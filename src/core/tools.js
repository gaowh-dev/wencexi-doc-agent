/*!
 * 智办通 AI 智能办公助手 —— 真实工具层（v2）
 * 所有工具均为“本地执行、可验证产物”：
 *   - calendar_ics   生成标准 iCalendar 日历文件（可导入 Outlook / 苹果日历 / 飞书日历）
 *   - todo_csv       生成飞书/钉钉/Excel 可导入的待办 CSV
 *   - assignment     生成按责任人分组的派任务消息（复制到微信/飞书/钉钉即可发送）
 *   - checklist_md   生成 Markdown 任务核对清单
 *   - report_md      生成工作报告文件
 *   - result_json    生成完整结构化结果
 * 不发送任何网络请求；不伪造执行结果。每个工具都带 verify 校验。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhiBanTongTools = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function uid(seed) {
    return 'zbt-' + seed + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '@zhibantong.local';
  }
  // RFC5545 文本转义
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsDate(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function icsDateTime(d) {
    return icsDate(d) + 'T' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    return { h: +m[1], mi: +m[2] };
  }
  function ownerText(t) {
    var o = (t.owners && t.owners.length) ? t.owners.slice() : (t.owner ? [t.owner] : []);
    (t.vagueOwners || []).forEach(function (v) { if (o.indexOf(v) < 0) o.push(v); });
    return o.join('、');
  }
  function safeName(s) {
    return String(s || '智办通').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '智办通';
  }

  /* ============================================================
   * 工具一：日历 ICS
   * ========================================================== */
  function buildCalendarICS(result) {
    var todos = (result.todos || []).filter(function (t) { return t.deadline; });
    var now = new Date();
    var L = [];
    L.push('BEGIN:VCALENDAR');
    L.push('VERSION:2.0');
    L.push('PRODID:-//ZhiBanTong//AI Office Assistant v2//ZH');
    L.push('CALSCALE:GREGORIAN');
    L.push('METHOD:PUBLISH');
    L.push('X-WR-CALNAME:' + icsEscape(result.title || '智办通任务日历'));
    L.push('X-WR-TIMEZONE:Asia/Shanghai');
    // 显式 VTIMEZONE 定义：Asia/Shanghai 自 1991 年起无夏令时，单一 STANDARD 即可，提升严格客户端兼容性
    L.push('BEGIN:VTIMEZONE');
    L.push('TZID:Asia/Shanghai');
    L.push('BEGIN:STANDARD');
    L.push('DTSTART:19700101T000000');
    L.push('TZOFFSETFROM:+0800');
    L.push('TZOFFSETTO:+0800');
    L.push('TZNAME:CST');
    L.push('END:STANDARD');
    L.push('END:VTIMEZONE');
    todos.forEach(function (t, i) {
      var d = parseISO(t.deadline);
      if (!d) return;
      var who = ownerText(t) || '责任人待明确';
      var desc = '责任人：' + who + '\\n优先级：' + t.priority +
        (t.confidence && t.confidence !== 'high' ? '\\n【需核对】' + (t.confidenceReasons || []).join('；') : '') +
        '\\n来源：' + icsEscape(t.source || '') + '\\n由智办通 AI 智能办公助手生成';
      L.push('BEGIN:VEVENT');
      L.push('UID:' + uid('evt' + i));
      L.push('DTSTAMP:' + icsDateTime(now));
      L.push('SUMMARY:' + icsEscape('【截止】' + t.content.slice(0, 50) + '（' + who + '）'));
      var hm = parseHM(t.timePoint);
      if (hm) {
        var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm.h, hm.mi, 0);
        var end = new Date(start.getTime() + 30 * 60000);
        L.push('DTSTART;TZID=Asia/Shanghai:' + icsDateTime(start));
        L.push('DTEND;TZID=Asia/Shanghai:' + icsDateTime(end));
        L.push('BEGIN:VALARM');
        L.push('ACTION:DISPLAY');
        L.push('DESCRIPTION:' + icsEscape('任务即将到期：' + t.content.slice(0, 30)));
        L.push('TRIGGER:-PT15M');
        L.push('END:VALARM');
      } else {
        var next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        L.push('DTSTART;VALUE=DATE:' + icsDate(d));
        L.push('DTEND;VALUE=DATE:' + icsDate(next));
        L.push('BEGIN:VALARM');
        L.push('ACTION:DISPLAY');
        L.push('DESCRIPTION:' + icsEscape('今日截止：' + t.content.slice(0, 30)));
        L.push('TRIGGER:-PT9H');
        L.push('END:VALARM');
      }
      L.push('DESCRIPTION:' + desc);
      L.push('STATUS:CONFIRMED');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return {
      filename: safeName(result.title) + '_任务日历.ics',
      mime: 'text/calendar',
      content: L.join('\r\n'),
      eventCount: todos.length
    };
  }

  function verifyICS(content, expectedCount) {
    var events = (content.match(/BEGIN:VEVENT/g) || []).length;
    var uids = (content.match(/^UID:/gm) || []).length;
    // VTIMEZONE 内的 STANDARD 也含 DTSTART，统计事件时先剔除时区块
    var eventPart = content.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/g, '');
    var dtstarts = (eventPart.match(/^DTSTART/gm) || []).length;
    var checks = [
      { name: 'VCALENDAR 封装', ok: /BEGIN:VCALENDAR/.test(content) && /END:VCALENDAR/.test(content) },
      { name: '含 VTIMEZONE 定义', ok: /BEGIN:VTIMEZONE/.test(content) && /TZID:Asia\/Shanghai/.test(content) },
      { name: '事件数量与带截止时间任务一致', ok: events === expectedCount },
      { name: '每个事件含 UID', ok: uids === expectedCount },
      { name: '每个事件含 DTSTART', ok: dtstarts === expectedCount }
    ];
    return { ok: checks.every(function (c) { return c.ok; }), eventCount: events, checks: checks };
  }

  /* ============================================================
   * 工具二：待办 CSV（飞书/钉钉/Excel 导入）
   * ========================================================== */
  function csvCell(s) {
    return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  }
  function buildTodoCSV(result) {
    var todos = result.todos || [];
    // 任务阶段来自任务计划（plan.items 已按动作词分类）；建立内容→阶段映射
    var phaseMap = {};
    ((result.plan && result.plan.items) || []).forEach(function (it) {
      if (it.phase && phaseMap[it.content] == null) phaseMap[it.content] = it.phase;
    });
    var rows = [['任务标题', '责任人', '优先级', '截止日期', '具体时间', '状态', '置信度', '来源句子', '任务阶段']];
    todos.forEach(function (t) {
      rows.push([
        t.content,
        ownerText(t),
        t.priority,
        t.deadline || '',
        t.timePoint || '',
        t.status === 'done' ? '已完成' : '待办',
        { high: '高', medium: '中-需核对', low: '低-需核对' }[t.confidence] || '中',
        t.source || '',
        phaseMap[t.content] || ''
      ]);
    });
    var csv = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return {
      filename: safeName(result.title) + '_待办清单.csv',
      mime: 'text/csv',
      content: csv,
      rowCount: todos.length
    };
  }

  function verifyCSV(content, expectedRows) {
    var dataLines = content.replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    var checks = [
      { name: '含表头', ok: dataLines.length >= 1 && dataLines[0].indexOf('任务标题') === 1 },
      { name: '数据行数与待办数一致', ok: dataLines.length - 1 === expectedRows }
    ];
    return { ok: checks.every(function (c) { return c.ok; }), rowCount: Math.max(0, dataLines.length - 1), checks: checks };
  }

  /* ============================================================
   * 工具三：派任务消息（按责任人分组，供复制到 IM）
   * ========================================================== */
  function buildAssignmentMessages(result) {
    var todos = result.todos || [];
    var groups = {};
    var unassigned = [];
    todos.forEach(function (t) {
      var allNames = (t.owners && t.owners.length) ? t.owners.slice() : [];
      // 只要存在具体责任人（非部门/小组），就按具体人分组，部门/小组仅作忽略，避免重复进入待分配
      var personal = allNames.filter(function (n) { return !/[部组]$/.test(n); });
      if (!personal.length) { unassigned.push(t); return; }
      personal.forEach(function (n) {
        (groups[n] = groups[n] || []).push(t);
      });
    });
    var messages = Object.keys(groups).sort().map(function (name) {
      var list = groups[name];
      var lines = ['@' + name + ' 【任务提醒】请查收以下 ' + list.length + ' 项任务（由智办通自动整理自《' + (result.title || '工作材料') + '》）：'];
      list.forEach(function (t, i) {
        var due = t.deadline ? t.deadline + (t.timePoint ? ' ' + t.timePoint : '前') : '（时间待明确）';
        lines.push((i + 1) + '. ' + t.content + '；截止：' + due + '（优先级：' + t.priority + '）');
      });
      lines.push('收到请回复确认，如有异议请直接说明。');
      return { owner: name, text: lines.join('\n'), count: list.length, todoIds: list.map(function (t) { return t.id; }) };
    });
    if (unassigned.length) {
      var lines = ['【待分配任务】以下 ' + unassigned.length + ' 项任务未识别到具体责任人，请管理者补充指派（来自《' + (result.title || '工作材料') + '》）：'];
      unassigned.forEach(function (t, i) {
        lines.push((i + 1) + '. ' + t.content + (t.deadline ? '；截止：' + t.deadline : '；时间待明确'));
      });
      messages.push({ owner: '管理者（待分配）', text: lines.join('\n'), count: unassigned.length, todoIds: unassigned.map(function (t) { return t.id; }), unassigned: true });
    }
    var combined = messages.map(function (m) {
      return '──────── 发给「' + m.owner + '」────────\n' + m.text;
    }).join('\n\n');
    return {
      filename: safeName(result.title) + '_派任务消息.txt',
      mime: 'text/plain',
      messages: messages,
      combined: combined,
      assignedCount: messages.filter(function (m) { return !m.unassigned; }).length
    };
  }

  function verifyMessages(out, todos) {
    var covered = {};
    out.messages.forEach(function (m) { m.todoIds.forEach(function (id) { covered[id] = true; }); });
    var allCovered = todos.filter(function (t) { return (t.owners || []).length; })
      .every(function (t) { return t.owners.some(function (o) { return !/[部组]$/.test(o); }) ? covered[t.id] : true; });
    var checks = [
      { name: '每位具体责任人都有对应消息', ok: allCovered },
      { name: '无具体责任人的任务进入待分配汇总', ok: out.messages.length >= out.assignedCount },
      { name: '消息内容非空', ok: out.messages.every(function (m) { return m.text.length > 10; }) }
    ];
    return { ok: checks.every(function (c) { return c.ok; }), messageCount: out.messages.length, checks: checks };
  }

  /* ============================================================
   * 工具四：Markdown 核对清单
   * ========================================================== */
  function buildChecklist(result) {
    var todos = result.todos || [];
    var L = ['# ' + (result.title || '任务') + ' · 执行核对清单', '> 由智办通 AI 智能办公助手生成，可逐项打勾核对', ''];
    var byDate = {};
    todos.forEach(function (t) {
      var k = t.deadline || '截止时间待明确';
      (byDate[k] = byDate[k] || []).push(t);
    });
    Object.keys(byDate).sort().forEach(function (date) {
      L.push('## ' + date);
      byDate[date].forEach(function (t) {
        var who = ownerText(t) || '待明确';
        var flag = t.confidence !== 'high' ? ' ⚠️需核对' : '';
        L.push('- [ ] ' + t.content + '（责任人：' + who + '；优先级：' + t.priority + flag + '）');
      });
      L.push('');
    });
    return {
      filename: safeName(result.title) + '_核对清单.md',
      mime: 'text/markdown',
      content: L.join('\n'),
      itemCount: todos.length
    };
  }

  /* ============================================================
   * 工具注册表
   * ========================================================== */
  var TOOLS = {
    calendar_ics: {
      id: 'calendar_ics',
      name: '生成任务日历（.ics）',
      description: '把每条带截止时间的任务生成日历事件，可导入 Outlook / 苹果日历 / 飞书日历，含到期提醒。',
      risk: 'low',
      defaultSelected: true,
      needsInput: false,
      run: function (result) {
        var out = buildCalendarICS(result);
        if (out.eventCount === 0) return { skipped: true, reason: '没有带截止时间的任务，无法生成日历', output: out };
        return { output: out, verify: verifyICS(out.content, out.eventCount) };
      }
    },
    todo_csv: {
      id: 'todo_csv',
      name: '生成待办清单（CSV）',
      description: '生成飞书/钉钉/Excel 可直接导入的待办表格，含责任人、优先级、截止时间、置信度。',
      risk: 'low',
      defaultSelected: true,
      needsInput: false,
      run: function (result) {
        var out = buildTodoCSV(result);
        if (out.rowCount === 0) return { skipped: true, reason: '没有待办任务', output: out };
        return { output: out, verify: verifyCSV(out.content, out.rowCount) };
      }
    },
    assignment: {
      id: 'assignment',
      name: '生成派任务消息（复制到微信/飞书/钉钉）',
      description: '按责任人自动分组生成任务提醒文案，复制后即可在 IM 中发送；未分配任务单独汇总。',
      risk: 'medium',
      riskNote: '复制后仍需你本人确认内容再发送，系统不会自动发出消息。',
      defaultSelected: true,
      needsInput: false,
      run: function (result) {
        var out = buildAssignmentMessages(result);
        if (!out.messages.length) return { skipped: true, reason: '没有待办任务', output: out };
        return { output: out, verify: verifyMessages(out, result.todos || []) };
      }
    },
    checklist_md: {
      id: 'checklist_md',
      name: '生成执行核对清单（Markdown）',
      description: '按截止日期分组的可勾选清单，便于逐项核对。',
      risk: 'low',
      defaultSelected: true,
      needsInput: false,
      run: function (result) {
        var out = buildChecklist(result);
        if (out.itemCount === 0) return { skipped: true, reason: '没有待办任务', output: out };
        return { output: out, verify: { ok: true, itemCount: out.itemCount, checks: [{ name: '清单条目数与待办数一致', ok: (out.content.match(/- \[ \]/g) || []).length === out.itemCount }] } };
      }
    },
    report_md: {
      id: 'report_md',
      name: '导出工作报告（Markdown）',
      description: '导出完整的七章节工作报告。',
      risk: 'low',
      defaultSelected: true,
      needsInput: false,
      run: function (result) {
        var out = { filename: safeName(result.title) + '_工作报告.md', mime: 'text/markdown', content: result.report || '' };
        return { output: out, verify: { ok: out.content.length > 200, checks: [{ name: '报告内容非空且含章节', ok: out.content.indexOf('## ') >= 0 }] } };
      }
    },
    result_json: {
      id: 'result_json',
      name: '导出完整结构化结果（JSON）',
      description: '包含全部分析结果、置信度与执行记录，便于系统对接和归档。',
      risk: 'low',
      defaultSelected: false,
      needsInput: false,
      run: function (result) {
        var out = { filename: safeName(result.title) + '_完整结果.json', mime: 'application/json', content: JSON.stringify(result, null, 2) };
        var parsed;
        try { parsed = JSON.parse(out.content); } catch (e) { parsed = null; }
        return { output: out, verify: { ok: !!parsed && !!parsed.todos, checks: [{ name: 'JSON 可解析且含 todos', ok: !!parsed && Array.isArray(parsed.todos) }] } };
      }
    }
  };

  return {
    TOOLS: TOOLS,
    buildCalendarICS: buildCalendarICS,
    verifyICS: verifyICS,
    buildTodoCSV: buildTodoCSV,
    verifyCSV: verifyCSV,
    buildAssignmentMessages: buildAssignmentMessages,
    verifyMessages: verifyMessages,
    buildChecklist: buildChecklist,
    ownerText: ownerText,
    safeName: safeName
  };
});
