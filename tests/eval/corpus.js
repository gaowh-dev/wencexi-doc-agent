/*!
 * 文策析 评测语料（人工标注，基准日期固定为 2026-10-19）
 * 每个用例标注：
 *   expectedTodos: [{ match: 实际待办内容应包含的关键子串, owners: [具体责任人], vague: [泛称], deadline: ISO }]
 *   expectedPersons: 应提取的人名（去重后）
 *   forbiddenPersons: 不应出现的假人名
 *   expectedIssueTypes: 检查结果中应包含的问题类型
 * 说明：标注依据“真实用户期望的行动项”，不是根据程序输出反推。
 */
module.exports = {
  baseDate: '2026-10-19',
  cases: [
    {
      id: 'meeting',
      name: '项目周例会纪要（8 项行动）',
      text: [
        '文策析V1.0产品研发项目周例会会议纪要',
        '时间：2026年10月21日 下午2点',
        '地点：昆明市高新区海源北路云科大厦12层大会议室',
        '参会人员：产品部、研发部、测试组及项目组全体成员。会议由王磊总监主持，主要讨论文策析V1.0版本上线前的准备工作。',
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
      ].join('\n'),
      expectedTodos: [
        { match: '前端兼容性修复', owners: ['张伟'] },
        { match: '回归测试', owners: ['李娟'] },
        { match: '操作手册', owners: ['赵敏'] },
        { match: '上线前评审会', owners: ['王磊'] },
        { match: '宣传文案', owners: ['运营部'] },
        { match: '内部培训', vague: ['大家'] },
        { match: '布局错位', owners: [], deadline: '2026-10-23' },
        { match: '合同审批', owners: [], deadline: '2026-10-30' }
      ],
      expectedPersons: ['王磊', '张伟', '李娟', '赵敏'],
      forbiddenPersons: ['项目经理', '项目经', '项目', '万元', '计划提', '马楠'],
      expectedIssueTypes: ['金额口径需核对']
    },
    {
      id: 'notify',
      name: '信息安全培训通知（各部门泛称）',
      text: '关于开展2026年度信息安全培训的通知\n各部门：请各部门于10月30日前完成本部门信息安全培训，并在11月5日前将培训签到表报送行政部。培训时间定于11月6日下午2点在三楼报告厅举行。',
      expectedTodos: [
        { match: '信息安全培训', vague: ['各部门'], deadline: '2026-10-30' },
        { match: '签到表', vague: ['各部门'], deadline: '2026-11-05' }
      ],
      expectedPersons: [],
      forbiddenPersons: ['关于', '时间定', '行政部'],
      expectedIssueTypes: []
    },
    {
      id: 'plan',
      name: '迭代计划（多日期节点、无主任务）',
      text: '文策析V2.0迭代计划：10月26日前完成需求评审，研发组需在11月10日前完成核心功能开发，测试组于11月13日前完成系统测试，11月16日组织上线评审。',
      expectedTodos: [
        { match: '需求评审', owners: [], deadline: '2026-10-26' },
        { match: '核心功能开发', owners: ['研发组'], deadline: '2026-11-10' },
        { match: '系统测试', owners: ['测试组'], deadline: '2026-11-13' },
        { match: '上线评审', owners: [], deadline: '2026-11-16' }
      ],
      expectedPersons: [],
      forbiddenPersons: ['能开发', '成核心', '时间定'],
      expectedIssueTypes: []
    },
    {
      id: 'contract',
      name: '采购合同评审（金额口径不一致）',
      text: '采购合同评审纪要：供应商报价18万元，而预算明细中合同金额为35万元。请采购部陈静在10月28日前完成报价核对。',
      expectedTodos: [
        { match: '报价核对', owners: ['陈静'], deadline: '2026-10-28' }
      ],
      expectedPersons: ['陈静'],
      forbiddenPersons: ['合同', '采购合同'],
      expectedIssueTypes: ['金额口径需核对']
    },
    {
      id: 'multi',
      name: '多责任人 + 复姓（林晓舟/欧阳致远/司马楠）',
      text: '请林晓舟和欧阳致远在10月25日前完成接口联调，由司马楠负责汇总，周五下班前完成数据核对。',
      expectedTodos: [
        { match: '接口联调', owners: ['林晓舟', '欧阳致远'], deadline: '2026-10-25' },
        { match: '汇总', owners: ['司马楠'] },
        { match: '数据核对', owners: [], deadline: '2026-10-23' }
      ],
      expectedPersons: ['林晓舟', '欧阳致远', '司马楠'],
      forbiddenPersons: ['马楠', '周五', '成数据', '欧阳'],
      expectedIssueTypes: []
    },
    {
      id: 'risk',
      name: '故障复盘（同责任人多子句 + 无日期任务）',
      text: '线上故障复盘：10月18日支付接口出现2次超时。请运维组刘洋在10月21日前完成故障根因排查，并在10月22日前提交整改报告；请孙倩同步更新应急预案。',
      expectedTodos: [
        { match: '根因排查', owners: ['刘洋'], deadline: '2026-10-21' },
        { match: '整改报告', owners: ['刘洋'], deadline: '2026-10-22' },
        { match: '应急预案', owners: ['孙倩'] }
      ],
      expectedPersons: ['刘洋', '孙倩'],
      forbiddenPersons: [],
      expectedIssueTypes: []
    },
    {
      id: 'en',
      name: '中英混杂 / 英文指派',
      text: 'Please ask 张伟 to finish the UI review by 10月24日，李娟 must submit the test report by Friday.',
      expectedTodos: [
        { match: 'UI review', owners: ['张伟'], deadline: '2026-10-24' },
        { match: 'test report', owners: ['李娟'], deadline: '2026-10-23' }
      ],
      expectedPersons: ['张伟', '李娟'],
      forbiddenPersons: [],
      expectedIssueTypes: []
    },
    {
      id: 'wechat',
      name: '微信口语（泛称、无截止）',
      text: '各位，大家记得把本周的周报发我邮箱，辛苦啦~',
      expectedTodos: [
        { match: '周报', vague: ['大家'] }
      ],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: ['缺少截止时间']
    },
    {
      id: 'declarative',
      name: '纯陈述经营数据（零误报对照）',
      text: '公司去年全年实现营收12亿元，同比增长18%。新客户签约320家，整体经营情况良好。',
      expectedTodos: [],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: []
    },
    {
      id: 'qa',
      name: '疑问句（不应识别为任务）',
      text: '我们是不是应该先和客户确认一下需求范围？另外周三的评审会大家时间OK吗？',
      expectedTodos: [],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: []
    },
    {
      id: 'short',
      name: '口语短句提醒（记得开站会）',
      text: '明天上午记得开站会。',
      expectedTodos: [
        { match: '站会', owners: [], deadline: '2026-10-20' }
      ],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: ['缺少责任人']
    },
    {
      id: 'weekly',
      name: '项目周报（X需在日期 + 假名防护）',
      text: '项目周报：本周完成登录模块开发，缺陷修复8个。下周计划完成权限模块联调，陈晓东负责在10月30日前输出接口文档；何雯需在11月3日前完成性能压测。',
      expectedTodos: [
        { match: '接口文档', owners: ['陈晓东'], deadline: '2026-10-30' },
        { match: '性能压测', owners: ['何雯'], deadline: '2026-11-03' }
      ],
      expectedPersons: ['陈晓东', '何雯'],
      forbiddenPersons: ['周计', '周计划', '成权限', '权限'],
      expectedIssueTypes: []
    },
    {
      id: 'expense',
      name: '报销通知（各部门、截止时间）',
      text: '报销通知：请各部门在10月25日前提交9月差旅发票，逾期不予报销。',
      expectedTodos: [
        { match: '差旅发票', vague: ['各部门'], deadline: '2026-10-25' }
      ],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: []
    },
    {
      id: 'stmt',
      name: '培训安排陈述句（不应识别为任务）',
      text: '培训时间定于11月6日下午2点在三楼报告厅举行。',
      expectedTodos: [],
      expectedPersons: [],
      forbiddenPersons: ['时间定'],
      expectedIssueTypes: []
    },
    {
      id: 'host',
      name: '主持人与参会要求',
      text: '明天下午3点李建国主持产品评审会，研发全员参加。',
      expectedTodos: [
        { match: '产品评审会', owners: ['李建国'], deadline: '2026-10-20' }
      ],
      expectedPersons: ['李建国'],
      forbiddenPersons: ['家准时', '季度'],
      expectedIssueTypes: []
    },
    {
      id: 'closing',
      name: '会议结束语（零误报对照）',
      text: '感谢大家今天的辛苦付出，会议到此结束！收到，辛苦大家。',
      expectedTodos: [],
      expectedPersons: [],
      forbiddenPersons: [],
      expectedIssueTypes: []
    }
  ]
};
