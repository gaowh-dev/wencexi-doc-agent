/*!
 * 评测运行器：对人工标注语料做“待办召回 / 待办精确率 / 责任人命中 / 人名误报”统计
 * 运行：npm run eval   （或 node --test tests/eval/run-eval.js）
 * 结果同时写入 tests/eval/last-run.json，供文档引用。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Engine = require('../../src/core/engine.js');
const corpus = require('./corpus.js');

const base = new Date(2026, 9, 19); // 2026-10-19 本地时区（JS 月份从 0 开始）

function run() {
  const rows = [];
  let totalExpected = 0, totalMatched = 0, totalActual = 0, totalActualMatched = 0;
  let totalOwnerSlots = 0, totalOwnerHits = 0;
  let totalVagueSlots = 0, totalVagueHits = 0;
  let totalDeadlineSlots = 0, totalDeadlineHits = 0;
  let totalPersonSlots = 0, totalPersonHits = 0;
  const forbiddenHits = [];
  const issueMisses = [];

  corpus.cases.forEach(function (c) {
    const r = Engine.processAll(c.text, { baseDate: base, title: c.name });
    const actual = r.todos;
    const matchedExpected = [];
    const matchedActualIds = {};

    c.expectedTodos.forEach(function (e) {
      totalExpected++;
      const hit = actual.find(function (t) { return t.content.indexOf(e.match) >= 0; });
      if (hit) {
        totalMatched++;
        matchedExpected.push(e);
        matchedActualIds[hit.id] = 1;
        (e.owners || []).forEach(function (o) {
          totalOwnerSlots++;
          if (hit.owners.indexOf(o) >= 0) totalOwnerHits++;
        });
        (e.vague || []).forEach(function (v) {
          totalVagueSlots++;
          if (hit.vagueOwners.indexOf(v) >= 0) totalVagueHits++;
        });
        if (e.deadline) {
          totalDeadlineSlots++;
          if (hit.deadline === e.deadline) totalDeadlineHits++;
        }
      }
    });

    // 精确率：实际待办中有多少能对上标注项
    actual.forEach(function (t) {
      totalActual++;
      const covered = c.expectedTodos.some(function (e) { return t.content.indexOf(e.match) >= 0; });
      if (covered) totalActualMatched++;
    });

    // 人名召回与误报
    c.expectedPersons.forEach(function (p) {
      totalPersonSlots++;
      if (r.entities.persons.indexOf(p) >= 0) totalPersonHits++;
    });
    (c.forbiddenPersons || []).forEach(function (p) {
      if (r.entities.persons.indexOf(p) >= 0) forbiddenHits.push({ case: c.id, person: p });
    });

    // 问题类型
    (c.expectedIssueTypes || []).forEach(function (ty) {
      if (!r.check.issues.some(function (i) { return i.type === ty; })) issueMisses.push({ case: c.id, type: ty });
    });

    rows.push({
      id: c.id,
      name: c.name,
      expected: c.expectedTodos.length,
      matched: matchedExpected.length,
      actual: actual.length,
      extra: actual.filter(function (t) { return !matchedActualIds[t.id]; }).length,
      persons: r.entities.persons.slice()
    });
  });

  const pct = function (a, b) { return b === 0 ? 1 : +(a / b).toFixed(4); };

  // 性能：对最长样本 processAll 跑 100 次取均值（纯本地可复现，不涉及人工耗时对比）
  const meeting = corpus.cases.find(function (c) { return c.id === 'meeting'; });
  var N = 100;
  var t0 = process.hrtime.bigint();
  for (var i = 0; i < N; i++) Engine.processAll(meeting.text, { baseDate: base, title: 'x' });
  var t1 = process.hrtime.bigint();
  var msPerDoc = Number(t1 - t0) / 1e6 / N;
  var summary = {
    baseDate: corpus.baseDate,
    caseCount: corpus.cases.length,
    msPerDoc: +msPerDoc.toFixed(2),
    todoRecall: pct(totalMatched, totalExpected),
    todoPrecision: pct(totalActualMatched, totalActual),
    ownerRecall: pct(totalOwnerHits, totalOwnerSlots),
    vagueRecall: pct(totalVagueHits, totalVagueSlots),
    deadlineRecall: pct(totalDeadlineHits, totalDeadlineSlots),
    personRecall: pct(totalPersonHits, totalPersonSlots),
    forbiddenPersonHits: forbiddenHits,
    issueTypeMisses: issueMisses,
    counts: {
      expectedTodos: totalExpected,
      matchedTodos: totalMatched,
      actualTodos: totalActual,
      ownerSlots: totalOwnerSlots,
      ownerHits: totalOwnerHits,
      vagueSlots: totalVagueSlots,
      vagueHits: totalVagueHits,
      deadlineSlots: totalDeadlineSlots,
      deadlineHits: totalDeadlineHits,
      personSlots: totalPersonSlots,
      personHits: totalPersonHits
    }
  };
  return { rows: rows, summary: summary };
}

test('评测：待办召回率不低于 95%', () => {
  const { summary } = runOnce;
  assert.ok(summary.todoRecall >= 0.95, '召回率=' + summary.todoRecall);
});

test('评测：待办精确率不低于 95%', () => {
  const { summary } = runOnce;
  assert.ok(summary.todoPrecision >= 0.95, '精确率=' + summary.todoPrecision);
});

test('评测：具体责任人命中率不低于 90%', () => {
  const { summary } = runOnce;
  assert.ok(summary.ownerRecall >= 0.9, '责任人命中=' + summary.ownerRecall);
});

test('评测：泛称责任人命中率不低于 90%', () => {
  const { summary } = runOnce;
  assert.ok(summary.vagueRecall >= 0.9, '泛称命中=' + summary.vagueRecall);
});

test('评测：截止日期命中率不低于 90%', () => {
  const { summary } = runOnce;
  assert.ok(summary.deadlineRecall >= 0.9, '日期命中=' + summary.deadlineRecall);
});

test('评测：人名召回率不低于 95%', () => {
  const { summary } = runOnce;
  assert.ok(summary.personRecall >= 0.95, '人名召回=' + summary.personRecall);
});

test('评测：禁止出现的假人名数量为 0', () => {
  const { summary } = runOnce;
  assert.strictEqual(summary.forbiddenPersonHits.length, 0, JSON.stringify(summary.forbiddenPersonHits));
});

test('评测：应检出的问题类型全部命中', () => {
  const { summary } = runOnce;
  assert.strictEqual(summary.issueTypeMisses.length, 0, JSON.stringify(summary.issueTypeMisses));
});

const runOnce = run();
fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(runOnce.summary, null, 2), 'utf8');
console.log('\n========== 智办通 引擎评测（基准日期 ' + corpus.baseDate + '）==========');
console.log('用例'.padEnd(34) + '期望 命中 实际 多出');
runOnce.rows.forEach(function (r) {
  console.log((r.id + ' ' + r.name).slice(0, 32).padEnd(34) +
    String(r.expected).padStart(2) + String(r.matched).padStart(4) + String(r.actual).padStart(4) + String(r.extra).padStart(4));
});
const s = runOnce.summary;
console.log('----------------------------------------------------------');
console.log('待办召回率：' + (s.todoRecall * 100).toFixed(1) + '%（' + s.counts.matchedTodos + '/' + s.counts.expectedTodos + '）');
console.log('待办精确率：' + (s.todoPrecision * 100).toFixed(1) + '%（' + s.counts.actualTodos + ' 条实际待办）');
console.log('责任人命中：' + (s.ownerRecall * 100).toFixed(1) + '%（' + s.counts.ownerHits + '/' + s.counts.ownerSlots + '）');
console.log('泛称命中：  ' + (s.vagueRecall * 100).toFixed(1) + '%（' + s.counts.vagueHits + '/' + s.counts.vagueSlots + '）');
console.log('日期命中：  ' + (s.deadlineRecall * 100).toFixed(1) + '%（' + s.counts.deadlineHits + '/' + s.counts.deadlineSlots + '）');
console.log('人名召回：  ' + (s.personRecall * 100).toFixed(1) + '%（' + s.counts.personHits + '/' + s.counts.personSlots + '）');
console.log('假人名：    ' + s.forbiddenPersonHits.length + ' 个 ' + JSON.stringify(s.forbiddenPersonHits));
console.log('问题类型漏检：' + s.issueTypeMisses.length + ' 个 ' + JSON.stringify(s.issueTypeMisses));
console.log('引擎处理速度：' + s.msPerDoc + ' ms/篇（会议纪要样本，100 次均值）');
console.log('结果已写入 tests/eval/last-run.json\n');
