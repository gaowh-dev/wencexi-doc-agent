/* ============================================================
 * 智办通 · 前端交互逻辑
 * ============================================================ */
(function () {
  'use strict';

  var Engine = window.ZhiBanTong;
  var Tools = window.ZhiBanTongTools;
  var Agent = window.ZhiBanTongAgent;
  var MobileClaw = window.MobileClawAdapter;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    result: null,          // 最近一次完整分析结果
    currentTab: 'analysis',
    agentPlan: null,       // 智能体执行计划（含用户勾选状态）
    agentRun: null,        // 最近一次执行记录
    history: loadHistory()
  };

  /* ---------------- 示例材料 ---------------- */
  var SAMPLE = [
    '智办通V1.0产品研发项目周例会会议纪要',
    '时间：2026年10月21日 下午2点',
    '地点：昆明市高新区海源北路云科大厦12层大会议室',
    '参会人员：产品部、研发部、测试组及项目组全体成员。会议由王磊总监主持，主要讨论智办通V1.0版本上线前的准备工作。',
    '',
    '一、上周进展：核心文本分析引擎已完成开发，关键词提取和待办识别功能测试通过，整体进度比原计划提前2天，客户体验调研满意度达85%。',
    '二、存在问题：移动端页面在小屏幕上存在布局错位问题，需要在10月23日之前完成修复；测试组反馈缺陷12个，其中严重缺陷2个。',
    '三、预算方面：项目合同金额为35万元，其中供应商报价18万元，需在10月30日前完成合同审批和付款。',
    '四、会议要求：',
    '1. 请研发部张伟工程师在10月22日下午6点前完成前端兼容性修复并提交代码；',
    '2. 请测试组李娟负责在10月23日完成回归测试，并于当天下午5点前反馈测试报告；',
    '3. 请产品部赵敏在本周四前完成用户操作手册初稿；',
    '4. 请项目经理王磊在10月28日前组织上线前评审会，确认发布时间；',
    '5. 运营部需要在10月31日前完成宣传文案和发布会材料的准备；',
    '6. 建议大家在11月2日之前完成内部培训，确保上线后平稳运行。',
    '五、下次会议定于10月28日上午10点在同一会议室召开。'
  ].join('\n');

  /* ---------------- 工具函数 ---------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 2200);
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------------- localStorage 历史 ---------------- */
  var HIST_KEY = 'zhibantong_history_v1';
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistoryStore() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(state.history)); }
    catch (e) { toast('浏览器存储已满，历史保存失败'); }
  }

  /* ============================================================
   * 核心：一键分析
   * ============================================================ */
  function runAnalyze() {
    var text = $('inputText').value.trim();
    if (!text) { toast('请先粘贴或上传办公材料'); return; }
    var title = $('docTitle').value.trim();
    var result = Engine.processAll(text, { title: title });
    state.result = result;
    state.agentPlan = null;
    state.agentRun = null;
    $('emptyState').hidden = true;
    $('resultToolbar').hidden = false;
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = true; });
    switchTab('analysis');
    renderAll();
    toast('分析完成：共识别 ' + result.todos.length + ' 项待办、' + result.check.issues.length + ' 个检查项');
  }

  /* 待办被人工修改后，重算计划/检查/报告（保留人工修改，不重新识别） */
  function recomputeDerived() {
    var r = state.result;
    if (!r) return;
    var base = new Date();
    r.plan = Engine.makePlan(r.todos, base);
    r.check = Engine.checkIssues(r.text, r.todos, base);
    r.report = Engine.generateReport({
      title: r.title, text: r.text,
      analysis: r.analysis, entities: r.entities,
      todos: r.todos, plan: r.plan, check: r.check, baseDate: base
    });
    state.agentPlan = null;
    state.agentRun = null;
  }

  function renderAll() {
    renderAnalysis();
    renderEntities();
    renderTodos();
    renderAgent();
    renderPlan();
    renderReport();
    renderDashboard();
    renderCheck();
    renderTabBadges();
  }

  /* ---------------- 材料分析 ---------------- */
  function renderAnalysis() {
    var r = state.result, a = r.analysis, s = a.stats;
    var html = '';
    html += '<div class="section-title">基础统计</div>';
    html += '<div class="stat-grid">' +
      stat(s.chars, '正文字数（不含空白）') +
      stat(s.sentenceCount, '句子数量') +
      stat(s.paragraphCount, '段落数量') +
      stat(s.avgSentenceLength, '平均句长（字）') +
      stat(s.readingMinutes, '预计阅读（分钟）') +
      stat(a.keywords.length, '核心关键词') +
      '</div>';

    html += '<div class="section-title">文档分类与倾向</div>';
    html += '<div class="tone-bar">' +
      '<span class="tone-chip neu">文档类型：<b>' + escapeHtml(a.category) + '</b></span>' +
      '<span class="tone-chip ' + (a.tone.label.indexOf('积极') >= 0 ? 'pos' : a.tone.label.indexOf('消极') >= 0 ? 'neg' : 'neu') + '">整体倾向：<b>' + escapeHtml(a.tone.label) + '</b>（积极词 ' + a.tone.positiveScore + ' / 消极词 ' + a.tone.negativeScore + '）</span>' +
      '</div>';
    if (a.tone.positiveWords.length) html += '<p style="margin-top:8px;font-size:13px;color:#15803d">积极表述：' + a.tone.positiveWords.map(escapeHtml).join('、') + '</p>';
    if (a.tone.negativeWords.length) html += '<p style="margin-top:4px;font-size:13px;color:#b91c1c">风险表述：' + a.tone.negativeWords.map(escapeHtml).join('、') + '</p>';

    html += '<div class="section-title">核心关键词</div>';
    html += '<div class="tag-cloud">' + a.keywords.map(function (k) {
      return '<span class="keyword-tag">' + escapeHtml(k.word) + '<small>' + k.weight + '</small></span>';
    }).join('') + '</div>';

    html += '<div class="section-title">智能摘要（抽取式 · ' + a.summary.length + ' 句）</div>';
    html += '<ul class="summary-list">' + a.summary.map(function (x, i) {
      return '<li data-i="' + (i + 1) + '">' + escapeHtml(x) + '</li>';
    }).join('') + '</ul>';

    $('pane-analysis').innerHTML = html;
  }
  function stat(num, label) {
    return '<div class="stat-card"><div class="num">' + num + '</div><div class="label">' + label + '</div></div>';
  }

  /* ---------------- 关键信息 ---------------- */
  function renderEntities() {
    var e = state.result.entities;
    function card(title, items, render, cls) {
      var body = items.length
        ? items.map(function (x) { return '<span class="entity-item ' + (cls || '') + '">' + render(x) + '</span>'; }).join('')
        : '<span class="entity-empty">未识别到</span>';
      return '<div class="entity-card"><div class="ec-head"><span>' + title + '</span><span class="ec-count">' + items.length + ' 项</span></div><div class="ec-body">' + body + '</div></div>';
    }
    var html = '<div class="entity-grid">' +
      card('日期', e.dates, function (x) { return escapeHtml(x.iso) + ' <small style="opacity:.6">' + escapeHtml(x.raw) + '</small>'; }, 'date') +
      card('时间点', e.times, function (x) { return escapeHtml(x.text); }, 'date') +
      card('截止时间', e.deadlines, function (x) { return escapeHtml(x.iso) + (x.time ? ' ' + escapeHtml(x.time) : '') + '<br><small style="opacity:.65">' + escapeHtml(x.raw) + '</small>'; }, 'warn') +
      card('金额信息', e.money, function (x) { return escapeHtml(x.raw) + '（约 ' + x.approxYuan.toLocaleString() + ' 元）'; }) +
      card('百分比', e.percents, function (x) { return escapeHtml(x.raw); }) +
      card('电话号码', e.phones, function (x) { return escapeHtml(x); }) +
      card('邮箱', e.emails, function (x) { return escapeHtml(x); }) +
      card('网址', e.urls, function (x) { return escapeHtml(x); }) +
      card('组织机构', e.organizations, function (x) { return escapeHtml(x); }) +
      card('人物', e.persons, function (x) { return escapeHtml(x); }) +
      card('地点', e.places, function (x) { return escapeHtml(x); }) +
      card('场所', e.venues, function (x) { return escapeHtml(x); }) +
      card('证件号码', e.idCards, function (x) { return escapeHtml(x); }) +
      '</div>';
    $('pane-entities').innerHTML = html;
  }

  /* ---------------- 待办与进度（可编辑） ---------------- */
  function ownerLabel(t) {
    var o = (t.owners || []).slice();
    (t.vagueOwners || []).forEach(function (v) { if (o.indexOf(v) < 0) o.push(v); });
    return o.join('、');
  }
  function confBadge(t) {
    var map = {
      high: ['conf-high', '高置信'],
      medium: ['conf-mid', '中置信'],
      low: ['conf-low', '低置信']
    };
    var c = map[t.confidence] || map.medium;
    var title = (t.confidenceReasons || []).join('；');
    return '<span class="conf-badge ' + c[0] + '" title="' + escapeHtml(title) + '">' + c[1] + '</span>';
  }
  function renderTodos() {
    var todos = state.result.todos;
    var done = todos.filter(function (t) { return t.status === 'done'; }).length;
    var pct = todos.length ? Math.round(done / todos.length * 100) : 0;
    var html = '<div class="progress-wrap">' +
      '<div class="progress-info"><b>任务执行进度</b><span>' + done + ' / ' + todos.length + ' 已完成（' + pct + '%）</span></div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';

    // 手动新增
    html += '<div class="todo-add">' +
      '<input type="text" id="newTodoContent" placeholder="手动新增任务内容" />' +
      '<input type="text" id="newTodoOwner" placeholder="责任人" />' +
      '<input type="date" id="newTodoDate" />' +
      '<select id="newTodoPrio"><option value="高">高</option><option value="中" selected>中</option><option value="低">低</option></select>' +
      '<button class="btn tiny primary" id="btnAddTodo">+ 添加</button>' +
      '</div>';

    if (!todos.length) {
      html += '<p class="muted">未从材料中识别出明确的待办事项。可直接在上方手动添加，或使用「请XX在X日前完成XX」这类表述。</p>';
    } else {
      html += todos.map(function (t) {
        return '<div class="todo-item ' + (t.status === 'done' ? 'done' : '') + '" data-id="' + t.id + '">' +
          '<input type="checkbox" class="todo-check" ' + (t.status === 'done' ? 'checked' : '') + ' data-id="' + t.id + '">' +
          '<div class="todo-main">' +
          '<div class="todo-row1">' +
            '<input class="todo-input todo-content-edit" value="' + escapeHtml(t.content) + '" data-id="' + t.id + '" data-field="content" />' +
            '<button class="todo-del" data-id="' + t.id + '" title="删除该任务">×</button>' +
          '</div>' +
          '<div class="todo-meta">' +
            '<span class="mini-tag priority-' + t.priority + '"><label>优先级</label>' +
              '<select class="todo-inline-edit" data-id="' + t.id + '" data-field="priority">' +
                ['高', '中', '低'].map(function (p) { return '<option value="' + p + '"' + (t.priority === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
              '</select>' +
            '</span>' +
            '<span class="mini-tag ' + (t.owners.length || t.vagueOwners.length ? 'owner' : 'none') + '">👤 <input class="todo-input todo-owner-edit" value="' + escapeHtml(ownerLabel(t)) + '" data-id="' + t.id + '" data-field="owner" placeholder="责任人" /></span>' +
            '<span class="mini-tag ' + (t.deadline ? 'date' : 'none') + '">📅 <input type="date" class="todo-date-edit" value="' + (t.deadline || '') + '" data-id="' + t.id + '" data-field="deadline" /></span>' +
            confBadge(t) +
          '</div>' +
          '<div class="todo-source" title="原文出处">📍 来源：' + escapeHtml(t.source || '（无）') + '</div>' +
          '</div></div>';
      }).join('');
    }
    $('pane-todos').innerHTML = html;
    bindTodoEdits(todos);
  }

  function bindTodoEdits(todos) {
    var pane = $('pane-todos');

    function find(id) { return todos.find(function (x) { return x.id === id; }); }

    pane.querySelectorAll('.todo-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var t = find(cb.getAttribute('data-id'));
        if (t) {
          t.status = cb.checked ? 'done' : 'pending';
          renderTodos();
          recomputeDerived();
          renderPlan(); renderReport(); renderDashboard(); renderCheck(); renderAgent(); renderTabBadges();
        }
      });
    });

    pane.querySelectorAll('.todo-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('确定删除这条任务吗？')) return;
        var idx = state.result.todos.findIndex(function (x) { return x.id === id; });
        if (idx >= 0) state.result.todos.splice(idx, 1);
        recomputeDerived();
        renderAll();
        toast('任务已删除');
      });
    });

    pane.querySelectorAll('.todo-inline-edit').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var t = find(sel.getAttribute('data-id'));
        if (!t) return;
        t.priority = sel.value;
        t.confidence = 'high'; t.confidenceReasons = ['人工修改优先级'];
        recomputeDerived();
        renderPlan(); renderReport(); renderDashboard(); renderAgent();
      });
    });

    pane.querySelectorAll('.todo-content-edit').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var t = find(inp.getAttribute('data-id'));
        if (!t) return;
        var v = inp.value.trim();
        if (!v) { inp.value = t.content; return; }
        t.content = v;
        t.confidence = 'high'; t.confidenceReasons = ['人工修改任务内容'];
        recomputeDerived();
        renderPlan(); renderReport(); renderDashboard(); renderCheck(); renderAgent();
      });
    });

    pane.querySelectorAll('.todo-owner-edit').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var t = find(inp.getAttribute('data-id'));
        if (!t) return;
        var parts = inp.value.split(/[、,，\/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        t.owners = parts; t.vagueOwners = []; t.owner = parts.join('、');
        t.confidence = 'high'; t.confidenceReasons = ['人工指定责任人'];
        recomputeDerived();
        renderPlan(); renderReport(); renderDashboard(); renderCheck(); renderAgent();
      });
    });

    pane.querySelectorAll('.todo-date-edit').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var t = find(inp.getAttribute('data-id'));
        if (!t) return;
        t.deadline = inp.value || '';
        t.timePoint = '';
        t.deadlineRaw = inp.value ? ('人工设定：' + inp.value) : '';
        t.confidence = 'high'; t.confidenceReasons = ['人工设定截止时间'];
        recomputeDerived();
        renderPlan(); renderReport(); renderDashboard(); renderCheck(); renderAgent();
      });
    });

    var addBtn = $('btnAddTodo');
    if (addBtn) addBtn.addEventListener('click', function () {
      var c = $('newTodoContent').value.trim();
      if (!c) { toast('请先填写任务内容'); return; }
      var owners = $('newTodoOwner').value.split(/[、,，\/\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var t = {
        id: 'todo_manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        content: c,
        priority: $('newTodoPrio').value,
        owners: owners,
        vagueOwners: [],
        owner: owners.join('、'),
        deadline: $('newTodoDate').value || '',
        timePoint: '',
        deadlineRaw: '',
        status: 'pending',
        source: '用户手动添加',
        sentenceIndex: -1,
        confidence: 'high',
        confidenceReasons: ['用户手动添加']
      };
      state.result.todos.push(t);
      recomputeDerived();
      renderAll();
      toast('已添加任务');
    });
  }

  /* ============================================================
   * 智能体执行（规划 → 确认 → 执行 → 校验 → 交付）
   * ============================================================ */
  function getPlan() {
    if (!state.agentPlan && state.result) state.agentPlan = Agent.plan(state.result);
    return state.agentPlan;
  }

  /* 浏览器执行器：真正的落地动作 = 下载文件 / 复制剪贴板，不发送任何网络请求 */
  function makeBrowserExecutor() {
    return {
      downloadFile: function (output) {
        return new Promise(function (resolve) {
          try {
            var blob = new Blob([output.content], { type: (output.mime || 'text/plain') + ';charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = output.filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
            resolve({ ok: true, size: blob.size });
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      },
      copyText: function (text) {
        return new Promise(function (resolve) {
          function fallback() {
            try {
              var ta = document.createElement('textarea');
              ta.value = text;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              var ok = document.execCommand('copy');
              ta.remove();
              ok ? resolve({ ok: true }) : resolve({ ok: false, error: '浏览器拒绝剪贴板访问' });
            } catch (e) { resolve({ ok: false, error: e.message }); }
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { resolve({ ok: true }); }, fallback);
          } else fallback();
        });
      }
    };
  }

  function renderAgent() {
    var pane = $('pane-agent');
    if (!state.result) {
      pane.innerHTML = '<p class="muted">请先完成一次材料分析，智能体将基于分析结果生成可执行的动作计划。</p>';
      return;
    }
    var plan = getPlan();
    var mc = MobileClaw.status();
    var html = '';

    // MobileClaw 通道状态（诚实展示）
    html += '<div class="mc-bar ' + (mc.connected ? 'ok' : 'off') + '">' +
      '<b>📱 MobileClaw 手机执行通道：' + (mc.connected ? '已连接' : '未连接') + '</b>' +
      '<span class="mc-note">' + (mc.connected ? '' : '当前使用本地真实替代方案：' + mc.currentFallback + '；未模拟任何手机操作。') + '</span>' +
      '</div>';

    // 计划概览
    var s = plan.stats;
    html += '<div class="agent-stats">' +
      psCard(s.todoCount, '待办总数') +
      psCard(s.withDeadline, '有截止时间') +
      psCard(s.withOwner, '有责任人') +
      psCard(s.lowConfidence, '需核对') +
      '</div>';

    // 信息缺口
    if (plan.gaps.length) {
      html += '<div class="gap-box"><div class="section-title">⚠️ 执行前需要补齐的信息（' + plan.gaps.length + ' 项）</div>';
      plan.gaps.forEach(function (g) {
        html += '<div class="gap-item"><b>' + escapeHtml(g.content.slice(0, 40)) + '</b>' +
          '<ul>' + g.questions.map(function (q) { return '<li>' + escapeHtml(q) + '</li>'; }).join('') + '</ul>' +
          '<div class="muted small">可在「待办与进度」页直接修改，修改后计划自动更新。</div></div>';
      });
      html += '</div>';
    } else {
      html += '<div class="gap-box ok">✅ 全部任务都有责任人与截止时间，可直接执行。</div>';
    }

    // 动作计划
    html += '<div class="section-title">动作计划（逐条确认后执行）</div>';
    html += '<div class="agent-steps">';
    plan.steps.forEach(function (step, idx) {
      var runState = state.agentRun ? state.agentRun.records[idx] : null;
      var icon = runState ? { done: '✅', failed: '❌', skipped: '⏭️' }[runState.status] || '⏳' : '⏳';
      html += '<div class="agent-step ' + (runState ? runState.status : 'pending') + '">' +
        '<label class="step-check"><input type="checkbox" class="step-select" data-idx="' + idx + '" ' + (step.selected ? 'checked' : '') + ' />' +
          '<span class="step-icon">' + icon + '</span>' +
          '<span class="step-name">' + escapeHtml(step.name) + '</span>' +
          '<span class="risk-tag risk-' + step.risk + '">' + (step.risk === 'low' ? '低风险' : '需确认') + '</span>' +
        '</label>' +
        '<div class="step-desc">' + escapeHtml(step.description) +
          (step.delivery === 'file' ? '（生成为文件下载）' : '（复制到剪贴板，由你本人发送）') +
        '</div>' +
        (step.riskNote ? '<div class="step-risk-note">🔒 ' + escapeHtml(step.riskNote) + '</div>' : '') +
        (runState && runState.error ? '<div class="step-error">失败原因：' + escapeHtml(runState.error) + '</div>' : '') +
        (runState && runState.status === 'skipped' ? '<div class="step-skip">已跳过：' + escapeHtml(runState.reason || '用户未勾选') + '</div>' : '') +
        (runState && runState.verify ? '<div class="step-verify">' +
          runState.verify.checks.map(function (c) {
            return '<span class="verify-' + (c.ok ? 'ok' : 'bad') + '">' + (c.ok ? '✓' : '✗') + ' ' + escapeHtml(c.name) + '</span>';
          }).join('') +
          (runState.fileSize ? '<span class="verify-size">文件 ' + (runState.fileSize / 1024).toFixed(1) + ' KB</span>' : '') +
          '</div>' : '') +
        (runState && runState.output && runState.output.filename && runState.status === 'done' ?
          '<button class="btn tiny step-redl" data-idx="' + idx + '">重新下载 ' + escapeHtml(runState.output.filename) + '</button>' : '') +
        '</div>';
    });
    html += '</div>';

    html += '<div class="agent-actions">' +
      '<button class="btn primary big" id="btnRunAgent">③ 执行选中的动作</button>' +
      '<button class="btn" id="btnReplan">刷新计划（应用待办修改）</button>' +
      '</div>';

    // 执行结果汇总
    if (state.agentRun) {
      var sm = state.agentRun.summary;
      html += '<div class="run-summary ' + (sm.passed ? 'pass' : 'fail') + '">' +
        '执行完成：✅ 成功 ' + sm.done + ' 项　❌ 失败 ' + sm.failed + ' 项　⏭️ 跳过 ' + sm.skipped + ' 项' +
        (sm.passed ? '（所有产物自检通过）' : '（存在失败项，请查看上方失败原因）') +
        '</div>';
      if (state.agentRun.messages && state.agentRun.messages.length) {
        html += '<div class="section-title">派任务消息（逐条复制，由你本人发送）</div><div class="msg-list">';
        state.agentRun.messages.forEach(function (m, i) {
          html += '<div class="msg-card' + (m.unassigned ? ' unassigned' : '') + '">' +
            '<div class="msg-head"><b>发给：' + escapeHtml(m.owner) + '</b>（' + m.count + ' 项）' +
            '<button class="btn tiny msg-copy" data-msg="' + i + '">复制该消息</button></div>' +
            '<pre class="msg-text">' + escapeHtml(m.text) + '</pre></div>';
        });
        html += '</div>';
      }
      var manual = Agent.remainingManual(plan, state.result);
      if (manual.length) {
        html += '<div class="section-title">还需要你人工完成的步骤</div><ul class="manual-list">' +
          manual.map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
      }
    }

    pane.innerHTML = html;

    pane.querySelectorAll('.step-select').forEach(function (cb) {
      cb.addEventListener('change', function () {
        plan.steps[+cb.getAttribute('data-idx')].selected = cb.checked;
      });
    });
    $('btnReplan').addEventListener('click', function () {
      state.agentPlan = Agent.plan(state.result);
      state.agentRun = null;
      renderAgent();
      toast('计划已按最新待办刷新');
    });
    $('btnRunAgent').addEventListener('click', runAgent);

    pane.querySelectorAll('.step-redl').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var rec = state.agentRun.records[+btn.getAttribute('data-idx')];
        if (rec && rec.output) makeBrowserExecutor().downloadFile(rec.output);
      });
    });
    pane.querySelectorAll('.msg-copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = state.agentRun.messages[+btn.getAttribute('data-msg')];
        makeBrowserExecutor().copyText(m.text).then(function (r) {
          r.ok ? toast('已复制发给「' + m.owner + '」的消息，请在 IM 中粘贴发送') : toast('复制失败：' + r.error);
        });
      });
    });
  }

  async function runAgent() {
    var plan = getPlan();
    if (!plan.steps.some(function (s) { return s.selected; })) { toast('请至少勾选一个动作'); return; }
    var btn = $('btnRunAgent');
    btn.disabled = true;
    btn.textContent = '执行中…';
    try {
      state.agentRun = await Agent.execute(plan, state.result, makeBrowserExecutor());
      renderAgent();
      var sm = state.agentRun.summary;
      toast('执行完成：成功 ' + sm.done + ' / 失败 ' + sm.failed + ' / 跳过 ' + sm.skipped);
    } catch (e) {
      toast('执行中断：' + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = '③ 执行选中的动作';
    }
  }

  /* ---------------- 任务计划 ---------------- */
  function renderPlan() {
    var p = state.result.plan;
    var html = '<div class="plan-summary">' +
      psCard(p.totalTasks, '任务总数') +
      psCard(p.workdaysUsed, '占用工作日') +
      psCard(p.startDate || '—', '开始日期') +
      psCard(p.endDate || '—', '结束日期') +
      psCard(p.milestones.length, '关键里程碑') +
      '</div>';
    if (!p.totalTasks) { html += '<p class="muted">暂无待办任务，无法排期。</p>'; $('pane-plan').innerHTML = html; return; }

    p.phases.forEach(function (ph) {
      html += '<div class="phase-block"><div class="phase-title">' + escapeHtml(ph.name) + '（' + ph.items.length + ' 项）</div>';
      html += '<table class="plan-table"><thead><tr><th style="width:110px">日期</th><th style="width:60px">星期</th><th>任务</th><th style="width:120px">责任人</th><th style="width:70px">优先级</th></tr></thead><tbody>';
      ph.items.forEach(function (it) {
        html += '<tr' + (it.overdue ? ' style="background:#fff5f5"' : '') + '>' +
          '<td>' + it.date + '</td><td>' + it.weekday + '</td>' +
          '<td>' + escapeHtml(it.content) + (it.overdue ? ' <span class="mini-tag priority-高">日期已过</span>' : '') + '</td>' +
          '<td>' + escapeHtml(it.owner || '待明确') + '</td>' +
          '<td><span class="mini-tag priority-' + it.priority + '">' + it.priority + '</span></td></tr>';
      });
      html += '</tbody></table></div>';
    });

    if (p.milestones.length) {
      html += '<div class="section-title">关键里程碑（来自材料中的明确截止时间）</div>';
      html += '<ul class="milestone-list">' + p.milestones.map(function (m) {
        return '<li><b>' + m.date + '（' + m.weekday + '）</b>' + (m.overdue ? '　⚠️ 该日期已过，请立即确认' : '') + '<br>' + escapeHtml(m.content) + '</li>';
      }).join('') + '</ul>';
    }
    $('pane-plan').innerHTML = html;
  }
  function psCard(v, label) {
    return '<div class="ps-card"><b>' + escapeHtml(String(v)) + '</b><span>' + label + '</span></div>';
  }

  /* ---------------- 工作报告 ---------------- */
  function renderReport(aiMarkdown) {
    var md = aiMarkdown || state.result.report;
    var html = '<div class="report-doc">' + renderMarkdown(md) + '</div>';
    if (aiMarkdown) html += '<p class="muted small" style="margin-top:10px">✨ 以上为配置的大模型增强结果。<button class="btn tiny" id="btnBackLocal">恢复本地引擎版本</button></p>';
    $('pane-report').innerHTML = html;
    var back = $('btnBackLocal');
    if (back) back.addEventListener('click', function () { renderReport(); });
  }

  /* 极简 Markdown 渲染（支持标题/表格/列表/引用/粗体/代码/分隔线） */
  function renderMarkdown(md) {
    var lines = md.split('\n');
    var out = [];
    var i = 0;
    function inline(s) {
      s = escapeHtml(s);
      s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      return s;
    }
    while (i < lines.length) {
      var line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^###\s+/.test(line)) { out.push('<h3>' + inline(line.replace(/^###\s+/, '')) + '</h3>'); i++; continue; }
      if (/^##\s+/.test(line)) { out.push('<h2>' + inline(line.replace(/^##\s+/, '')) + '</h2>'); i++; continue; }
      if (/^#\s+/.test(line)) { out.push('<h1>' + inline(line.replace(/^#\s+/, '')) + '</h1>'); i++; continue; }
      if (/^---\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
      if (/^>\s?/.test(line)) {
        var buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
        continue;
      }
      if (/^\|/.test(line)) {
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        if (rows.length >= 2) {
          var head = rows[0].split('|').slice(1, -1).map(function (c) { return c.trim(); });
          var bodyRows = rows.slice(2);
          var table = '<table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
          bodyRows.forEach(function (r) {
            var cells = r.split('|').slice(1, -1).map(function (c) { return c.trim(); });
            table += '<tr>' + cells.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          });
          table += '</tbody></table>';
          out.push(table);
        }
        continue;
      }
      if (/^\d+\.\s/.test(line)) {
        var ol = [];
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) { ol.push(lines[i].replace(/^\d+\.\s/, '')); i++; }
        out.push('<ol>' + ol.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>');
        continue;
      }
      if (/^[-*]\s/.test(line)) {
        var ul = [];
        while (i < lines.length && /^[-*]\s/.test(lines[i])) { ul.push(lines[i].replace(/^[-*]\s/, '')); i++; }
        out.push('<ul>' + ul.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>');
        continue;
      }
      out.push('<p>' + inline(line) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  /* ---------------- 一致性检查 ---------------- */
  /* ---------------- 数据看板（可视化） ---------------- */
  function renderDashboard() {
    $('pane-dashboard').innerHTML = window.Charts ? Charts.render(state.result) :
      '<p class="muted">可视化模块加载失败，请检查 charts.js。</p>';
  }

  function renderCheck() {
    var c = state.result.check;
    var html = '<div class="check-banner ' + (c.summary.passed ? 'pass' : 'fail') + '">' +
      (c.summary.passed ? '✅ 未发现高风险矛盾，材料整体可用' : '⚠️ 发现高风险问题，建议修正后再使用') +
      '</div>';
    html += '<div class="check-stats">' +
      '<span class="check-stat" style="color:#b91c1c"><b>' + c.summary.contradictionCount + '</b>矛盾/风险</span>' +
      '<span class="check-stat" style="color:#92400e"><b>' + c.summary.omissionCount + '</b>信息遗漏</span>' +
      '<span class="check-stat" style="color:#075985"><b>' + c.summary.duplicateCount + '</b>内容重复</span>' +
      '<span class="check-stat" style="color:#166534"><b>' + c.summary.suggestionCount + '</b>优化建议</span>' +
      '</div>';
    if (!c.issues.length) {
      html += '<p class="muted">未发现明显问题。</p>';
    } else {
      html += c.issues.map(function (x) {
        var label = { contradiction: '矛盾', omission: '遗漏', duplicate: '重复', suggestion: '建议' }[x.level];
        return '<div class="issue-item ' + x.level + '"><span class="issue-type">[' + label + ' · ' + ({ high: '高', medium: '中', low: '低' }[x.severity]) + ']</span>' +
          escapeHtml(x.message) +
          (x.evidence ? '<span class="issue-evidence">依据：' + escapeHtml(x.evidence) + '</span>' : '') +
          '</div>';
      }).join('');
    }
    $('pane-check').innerHTML = html;
  }

  function renderTabBadges() {
    var tabs = {
      todos: state.result.todos.length || null,
      check: (state.result.check.summary.contradictionCount + state.result.check.summary.omissionCount) || null
    };
    Object.keys(tabs).forEach(function (name) {
      var tab = document.querySelector('.tab[data-tab="' + name + '"]');
      tab.querySelector('.badge-dot')?.remove();
      if (tabs[name]) {
        var dot = document.createElement('span');
        dot.className = 'badge-dot';
        dot.textContent = tabs[name];
        tab.appendChild(dot);
      }
    });
  }

  /* ---------------- Tab 切换 ---------------- */
  function switchTab(name) {
    state.currentTab = name;
    document.querySelectorAll('#resultTabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = true; });
    $('pane-' + name).hidden = false;
    $('emptyState').hidden = !!state.result;
  }

  /* ---------------- 历史 ---------------- */
  function renderHistory() {
    var wrap = $('historyList');
    $('historyCount').textContent = state.history.length ? '共 ' + state.history.length + ' 条记录' : '';
    if (!state.history.length) {
      wrap.innerHTML = '<div class="history-empty">暂无历史任务。完成一次分析后点击「保存到历史」即可长期保存（数据保存在本机浏览器）。</div>';
      return;
    }
    wrap.innerHTML = state.history.map(function (h) {
      return '<div class="history-card">' +
        '<h4>' + escapeHtml(h.title) + '</h4>' +
        '<div class="hc-meta">' + fmtTime(h.savedAt) + '　|　' + (h.todos || 0) + ' 项待办　|　' + (h.issues || 0) + ' 个检查项</div>' +
        '<div class="hc-actions">' +
        '<button class="btn tiny primary" data-act="load" data-id="' + h.id + '">载入</button>' +
        '<button class="btn tiny" data-act="export" data-id="' + h.id + '">导出报告</button>' +
        '<button class="btn tiny danger" data-act="del" data-id="' + h.id + '">删除</button>' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        var h = state.history.find(function (x) { return x.id === id; });
        if (!h) return;
        if (act === 'load') {
          $('docTitle').value = h.title;
          $('inputText').value = h.text;
          updateCharCount();
          state.result = h.result;
          state.agentPlan = null;
          state.agentRun = null;
          $('emptyState').hidden = true;
          $('resultToolbar').hidden = false;
          renderAll();
          switchView('workbench');
          switchTab('analysis');
          toast('已载入历史任务');
        } else if (act === 'export') {
          download(safeName(h.title) + '_工作报告.md', h.result.report, 'text/markdown');
        } else if (act === 'del') {
          if (!confirm('确定删除这条历史任务吗？')) return;
          state.history = state.history.filter(function (x) { return x.id !== id; });
          saveHistoryStore();
          renderHistory();
        }
      });
    });
  }

  function saveCurrentToHistory() {
    if (!state.result) { toast('请先执行分析'); return; }
    var rec = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: state.result.title,
      text: state.result.text,
      savedAt: new Date().toISOString(),
      todos: state.result.todos.length,
      issues: state.result.check.issues.length,
      result: state.result
    };
    state.history.unshift(rec);
    if (state.history.length > 50) state.history = state.history.slice(0, 50);
    saveHistoryStore();
    renderHistory();
    toast('已保存到历史任务');
  }

  /* ---------------- 导出 ---------------- */
  function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '智办通结果';
  }
  function doExport(kind) {
    if (!state.result) { toast('请先执行分析'); return; }
    var base = safeName(state.result.title);
    if (kind === 'md') download(base + '_工作报告.md', state.result.report, 'text/markdown');
    if (kind === 'txt') {
      var r = state.result;
      var txt = r.report.replace(/[#*`>]/g, '').replace(/\|/g, '\t');
      download(base + '_工作报告.txt', txt, 'text/plain');
    }
    if (kind === 'json') download(base + '_完整结果.json', JSON.stringify(state.result, null, 2), 'application/json');
    toast('导出成功');
  }

  /* ---------------- 可选大模型 API（密钥仅存会话存储，关闭浏览器即清除） ---------------- */
  var LLM_KEY = 'zhibantong_llm';
  // 一次性迁移：旧版本存在 localStorage 的密钥迁移到 sessionStorage 并删除
  try {
    var legacy = localStorage.getItem(LLM_KEY);
    if (legacy) {
      sessionStorage.setItem(LLM_KEY, legacy);
      localStorage.removeItem(LLM_KEY);
    }
  } catch (e) { /* 存储不可用时静默降级 */ }

  function getSettings() {
    try { return JSON.parse(sessionStorage.getItem(LLM_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function setSettings(s) { sessionStorage.setItem(LLM_KEY, JSON.stringify(s)); }

  async function callLLM(messages) {
    var cfg = getSettings();
    if (!cfg.apiKey || !cfg.baseUrl) {
      throw new Error('未配置 API 密钥：请点击右上角「设置」填写，或直接使用本地引擎（核心功能不受影响）。');
    }
    var url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', messages: messages, temperature: 0.4 })
    });
    if (!resp.ok) {
      var txt = await resp.text().catch(function () { return ''; });
      throw new Error('接口返回错误 ' + resp.status + '：' + txt.slice(0, 200));
    }
    var data = await resp.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('接口返回内容为空，未伪造结果。请检查模型名称或密钥。');
    return content;
  }

  async function aiEnhance() {
    if (!state.result) { toast('请先执行分析'); return; }
    var cfg = getSettings();
    if (!cfg.apiKey || !cfg.baseUrl) {
      toast('尚未配置 API 密钥，当前使用本地引擎');
      $('settingsMask').hidden = false;
      return;
    }
    // 外发前显式确认：展示目标与发送范围
    $('sendTarget').textContent = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    var ok = await new Promise(function (resolve) {
      $('sendMask').hidden = false;
      var mask = $('sendMask');
      function onConfirm() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function cleanup() {
        mask.hidden = true;
        $('btnConfirmSend').removeEventListener('click', onConfirm);
        mask.removeEventListener('click', onBg);
        document.querySelectorAll('[data-close="sendMask"]').forEach(function (b) {
          b.removeEventListener('click', onCancel);
        });
      }
      function onBg(e) { if (e.target === mask) onCancel(); }
      $('btnConfirmSend').addEventListener('click', onConfirm);
      document.querySelectorAll('[data-close="sendMask"]').forEach(function (b) {
        b.addEventListener('click', onCancel);
      });
      mask.addEventListener('click', onBg);
    });
    if (!ok) { toast('已取消发送，仍可使用本地报告'); return; }

    var btn = $('btnAIEnhance');
    btn.disabled = true;
    btn.textContent = '✨ AI 增强中…';
    try {
      var prompt = '你是资深行政办公专家。请基于以下本地引擎分析结果与原始材料，将工作报告优化得更专业、条理更清晰（保持 Markdown 格式，保持关键事实、日期、金额、责任人不得改动），并补充“风险提示与应对建议”。\n\n原始材料：\n' + state.result.text + '\n\n本地引擎生成的报告：\n' + state.result.report;
      var enhanced = await callLLM([{ role: 'user', content: prompt }]);
      switchTab('report');
      renderReport(enhanced);
      toast('AI 增强完成');
    } catch (err) {
      toast('AI 增强失败：' + err.message, 4200);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI 增强（可选）';
    }
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    $('view-workbench').hidden = name !== 'workbench';
    $('view-history').hidden = name !== 'history';
    $('view-recording').hidden = name !== 'recording';
    if (name === 'history') renderHistory();
  }

  /* ---------------- 文件上传 ---------------- */
  function bindUpload() {
    $('btnUpload').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('文件过大（限 5MB）'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        $('inputText').value = String(reader.result);
        if (!$('docTitle').value) $('docTitle').value = f.name.replace(/\.[^.]+$/, '');
        updateCharCount();
        toast('文件已载入：' + f.name);
      };
      reader.readAsText(f, 'utf-8');
      this.value = '';
    });
  }

  function updateCharCount() {
    $('charCount').textContent = $('inputText').value.replace(/\s/g, '').length + ' 字';
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('btnAnalyze').addEventListener('click', runAnalyze);
    $('btnSample').addEventListener('click', function () {
      $('inputText').value = SAMPLE;
      $('docTitle').value = '智办通V1.0项目周例会分析';
      updateCharCount();
      toast('示例已载入，点击「一键智能分析」');
    });
    $('btnClear').addEventListener('click', function () {
      $('inputText').value = '';
      $('docTitle').value = '';
      updateCharCount();
      state.result = null;
      $('resultToolbar').hidden = true;
      $('emptyState').hidden = false;
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.hidden = true; });
    });
    $('inputText').addEventListener('input', updateCharCount);

    document.querySelectorAll('#resultTabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });
    document.querySelectorAll('.nav-btn[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });

    document.querySelectorAll('[data-export]').forEach(function (b) {
      b.addEventListener('click', function () { doExport(b.getAttribute('data-export')); });
    });
    $('btnCopy').addEventListener('click', function () {
      if (!state.result) { toast('请先执行分析'); return; }
      navigator.clipboard.writeText(state.result.report).then(function () { toast('报告已复制到剪贴板'); }, function () {
        toast('复制失败，请手动选择文本复制');
      });
    });
    $('btnSave').addEventListener('click', saveCurrentToHistory);
    $('btnClearHistory').addEventListener('click', function () {
      if (!state.history.length) { toast('暂无历史'); return; }
      if (confirm('确定清空全部历史任务吗？')) { state.history = []; saveHistoryStore(); renderHistory(); toast('已清空'); }
    });
    $('btnAIEnhance').addEventListener('click', aiEnhance);

    // 设置
    $('btnSettings').addEventListener('click', function () {
      var cfg = getSettings();
      $('setBaseUrl').value = cfg.baseUrl || 'https://api.openai.com/v1';
      $('setApiKey').value = cfg.apiKey || '';
      $('setModel').value = cfg.model || 'gpt-4o-mini';
      $('settingsStatus').textContent = '';
      $('settingsStatus').className = 'settings-status';
      $('settingsMask').hidden = false;
    });
    $('btnHelp').addEventListener('click', function () { $('helpMask').hidden = false; });
    document.querySelectorAll('.modal-close').forEach(function (b) {
      b.addEventListener('click', function () { $(b.getAttribute('data-close')).hidden = true; });
    });
    document.querySelectorAll('.modal-mask').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
    });
    $('btnSaveSettings').addEventListener('click', function () {
      setSettings({
        baseUrl: $('setBaseUrl').value.trim(),
        apiKey: $('setApiKey').value.trim(),
        model: $('setModel').value.trim() || 'gpt-4o-mini'
      });
      $('settingsStatus').textContent = '已保存（密钥仅存储在本机浏览器）';
      $('settingsStatus').className = 'settings-status ok';
      setTimeout(function () { $('settingsMask').hidden = true; }, 900);
    });
    $('btnTestConn').addEventListener('click', async function () {
      var cfg = { baseUrl: $('setBaseUrl').value.trim(), apiKey: $('setApiKey').value.trim(), model: $('setModel').value.trim() || 'gpt-4o-mini' };
      var st = $('settingsStatus');
      st.className = 'settings-status';
      st.textContent = '正在测试连接…';
      setSettings(cfg);
      try {
        await callLLM([{ role: 'user', content: '请回复“连接成功”四个字。' }]);
        st.textContent = '✅ 连接成功，大模型可用';
        st.className = 'settings-status ok';
      } catch (err) {
        st.textContent = '❌ ' + err.message;
        st.className = 'settings-status err';
      }
    });

    bindUpload();
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    bindEvents();
    updateCharCount();
    // #demo / #demo-<tab>：自动载入示例并分析（用于演示与截图）
    // #demo-agent-auto：自动进入智能体执行页并执行全部默认动作（演示/截图用）
    if (location.hash.indexOf('demo') >= 0) {
      $('inputText').value = SAMPLE;
      $('docTitle').value = '智办通V1.0项目周例会分析';
      updateCharCount();
      var auto = /-auto/.test(location.hash);
      setTimeout(function () {
        runAnalyze();
        var hm = /demo-([a-z]+)/.exec(location.hash);
        if (hm) switchTab(hm[1]);
        if (auto) {
          setTimeout(function () {
            switchTab('agent');
            var b = $('btnRunAgent');
            if (b) b.click();
          }, 900);
        }
      }, 200);
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
