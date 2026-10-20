/*!
 * 文策析 v2.1 可视化看板（charts.js）
 * 纯原生 SVG 渲染，零第三方依赖，完全离线；所有数字直接来自当前分析结果，不做任何模拟。
 * 暴露 window.Charts.render(result) -> HTML 字符串；state.result 为 null 时返回空态提示。
 */
(function () {
  'use strict';

  var COLORS = {
    high: '#dc2626', medium: '#f59e0b', low: '#16a34a',
    done: '#0d9488', pending: '#cbd5e1',
    confHigh: '#0d9488', confMid: '#d97706', confLow: '#94a3b8',
    contradiction: '#dc2626', omission: '#d97706', duplicate: '#0369a1', suggestion: '#16a34a',
    phase1: '#0ea5e9', phase2: '#6366f1', phase3: '#f59e0b', phase4: '#16a34a',
    overdue: '#dc2626', deadline: '#0d9488', noDate: '#cbd5e1'
  };
  var PHASE_SHORT = {
    '第一阶段 · 准备与梳理': '准备梳理',
    '第二阶段 · 执行与推进': '执行推进',
    '第三阶段 · 交付与验收': '交付验收',
    '第四阶段 · 复盘与总结': '复盘总结'
  };
  var PHASE_COLORS = [COLORS.phase1, COLORS.phase2, COLORS.phase3, COLORS.phase4];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }

  /* ---------- 环形图 ---------- */
  function donut(items, cx, cy, r, thickness) {
    var total = sum(items.map(function (i) { return i.value; }));
    if (!total) {
      return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="' + thickness + '"/>' +
        '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" font-size="13" fill="#94a3b8">无数据</text>';
    }
    var C = 2 * Math.PI * r, offset = 0;
    var arcs = items.map(function (it) {
      var len = it.value / total * C;
      var el = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + it.color + '" stroke-width="' + thickness + '"' +
        ' stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '">' +
        '<title>' + esc(it.label) + '：' + it.value + ' 项（' + Math.round(it.value / total * 100) + '%）</title></circle>';
      offset += len;
      return el;
    }).join('');
    return '<g transform="rotate(-90 ' + cx + ' ' + cy + ')">' + arcs + '</g>';
  }

  function legend(items) {
    var total = sum(items.map(function (i) { return i.value; }));
    return '<div class="chart-legend">' + items.map(function (it) {
      var pct = total ? Math.round(it.value / total * 100) : 0;
      return '<div class="legend-item"><span class="legend-dot" style="background:' + it.color + '"></span>' +
        '<span class="legend-label">' + esc(it.label) + '</span><b>' + it.value + '</b><span class="legend-pct">' + pct + '%</span></div>';
    }).join('') + '</div>';
  }

  function donutCard(title, sub, items, centerText) {
    return '<div class="chart-card"><div class="chart-head"><h4>' + title + '</h4><span class="muted small">' + esc(sub) + '</span></div>' +
      '<div class="donut-wrap"><svg viewBox="0 0 120 120" width="120" height="120" role="img">' +
      donut(items, 60, 60, 46, 14) +
      '<text x="60" y="57" text-anchor="middle" font-size="20" font-weight="700" fill="#0f172a">' + centerText.main + '</text>' +
      '<text x="60" y="74" text-anchor="middle" font-size="10" fill="#64748b">' + esc(centerText.sub) + '</text></svg>' +
      legend(items) + '</div></div>';
  }

  /* ---------- 进度环 ---------- */
  function ringCard(done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    var r = 46, C = 2 * Math.PI * r, len = total ? (done / total) * C : 0;
    var svg = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="14"/>' +
      '<g transform="rotate(-90 60 60)"><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + COLORS.done + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '"/></g>' +
      '<text x="60" y="57" text-anchor="middle" font-size="20" font-weight="700" fill="#0f172a">' + pct + '%</text>' +
      '<text x="60" y="74" text-anchor="middle" font-size="10" fill="#64748b">已完成</text>';
    return '<div class="chart-card"><div class="chart-head"><h4>任务完成进度</h4><span class="muted small">勾选待办后实时更新</span></div>' +
      '<div class="donut-wrap"><svg viewBox="0 0 120 120" width="120" height="120">' + svg + '</svg>' +
      '<div class="chart-legend"><div class="legend-item"><span class="legend-dot" style="background:' + COLORS.done + '"></span><span class="legend-label">已完成</span><b>' + done + '</b></div>' +
      '<div class="legend-item"><span class="legend-dot" style="background:' + COLORS.pending + '"></span><span class="legend-label">待完成</span><b>' + (total - done) + '</b></div></div></div></div>';
  }

  /* ---------- 横向条形图 ---------- */
  function barCard(title, sub, rows, colorFn, unit) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    return '<div class="chart-card"><div class="chart-head"><h4>' + title + '</h4><span class="muted small">' + esc(sub) + '</span></div>' +
      '<div class="bar-list">' + rows.map(function (row) {
        var w = Math.round(row.value / max * 100);
        var color = colorFn(row);
        return '<div class="bar-row"><span class="bar-label" title="' + esc(row.label) + '">' + esc(row.label) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + w + '%;background:' + color + '"></span></span>' +
          '<span class="bar-value">' + row.value + (unit || ' 项') + '</span></div>';
      }).join('') + '</div></div>';
  }

  /* ---------- 截止时间线 ---------- */
  function timelineCard(todos, baseDate) {
    var dated = todos.filter(function (t) { return t.deadline; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
    var noDate = todos.filter(function (t) { return !t.deadline; }).length;
    if (!dated.length) {
      return '<div class="chart-card wide"><div class="chart-head"><h4>截止时间线</h4><span class="muted small">按截止日期排列</span></div>' +
        '<p class="muted">暂无可绘制的截止日期' + (noDate ? '，' + noDate + ' 项任务缺少截止时间' : '') + '。</p></div>';
    }
    var W = 760, H = 260, padL = 30, padR = 30, padT = 30, padB = 34;
    var minD = new Date(dated[0].deadline), maxD = new Date(dated[dated.length - 1].deadline);
    // 以基准日（若在范围内）作为“今天”参考点；范围两端至少留出少量空隙
    var base = baseDate ? new Date(baseDate) : null;
    var span = Math.max(1, (maxD - minD) / 86400000);
    function xOf(d) {
      var dd = new Date(d);
      return padL + ((dd - minD) / 86400000) * (W - padL - padR) / span;
    }
    var todayX = (base && base >= minD && base <= maxD) ? xOf(base) : null;
    // 同一日期堆叠，避免重叠
    var stack = {};
    var dots = dated.map(function (t) {
      var key = t.deadline;
      var lvl = stack[key] || 0;
      stack[key] = lvl + 1;
      var x = xOf(t.deadline);
      var y = H - padB - 38 - lvl * 26;
      var overdue = (base && new Date(t.deadline) < base && t.status !== 'done') || false;
      var color = t.status === 'done' ? COLORS.done : (overdue ? COLORS.overdue : COLORS.deadline);
      var short = t.deadline.slice(5).replace('-', '/');
      var g = '<g>' +
        '<line x1="' + x + '" y1="' + (H - padB) + '" x2="' + x + '" y2="' + (y + 7) + '" stroke="#cbd5e1" stroke-width="1"/>' +
        '<circle cx="' + x + '" cy="' + y + '" r="6" fill="' + color + '" stroke="#fff" stroke-width="1.5"><title>' + esc(t.deadline + '｜' + t.content) + '</title></circle>' +
        '<text x="' + x + '" y="' + (y - 10) + '" text-anchor="middle" font-size="10" fill="#334155">' + short + '</text></g>';
      return g;
    }).join('');
    // 日期刻度
    var ticks = '';
    var tickCount = Math.min(6, dated.length);
    for (var i = 0; i < tickCount; i++) {
      var idx = Math.round(i * (dated.length - 1) / Math.max(1, tickCount - 1));
      var t = dated[idx];
      var x = xOf(t.deadline);
      ticks += '<line x1="' + x + '" y1="' + (H - padB) + '" x2="' + x + '" y2="' + (H - padB + 5) + '" stroke="#94a3b8"/>' +
        '<text x="' + x + '" y="' + (H - padB + 18) + '" text-anchor="middle" font-size="10" fill="#64748b">' + t.deadline.slice(5).replace('-', '/') + '</text>';
    }
    var todayLine = todayX != null ? '<line x1="' + todayX + '" y1="' + padT + '" x2="' + todayX + '" y2="' + (H - padB) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3"/>' +
      '<text x="' + todayX + '" y="' + (padT - 8) + '" text-anchor="middle" font-size="10" fill="#64748b">今天</text>' : '';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '" stroke="#94a3b8" stroke-width="1.5"/>' +
      todayLine + ticks + dots + '</svg>';
    var note = '<div class="muted small">共 ' + dated.length + ' 项有明确截止时间' + (noDate ? '，' + noDate + ' 项缺少截止时间' : '') +
      '；<span style="color:' + COLORS.overdue + '">红点</span>为已逾期、<span style="color:' + COLORS.deadline + '">绿点</span>为正常、<span style="color:' + COLORS.done + '">青色</span>为已完成。</div>';
    return '<div class="chart-card wide"><div class="chart-head"><h4>截止时间线</h4><span class="muted small">按截止日期排列，悬停圆点可查看任务</span></div>' + svg + note + '</div>';
  }

  function render(result) {
    if (!result || !result.todos) {
      return '<p class="muted" style="padding:24px">请先执行「一键智能分析」，可视化看板将基于真实分析结果生成。</p>';
    }
    var todos = result.todos;
    var total = todos.length;
    var done = todos.filter(function (t) { return t.status === 'done'; }).length;

    // 1. 优先级分布
    var pri = ['高', '中', '低'].map(function (p, i) {
      return { label: p + '优先级', value: todos.filter(function (t) { return (t.priority || '中') === p; }).length, color: [COLORS.high, COLORS.medium, COLORS.low][i] };
    });

    // 2. 置信度分布
    var conf = [
      { label: '高置信', value: todos.filter(function (t) { return (t.confidence || 'medium') === 'high'; }).length, color: COLORS.confHigh },
      { label: '中置信', value: todos.filter(function (t) { return (t.confidence || 'medium') === 'medium'; }).length, color: COLORS.confMid },
      { label: '低置信', value: todos.filter(function (t) { return (t.confidence || 'medium') === 'low'; }).length, color: COLORS.confLow }
    ];

    // 3. 责任人分布
    var ownerMap = {};
    todos.forEach(function (t) {
      var names = (t.owners || []).slice();
      (t.vagueOwners || []).forEach(function (v) { if (names.indexOf(v) < 0) names.push(v); });
      if (!names.length) names = ['待明确'];
      names.forEach(function (n) { ownerMap[n] = (ownerMap[n] || 0) + 1; });
    });
    var ownerRows = Object.keys(ownerMap).map(function (k) { return { label: k, value: ownerMap[k] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
    var ownerCard = ownerRows.length ? barCard('责任人任务分布', '取任务数最多的前 10 位；“待明确”为信息缺口', ownerRows, function (r) {
      return r.label === '待明确' ? COLORS.overdue : '#0d9488';
    }) : '<div class="chart-card"><div class="chart-head"><h4>责任人任务分布</h4></div><p class="muted">暂无数据</p></div>';

    // 4. 问题构成
    var s = result.check.summary;
    var issueRows = [
      { label: '矛盾/风险', value: s.contradictionCount || 0, color: COLORS.contradiction },
      { label: '信息遗漏', value: s.omissionCount || 0, color: COLORS.omission },
      { label: '内容重复', value: s.duplicateCount || 0, color: COLORS.duplicate },
      { label: '优化建议', value: s.suggestionCount || 0, color: COLORS.suggestion }
    ];
    var issueCard = barCard('一致性检查问题构成', '按类型统计，每条结论可在“一致性检查”页查看原文依据', issueRows, function (r) { return r.color; }, ' 条');

    // 5. 阶段分布
    var phaseRows = (result.plan && result.plan.phases ? result.plan.phases : []).map(function (p, i) {
      return { label: PHASE_SHORT[p.name] || p.name, value: p.items.length, color: PHASE_COLORS[i % 4] };
    });
    var phaseCard = phaseRows.length ? barCard('任务阶段分布', '按动作类型归入四个阶段（来自任务计划）', phaseRows, function (r) { return r.color; })
      : '<div class="chart-card"><div class="chart-head"><h4>任务阶段分布</h4></div><p class="muted">暂无数据</p></div>';

    // KPI 卡
    var withOwner = todos.filter(function (t) { return (t.owners || []).length || (t.vagueOwners || []).length; }).length;
    var withDeadline = todos.filter(function (t) { return t.deadline; }).length;
    var highPri = todos.filter(function (t) { return (t.priority || '中') === '高'; }).length;
    var issueCount = (s.contradictionCount || 0) + (s.omissionCount || 0);
    var kpiHtml = '<div class="kpi-row">' +
      kpi(total, '待办总数', '#0f766e') +
      kpi(done, '已完成', '#0d9488') +
      kpi(withOwner, '已明确责任人', '#2563eb') +
      kpi(withDeadline, '已明确截止', '#7c3aed') +
      kpi(highPri, '高优先级', '#dc2626') +
      kpi(issueCount, '需核对问题', '#d97706') +
      '</div>';

    return kpiHtml +
      '<div class="charts-grid">' +
      ringCard(done, total) +
      donutCard('优先级分布', '依据材料语气与时限自动判定', pri, { main: total, sub: '项待办' }) +
      donutCard('置信度分布', '识别结果可信程度，低置信需人工核对', conf, { main: total, sub: '项待办' }) +
      issueCard +
      ownerCard +
      phaseCard +
      '</div>' +
      timelineCard(todos, result.plan && result.plan.generatedAt);
  }

  function kpi(value, label, color) {
    return '<div class="kpi-card" style="border-top:3px solid ' + color + '"><b>' + value + '</b><span>' + label + '</span></div>';
  }

  window.Charts = { render: render };
})();
