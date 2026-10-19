/*!
 * 智办通 AI 智能办公助手 —— 智能体运行时（v2）
 * 真实的“规划 → 确认授权 → 执行 → 校验 → 交付/留档”循环：
 *   1. plan()    基于分析结果确定性生成动作计划（本地规则，可复现）
 *   2. 用户在界面逐条确认/取消（每条动作默认勾选但可取消，外部影响动作默认不自动发送）
 *   3. execute() 调用真实工具执行，每条动作有执行状态、产物校验与完整执行日志
 *   4. 信息不全的任务进入“待补充”区，不编造、不执行
 * 运行环境无关：浏览器/Node 均可，真正的“落地动作”由注入的 executor 实现
 * （浏览器端为下载文件、复制到剪贴板；不发送任何网络请求）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var T = require('./tools.js');
    module.exports = factory(T);
  } else {
    root.ZhiBanTongAgent = factory(root.ZhiBanTongTools);
  }
})(typeof self !== 'undefined' ? self : this, function (Tools) {
  'use strict';

  var TOOL_ORDER = ['calendar_ics', 'assignment', 'todo_csv', 'checklist_md', 'report_md', 'result_json'];
  var DELIVERY = { assignment: 'clipboard', calendar_ics: 'file', todo_csv: 'file', checklist_md: 'file', report_md: 'file', result_json: 'file' };

  function nowISO() { return new Date().toISOString(); }

  /* ---------------- 规划 ---------------- */
  function plan(result) {
    var todos = (result && result.todos) || [];
    var gaps = [];
    todos.forEach(function (t) {
      var questions = [];
      var concrete = (t.owners || []).filter(function (o) { return !/[部组]$/.test(o); });
      if (!concrete.length) questions.push((t.vagueOwners || []).length ? '责任人是泛称（' + t.vagueOwners.join('、') + '），请指定具体责任人' : '请补充责任人');
      if (!t.deadline) questions.push('请补充截止时间');
      if (t.confidence === 'low') questions.push('置信度低，建议人工核对任务描述');
      if (questions.length) gaps.push({ todoId: t.id, content: t.content, questions: questions, source: t.source });
    });

    var steps = TOOL_ORDER.map(function (id) {
      var tool = Tools.TOOLS[id];
      return {
        id: 'step_' + id,
        toolId: id,
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        riskNote: tool.riskNote || '',
        delivery: DELIVERY[id],
        requiresConfirm: true,
        selected: tool.defaultSelected === true,
        status: 'pending'
      };
    });

    var withDeadline = todos.filter(function (t) { return t.deadline; }).length;
    var withOwner = todos.filter(function (t) { return (t.owners || []).length; }).length;
    return {
      plannedAt: nowISO(),
      title: result.title || '智能执行计划',
      gaps: gaps,
      steps: steps,
      stats: {
        todoCount: todos.length,
        withDeadline: withDeadline,
        withOwner: withOwner,
        withoutDeadline: todos.length - withDeadline,
        withoutOwner: todos.length - withOwner,
        lowConfidence: todos.filter(function (t) { return t.confidence !== 'high'; }).length
      }
    };
  }

  /* ---------------- 执行 ----------------
   * executor = {
   *   downloadFile(output): Promise<{ok, size, error?}>
   *   copyText(text):      Promise<{ok, error?}>
   * }
   * 返回完整执行记录；未选中的步骤记 skipped；工具自检失败记 failed（不冒充成功）
   */
  async function execute(plan, result, executor) {
    var startedAt = nowISO();
    var records = [];
    for (var i = 0; i < plan.steps.length; i++) {
      var step = plan.steps[i];
      var rec = {
        stepId: step.id, toolId: step.toolId, name: step.name,
        delivery: step.delivery, startedAt: nowISO(),
        status: 'running', output: null, verify: null, error: null, finishedAt: null
      };
      if (!step.selected) {
        rec.status = 'skipped';
        rec.reason = '用户未勾选';
        rec.finishedAt = nowISO();
        records.push(rec);
        step.status = 'skipped';
        continue;
      }
      var toolResult;
      try {
        toolResult = Tools.TOOLS[step.toolId].run(result);
      } catch (e) {
        rec.status = 'failed';
        rec.error = '工具执行异常：' + (e && e.message ? e.message : String(e));
        rec.finishedAt = nowISO();
        records.push(rec);
        step.status = 'failed';
        continue;
      }
      if (toolResult.skipped) {
        rec.status = 'skipped';
        rec.reason = toolResult.reason;
        rec.output = toolResult.output;
        rec.finishedAt = nowISO();
        records.push(rec);
        step.status = 'skipped';
        continue;
      }
      rec.output = toolResult.output;
      // 产物校验（规则可验证）
      var verify = toolResult.verify;
      rec.verify = verify || null;
      if (verify && !verify.ok) {
        rec.status = 'failed';
        rec.error = '产物自检未通过：' + (verify.checks || []).filter(function (c) { return !c.ok; }).map(function (c) { return c.name; }).join('；');
        rec.finishedAt = nowISO();
        records.push(rec);
        step.status = 'failed';
        continue;
      }
      // 真正落地：下载文件或复制剪贴板
      try {
        if (step.delivery === 'clipboard') {
          var cp = await executor.copyText(toolResult.output.combined);
          if (!cp.ok) throw new Error(cp.error || '剪贴板写入失败');
        } else {
          var dl = await executor.downloadFile(toolResult.output);
          if (!dl.ok) throw new Error(dl.error || '文件下载失败');
          rec.fileSize = dl.size;
        }
        rec.status = 'done';
        step.status = 'done';
      } catch (e) {
        rec.status = 'failed';
        rec.error = (e && e.message ? e.message : String(e));
        step.status = 'failed';
      }
      rec.finishedAt = nowISO();
      records.push(rec);
    }

    var done = records.filter(function (r) { return r.status === 'done'; }).length;
    var failed = records.filter(function (r) { return r.status === 'failed'; }).length;
    var skipped = records.filter(function (r) { return r.status === 'skipped'; }).length;
    var run = {
      startedAt: startedAt,
      finishedAt: nowISO(),
      records: records,
      messages: null,
      summary: {
        total: records.length,
        done: done,
        failed: failed,
        skipped: skipped,
        passed: failed === 0
      }
    };
    // 派任务消息的分组结果留给 UI 逐个人复制（不改变日志）
    var assignmentRec = records.filter(function (r) { return r.toolId === 'assignment'; })[0];
    if (assignmentRec && assignmentRec.output && assignmentRec.output.messages) {
      run.messages = assignmentRec.output.messages;
    }
    return run;
  }

  /* ---------------- 最终交付说明（人工待办） ---------------- */
  function remainingManual(plan, result) {
    var items = [];
    if (plan.gaps.length) items.push('有 ' + plan.gaps.length + ' 项任务信息不全，需在界面上补充责任人或截止时间后再执行');
    var assigneeStep = plan.steps.filter(function (s) { return s.toolId === 'assignment'; })[0];
    if (assigneeStep && assigneeStep.selected) {
      items.push('派任务消息已复制到剪贴板，需你本人在微信/飞书/钉钉中确认后发送（系统不会自动发送消息）');
    }
    var calStep = plan.steps.filter(function (s) { return s.toolId === 'calendar_ics'; })[0];
    if (calStep && calStep.selected) {
      items.push('请在下载目录找到 .ics 文件并双击导入日历（或转发到手机打开）');
    }
    return items;
  }

  return {
    plan: plan,
    execute: execute,
    remainingManual: remainingManual,
    DELIVERY: DELIVERY
  };
});
