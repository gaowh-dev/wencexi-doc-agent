/*!
 * 智办通 AI 智能办公助手 —— 中文办公文本分析核心引擎
 * 纯本地规则引擎，无需任何外部 API 与第三方依赖即可运行。
 * 同时支持浏览器（window.ZhiBanTong）与 Node.js（module.exports）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhiBanTong = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '2.0.0';

  /* ============================================================
   * 一、基础工具
   * ========================================================== */

  var CJK = '\u4e00-\u9fa5';

  function isCJK(ch) {
    return ch >= '\u4e00' && ch <= '\u9fa5';
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function addDays(d, n) {
    var r = new Date(d.getTime());
    r.setDate(r.getDate() + n);
    return r;
  }

  function isWorkday(d) {
    var day = d.getDay();
    return day !== 0 && day !== 6;
  }

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function weekdayOf(d) { return WEEKDAYS[d.getDay()]; }

  // 找到 base 之后（含当天）第一个星期 X 的工作日
  function nextWeekday(base, targetDay) {
    var diff = (targetDay - base.getDay() + 7) % 7;
    return addDays(base, diff);
  }

  function nextWorkday(base) {
    var d = new Date(base.getTime());
    while (!isWorkday(d)) d = addDays(d, 1);
    return d;
  }

  function unique(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var k = arr[i];
      if (k && !seen[k]) { seen[k] = 1; out.push(k); }
    }
    return out;
  }

  /* ============================================================
   * 二、分句、基础统计
   * ========================================================== */

  // 切分句子（保留原句），按句号、问号、感叹号、分号、换行切分
  function splitSentences(text) {
    if (!text) return [];
    var raw = String(text)
      .replace(/\r/g, '')
      .split(/(?=[\n])|[\n]+/)
      .join('\n');
    var parts = raw.split(/(?=[。！？；!?;])|[\n]+/);
    var sentences = [];
    var buf = '';
    var all = raw.split(/([。！？；!?;\n])/);
    for (var i = 0; i < all.length; i++) {
      var seg = all[i];
      if (seg === '\n') {
        if (buf.trim()) sentences.push(buf.trim());
        buf = '';
      } else if (/^[。！？；!?;]$/.test(seg)) {
        buf += seg;
        if (buf.trim()) sentences.push(buf.trim());
        buf = '';
      } else {
        buf += seg;
      }
    }
    if (buf.trim()) sentences.push(buf.trim());
    return sentences.map(function (s) {
      return s.replace(/^[\s　•·●○◆◇■□★☆►▶-]+/, '').trim();
    }).filter(function (s) { return s.length >= 2; });
  }

  function splitParagraphs(text) {
    return String(text || '').split(/\n\s*\n|\r\n\s*\r\n|\n{2,}/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function textStats(text) {
    var t = String(text || '');
    var chars = t.replace(/\s/g, '').length;
    var totalChars = t.length;
    var sentences = splitSentences(t);
    var paragraphs = splitParagraphs(t);
    var cjkCount = (t.match(new RegExp('[' + CJK + ']', 'g')) || []).length;
    var digits = (t.match(/\d/g) || []).length;
    var avgLen = sentences.length
      ? Math.round(sentences.reduce(function (a, s) { return a + s.length; }, 0) / sentences.length)
      : 0;
    var readingMinutes = Math.max(1, Math.round(chars / 400));
    return {
      totalChars: totalChars,
      chars: chars,
      cjkCount: cjkCount,
      digits: digits,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      avgSentenceLength: avgLen,
      readingMinutes: readingMinutes
    };
  }

  /* ============================================================
   * 三、日期 / 时间解析（含相对日期）
   * ========================================================== */

  var WEEKDAY_MAP = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

  // 解析句子中的日期，返回 [{raw, iso, type}]
  function extractDates(text, baseDate) {
    baseDate = baseDate || new Date();
    var out = [];
    var t = String(text || '');
    var m;

    // 2026年10月19日 / 2026-10-19 / 2026/10/19 / 2026.10.19
    var reFull = /(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*[日号]?/g;
    while ((m = reFull.exec(t))) {
      var d = safeDate(+m[1], +m[2] - 1, +m[3]);
      if (d) out.push({ raw: m[0], iso: toISODate(d), type: 'absolute' });
    }

    // 10月19日（未注明年份，取基准年；若已过则取次年）
    var reMD = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g;
    while ((m = reMD.exec(t))) {
      if (/\d\s*年\s*0*$/.test(t.slice(0, m.index))) continue;
      var mm = +m[1], dd = +m[2];
      var cand = safeDate(baseDate.getFullYear(), mm - 1, dd);
      if (!cand) continue;
      if (cand < addDays(baseDate, -1)) cand = safeDate(baseDate.getFullYear() + 1, mm - 1, dd);
      out.push({ raw: m[0], iso: toISODate(cand), type: 'monthday' });
    }

    // 相对日期
    var relRules = [
      [/(今天|今日)/g, 0], [/(明天|明日)/g, 1], [/(后天)/g, 2], [/(大后天)/g, 3]
    ];
    relRules.forEach(function (rule) {
      var r;
      while ((r = rule[0].exec(t))) {
        out.push({ raw: r[0], iso: toISODate(addDays(baseDate, rule[1])), type: 'relative' });
      }
    });

    // 本周/下周 周X；周X（显式前缀优先，避免“本周X”被拆开误判）
    var reWeek = /(本周|这周|下周|下星期|下个星期)(?:星期|礼拜|周)?([日天一二三四五六])|(?:星期|礼拜|周)([日天一二三四五六])/g;
    while ((m = reWeek.exec(t))) {
      var prefix = m[1] || '';
      var target = WEEKDAY_MAP[m[2] !== undefined ? m[2] : m[3]];
      var date;
      var monday = addDays(baseDate, baseDate.getDay() === 0 ? -6 : 1 - baseDate.getDay());
      if (/下周|下星期/.test(prefix)) {
        date = addDays(monday, 7 + (target === 0 ? 6 : target - 1));
      } else if (/本周|这周/.test(prefix)) {
        date = addDays(monday, target === 0 ? 6 : target - 1);
      } else {
        date = nextWeekday(baseDate, target);
      }
      out.push({ raw: m[0], iso: toISODate(date), type: 'relative' });
    }

    // 英文星期：Monday/Tuesday/...（可带 next），含 Fri. 缩写
    var EN_WEEK = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    var reEnWeek = /(next\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/gi;
    while ((m = reEnWeek.exec(t))) {
      var enTarget = EN_WEEK[m[2].toLowerCase()];
      var enDate;
      var enMonday = addDays(baseDate, baseDate.getDay() === 0 ? -6 : 1 - baseDate.getDay());
      if (m[1]) enDate = addDays(enMonday, 7 + (enTarget === 0 ? 6 : enTarget - 1));
      else enDate = nextWeekday(baseDate, enTarget);
      out.push({ raw: m[0], iso: toISODate(enDate), type: 'relative' });
    }

    // 月底 / 月初 / 年底 / 年末
    if (m = /月底/.exec(t)) {
      out.push({ raw: m[0], iso: toISODate(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0)), type: 'relative' });
    }
    if (m = /月初/.exec(t)) {
      out.push({ raw: m[0], iso: toISODate(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)), type: 'relative' });
    }
    if (m = /(年底|年末)/.exec(t)) {
      out.push({ raw: m[0], iso: baseDate.getFullYear() + '-12-31', type: 'relative' });
    }

    // 去重（同 raw/iso）
    var seen = {};
    return out.filter(function (x) {
      var k = x.raw + '|' + x.iso;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  function safeDate(y, mo, d) {
    var dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  // 提取时间点：上午10点 / 10:30 / 下午3点半
  function extractTimes(text) {
    var t = String(text || '');
    var out = [];
    var m;
    var reHM = /(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*分)?/g;
    while ((m = reHM.exec(t))) {
      if (+m[1] <= 24 && +m[2] <= 59) out.push({ raw: m[0], text: pad2(+m[1]) + ':' + pad2(+m[2]) });
    }
    var reDian = /(凌晨|早上|上午|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分)?/g;
    while ((m = reDian.exec(t))) {
      var h = +m[2];
      var min = m[3] === '半' ? 30 : (m[4] ? +m[4] : 0);
      var ap = m[1] || '';
      if (h <= 12 && /下午|晚上|傍晚/.test(ap)) h = h === 12 ? 12 : h + 12;
      if (h <= 12 && ap === '中午') h = h < 12 ? h + 12 : h;
      if (h <= 12 && /凌晨|早上|上午/.test(ap)) h = h === 12 ? 0 : h;
      if (h <= 24 && min <= 59) out.push({ raw: m[0], text: pad2(h) + ':' + pad2(min) });
    }
    var seen = {};
    return out.filter(function (x) { if (seen[x.text]) return false; seen[x.text] = 1; return true; });
  }

  /* ============================================================
   * 四、关键信息抽取
   * ========================================================== */

  var PLACES = [
    '北京', '上海', '天津', '重庆', '广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '苏州', '郑州', '长沙', '青岛', '沈阳', '大连', '厦门', '宁波', '福州', '济南', '合肥', '南昌', '昆明', '贵阳', '南宁', '兰州', '太原', '石家庄', '哈尔滨', '长春', '呼和浩特', '乌鲁木齐', '拉萨', '银川', '海口', '三亚', '无锡', '佛山', '东莞', '珠海', '温州', '常州', '烟台', '唐山', '徐州', '香港', '澳门', '台湾',
    '云南', '贵州', '四川', '广东', '江苏', '浙江', '山东', '河南', '河北', '湖北', '湖南', '安徽', '福建', '江西', '陕西', '甘肃', '青海', '山西', '辽宁', '吉林', '黑龙江', '海南', '云南', '内蒙古', '新疆', '西藏', '宁夏', '广西'
  ];

  var SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公年麦迟宇端么粟况';

  function extractEntities(text, baseDate) {
    var t = String(text || '');
    var result = {
      dates: [], times: [], phones: [], emails: [], urls: [],
      money: [], percents: [], idCards: [],
      organizations: [], places: [], persons: [],
      venues: [], deadlines: []
    };

    result.dates = extractDates(t, baseDate);
    result.times = extractTimes(t);

    var m;
    var reEmail = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
    while ((m = reEmail.exec(t))) result.emails.push(m[0]);

    var rePhone = /(?<!\d)(1[3-9]\d{9})(?!\d)/g;
    while ((m = rePhone.exec(t))) result.phones.push(m[0]);
    var reTel = /(?<!\d)(0\d{2,3}[-\s]?\d{7,8})(?!\d)/g;
    while ((m = reTel.exec(t))) result.phones.push(m[0]);

    var reUrl = /https?:\/\/[^\s，。；;、）)】\]]+|www\.[^\s，。；;、）)】\]]+/gi;
    while ((m = reUrl.exec(t))) result.urls.push(m[0]);

    var reMoney = /(\d+(?:\.\d+)?)\s*(万亿元|亿万元|亿元|万元|万港元|万美元|万欧元|万人民币|元|块钱|块|人民币|美元|欧元|日元|港元|港币|英镑)/g;
    while ((m = reMoney.exec(t))) {
      var amount = +m[1];
      var unit = m[2];
      var yuan = amount;
      // 注意顺序：“万亿元”包含“亿元”子串，必须先判万亿，再判亿、万，否则 5 万亿元会被误算成 5 亿元
      if (/万亿元|亿万元/.test(unit)) yuan = amount * 1000000000000;
      else if (/亿元/.test(unit)) yuan = amount * 100000000;
      else if (/万元|万港元|万美元|万欧元|万人民币/.test(unit)) yuan = amount * 10000;
      result.money.push({ raw: m[0], amount: amount, unit: unit, approxYuan: yuan });
    }

    var rePct = /(\d+(?:\.\d+)?)\s*(?:%|％|个百分点|百分号)/g;
    while ((m = rePct.exec(t))) result.percents.push({ raw: m[0], value: +m[1] });

    var reID = /(?<!\d)(\d{17}[\dXx]|\d{15})(?!\d)/g;
    while ((m = reID.exec(t))) result.idCards.push(m[0]);

    var reOrg = /[一-龥A-Za-z0-9·]{2,18}?(?:股份有限公司|有限责任公司|有限公司|集团公司|集团股份|事业部|政务中心|服务中心|分公司|子公司|项目组|委员会|工作组|研究院|研究所|事务所|联合会|促进会|协会|学会|基金会|职业学院|科室|处室|部门|中心|小组|班组|大学|学院|医院|银行|集团|公司|部|组|科|局|厅|署)/g;
    while ((m = reOrg.exec(t))) {
      var name = m[0];
      // 去掉匹配开头的连词/介词（如“请研发部”“及项目组”）
      name = name.replace(/^[请及和与在到从对由被让把给或]+/, '');
      // 排除“布局/部署/局面/格局/结局”等以机关字结尾的普通词语；单字后缀（部/组/科）会带来误命中，一并排除。
      // 机构名称不含在/的/了/是等虚词，含这些字的匹配（如“地点在云科”）也排除；
      // 含路/街/巷/大厦/号楼/层等字样的是地址片段而非机构，也排除。
      if (name.length >= 3 && !/[在的了是]/.test(name) && !/[路街巷]|大道|大厦|大楼|号楼|层/.test(name)
          && !/(布局|部署|局面|格局|结局|发布|局部|全部|部分|内部|外部|干部|重组|本科|专科|理科|工科|文科|学科)$/.test(name)) result.organizations.push(name);
    }

    PLACES.forEach(function (p) {
      if (t.indexOf(p) >= 0) result.places.push(p);
    });

    // 地点 / 场所：XX会议室、XX室、XX楼XX层、XX酒店；捕获组用贪婪以保留完整场所（如“云科大厦12层大会议室”）
    var reVenue = /(?:地点[是为：:\s]*|在)([一-龥A-Za-z0-9]{2,32}(?:会议室|报告厅|多功能厅|会展中心|酒店|大厦|大楼|写字楼|\d+号楼?|\d+层|[A-Za-z]\d+室|办公室|接待室|活动室))/g;
    while ((m = reVenue.exec(t))) {
      // 取捕获组，去掉“地点：/在”前缀；“同一会议室”这类泛指指代不是具体场所，不收录
      var venue = m[1].replace(/^在/, '');
      if (!/^(同一|相同)/.test(venue)) result.venues.push(venue);
    }

    // 人物：姓氏 + 称谓
    var rePerson = new RegExp('[' + SURNAMES + '](?:[一-龥]{0,2}?)(?:总经理|经理|主任|总监|主管|工程师|设计师|工|老师|先生|女士|教授|博士|科长|处长|局长|组长|院长|校长|总)', 'g');
    while ((m = rePerson.exec(t))) {
      var nm = m[0];
      // 排除“项目经理/部门经理/总经理”等岗位通称
      if (/^(项目经理|部门经理|总经理|副经理|项目总监|部门主管|项目主管|负责人)/.test(nm)) continue;
      // 归一化：去掉称谓只留姓名；若只剩单字（如“张工”）则保留原称谓
      var strippedName = nm.replace(/(总经理|副经理|经理|主任|总监|主管|工程师|设计师|工|老师|先生|女士|教授|博士|科长|处长|局长|组长|院长|校长|总)$/, '');
      if (strippedName.length >= 2) nm = strippedName;
      // 排除“季度总/月度总/年度总/本周总”等时间词误识别
      if (/^(季度|月度|年度|本周|本月|本年|每周|每月|每日|全年|上半年|下半年)$/.test(nm)) continue;
      result.persons.push(nm);
    }
    // 部门/小组 + 人名（如“测试组李娟负责”“产品部赵敏在”）
    var reDeptName = /(?:部|组|中心|科室)([一-龥]{2,3})(?:工程师|设计师|经理|总监|主管|主任|工)?(?=负责|在|于|牵头|需|请|跟进|完成|组织)/g;
    var nameBlacklist = ['需要', '应当', '应该', '建议', '尽快', '及时', '按时', '正在', '相关', '全体', '各位', '所有', '有关', '人员', '部门', '负责', '牵头', '准备', '组织', '统筹'];
    while ((m = reDeptName.exec(t))) {
      if (nameBlacklist.indexOf(m[1]) < 0 && !/[组部员室期长]$/.test(m[1])) result.persons.push(m[1]);
    }
    var reOwner = /负责人[是为：:\s]*([一-龥A-Za-z]{2,8})/g;
    while ((m = reOwner.exec(t))) result.persons.push(m[1]);

    // v2 新增：从“请…/由…负责”等指派片段中识别人名（含无头衔姓名、复姓、英文名）
    splitSentences(t).forEach(function (s) {
      var seg;
      var reReq = /请([^，。；！？]{0,44}?)(?:于|在|前|尽快|及时|抓紧|协助|配合|牵头|组织|提交|完成|联系|对接|确认|准备|安排|上报|将|务必|进行|负责|本周|这周|下周|今天|明天|后天|周[一二三四五六日天]|\d{1,2}\s*月|\d{1,2}\s*[:：])/;
      var rm = reReq.exec(s);
      if (rm) findNamesInSegment(rm[1]).forEach(function (n) { result.persons.push(n); });
      var reBy = /由([一-龥A-Za-z0-9、，和及与 ]{2,24}?)(?:负责|牵头|完成|落实|提交|跟进|对接|组织|汇总)/;
      var bm = reBy.exec(s);
      if (bm) findNamesInSegment(bm[1]).forEach(function (n) { result.persons.push(n); });
      // 直接复用责任人识别（排除部门/小组等机构性主体）
      detectOwners(s).owners.forEach(function (n) {
        if (!/[部组]$/.test(n)) result.persons.push(n);
      });
      // 英文指派 “John must finish”
      var enm = /([A-Z][a-z]{1,15})\s+(?:must|should|will|needs?\s+to|to)\s+(?:finish|complete|submit|review|prepare|send|check|provide|report)/g;
      var emx;
      while ((emx = enm.exec(s))) result.persons.push(emx[1]);
    });

    // 截止时间：句子中出现 截止/截至/最迟/最晚/前完成/前提交 等 + 日期
    var deadlineCue = /(截止|截至|最迟|最晚|到期|之前|以前|前完成|前提交|前上报|前反馈|前确认|前召开|前结束|前组织|前报送|前签署|deadline|Deadline|DDL)/;
    splitSentences(t).forEach(function (s) {
      if (deadlineCue.test(s)) {
        var ds = extractDates(s, baseDate);
        var ts = extractTimes(s);
        if (ds.length) {
          result.deadlines.push({
            raw: s.slice(0, 60),
            iso: ds[ds.length - 1].iso,
            time: ts.length ? ts[ts.length - 1].text : null
          });
        }
      }
    });

    // 各类结果去重
    ['emails', 'phones', 'urls', 'organizations', 'places', 'persons', 'venues'].forEach(function (k) {
      result[k] = unique(result[k]);
    });
    result.deadlines = result.deadlines.filter(function (d, i, arr) {
      return arr.findIndex(function (x) { return x.iso === d.iso && (x.time || '') === (d.time || ''); }) === i;
    });
    return result;
  }

  /* ============================================================
   * 五、关键词抽取（n-gram 词频 + 办公领域词库）
   * ========================================================== */

  var STOP_CHARS = new Set(('的了在是我你他她它们和与及或等也都就还会能可对把被让使向从为以于上下中不没有个这那之其而但并且则若如因所已正将需须应该此某每各本些着过地得啊吧呢吗嘛哦哈呀哟么很最再又非常把向跟给比按照由于为了关于对于通过进行一个以及可以需要我们你们他们大家目前现在正在一下一些这种那种什么怎么为什么因为所以虽然但是然后接着随后首先其次最后此外另外同时其中包括以下以上之间以内以来表示认为指出强调提出要求').split(''));

  var DOMAIN_WORDS = [
    '会议', '纪要', '项目', '进度', '计划', '报告', '方案', '预算', '客户', '合同', '交付', '上线',
    '测试', '需求', '评审', '复盘', '风险', '采购', '招标', '审批', '流程', '绩效', '招聘', '培训',
    '调研', '数据', '运营', '市场', '销售', '产品', '研发', '技术', '部门', '团队', '目标', '任务',
    '里程碑', '节点', '验收', '文档', '周报', '月报', '反馈', '优化', '整改', '落实', '推进', '协调',
    '资源', '排期', '成本', '发票', '报销', '合规', '质量', '安全', '部署', '服务器', '接口', '联调',
    '故障', '工单', '值班', '考核', '战略', '合作', '协议', '供应商', '报价', '回款', '库存', '物流',
    '盘点', '法务', '例会', '专题会', '启动会', '总结会', '验收会', '动员会', '签报', '立项', '结项',
    '自动化', '智能化', '数字化', '办公', '效率', '会议纪要', '工作流', '待办', '甘特图', '时间表',
    '负责人', '截止时间', '完成时限', '应急预案', '责任人', '时间表', '路线图'
  ];

  function extractKeywords(text, limit) {
    limit = limit || 12;
    var t = String(text || '');
    var runs = t.match(new RegExp('[' + CJK + ']{2,}', 'g')) || [];
    var freq = {};
    runs.forEach(function (run) {
      for (var n = 2; n <= 4; n++) {
        for (var i = 0; i + n <= run.length; i++) {
          var gram = run.substr(i, n);
          if (STOP_CHARS.has(gram[0]) || STOP_CHARS.has(gram[n - 1])) continue;
          freq[gram] = (freq[gram] || 0) + 1;
        }
      }
    });

    var scored = {};
    Object.keys(freq).forEach(function (g) {
      if (freq[g] < 2) return;
      // 被更长高频词包含的短词降权
      var score = freq[g] * (g.length >= 3 ? 1.6 : 1);
      scored[g] = score;
    });
    // 领域词加权
    DOMAIN_WORDS.forEach(function (w) {
      var c = 0, idx = t.indexOf(w);
      while (idx >= 0) { c++; idx = t.indexOf(w, idx + w.length); }
      if (c > 0) scored[w] = (scored[w] || 0) + c * 2.2 + 0.6;
    });

    var arr = Object.keys(scored).map(function (k) { return { word: k, score: scored[k] }; });
    // 去除高度重叠词：若一个词被另一个词包含且得分更低，则剔除
    arr.sort(function (a, b) { return b.score - a.score; });
    var kept = [];
    for (var i = 0; i < arr.length; i++) {
      var w = arr[i].word;
      var dominated = false;
      for (var j = 0; j < kept.length; j++) {
        if (kept[j].word.length > w.length && kept[j].word.indexOf(w) >= 0 && kept[j].score >= arr[i].score) {
          dominated = true; break;
        }
      }
      if (!dominated) kept.push(arr[i]);
      if (kept.length >= limit) break;
    }
    return kept.map(function (x) { return { word: x.word, weight: Math.round(x.score * 10) / 10 }; });
  }

  /* ============================================================
   * 六、摘要、分类、情感倾向
   * ========================================================== */

  var SUMMARY_CUES = /(因此|所以|总之|综上|总而言之|关键|重点|核心|主要|目标是|目标为|要求|必须|务必|决定|确定|明确|结论|计划|安排|部署|强调|指出|如下|包括|一是|二是|三是|四是|首先|其次|最后)/;

  function summarize(text, maxCount) {
    maxCount = maxCount || 3;
    var sentences = splitSentences(text);
    if (sentences.length <= maxCount) return sentences.slice();
    var kws = extractKeywords(text, 20).map(function (x) { return x.word; });
    var scored = sentences.map(function (s, idx) {
      var score = 0;
      kws.forEach(function (k) { var c = 0, i = s.indexOf(k); while (i >= 0) { c++; i = s.indexOf(k, i + k.length); } score += c * 1.4; });
      if (SUMMARY_CUES.test(s)) score += 2.5;
      if (idx === 0) score += 1.2;
      if (idx === sentences.length - 1) score += 0.8;
      if (s.length > 60) score += 0.6;
      if (s.length < 8) score -= 2;
      return { s: s, idx: idx, score: score };
    });
    var top = scored.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, maxCount);
    top.sort(function (a, b) { return a.idx - b.idx; });
    return top.map(function (x) { return x.s; });
  }

  var CATEGORY_RULES = [
    ['会议纪要', /会议|纪要|召开|参会|出席|议题|主持|发言|议定|会议认为|会议要求/],
    ['项目计划', /项目|里程碑|排期|进度计划|实施方案|开发计划|甘特|阶段目标/],
    ['通知公告', /通知|公告|通告|定于|兹定于|请各|请于|现将|特此/],
    ['工作报告', /工作报告|总结|复盘|述职|半年|年度|季度|完成情况|工作进展|下一步/],
    ['采购与合同', /采购|招标|投标|合同|供应商|报价|中标|履约|付款|发票/],
    ['财务预算', /预算|决算|报销|费用|收入|支出|成本|利润|现金流|回款|审计/],
    ['人力资源', /招聘|入职|离职|绩效|考核|培训|薪酬|岗位|编制|竞聘/],
    ['问题与风险', /故障|投诉|风险|隐患|整改|问题|事故|缺陷|应急|预警|漏洞/]
  ];

  function classify(text) {
    var t = String(text || '');
    var best = { category: '通用办公文档', score: 0 };
    CATEGORY_RULES.forEach(function (rule) {
      var c = (t.match(new RegExp(rule[1].source, 'g')) || []).length;
      if (c > best.score) best = { category: rule[0], score: c };
    });
    return best.category;
  }

  var POS_WORDS = ['顺利', '优秀', '良好', '完成', '达标', '增长', '提升', '盈利', '满意', '成功', '提前', '领先', '突破', '获奖', '通过', '认可', '积极', '超额', '好转', '改善', '稳定', '进展', '兑现', '增长', '成效'];
  var NEG_WORDS = ['延误', '延期', '逾期', '亏损', '失败', '投诉', '故障', '风险', '问题', '缺陷', '不足', '下降', '下滑', '严重', '紧急', '困难', '障碍', '停滞', '差错', '事故', '未完成', '不达标', '漏洞', '冲突', '矛盾', '分歧', '落后', '超支', '紧缺', '滞后', '隐患', '违规', '整改', '赔偿', '违约'];

  function sentiment(text) {
    var t = String(text || '');
    var pos = 0, neg = 0;
    var hits = { positive: [], negative: [] };
    POS_WORDS.forEach(function (w) {
      var c = t.indexOf(w) >= 0 ? t.split(w).length - 1 : 0;
      if (c) { pos += c; hits.positive.push(w); }
    });
    NEG_WORDS.forEach(function (w) {
      var c = t.indexOf(w) >= 0 ? t.split(w).length - 1 : 0;
      if (c) { neg += c; hits.negative.push(w); }
    });
    var label = '中性';
    if (pos > neg * 1.2 && pos >= 2) label = '偏积极';
    else if (neg > pos * 1.2 && neg >= 2) label = '偏消极（需关注）';
    else if (pos >= 2 || neg >= 2) label = '中性偏混合';
    return {
      label: label,
      positiveScore: pos,
      negativeScore: neg,
      positiveWords: unique(hits.positive),
      negativeWords: unique(hits.negative)
    };
  }

  function analyzeText(text, baseDate) {
    var stats = textStats(text);
    var keywords = extractKeywords(text, 12);
    var summary = summarize(text, 4);
    var category = classify(text);
    var tone = sentiment(text);
    return {
      stats: stats,
      keywords: keywords,
      summary: summary,
      category: category,
      tone: tone
    };
  }

  /* ============================================================
   * 七、待办清单提取
   * ========================================================== */

  var ACTION_VERBS = '完成|落实|推进|跟进|提交|交付|确认|安排|准备|上报|反馈|对接|整理|制定|制订|开展|组织|召开|主持|审核|审批|采购|整改|优化|更新|排查|统计|调研|梳理|撰写|编写|发送|通知|联系|协调|安排|落实|汇总|核对|复核|归档|备份|测试|上线|发布|评估|验收|培训|招聘|报名|签署|盖章|付款|报销|申领|登记|报送|检查|巡检|监控|复盘|总结|汇报|修订|完善|补充|启动|暂停|恢复|执行|处理|解决|答复|回复|预约|预定|预订|参会|参加|出席|主讲|牵头|负责|配合|协助|支持';

  // 英文动作动词（v2 新增，覆盖中英混杂办公材料）
  var EN_ACTION_VERBS = 'finish|complete|submit|review|prepare|send|deliver|confirm|update|check|provide|report|fix|schedule|arrange|attend|reply|follow\\s?up|hand\\s?over|sign|pay|organize|upload|deploy|test';

  function detectPriority(s) {
    if (/(紧急|立即|马上|立刻|务必|逾期|越快越好|火速|当天|今日内|今天之内|抢|刻不容缓|ASAP|urgent|immediately)/i.test(s)) return '高';
    if (/(建议|可以考虑|拟|视情况|方便时|有空|抽空|择机)/.test(s)) return '低';
    return '中';
  }

  function cleanOwner(o) {
    if (!o) return '';
    // 去掉角色头衔后缀
    o = o.replace(/(工程师|设计师|经理|主任|总监|主管|老师|先生|女士|同志|专员|同事)$/, '');
    o = o.replace(/^(.{2,})工$/, '$1');
    // 去掉开头的岗位前缀（仅当其后还有名字时）
    var stripped = o.replace(/^(项目经理|项目主管|部门经理|部门主管|总经理|副经理|助理)/, '')
      .replace(/^[一-龥]{2,8}?(?:部|组|中心|科室|事业部)/, '');
    if (stripped.length >= 2) o = stripped;
    return o.trim();
  }

  /* ---------- 多责任人 / 无头衔姓名 / 英文人名（v2 新增） ---------- */

  var VAGUE_OWNERS = ['大家', '各位', '全员', '全体', '各部门', '相关人员', '相关同事', '各组', '各小组', '项目组全体', '全体成员', '全体同事', '与会人员', '参会人员'];

  // 名字右截断停用字（如“李娟负责”“王磊在”）
  var NAME_TRIM_TAIL = {
    '负': 1, '责': 1, '在': 1, '于': 1, '是': 1, '和': 1, '的': 1, '与': 1,
    '及': 1, '或': 1, '要': 1, '需': 1, '会': 1, '把': 1, '对': 1, '从': 1,
    '向': 1, '按': 1, '将': 1, '被': 1, '给': 1, '跟': 1, '让': 1, '使': 1,
    '为': 1, '以': 1, '前': 1, '之': 1, '后': 1, '工': 1, '总': 1, '等': 1,
    '这': 1, '那': 1, '也': 1, '都': 1, '就': 1, '请': 1, '来': 1, '去': 1,
    '做': 1, '说': 1, '想': 1, '能': 1, '可': 1, '应': 1, '该': 1, '须': 1,
    '同': 1, '跟': 1, '及': 1, '并': 1, '而': 1, '且': 1, '中': 1, '内': 1,
    '上': 1, '下': 1, '里': 1, '到': 1, '过': 1, '着': 1, '了': 1, '有': 1,
    '师': 1, '长': 1, '组': 1, '部': 1, '员': 1, '室': 1, '期': 1, '局': 1, '开': 1,
    '元': 1, '划': 1, '目': 1, '计': 1
  };

  // 名字中后两字为常见办公名词时，整词判为误识别（如“成数据”“张进度”）
  var NAME_TAIL2 = ['数据', '信息', '工作', '材料', '会议', '计划', '方案', '任务', '进度', '报告', '部门', '人员', '测试', '研发', '产品', '运营', '财务', '项目', '系统', '质量', '安全', '内容', '时间', '问题', '情况', '要求', '安排', '准备', '相关', '客户', '用户', '团队', '领导', '合同', '预算', '成本', '邮件', '通知', '文档', '服务', '技术', '市场', '销售', '人事', '行政', '培训', '招聘', '采购', '付款', '发票', '报销', '流程', '风险', '缺陷', '故障', '整改', '验收', '发布', '上线', '部署', '接口', '联调', '调研', '统计', '梳理', '汇总', '核对', '复核', '检查', '监控', '复盘', '总结', '汇报', '优化', '完善', '补充', '处理', '解决', '答复', '回复', '预约', '组织', '召开', '协调', '配合', '协助', '支持', '牵头', '落实', '推进', '跟进', '开展', '执行', '资料', '事项', '需求', '手册', '文案', '宣传', '版本', '功能', '页面', '代码', '缺陷', '文档', '纪要', '例会', '评审', '付款', '审批', '流程', '负责', '完成', '提交', '确认', '反馈', '准备', '整理', '制定', '编写', '撰写', '发送', '联系', '修复', '回归', '权限', '模块', '同步', '间定', '期间', '开发', '评审', '经理', '准时'];

  // 从一个“指派片段”中识别人名（支持复姓、无头衔姓名、英文人名）
  function findNamesInSegment(seg) {
    if (!seg) return [];
    var out = [];
    var m;
    function keep(n) {
      if (n && n.length >= 2 && out.indexOf(n) < 0) out.push(n);
    }
    // 1) 复姓 + 1~2 名；命中后把该片段遮蔽，避免单姓规则二次命中（如“司马楠”误出“马楠”）
    var masked = String(seg);
    var reCompound = /(欧阳|司马|上官|诸葛|东方|令狐|皇甫|尉迟|公孙|慕容|长孙|宇文|司徒|司空|澹台|宗政|亓官|万俟|单于|呼延|夏侯)([一-龥]{1,2})/g;
    while ((m = reCompound.exec(seg))) {
      var nm = m[0];
      while (nm.length > 2 && NAME_TRIM_TAIL[nm.charAt(nm.length - 1)]) nm = nm.slice(0, -1);
      keep(nm);
      masked = masked.split(nm).join(new Array(nm.length + 1).join('·'));
    }
    // 遮蔽星期表述（避免“周五”被识别成人名）
    masked = masked.replace(/(本周|这周|下周|本星期|下星期|星期|礼拜|周)([一二三四五六日天])/g, function (x) {
      return new Array(x.length + 1).join('·');
    });
    // 2) 单姓 + 1~2 名（贪婪两字后做右截断与名词过滤）
    var reSingle = new RegExp('[' + SURNAMES + ']([一-龥]{1,2})', 'g');
    while ((m = reSingle.exec(masked))) {
      var name = m[0];
      while (name.length > 2 && NAME_TRIM_TAIL[name.charAt(name.length - 1)]) name = name.slice(0, -1);
      if (name.length === 2 && NAME_TRIM_TAIL[name.charAt(1)]) continue;
      if (name.length === 3 && NAME_TRIM_TAIL[name.charAt(1)]) continue;
      if (name.length === 3 && /[部组组员人室期长局科院办师]$/.test(name.charAt(2))) name = name.slice(0, 2);
      if (name.length === 3 && NAME_TAIL2.indexOf(name.slice(1)) >= 0) continue;
      if (name.length === 3 && NAME_TAIL2.indexOf(name.slice(-2)) >= 0) continue;
      keep(name);
    }
    // 3) 英文指派：please ask John / @John / John must / John to finish
    var reEn = /(?:please\s+ask|ask|@|请)\s*([A-Z][a-z]{1,15})\b|([A-Z][a-z]{1,15})\s+(?:must|should|will|needs?\s+to|to)\s+(?:finish|complete|submit|review|prepare|send|check|provide|report)/g;
    while ((m = reEn.exec(seg))) {
      keep(m[1] || m[2]);
    }
    // 过滤：整体等于岗位通称、部门词或常见办公词
    var bad = ['项目经理', '部门经理', '总经理', '负责人', '相关人员', '工作人员', '项目组', '后续', '目前', '前期', '后期', '同期'];
    return out.filter(function (n) {
      if (bad.indexOf(n) >= 0) return false;
      if (/^(负责|完成|准备|安排|组织|建议|需要|应当|应该|尽快|及时|相关|全体|各位|大家|所有|会议|部门|人员|同事|项目|任务|工作|测试|研发|产品|运营|财务|行政|人事)$/.test(n)) return false;
      // 工作日/星期单字结尾的 2 字名（如“周五”）
      if (/^[一二三四五六日天]$/.test(n.charAt(1))) return false;
      return true;
    });
  }

  // 兼容旧接口：返回第一责任人
  function detectOwner(s) {
    return detectOwners(s).owners[0] || '';
  }

  // 返回 { owners: 具体责任人[], vague: 泛称[] }
  function detectOwners(s) {
    var owners = [];
    var vague = [];
    function addName(n) {
      n = cleanOwner(n);
      if (!n) return;
      if (VAGUE_OWNERS.indexOf(n) >= 0) { if (vague.indexOf(n) < 0) vague.push(n); return; }
      if (n.length >= 2 && owners.indexOf(n) < 0) owners.push(n);
    }
    var m;
    // 1) “由 X 负责/牵头/汇总”
    if ((m = /由([一-龥A-Za-z0-9、，和及与 ]{2,24}?)(?:负责|牵头|完成|落实|提交|跟进|对接|组织|汇总)/.exec(s))) {
      findNamesInSegment(m[1]).forEach(addName);
    }
    // 2) “X 负责/牵头”
    if ((m = /([一-龥A-Za-z0-9、，和 ]{2,16}?)(?:负责|牵头)(?:完成|开展|推进|实施|落实)?/.exec(s))) {
      findNamesInSegment(m[1]).forEach(addName);
    }
    // 3) “请 X（在/于/前/动作）…”
    if ((m = /请([^，。；！？]{0,44}?)(?:于|在|前|尽快|及时|抓紧|协助|配合|牵头|组织|提交|完成|联系|对接|确认|准备|安排|上报|更新|同步|联调|跟进|推进|执行|处理|解决|报送|汇报|参加|出席|参会|排查|整改|优化|修复|采购|发送|通知|回复|培训|测试|将|务必|进行|负责|本周|这周|下周|今天|明天|后天|周[一二三四五六日天]|\d{1,2}\s*月|\d{1,2}\s*[:：])/.exec(s))) {
      findNamesInSegment(m[1]).forEach(addName);
    }
    // 4) 带称谓的姓名（优先用 findNames 过滤“项目经理”等岗位通称；“张工”保留称谓）
    var reTitle = new RegExp('[' + SURNAMES + '](?:[一-龥]{0,2}?)(?:总经理|经理|主任|总监|主管|工程师|设计师|工|老师|科长|处长|组长)', 'g');
    while ((m = reTitle.exec(s))) {
      var titleRaw = m[0];
      if (/^(项目经理|部门经理|总经理|副经理|项目总监|部门主管|项目主管|负责人|产品经理|技术经理|研发经理)/.test(titleRaw)) continue;
      var titleNames = findNamesInSegment(titleRaw);
      if (titleNames.length) titleNames.forEach(addName);
      else if (new RegExp('^[' + SURNAMES + ']工$').test(titleRaw)) addName(titleRaw);
    }
    // 5) 部门 / 小组作为责任方（报送/发送/提交给之后的部门是接收方，不是责任人）
    var deptRe = /(产品部|研发部|技术部|市场部|销售部|运营部|财务部|人事部|人力资源部|行政部|综合部|项目部|采购部|法务部|质控部|质量管理部|各部门|项目组|课题组|研发组|产品组|设计组|运维组|前端组|后端组|测试组|测试部|算法组|数据组|客服组|实施组)/g;
    var deptHit;
    while ((deptHit = deptRe.exec(s))) {
      var dept = deptHit[1];
      var before = s.slice(Math.max(0, deptHit.index - 4), deptHit.index);
      var isReceiver = /(报送|发送|发至|发往|发给|提交至|提交给|交至|抄送|抄报|交)$/.test(before) || /(报送|发送|发至|发往|发给|提交至|提交给|交至|抄送|抄报)/.test(before);
      if (dept === '各部门') {
        if (vague.indexOf('各部门') < 0) vague.push('各部门');
      } else if (!isReceiver && owners.indexOf(dept) < 0) {
        owners.push(dept);
      }
    }
    // 6) 泛称（大家/各位/相关人员/全体…）
    VAGUE_OWNERS.forEach(function (v) {
      if (s.indexOf(v) >= 0 && vague.indexOf(v) < 0 && /(请|建议|望|请各位|由|要求|需|希望|记得|别忘了|别忘|参加|出席|主持|参会)/.test(s)) vague.push(v);
    });
    // 7) 英文祈使指派（含中文人名：“李娟 must submit”“ask 张伟 to finish”）
    var reEn = new RegExp('((?:[A-Z][a-z]{1,15})|(?:[' + SURNAMES + '][一-龥]{1,2}))\\s+(?:must|should|will|needs?\\s+to|to)\\s+(?:finish|complete|submit|review|prepare|send|check|provide|report)', 'g');
    while ((m = reEn.exec(s))) {
      if (/[一-龥]/.test(m[1])) findNamesInSegment(m[1]).forEach(addName);
      else if (owners.indexOf(m[1]) < 0) owners.push(m[1]);
    }
    // 7b) “ask 张伟 to finish” / “@张伟”
    var reAsk = /(?:please\s+ask|ask|@)\s*([A-Z][a-z]{1,15}|[一-龥]{2,4})/g;
    while ((m = reAsk.exec(s))) {
      if (/[一-龥]/.test(m[1])) findNamesInSegment(m[1]).forEach(addName);
      else if (owners.indexOf(m[1]) < 0) owners.push(m[1]);
    }
    // 8) “何雯需在11月3日前…”“陈晓东须在本周五…”
    if ((m = /([一-龥A-Za-z]{2,10}?)(?:需|须要|务必|要)(?:在|于)\s*(?:\d{1,2}\s*月|本周|这周|下周|今天|明天|后天|周[一二三四五六日天]|\d{1,2}\s*[:：])/.exec(s))) {
      findNamesInSegment(m[1]).forEach(addName);
    }
    // 9) 裸姓名 + 任务词（“刘洋在10月21日前…”“张伟完成…”），复用 findNames 黑名单
    var reNaked = new RegExp('([' + SURNAMES + '][一-龥]{1,2})(?:在|于|需|须|前|负责|牵头|主持|完成|提交|落实|开展|组织|召开|更新|输出)', 'g');
    while ((m = reNaked.exec(s))) {
      findNamesInSegment(m[1]).forEach(addName);
    }
    // 9b) “姓名/姓名在…前”宽片段（“林晓舟和欧阳致远在10月25日前…”）
    var reNakedSeg = /([一-龥、，和及与]{2,14}?)(?:在|于)(?=[^，。；！？]{0,8}(?:\d{1,2}\s*月|本周|下周|周[一二三四五六日天]|今天|明天|前|下午|上午))/g;
    while ((m = reNakedSeg.exec(s))) {
      if (!new RegExp('[' + SURNAMES + ']').test(m[1])) continue;
      var segMasked = m[1].replace(/(供应商|经销商|客户|厂商|合作方|甲方|乙方|第三方|承包商|服务商)/g, function (w) { return new Array(w.length + 1).join('·'); });
      findNamesInSegment(segMasked).forEach(function (nm) {
        // 姓名后必须是连接词（和/与/、…）或紧邻“在/于”（片段结尾）
        var p = segMasked.lastIndexOf(nm);
        var after = segMasked.charAt(p + nm.length);
        if (after === '' || /[和与及、，]/.test(after)) addName(nm);
      });
    }
    return { owners: owners, vague: vague };
  }

  // 置信度评估：责任人/截止时间缺失即降级
  function scoreConfidence(todo, s) {
    var reasons = [];
    var hasConcrete = (todo.owners || []).length > 0;
    var hasVague = (todo.vagueOwners || []).length > 0;
    if (!hasConcrete) {
      reasons.push(hasVague ? '责任人为泛称（' + todo.vagueOwners.join('、') + '），需落实到具体人' : '未识别到责任人');
    }
    if (!todo.deadline) reasons.push('未识别到截止时间');
    if (/[？?]/.test(s)) reasons.push('原句为疑问句，行动要求需确认');
    if (/[一-龥]/.test(todo.content) && todo.content.length < 8) reasons.push('任务描述过短，可能不完整');
    var level = reasons.length === 0 ? 'high' : (reasons.length === 1 ? 'medium' : 'low');
    return { level: level, reasons: reasons };
  }

  function generateTodos(text, baseDate) {
    baseDate = baseDate || new Date();
    var sentences = splitSentences(text);
    var todos = [];
    var seen = {};
    sentences.forEach(function (s, idx) {
      var isAction = false;
      var cueMatched = '';
      // 疑问句（“是不是…？”“大家时间OK吗？”）不直接当作任务
      if (/[？?]/.test(s) && /(是不是|对不对|行不行|好不好|可以吗|怎么样|如何|怎么|吗[？?]|OK\s*吗|ok\s*吗)/.test(s)) return;
      // 强提示：祈使 / 情态 / 动作动词（不含裸“要”，避免“主要/需要”中“要”的误匹配）
      var reVerb = new RegExp('(请|务必|必须|须|应当|应该|建议|需要|需|抓紧|尽快|及时|按时|准时|拟将|计划|定于|将于)\\s*[^，。；！？]{0,30}?(' + ACTION_VERBS + ')');
      var m = reVerb.exec(s);
      if (m) { isAction = true; cueMatched = m[0].slice(0, 20); }
      if (!isAction) {
        // 句首直接是动作动词，但排除“测试组 / 参会人员 / 培训期间”等名词性开头
        var strippedHead = s.replace(/^[一二三四五六七八九十\d]+[、.．)）]\s*/, '');
        var dm = new RegExp('^(' + ACTION_VERBS + ')([一-龥])').exec(strippedHead);
        if (dm && !/^(组|部|员|人|期|官|方|室|工作|阶段|流程|学校|合|流|物|清|订|案|划|制|理|务|模|块|书|据|表|单|网|端|机|线|包|商|价|款)$/.test(dm[2])) {
          isAction = true;
        }
      }
      // v2：口语提醒“记得/别忘了开站会、带材料”
      if (!isAction && /(记得|别忘了|别忘|记得要)[^，。；！？]{0,14}(开|做|发|写|交|准备|整理|联系|参加|预约|订|完成|提交|带|汇报|出席|参会)/.test(s)) {
        isAction = true;
      }
      // v2：参会/主持要求（“李建国主持评审会，研发全员参加”），排除“会议由X主持”的陈述句
      if (!isAction && /(主持|参加|出席|参会|列席|主讲)/.test(s) && /(会议|例会|评审会|协调会|总结会|发布会|启动会|动员会|宣讲会|分享会|年会|周会|月会|晨会|站会|班会|大会|论坛|讲座|培训|演练)/.test(s)) {
        var hostOnly = /主持/.test(s) && !/(参加|出席|参会|列席|主讲)/.test(s);
        var hostStatement = /由[^，。；！？]{0,8}主持/.test(s);
        var futureCue = /(请|需|务必|准时|明天|后天|下周|本周|将于|定于|今晚|今晚|今晚)/.test(s);
        if (!(hostOnly && hostStatement && !futureCue)) isAction = true;
      }
      // v2 新增：英文 / 中英混杂动作句
      if (!isAction) {
        var reEn = new RegExp('(?:please|must|need\\s*to|needs?\\s+to|should|required\\s+to|kindly|by\\s+\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|(?:必须|务必|需要|需|尽快|请)[^，。；！？\\n]{0,24}?)[^。；！？\\n]{0,50}?(?:' + EN_ACTION_VERBS + ')', 'i');
        var em = reEn.exec(s);
        if (em) { isAction = true; cueMatched = 'EN:' + em[0].slice(0, 20); }
      }
      if (!isAction && /(负责|牵头|责任人|责任部门|deadline|DDL|截止)/i.test(s)) {
        // 含责任分配但无动作动词的句子，若是名词性分工也收录
        if (new RegExp(ACTION_VERBS).test(s)) { isAction = true; }
      }
      // 排除会议/培训等活动安排类陈述句（“会议定于X召开/培训定于X举行”），除非有出席要求
      if (isAction && /(会议|例会|协调会|评审会|大会|活动|论坛|培训|讲座|演练|宣讲会|分享会|总结会|发布会|启动会|动员会|年会|周会|月会|晨会|班会).{0,12}(定于|将于|时间[：:])/.test(s) && /(召开|举行|举办|开始|开展)/.test(s) && !/(请|务必|准时|按时|参加|参会|出席|列席|不得缺席)/.test(s)) {
        isAction = false;
      }
      if (!isAction) return;

      var sentOwnerInfo = detectOwners(s);
      // 多日期长句：按逗号/分号拆成子任务（每个子任务独立判定）
      var sDates = extractDates(s, baseDate);
      var units = [s];
      var rawUnits = [s];
      if (sDates.length >= 2) {
        var pairs = s.split(/[，,；;、]/).map(function (p) {
          return { raw: p.trim(), clean: cleanTodoContent(p) };
        }).filter(function (pr) { return pr.clean.length >= 4; });
        var actionParts = pairs.filter(function (pr) {
          return new RegExp(ACTION_VERBS).test(pr.clean) || new RegExp(EN_ACTION_VERBS, 'i').test(pr.clean);
        });
        if (actionParts.length >= 2) {
          units = pairs.map(function (pr) { return pr.clean; });
          rawUnits = pairs.map(function (pr) { return pr.raw; });
        }
      }
      var prevInherit = null;
      units.forEach(function (u, ui) {
        if (u !== s && !(new RegExp(ACTION_VERBS).test(u) || new RegExp(EN_ACTION_VERBS, 'i').test(u))) return;
        var unitInfo = detectOwners(u);
        var connector = rawUnits[ui] && /^(并|并且|且|然后|随后|同时|再|以及|及)/.test(rawUnits[ui]);
        var inherit = null;
        if (unitInfo.owners.length === 0 && unitInfo.vague.length === 0) {
          // 承接连词（并/然后/同时）→ 继承上一子句；整句只有一个明确责任人 → 继承整句
          if (connector && prevInherit) inherit = prevInherit;
          else if (!connector && sentOwnerInfo.owners.length <= 1) inherit = sentOwnerInfo;
        }
        pushTodoUnit(u, s, idx, seen, todos, baseDate, inherit);
        // 记录本句（含继承）结果，供后续“并…”子句承接
        if (unitInfo.owners.length || unitInfo.vague.length) prevInherit = unitInfo;
        else if (inherit) prevInherit = inherit;
      });
    });
    // 优先级排序：高>中>低
    var order = { '高': 0, '中': 1, '低': 2 };
    return todos.sort(function (a, b) {
      return (order[a.priority] - order[b.priority]) || (a.deadline && b.deadline ? (a.deadline < b.deadline ? -1 : 1) : 0);
    });
  }

  function cleanTodoContent(unit) {
    return String(unit)
      .replace(/^[一二三四五六七八九十\d]+[、.．)）]\s*/, '')
      .replace(/^(请|请各位|请各部门|请大家|并|并且|且|然后|随后|同时|再|以及|及)\s*/, '')
      .replace(/^[：:，,、；; ]+/, '')
      .replace(/[。；;！!？?]+$/, '').trim();
  }

  function pushTodoUnit(unit, s, idx, seen, todos, baseDate, inherit) {
    var content = cleanTodoContent(unit);
    if (content.length < 4 || content.length > 160) return;
    if (seen[content]) return;
    seen[content] = 1;

    var dates = extractDates(unit, baseDate);
    var times = extractTimes(unit);
    var deadline = dates.length ? dates[dates.length - 1].iso : '';
    var deadlineRaw = dates.length ? dates[dates.length - 1].raw : '';
    var timePoint = times.length ? times[0].text : '';
    var hasDeadlineCue = /(截止|截至|最迟|最晚|到期|之前|以前|前完成|前提交|前上报|前反馈|前确认|前召开|前结束|前组织|前报送|前签署|deadline|DDL|by\s+\d{4})/i.test(unit);

    var ownerInfo = detectOwners(unit);
    var owners = ownerInfo.owners.slice();
    var vague = ownerInfo.vague.slice();
    // 仅按“承接连词 / 整句唯一责任人”规则继承
    if (!owners.length && inherit) inherit.owners.forEach(function (o) { if (owners.indexOf(o) < 0) owners.push(o); });
    if (!vague.length && inherit) inherit.vague.forEach(function (o) { if (vague.indexOf(o) < 0) vague.push(o); });

    var todo = {
      id: 'todo_' + idx + '_' + Math.random().toString(36).slice(2, 7),
      content: content,
      owners: owners,
      owner: owners[0] || '',
      vagueOwners: vague,
      priority: detectPriority(unit),
      deadline: deadline,
      deadlineRaw: deadlineRaw,
      timePoint: timePoint,
      hasDeadlineCue: hasDeadlineCue,
      status: 'pending',
      source: s.slice(0, 120),
      sentenceIndex: idx
    };
    var conf = scoreConfidence(todo, unit);
    todo.confidence = conf.level;
    todo.confidenceReasons = conf.reasons;
    todos.push(todo);
  }

  /* ============================================================
   * 八、任务计划生成（含阶段划分、里程碑、工作日排期）
   * ========================================================== */

  var PHASE_RULES = [
    ['第一阶段 · 准备与梳理', /(准备|整理|梳理|制定|制订|调研|统计|摸排|盘点|收集|需求分析|方案|立项|报名|预约|登记)/],
    ['第二阶段 · 执行与推进', /(推进|开展|完成|对接|组织|召开|采购|开发|编码|实施|建设|测试|整改|优化|更新|排查|执行|处理|解决|培训|招聘|协调|部署|联调|上线|发布|施工|生产|发货)/],
    ['第三阶段 · 交付与验收', /(提交|交付|上报|报送|反馈|确认|审核|审批|验收|汇报|签署|盖章|付款|报销|归档|答复|评估|评审|检查|巡检)/],
    ['第四阶段 · 复盘与总结', /(复盘|总结|归档|结案|结项|表彰|回顾)/]
  ];

  function classifyPhase(content) {
    // 统计各阶段动作词命中次数，取得分最高的阶段；同分时优先更靠后的阶段
    // （如“完成修复并提交代码”“完成回归测试并反馈报告”更接近交付环节）
    var best = { name: '第二阶段 · 执行与推进', score: 0 };
    for (var i = 0; i < PHASE_RULES.length; i++) {
      var matches = content.match(new RegExp(PHASE_RULES[i][1].source, 'g'));
      var score = matches ? matches.length : 0;
      if (score >= best.score && score > 0) best = { name: PHASE_RULES[i][0], score: score };
    }
    return best.name;
  }

  // 责任人展示文本（多责任人 + 泛称合并）
  function ownerText(t) {
    var o = (t.owners && t.owners.length) ? t.owners.slice() : (t.owner ? [t.owner] : []);
    (t.vagueOwners || []).forEach(function (v) { if (o.indexOf(v) < 0) o.push(v); });
    return o.join('、');
  }

  function makePlan(todos, baseDate) {
    baseDate = baseDate || new Date();
    var cursor = nextWorkday(baseDate);
    var occupied = {};
    var items = todos.map(function (t) {
      return {
        content: t.content,
        owner: ownerText(t),
        owners: (t.owners || []).slice(),
        priority: t.priority,
        deadline: t.deadline || '',
        timePoint: t.timePoint || '',
        confidence: t.confidence || 'medium',
        phase: classifyPhase(t.content),
        date: '',
        weekday: '',
        pinned: false,
        overdue: false
      };
    });

    // 先固定带明确截止日期的任务
    items.filter(function (x) { return x.deadline; }).forEach(function (x) {
      x.date = x.deadline;
      x.weekday = (function () { var d = parseISO(x.deadline); return d ? weekdayOf(d) : ''; })();
      x.pinned = true;
      var dd = parseISO(x.deadline);
      if (dd && dd < nextWorkday(baseDate)) x.overdue = true;
      occupied[x.date] = true;
    });

    // 其余任务按优先级填入空闲工作日
    var order = { '高': 0, '中': 1, '低': 2 };
    items.filter(function (x) { return !x.date; })
      .sort(function (a, b) { return order[a.priority] - order[b.priority]; })
      .forEach(function (x) {
        while (occupied[toISODate(cursor)]) cursor = addDays(cursor, 1);
        cursor = nextWorkday(cursor);
        while (occupied[toISODate(cursor)]) cursor = addDays(cursor, 1);
        x.date = toISODate(cursor);
        x.weekday = weekdayOf(cursor);
        occupied[x.date] = true;
        cursor = addDays(cursor, 1);
      });

    // 按阶段分组
    var phaseMap = {};
    items.forEach(function (x) {
      if (!phaseMap[x.phase]) phaseMap[x.phase] = [];
      phaseMap[x.phase].push(x);
    });
    var phases = PHASE_RULES.map(function (r) { return r[0]; }).filter(function (name) { return phaseMap[name]; })
      .map(function (name) {
        phaseMap[name].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        return { name: name, items: phaseMap[name] };
      });

    var milestones = items.filter(function (x) { return x.pinned; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (x) { return { content: x.content, date: x.date, weekday: x.weekday, overdue: x.overdue }; });

    var dates = items.map(function (x) { return x.date; }).filter(Boolean).sort();
    return {
      generatedAt: toISODate(baseDate),
      phases: phases,
      milestones: milestones,
      items: items,
      startDate: dates.length ? dates[0] : '',
      endDate: dates.length ? dates[dates.length - 1] : '',
      totalTasks: items.length,
      workdaysUsed: Object.keys(occupied).length
    };
  }

  /* ============================================================
   * 九、一致性 / 遗漏 / 矛盾检查
   * ========================================================== */

  function jaccard(a, b) {
    var sa = new Set(a), sb = new Set(b);
    var inter = 0;
    sa.forEach(function (c) { if (sb.has(c)) inter++; });
    return inter / (sa.size + sb.size - inter);
  }

  function checkIssues(text, todos, baseDate) {
    baseDate = baseDate || new Date();
    var issues = [];
    var t = String(text || '');
    var sentences = splitSentences(t);

    // 1) 待办缺少责任人 / 截止时间
    (todos || []).forEach(function (td) {
      var concrete = td.owners || (td.owner ? [td.owner] : []);
      var vague = td.vagueOwners || [];
      if (!concrete.length) {
        issues.push({
          level: 'omission', severity: 'medium', type: '缺少责任人',
          message: (vague.length ? '责任人仅为泛称（' + vague.join('、') + '），需落实到人：「' : '待办事项未指明责任人：「') + td.content.slice(0, 30) + '」',
          evidence: td.source
        });
      }
      if (!td.deadline) {
        issues.push({ level: 'omission', severity: 'low', type: '缺少截止时间', message: '待办事项未给出明确截止时间：「' + td.content.slice(0, 30) + '」', evidence: td.source });
      } else if (td.deadline < toISODate(baseDate)) {
        issues.push({ level: 'contradiction', severity: 'high', type: '时间已过', message: '截止日期 ' + td.deadline + ' 已早于当前日期：「' + td.content.slice(0, 30) + '」', evidence: td.source });
      }
    });

    // 2) 金额冲突：同一关键词搭配不同金额
    var moneyGroups = {};
    var reMoneyCtx = /([一-龥A-Za-z]{2,10})(\d+(?:\.\d+)?)\s*(万亿元|亿元|万元|万|元|美元|欧元|港元|港币|人民币)/g;
    var mm;
    while ((mm = reMoneyCtx.exec(t))) {
      var key = mm[1].slice(-3).replace(/[为是约达了:：]+$/, '');
      var val = +mm[2];
      // 同主提取：万亿需先于亿判断
      if (/万亿元/.test(mm[3])) val *= 1000000000000;
      else if (/亿元/.test(mm[3])) val *= 100000000;
      else if (/万元|万$/.test(mm[3])) val *= 10000;
      (moneyGroups[key] = moneyGroups[key] || { values: [], raws: [] });
      if (moneyGroups[key].values.indexOf(val) < 0) {
        moneyGroups[key].values.push(val);
        moneyGroups[key].raws.push(mm[0]);
      }
    }
    Object.keys(moneyGroups).forEach(function (k) {
      var g = moneyGroups[k];
      if (g.values.length >= 2 && /(预算|金额|费用|报价|合同|成本|价格|总价|补贴|工资|薪酬|投资|拨款|收费)/.test(k)) {
        issues.push({
          level: 'contradiction', severity: 'high', type: '金额表述不一致',
          message: '「' + k + '」在材料中出现了不同金额：' + g.raws.join(' 与 '),
          evidence: g.raws.join(' / ')
        });
      }
    });

    // 2b) 报价/中标 与 合同/预算 金额口径不同（可能是正常分项，也可能是漏项，提示核对）
    var dealAmounts = [];
    var reDeal = /([一-龥A-Za-z]{0,8}(?:报价|合同金额|合同总价|合同款|预算(?:金额|总额|为)?|总价|造价|中标(?:金额|价)?|采购金额|采购费|费用|成本|价格)[^0-9]{0,6})(\d+(?:\.\d+)?)\s*(万亿元|亿元|万元|万|元|美元|欧元|港元|港币|人民币)/g;
    while ((mm = reDeal.exec(t))) {
      var dv = +mm[2];
      if (/万亿元/.test(mm[3])) dv *= 1000000000000;
      else if (/亿元/.test(mm[3])) dv *= 100000000;
      else if (/万元|万$/.test(mm[3])) dv *= 10000;
      dealAmounts.push({ label: mm[1].replace(/[为是约达了:：\s]+$/, ''), value: dv, raw: mm[0] });
    }
    var dealUniq = {};
    dealAmounts.forEach(function (d) { dealUniq[d.value] = d; });
    var dealVals = Object.keys(dealUniq);
    if (dealVals.length >= 2) {
      var labelJoin = dealAmounts.map(function (d) { return d.label; }).join('|');
      if (/(报价|中标)/.test(labelJoin) && /(合同|预算|总价|造价|采购)/.test(labelJoin)) {
        issues.push({
          level: 'suggestion', severity: 'medium', type: '金额口径需核对',
          message: '报价/中标金额与合同/预算金额数值不同，请核对是否为漏项或口径差异：' + dealVals.map(function (v) { return dealUniq[v].raw; }).join(' 与 '),
          evidence: dealAmounts.map(function (d) { return d.raw; }).join(' / ')
        });
      }
    }

    // 3) 同一指标不同百分比
    var pctGroups = {};
    var rePctCtx = /([一-龥]{2,10})(\d+(?:\.\d+)?)\s*(?:%|％)/g;
    while ((mm = rePctCtx.exec(t))) {
      var pk = mm[1].slice(-3).replace(/[为是约达了:：]+$/, '');
      if (/(率|比例|占比|比重|增长|下降|完成度|进度|满意度|合格率|覆盖率)/.test(pk)) {
        (pctGroups[pk] = pctGroups[pk] || { values: [], raws: [] });
        if (pctGroups[pk].values.indexOf(+mm[2]) < 0) {
          pctGroups[pk].values.push(+mm[2]);
          pctGroups[pk].raws.push(mm[0]);
        }
      }
    }
    Object.keys(pctGroups).forEach(function (k) {
      var g = pctGroups[k];
      if (g.values.length >= 2) {
        issues.push({
          level: 'contradiction', severity: 'medium', type: '数据表述不一致',
          message: '指标「' + k + '」存在多个数值：' + g.raws.join(' 与 '),
          evidence: g.raws.join(' / ')
        });
      }
    });

    // 4) 状态矛盾：同句既说完成又说未完成/延期
    sentences.forEach(function (s) {
      if (/(已完成|已上线|已交付|已验收|已结案)/.test(s) && /(未完成|未上线|未交付|延期|停滞|未通过)/.test(s)) {
        issues.push({ level: 'contradiction', severity: 'high', type: '状态表述矛盾', message: '同一句话中同时出现“已完成”与“未完成/延期”等矛盾表述。', evidence: s.slice(0, 80) });
      }
    });

    // 5) 时间变更提醒（原定/现改为）
    sentences.forEach(function (s) {
      var ds = extractDates(s, baseDate);
      if (/(原定|原本|原计划|现改|改为|延期|推迟|调整至)/.test(s) && ds.length >= 2) {
        issues.push({ level: 'suggestion', severity: 'medium', type: '时间有变更', message: '检测到时间调整表述，涉及 ' + ds.length + ' 个日期，请确认以哪个为准：' + ds.map(function (d) { return d.iso; }).join('、'), evidence: s.slice(0, 80) });
      }
    });

    // 6) 重复句子
    for (var i = 0; i < sentences.length; i++) {
      for (var j = i + 1; j < sentences.length; j++) {
        var a = sentences[i], b = sentences[j];
        if (a.length >= 10 && Math.abs(a.length - b.length) <= 6 && jaccard(a, b) > 0.85) {
          issues.push({ level: 'duplicate', severity: 'low', type: '内容重复', message: '发现两处高度重复的表述。', evidence: a.slice(0, 40) + ' ／ ' + b.slice(0, 40) });
        }
      }
    }

    // 7) 会议类文档完整性
    if (/会议|召开|参会|出席/.test(t)) {
      var ent = extractEntities(t, baseDate);
      if (!ent.dates.length) issues.push({ level: 'omission', severity: 'medium', type: '会议信息缺失', message: '检测到会议内容，但未找到会议日期。', evidence: '' });
      if (!ent.times.length && !/时间待定|另行通知/.test(t)) issues.push({ level: 'omission', severity: 'medium', type: '会议信息缺失', message: '检测到会议内容，但未找到具体开始时间。', evidence: '' });
      if (!ent.venues.length && !/地点待定|线上|腾讯会议|钉钉|飞书|Zoom|zoom|会议链接/.test(t)) issues.push({ level: 'omission', severity: 'low', type: '会议信息缺失', message: '检测到会议内容，但未找到会议地点或线上会议链接。', evidence: '' });
      if (!/(参会|参加|出席|与会)/.test(t)) issues.push({ level: 'omission', severity: 'low', type: '会议信息缺失', message: '未检测到参会人员范围。', evidence: '' });
    }

    // 8) 联系方式与基础检查
    if (t.length > 0 && t.replace(/\s/g, '').length < 30) {
      issues.push({ level: 'suggestion', severity: 'medium', type: '材料过短', message: '材料正文不足 30 字，分析结果可能不完整。', evidence: '' });
    }

    // 去重并按严重程度排序
    var sevRank = { high: 0, medium: 1, low: 2 };
    var seen = {};
    issues = issues.filter(function (x) {
      var k = x.type + x.message;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).sort(function (a, b) { return sevRank[a.severity] - sevRank[b.severity]; });

    var summary = {
      contradictionCount: issues.filter(function (x) { return x.level === 'contradiction'; }).length,
      omissionCount: issues.filter(function (x) { return x.level === 'omission'; }).length,
      duplicateCount: issues.filter(function (x) { return x.level === 'duplicate'; }).length,
      suggestionCount: issues.filter(function (x) { return x.level === 'suggestion'; }).length,
      passed: issues.filter(function (x) { return x.severity === 'high'; }).length === 0
    };
    return { issues: issues, summary: summary };
  }

  /* ============================================================
   * 十、工作报告生成（Markdown）
   * ========================================================== */

  function generateReport(input) {
    var title = input.title || '智能办公分析报告';
    var now = new Date();
    var text = input.text || '';
    var analysis = input.analysis || analyzeText(text, input.baseDate);
    var entities = input.entities || extractEntities(text, input.baseDate);
    var todos = input.todos || generateTodos(text, input.baseDate);
    var plan = input.plan || makePlan(todos, input.baseDate);
    var check = input.check || checkIssues(text, todos, input.baseDate);

    var L = [];
    L.push('# ' + title);
    L.push('');
    L.push('> 生成时间：' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日　|　文档类型识别：' + analysis.category + '　|　整体倾向：' + analysis.tone.label);
    L.push('');
    L.push('## 一、材料概述');
    L.push('');
    L.push('- 全文字数（不含空白）：**' + analysis.stats.chars + '** 字');
    L.push('- 句子数量：**' + analysis.stats.sentenceCount + '** 句；段落数：**' + analysis.stats.paragraphCount + '** 段；平均句长：**' + analysis.stats.avgSentenceLength + '** 字');
    L.push('- 预计阅读时长：约 **' + analysis.stats.readingMinutes + '** 分钟');
    L.push('- 核心关键词：' + analysis.keywords.map(function (k) { return '`' + k.word + '`'; }).join('、'));
    L.push('');
    L.push('## 二、要点摘要');
    L.push('');
    analysis.summary.forEach(function (s, i) { L.push((i + 1) + '. ' + s); });
    L.push('');
    L.push('## 三、关键信息提取');
    L.push('');
    function row(label, arr, fmt) {
      if (arr && arr.length) L.push('- **' + label + '**：' + arr.map(fmt || function (x) { return typeof x === 'string' ? x : x.raw; }).join('、'));
    }
    row('日期', entities.dates, function (x) { return x.iso + '（' + x.raw + '）'; });
    row('时间', entities.times, function (x) { return x.text; });
    row('联系人电话', entities.phones);
    row('邮箱', entities.emails);
    row('网址', entities.urls);
    row('金额', entities.money, function (x) { return x.raw; });
    row('百分比', entities.percents, function (x) { return x.raw; });
    row('组织机构', entities.organizations);
    row('人物', entities.persons);
    row('地点', entities.places.concat(entities.venues));
    if (entities.deadlines.length) {
      L.push('- **截止时间**：');
      entities.deadlines.forEach(function (d) {
        L.push('  - ' + d.iso + (d.time ? ' ' + d.time : '') + '（' + d.raw + '）');
      });
    }
    if (!entities.dates.length && !entities.phones.length && !entities.money.length && !entities.organizations.length) {
      L.push('- 材料中未识别到明显的实体信息（日期、电话、金额、机构等）。');
    }
    L.push('');

    L.push('## 四、待办事项清单（共 ' + todos.length + ' 项）');
    L.push('');
    if (todos.length) {
      L.push('| 序号 | 事项 | 责任人 | 优先级 | 截止时间 | 置信度 |');
      L.push('| --- | --- | --- | --- | --- | --- |');
      todos.forEach(function (td, i) {
        var ownerAll = ownerText(td) || '待明确';
        var confLabel = { high: '高', medium: '中（需核对）', low: '低（需核对）' }[td.confidence] || '中';
        L.push('| ' + (i + 1) + ' | ' + td.content + ' | ' + ownerAll + ' | ' + td.priority + ' | ' + (td.deadline || '待明确') + ' | ' + confLabel + ' |');
      });
    } else {
      L.push('未从材料中识别出明确的行动事项。');
    }
    L.push('');

    L.push('## 五、任务执行计划');
    L.push('');
    if (plan.totalTasks) {
      L.push('- 计划周期：**' + plan.startDate + '** 至 **' + plan.endDate + '**，共占用 **' + plan.workdaysUsed + '** 个工作日、**' + plan.totalTasks + '** 项任务。');
      L.push('');
      plan.phases.forEach(function (p) {
        L.push('### ' + p.name);
        L.push('');
        L.push('| 日期 | 星期 | 任务 | 责任人 | 优先级 |');
        L.push('| --- | --- | --- | --- | --- |');
        p.items.forEach(function (it) {
          L.push('| ' + it.date + ' | ' + it.weekday + ' | ' + it.content + ' | ' + (it.owner || '待明确') + ' | ' + it.priority + ' |');
        });
        L.push('');
      });
      if (plan.milestones.length) {
        L.push('### 关键里程碑');
        L.push('');
        plan.milestones.forEach(function (m2, i) {
          L.push('- ' + (m2.overdue ? '⚠️ ' : '') + '**' + m2.date + '（' + m2.weekday + '）**：' + m2.content + (m2.overdue ? '（该日期已过，需立即确认）' : ''));
        });
        L.push('');
      }
    } else {
      L.push('暂无待办任务，无法生成计划。');
      L.push('');
    }

    L.push('## 六、一致性与遗漏检查');
    L.push('');
    L.push('- 矛盾 / 风险：**' + check.summary.contradictionCount + '** 项；遗漏：**' + check.summary.omissionCount + '** 项；重复：**' + check.summary.duplicateCount + '** 项；建议：**' + check.summary.suggestionCount + '** 项。');
    L.push('- 总体结论：**' + (check.summary.passed ? '未发现高风险矛盾，材料基本可用' : '存在高风险问题，建议修正后再使用') + '**。');
    L.push('');
    if (check.issues.length) {
      check.issues.forEach(function (x, i) {
        var tag = { contradiction: '【矛盾】', omission: '【遗漏】', duplicate: '【重复】', suggestion: '【建议】' }[x.level];
        L.push((i + 1) + '. ' + tag + ' ' + x.message + (x.evidence ? '　依据：' + x.evidence : ''));
      });
    } else {
      L.push('未发现明显问题。');
    }
    L.push('');

    L.push('## 七、结论与下一步建议');
    L.push('');
    L.push('1. 请优先处理优先级为「高」且带明确截止日期的事项。');
    L.push('2. 对标记为「待明确」的责任人与截止时间，请尽快补充确认。');
    L.push('3. 依据任务计划分阶段推进，并在每个里程碑节点进行检查。');
    if (check.summary.contradictionCount) L.push('4. 先解决材料中的矛盾与数据冲突，再据此安排执行。');
    L.push('');
    L.push('---');
    L.push('*本报告由「智办通 AI 智能办公助手」本地分析引擎生成，无需联网、无需 API 密钥。*');
    return L.join('\n');
  }

  /* ============================================================
   * 十一、一键流水线
   * ========================================================== */

  function processAll(text, options) {
    options = options || {};
    var base = options.baseDate || new Date();
    var title = options.title || '';
    var analysis = analyzeText(text, base);
    var entities = extractEntities(text, base);
    var todos = generateTodos(text, base);
    var plan = makePlan(todos, base);
    var check = checkIssues(text, todos, base);
    if (!title) {
      var firstLine = String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
      title = (firstLine.length <= 24 ? firstLine : firstLine.slice(0, 24)) || analysis.category + '分析报告';
    }
    var report = generateReport({ title: title, text: text, analysis: analysis, entities: entities, todos: todos, plan: plan, check: check, baseDate: base });
    return {
      version: VERSION,
      title: title,
      createdAt: new Date().toISOString(),
      text: text,
      analysis: analysis,
      entities: entities,
      todos: todos,
      plan: plan,
      check: check,
      report: report
    };
  }

  return {
    VERSION: VERSION,
    // 工具
    toISODate: toISODate,
    parseISO: parseISO,
    addDays: addDays,
    weekdayOf: weekdayOf,
    nextWorkday: nextWorkday,
    splitSentences: splitSentences,
    // 分析能力
    textStats: textStats,
    extractDates: extractDates,
    extractTimes: extractTimes,
    extractEntities: extractEntities,
    extractKeywords: extractKeywords,
    summarize: summarize,
    classify: classify,
    sentiment: sentiment,
    analyzeText: analyzeText,
    // 办公能力
    generateTodos: generateTodos,
    makePlan: makePlan,
    checkIssues: checkIssues,
    generateReport: generateReport,
    processAll: processAll,
    // v2 新增
    detectOwners: detectOwners,
    detectOwner: detectOwner,
    findNamesInSegment: findNamesInSegment,
    scoreConfidence: scoreConfidence,
    ownerText: ownerText
  };
});
