/*!
 * 智办通核心引擎自动化测试（使用 Node.js 内置 node:test，无需安装依赖）
 * 运行：npm test  或  node --test tests/
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require(path.join(__dirname, '..', 'src', 'core', 'engine.js'));

// 固定基准日期：2026-10-19（周一），保证相对日期测试可复现
const BASE = new Date(2026, 9, 19);

const SAMPLE = [
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

test('分句与基础统计', () => {
  const s = E.splitSentences(SAMPLE);
  assert.ok(s.length >= 12, '应至少切出 12 个句子，实际 ' + s.length);
  const stats = E.textStats(SAMPLE);
  assert.ok(stats.chars > 200);
  assert.ok(stats.sentenceCount === s.length);
  assert.ok(stats.readingMinutes >= 1);
});

test('绝对日期解析：2026年10月21日', () => {
  const ds = E.extractDates('会议时间：2026年10月21日 下午2点', BASE);
  assert.ok(ds.some((d) => d.iso === '2026-10-21'), JSON.stringify(ds));
});

test('相对日期解析：本周四（基准为周一）应为本周四 2026-10-22', () => {
  const ds = E.extractDates('本周四前完成手册', BASE);
  assert.ok(ds.some((d) => d.iso === '2026-10-22'), JSON.stringify(ds));
  const next = E.extractDates('下周三前完成', BASE);
  assert.ok(next.some((d) => d.iso === '2026-10-28'), JSON.stringify(next));
  const tomorrow = E.extractDates('明天下午开会', BASE);
  assert.ok(tomorrow.some((d) => d.iso === '2026-10-20'), JSON.stringify(tomorrow));
});

test('时间解析：下午2点 = 14:00；下午6点 = 18:00', () => {
  const t1 = E.extractTimes('下午2点开会');
  assert.ok(t1.some((x) => x.text === '14:00'), JSON.stringify(t1));
  const t2 = E.extractTimes('10月22日下午6点前');
  assert.ok(t2.some((x) => x.text === '18:00'), JSON.stringify(t2));
  const t3 = E.extractTimes('上午10:30');
  assert.ok(t3.some((x) => x.text === '10:30'), JSON.stringify(t3));
});

test('实体抽取：金额、电话、邮箱、机构、人物、地点', () => {
  const e = E.extractEntities(SAMPLE, BASE);
  assert.ok(e.money.some((x) => x.raw.indexOf('35万元') >= 0), JSON.stringify(e.money));
  assert.ok(e.money.some((x) => x.approxYuan === 350000));
  assert.ok(e.organizations.some((x) => x.indexOf('研发') >= 0 || x.indexOf('项目') >= 0), JSON.stringify(e.organizations));
  assert.ok(e.persons.some((x) => x.indexOf('王磊') >= 0), JSON.stringify(e.persons));
  assert.ok(e.places.indexOf('昆明') >= 0 || e.places.indexOf('云南') >= 0, JSON.stringify(e.places));
  assert.ok(e.venues.some((x) => x.indexOf('会议室') >= 0), JSON.stringify(e.venues));

  const e2 = E.extractEntities('联系我：电话13812345678，邮箱test@example.com，网址 https://www.example.com/a', BASE);
  assert.ok(e2.phones.indexOf('13812345678') >= 0);
  assert.ok(e2.emails.indexOf('test@example.com') >= 0);
  assert.ok(e2.urls[0].indexOf('https://www.example.com') >= 0);
});

test('关键词抽取包含办公领域词', () => {
  const kws = E.extractKeywords(SAMPLE, 12).map((x) => x.word);
  assert.ok(kws.length >= 5);
  assert.ok(kws.some((k) => k.indexOf('会议') >= 0 || k.indexOf('项目') >= 0 || k.indexOf('完成') >= 0), JSON.stringify(kws));
});

test('摘要抽取不超过指定句数且保留原文顺序', () => {
  const sum = E.summarize(SAMPLE, 3);
  assert.ok(sum.length >= 1 && sum.length <= 3);
  sum.forEach((s) => assert.ok(SAMPLE.indexOf(s) >= 0));
});

test('文档分类识别为会议纪要', () => {
  assert.equal(E.classify(SAMPLE), '会议纪要');
});

test('待办提取：责任人、截止时间、优先级', () => {
  const todos = E.generateTodos(SAMPLE, BASE);
  assert.ok(todos.length >= 6, '应识别至少 6 条待办，实际 ' + todos.length);
  const zhang = todos.find((t) => t.content.indexOf('张伟') >= 0 || t.content.indexOf('前端兼容性') >= 0);
  assert.ok(zhang, '应包含张伟的修复任务');
  assert.equal(zhang.deadline, '2026-10-22');
  assert.ok(zhang.owner.indexOf('张伟') >= 0, '责任人应解析为张伟，实际 ' + zhang.owner);
  const li = todos.find((t) => t.content.indexOf('李娟') >= 0 || t.content.indexOf('回归测试') >= 0);
  assert.ok(li && li.owner.indexOf('李娟') >= 0, '应解析李娟，实际 ' + JSON.stringify(li && li.owner));
  const zhao = todos.find((t) => t.content.indexOf('手册') >= 0);
  assert.ok(zhao && zhao.owner.indexOf('赵敏') >= 0 && zhao.deadline === '2026-10-22', '赵敏任务：' + JSON.stringify(zhao));
  // 内部培训任务没有责任人 → 应能识别出遗漏
  const train = todos.find((t) => t.content.indexOf('内部培训') >= 0);
  assert.ok(train, '应识别内部培训任务');
  assert.equal(train.owner, '');
});

test('任务计划：分阶段、日期连续、里程碑', () => {
  const todos = E.generateTodos(SAMPLE, BASE);
  const plan = E.makePlan(todos, BASE);
  assert.ok(plan.totalTasks >= 6);
  assert.ok(plan.phases.length >= 2, '应至少划分 2 个阶段');
  assert.ok(plan.milestones.length >= 4, '应提取至少 4 个里程碑');
  assert.ok(plan.startDate <= plan.endDate);
  plan.items.forEach((it) => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(it.date), '每项任务都有排期日期：' + it.content);
  });
});

test('矛盾检查：同一预算不同金额必须报出高风险矛盾', () => {
  const text = '项目预算为5万元。后续通知显示，项目预算为8万元，请相关人员按新预算执行。';
  const todos = E.generateTodos(text, BASE);
  const r = E.checkIssues(text, todos, BASE);
  const hit = r.issues.find((x) => x.type === '金额表述不一致');
  assert.ok(hit, '应检测到金额冲突：' + JSON.stringify(r.issues));
  assert.equal(hit.severity, 'high');
  assert.equal(r.summary.passed, false);
});

test('矛盾检查：状态自相矛盾', () => {
  const text = '该模块已完成上线，但因缺陷未通过验收，目前仍处于未完成状态，请尽快整改。';
  const r = E.checkIssues(text, [], BASE);
  assert.ok(r.issues.some((x) => x.type === '状态表述矛盾'), JSON.stringify(r.issues));
});

test('遗漏检查：会议缺时间/地点应提示', () => {
  const text = '关于召开项目协调会的通知：请各部门负责人准时参加，会议将讨论上线相关事宜。';
  const r = E.checkIssues(text, [], BASE);
  assert.ok(r.issues.some((x) => x.type === '会议信息缺失'), JSON.stringify(r.issues));
});

test('遗漏检查：待办缺责任人/截止时间', () => {
  const text = '请尽快完成宣传材料的准备工作。';
  const todos = E.generateTodos(text, BASE);
  const r = E.checkIssues(text, todos, BASE);
  assert.ok(r.issues.some((x) => x.type === '缺少截止时间'), JSON.stringify(r.issues));
});

test('重复内容检测', () => {
  const text = '请各部门在周五前提交月度工作报告。请各部门在周五之前提交月度工作报告。';
  const todos = E.generateTodos(text, BASE);
  const r = E.checkIssues(text, todos, BASE);
  assert.ok(r.issues.some((x) => x.type === '内容重复'), JSON.stringify(r.issues));
});

test('工作报告生成：包含七大章节与关键事实', () => {
  const r = E.processAll(SAMPLE, { title: '测试报告', baseDate: BASE });
  assert.ok(r.report.indexOf('# 测试报告') >= 0);
  ['一、材料概述', '二、要点摘要', '三、关键信息提取', '四、待办事项清单', '五、任务执行计划', '六、一致性与遗漏检查', '七、结论与下一步建议'].forEach((sec) => {
    assert.ok(r.report.indexOf(sec) >= 0, '报告缺少章节：' + sec);
  });
  assert.ok(r.report.indexOf('2026-10-22') >= 0);
  assert.ok(r.report.indexOf('35万元') >= 0);
});

test('processAll 流水线输出完整结构', () => {
  const r = E.processAll(SAMPLE, { baseDate: BASE });
  ['analysis', 'entities', 'todos', 'plan', 'check', 'report'].forEach((k) => {
    assert.ok(r[k] !== undefined, '缺少字段 ' + k);
  });
  assert.ok(r.analysis.stats.chars > 0);
  assert.ok(typeof r.report === 'string' && r.report.length > 500);
});

test('空输入不崩溃', () => {
  const r = E.processAll('', { baseDate: BASE });
  assert.equal(r.todos.length, 0);
  assert.equal(r.plan.totalTasks, 0);
  assert.ok(Array.isArray(r.check.issues));
});

test('金额解析：万亿元先于亿元匹配（5万亿元=5×10¹²）', () => {
  const e = E.extractEntities('项目总投资5万亿元，去年投入3亿元。', BASE);
  const wanyi = e.money.find((x) => x.raw.indexOf('万亿元') >= 0);
  assert.ok(wanyi, JSON.stringify(e.money));
  assert.equal(wanyi.approxYuan, 5000000000000);
  const yi = e.money.find((x) => x.unit === '亿元');
  assert.equal(yi.approxYuan, 300000000);
});

test('机构识别：产品部/研发部/测试组等部门后缀', () => {
  const e = E.extractEntities('参会人员：产品部、研发部、测试组、财务科。', BASE);
  ['产品部', '研发部', '测试组'].forEach((d) => {
    assert.ok(e.organizations.indexOf(d) >= 0, d + ' 未识别：' + JSON.stringify(e.organizations));
  });
  // 单字后缀的常见误命中必须排除
  const e2 = E.extractEntities('全部成员、部分骨干、本科实习生参会。', BASE);
  assert.ok(!e2.organizations.some((x) => /全部|部分|本科/.test(x)), JSON.stringify(e2.organizations));
});

test('场所识别：保留完整场所、去前缀、排除“同一会议室”泛指', () => {
  const e = E.extractEntities('地点在云科大厦12层大会议室，下次在同一会议室召开。', BASE);
  assert.ok(e.venues.some((x) => x === '云科大厦12层大会议室'), JSON.stringify(e.venues));
  assert.ok(!e.venues.some((x) => x.indexOf('同一') >= 0 || x.indexOf('地点') >= 0 || x.indexOf('在') === 0), JSON.stringify(e.venues));
});
