/*!
 * 工具层与智能体运行时测试（v2）
 * 运行：node --test tests/tools.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../src/core/engine.js');
const Tools = require('../src/core/tools.js');
const Agent = require('../src/core/agent.js');
const Adapter = require('../src/core/adapters/mobileclaw.js');

const SAMPLE = [
  '智办通V1.0产品研发项目周例会会议纪要',
  '时间：2026年10月21日 下午2点',
  '1. 请研发部张伟工程师在10月22日下午6点前完成前端兼容性修复并提交代码；',
  '2. 请测试组李娟负责在10月23日完成回归测试，并于当天下午5点前反馈测试报告；',
  '3. 建议大家在11月2日之前完成内部培训。'
].join('\n');
const base = new Date(2026, 9, 19);

function analyze() {
  return Engine.processAll(SAMPLE, { baseDate: base, title: '测试例会' });
}

test('日历 ICS：事件数量与带截止时间任务一致，含 UID/提醒/转义', () => {
  const r = analyze();
  const withDeadline = r.todos.filter(t => t.deadline).length;
  const out = Tools.buildCalendarICS(r);
  assert.ok(out.content.includes('BEGIN:VCALENDAR') && out.content.includes('END:VCALENDAR'));
  assert.strictEqual(out.eventCount, withDeadline);
  assert.strictEqual((out.content.match(/BEGIN:VEVENT/g) || []).length, withDeadline);
  assert.strictEqual((out.content.match(/BEGIN:VALARM/g) || []).length, withDeadline);
  // 有具体时间的任务应为定时事件
  assert.ok(out.content.includes('DTSTART;TZID=Asia/Shanghai:20261022T180000'));
  const v = Tools.verifyICS(out.content, withDeadline);
  assert.ok(v.ok, JSON.stringify(v.checks));
  assert.ok(out.content.includes('\\n')); // 换行转义
});

test('待办 CSV：带 BOM、行数与待办一致、字段完整', () => {
  const r = analyze();
  const out = Tools.buildTodoCSV(r);
  assert.ok(out.content.charCodeAt(0) === 0xFEFF);
  assert.ok(out.content.includes('任务标题'));
  assert.ok(out.content.includes('张伟'));
  assert.ok(out.content.includes('2026-10-22'));
  const v = Tools.verifyCSV(out.content, r.todos.length);
  assert.ok(v.ok, JSON.stringify(v.checks));
});

test('派任务消息：按责任人分组，泛称任务进入待分配汇总', () => {
  const r = analyze();
  const out = Tools.buildAssignmentMessages(r);
  const owners = out.messages.map(m => m.owner);
  assert.ok(owners.includes('张伟'));
  assert.ok(owners.includes('李娟'));
  assert.ok(owners.some(o => o.includes('待分配')));
  // 张伟的消息包含其任务内容与截止时间
  const zhang = out.messages.find(m => m.owner === '张伟');
  assert.ok(zhang.text.includes('前端兼容性修复'));
  assert.ok(zhang.text.includes('2026-10-22'));
  const v = Tools.verifyMessages(out, r.todos);
  assert.ok(v.ok, JSON.stringify(v.checks));
});

test('派任务消息：有具体责任人（同时带部门）的任务不重复进入待分配', () => {
  const r = analyze();
  const out = Tools.buildAssignmentMessages(r);
  const unassigned = out.messages.find(m => m.unassigned);
  // 张伟/李娟任务即使识别出“研发部/测试组”，也只能出现在个人消息里
  for (const name of ['张伟', '李娟']) {
    const personal = out.messages.find(m => m.owner === name);
    assert.ok(personal, '缺少 ' + name + ' 的个人消息');
    if (unassigned) {
      assert.ok(!unassigned.text.includes('前端兼容性修复'), '张伟任务重复进入待分配');
      assert.ok(!unassigned.text.includes('回归测试'), '李娟任务重复进入待分配');
    }
  }
  // 待分配汇总只能包含“大家”培训这条泛称任务
  if (unassigned) {
    assert.ok(unassigned.text.includes('内部培训'));
    assert.strictEqual(unassigned.count, 1);
  }
});

test('日历 ICS：含显式 VTIMEZONE 定义（Asia/Shanghai）', () => {
  const r = analyze();
  const out = Tools.buildCalendarICS(r);
  assert.ok(out.content.includes('BEGIN:VTIMEZONE'));
  assert.ok(out.content.includes('TZID:Asia/Shanghai'));
  assert.ok(out.content.includes('TZOFFSETFROM:+0800'));
  assert.ok(out.content.includes('END:VTIMEZONE'));
});

test('待办 CSV：任务阶段列非空（来自任务计划）', () => {
  const r = analyze();
  const out = Tools.buildTodoCSV(r);
  const lines = out.content.split('\r\n');
  assert.ok(lines.length >= r.todos.length + 1);
  lines.slice(1, r.todos.length + 1).forEach((line, i) => {
    const lastCell = line.slice(line.lastIndexOf('","') + 2);
    assert.notStrictEqual(lastCell, '""', '第 ' + (i + 1) + ' 行任务阶段为空');
  });
});

test('核对清单：条目数与待办一致', () => {
  const r = analyze();
  const out = Tools.buildChecklist(r);
  assert.strictEqual((out.content.match(/- \[ \]/g) || []).length, r.todos.length);
});

test('智能体规划：生成动作步骤与信息缺口', () => {
  const r = analyze();
  const p = Agent.plan(r);
  const ids = p.steps.map(s => s.toolId);
  assert.ok(ids.includes('calendar_ics'));
  assert.ok(ids.includes('assignment'));
  assert.ok(ids.includes('todo_csv'));
  // “建议大家…”无具体责任人，应进入缺口
  assert.ok(p.gaps.length >= 1, '应至少有 1 个信息缺口');
  assert.ok(p.gaps.some(g => g.questions.join('').includes('责任人')));
});

test('智能体执行：假执行器完整跑通，状态与校验真实记录', async () => {
  const r = analyze();
  const p = Agent.plan(r);
  const downloaded = [];
  let copied = null;
  const exec = {
    downloadFile: async (o) => { downloaded.push(o.filename); return { ok: true, size: o.content.length }; },
    copyText: async (t) => { copied = t; return { ok: true }; }
  };
  const run = await Agent.execute(p, r, exec);
  assert.strictEqual(run.summary.failed, 0, JSON.stringify(run.records.filter(x => x.error), null, 2));
  assert.ok(run.summary.done >= 4);
  assert.ok(downloaded.some(f => f.endsWith('.ics')));
  assert.ok(downloaded.some(f => f.endsWith('.csv')));
  assert.ok(downloaded.some(f => f.endsWith('.md')));
  assert.ok(copied && copied.includes('张伟'));
  // 每条完成的记录都有产物校验
  run.records.filter(x => x.status === 'done').forEach(rec => {
    assert.ok(rec.verify && rec.verify.ok, rec.toolId + ' 应有通过的自检');
  });
});

test('智能体执行：未勾选步骤被跳过，工具失败不冒充成功', async () => {
  const r = analyze();
  const p = Agent.plan(r);
  p.steps.find(s => s.toolId === 'calendar_ics').selected = false;
  const exec = {
    downloadFile: async (o) => { throw new Error('磁盘不可写（模拟）'); },
    copyText: async () => ({ ok: true })
  };
  const run = await Agent.execute(p, r, exec);
  const cal = run.records.find(x => x.toolId === 'calendar_ics');
  assert.strictEqual(cal.status, 'skipped');
  assert.strictEqual(cal.reason, '用户未勾选');
  // 其余文件动作全部失败且如实记录
  const fileRecs = run.records.filter(x => x.delivery === 'file');
  assert.ok(fileRecs.every(x => x.status === 'failed' || x.status === 'skipped'));
  assert.ok(fileRecs.some(x => x.status === 'failed' && x.error.includes('磁盘不可写')));
  assert.strictEqual(run.summary.passed, false);
});

test('MobileClaw 适配层：未连接时显式拒绝执行，不伪造结果', () => {
  const s = Adapter.status();
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.code, 'MOBILECLAW_NOT_CONNECTED');
  assert.throws(() => Adapter.execute(), /未连接/);
});

test('无待办文本：日历与 CSV 步骤被跳过而非报错', async () => {
  const r = Engine.processAll('公司去年全年实现营收12亿元，同比增长18%。', { baseDate: base });
  const p = Agent.plan(r);
  const exec = {
    downloadFile: async (o) => ({ ok: true, size: o.content.length }),
    copyText: async () => ({ ok: true })
  };
  const run = await Agent.execute(p, r, exec);
  const cal = run.records.find(x => x.toolId === 'calendar_ics');
  const csv = run.records.find(x => x.toolId === 'todo_csv');
  assert.strictEqual(cal.status, 'skipped');
  assert.ok(cal.reason.includes('没有带截止时间'));
  assert.strictEqual(csv.status, 'skipped');
});
