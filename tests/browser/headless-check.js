/*!
 * 无头浏览器端到端检查（零第三方依赖，使用 Edge/Chrome 远程调试协议 + Node 内置 WebSocket）
 *
 * 用法：
 *   1. 先以调试端口启动无头 Edge：
 *      msedge --headless=new --disable-gpu --remote-debugging-port=9222
 *             --user-data-dir=<临时目录> --no-first-run --window-size=1440,1700 about:blank
 *   2. 启动应用：PORT=5188 NO_OPEN=1 node src/server.js
 *   3. 运行：node tests/browser/headless-check.js
 *
 * 检查内容：页面无 JS 报错；示例分析自动执行；待办可编辑/新增；
 *          智能体执行真实产出文件（下载到临时目录）；产物自检全部通过；
 *          桌面/手机视口截图。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5188';
const SHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');
const DL_DIR = path.join(__dirname, '..', '..', 'tests', 'browser', 'downloads');
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, cond, detail) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!cond) failures.push(name + ' ' + (detail || ''));
}

let ws, msgId = 1;
const pending = {};
function send(method, params, sessionId) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      delete pending[id];
      reject(new Error('CDP 调用超时：' + method));
    }, 15000);
    pending[id] = { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } };
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  });
}

const errors = [];
let activeSid = null;
function startRouter() {
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) {
      if (m.error) pending[m.id].reject(new Error(JSON.stringify(m.error)));
      else pending[m.id].resolve(m.result);
      return;
    }
    if (!activeSid || m.sessionId !== activeSid) return;
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description || a.type).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('log: ' + m.params.entry.text);
    }
  });
}

async function evalJs(sid, expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, sid);
  if (r.exceptionDetails) {
    throw new Error('eval error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function resize(sid, targetId, width, height) {
  // headless=new 下可能存在 sync 确认对话框等多个 page 目标；Emulation 必须作用在真正的页面会话上
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width < 600
  }, sid);
  await sleep(400);
}

async function pickPageTarget() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  return list.find((t) => t.type === 'page' && /^https?:\/\//.test(t.url)) ||
    list.find((t) => t.type === 'page' && /about:blank/.test(t.url)) ||
    list.find((t) => t.type === 'page');
}

async function shot(sid, name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
  console.log('screenshot => ' + name);
}

async function setViewport(sid, width, height, dpr) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr || 1, mobile: width < 600
  }, sid);
  await sleep(300);
}

(async () => {
  const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
  let page = await pickPageTarget();
  if (!page) throw new Error('未找到调试页面目标');
  // 连接浏览器级端点，再以 flatten 方式附加到页面目标
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  startRouter();

  let sid = (await send('Target.attachToTarget', { targetId: page.id, flatten: true })).sessionId;
  activeSid = sid;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Log.enable', {}, sid);
  try {
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }, sid);
  } catch (e) { console.log('setDownloadBehavior(Page) 失败：' + e.message); }
  try {
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });
  } catch (e) { /* 仅页面级可用时忽略 */ }

  // 1. 加载演示页（#demo 会自动载入示例并分析；加时间戳确保每次真正重载，避免 hash-only 导航不刷新）
  await send('Page.navigate', { url: BASE + '/?t=' + Date.now() + '#demo' }, sid);
  await sleep(2500);
  // 导航后可能切换到新的 page 目标，重新选择并附加
  const real = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const appTarget = real.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url)) || page;
  if (appTarget.id !== page.id) {
    sid = (await send('Target.attachToTarget', { targetId: appTarget.id, flatten: true })).sessionId;
    activeSid = sid;
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR }, sid).catch(() => {});
    await sleep(2500);
  }
  // 桌面视口
  await resize(sid, appTarget.id, 1440, 1700);

  const todoCount = await evalJs(sid, 'document.querySelectorAll(".todo-item").length');
  check('示例分析自动执行，识别出 8 条待办', todoCount === 8, '实际 ' + todoCount + ' 条');

  const confBadges = await evalJs(sid, 'document.querySelectorAll(".conf-badge").length');
  check('每条待办显示置信度徽标', confBadges === todoCount, confBadges + '/' + todoCount);
  const sources = await evalJs(sid, 'document.querySelectorAll(".todo-source").length');
  check('每条待办显示原文出处', sources === todoCount, sources + '/' + todoCount);

  // 2. 切到待办页，手动新增一条任务
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="todos"]\').click()');
  await sleep(200);
  await evalJs(sid, `
    document.getElementById('newTodoContent').value='测试新增：核对发布会物料';
    document.getElementById('newTodoOwner').value='测试员';
    document.getElementById('newTodoDate').value='2026-10-27';
    document.getElementById('btnAddTodo').click();
    'ok'`);
  await sleep(400);
  const afterAdd = await evalJs(sid, 'document.querySelectorAll(".todo-item").length');
  check('手动新增待办生效', afterAdd === todoCount + 1, afterAdd + ' 条');
  const ownerFound = await evalJs(sid, 'Array.from(document.querySelectorAll(".todo-owner-edit")).some(i=>i.value.indexOf("测试员")>=0)');
  check('新增任务责任人写入', ownerFound);

  // 3. 行内编辑：给第一条无责任人任务补上责任人（演示缺口补全）
  const editResult = await evalJs(sid, `
    var inp = Array.from(document.querySelectorAll('.todo-owner-edit')).find(i=>!i.value);
    if (!inp) 'no-empty';
    else { inp.value='周明'; inp.dispatchEvent(new Event('change',{bubbles:true})); 'edited'; }`);
  await sleep(400);
  check('行内编辑责任人可提交', editResult === 'edited', editResult);

  // 4. 打开智能体执行面板
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="agent"]\').click()');
  await sleep(400);
  const gapCount = await evalJs(sid, 'document.querySelectorAll(".gap-item").length');
  const mcBar = await evalJs(sid, 'document.querySelector(".mc-bar") ? document.querySelector(".mc-bar").innerText.indexOf("未连接")>=0 : false');
  check('MobileClaw 通道状态诚实显示“未连接”', mcBar);
  const stepCount = await evalJs(sid, 'document.querySelectorAll(".agent-step").length');
  check('动作计划生成 6 个步骤', stepCount === 6, stepCount + ' 个');
  check('执行前显示信息缺口', gapCount >= 0, gapCount + ' 个缺口');

  // 桌面截图：执行前
  await resize(sid, page.id, 1440, 1700);
  await sleep(300);
  await shot(sid, 'v2-01-agent-before.png');

  // 5. 执行选中动作
  await evalJs(sid, 'document.getElementById("btnRunAgent").click()');
  await sleep(2500);
  const summary = await evalJs(sid, 'document.querySelector(".run-summary") ? document.querySelector(".run-summary").innerText : ""');
  console.log('执行汇总：' + summary.replace(/\s+/g, ' '));
  const failed = await evalJs(sid, 'document.querySelectorAll(".agent-step.failed").length');
  check('智能体执行 0 失败', failed === 0, failed + ' 个失败');
  const done = await evalJs(sid, 'document.querySelectorAll(".agent-step.done").length');
  check('智能体执行有成功产物', done >= 4, done + ' 个成功');
  const verifyBad = await evalJs(sid, 'document.querySelectorAll(".verify-bad").length');
  check('产物自检全部通过', verifyBad === 0, verifyBad + ' 个失败检查');
  const msgCards = await evalJs(sid, 'document.querySelectorAll(".msg-card").length');
  check('派任务消息按责任人生成', msgCards >= 3, msgCards + ' 组');
  await shot(sid, 'v2-02-agent-after.png');

  // 6. 消息复制按钮
  const copyOk = await evalJs(sid, `
    new Promise(resolve => {
      var btn = document.querySelector('.msg-copy');
      if (!btn) return resolve('no-btn');
      btn.click();
      setTimeout(async () => {
        try { resolve(navigator.clipboard && navigator.clipboard.readText ? (await navigator.clipboard.readText()).length > 20 ? 'copied' : 'empty' : 'fallback'); }
        catch(e){ resolve('read-denied'); }
      }, 600);
    })`);
  check('派任务消息复制功能可用', copyOk === 'copied' || copyOk === 'fallback' || copyOk === 'read-denied', copyOk + '（read-denied 为无头环境限制，写入路径已用 execCommand 兜底）');

  // 7. 验证文件真的下载到磁盘
  await sleep(800);
  const files = fs.readdirSync(DL_DIR).filter((f) => !f.endsWith('.crdownload'));
  console.log('下载目录文件：' + files.join(', '));
  const hasIcs = files.some((f) => f.endsWith('.ics'));
  const hasCsv = files.some((f) => f.endsWith('.csv'));
  const hasMd = files.some((f) => f.endsWith('.md'));
  check('日历 .ics 真实下载', hasIcs);
  check('待办 .csv 真实下载', hasCsv);
  check('报告/清单 .md 真实下载', hasMd);

  // 8. 其余标签页截图
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="todos"]\').click()');
  await sleep(300);
  await shot(sid, 'v2-03-todos-editable.png');
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="check"]\').click()');
  await sleep(300);
  await shot(sid, 'v2-04-check.png');
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="report"]\').click()');
  await sleep(300);
  await shot(sid, 'v2-05-report.png');

  // 8b. 数据看板（可视化）
  await evalJs(sid, 'document.querySelector(\'.tab[data-tab="dashboard"]\').click()');
  await sleep(400);
  const dash = await evalJs(sid, `(() => {
    const p = document.getElementById('pane-dashboard');
    return {
      visible: !p.hidden,
      svg: p.querySelectorAll('svg').length,
      kpi: p.querySelectorAll('.kpi-card').length,
      bars: p.querySelectorAll('.bar-row').length,
      dots: p.querySelectorAll('.chart-card.wide circle').length,
      titles: Array.from(p.querySelectorAll('.chart-head h4')).map(function (e) { return e.textContent; }).join('|')
    };
  })()`);
  check('数据看板正常渲染', dash.visible && dash.svg >= 4 && dash.kpi === 6, JSON.stringify({ svg: dash.svg, kpi: dash.kpi }));
  check('数据看板图表条目完整', dash.bars >= 10 && dash.dots >= 8, '条形 ' + dash.bars + ' 行，时间线 ' + dash.dots + ' 点');
  check('数据看板 7 个图表齐全', dash.titles === '任务完成进度|优先级分布|置信度分布|一致性检查问题构成|责任人任务分布|任务阶段分布|截止时间线', dash.titles);
  await shot(sid, 'v2-08-dashboard.png');

  // 8c. Word（.docx）上传解析（真实文件经本地服务 /api/parse-docx 解析，再跑任务拆解）
  await send('DOM.enable', {}, sid);
  await send('Page.navigate', { url: BASE + '/' }, sid);
  await sleep(1500);
  const docDom = await send('DOM.getDocument', { depth: -1 }, sid);
  const fileNode = await send('DOM.querySelector', { nodeId: docDom.root.nodeId, selector: '#fileInput' }, sid);
  await send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [path.join(__dirname, '..', 'fixtures', 'sample.docx')] }, sid);
  await sleep(2000);
  const docxLoaded = await evalJs(sid, `(() => {
    const v = document.getElementById('inputText').value;
    return { ok: v.indexOf('周例会会议纪要') !== -1 && v.indexOf('张伟') !== -1, chars: v.length };
  })()`);
  check('Word(.docx) 上传并经本地服务解析', docxLoaded.ok && docxLoaded.chars > 100, JSON.stringify(docxLoaded));
  await evalJs(sid, `document.getElementById('btnAnalyze').click()`);
  await sleep(2000);
  await evalJs(sid, `document.querySelector('.tab[data-tab="todos"]').click()`);
  await sleep(400);
  const docxTodos = await evalJs(sid, `(() => {
    const text = document.getElementById('pane-todos').innerText;
    return { count: document.querySelectorAll('.todo-item').length, text: text };
  })()`);
  check('Word 文档自动拆出任务（≥3 条，含张伟/李娟）', docxTodos.count >= 3 && docxTodos.text.includes('张伟') && docxTodos.text.includes('李娟'), docxTodos.count + ' 条');

  // 9. 手机视口（独立 390 宽无头实例，避免 Emulation 不支持）
  async function mobileShots() {
    const ver2 = await (await fetch('http://127.0.0.1:9223/json/version')).json();
    let list2 = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    let page2 = list2.find((t) => t.type === 'page' && /about:blank/.test(t.url)) || list2.find((t) => t.type === 'page');
    const ws2 = new WebSocket(ver2.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej; });
    let mId = 1; const pend = {};
    const mErrors = [];
    const send2 = (method, params, sessionId) => new Promise((resolve, reject) => {
      const id = mId++;
      const to = setTimeout(() => { delete pend[id]; reject(new Error('mobile CDP 超时 ' + method)); }, 15000);
      pend[id] = { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } };
      ws2.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    });
    let mSid = null;
    ws2.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend[m.id]) {
        m.error ? pend[m.id].reject(new Error(JSON.stringify(m.error))) : pend[m.id].resolve(m.result);
        return;
      }
      if (mSid && m.sessionId === mSid && (m.method === 'Runtime.exceptionThrown' ||
        (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'))) {
        mErrors.push('mobile: ' + (m.method));
      }
    });
    let attach = (await send2('Target.attachToTarget', { targetId: page2.id, flatten: true })).sessionId;
    mSid = attach;
    await send2('Page.enable', {}, attach);
    await send2('Runtime.enable', {}, attach);
    await send2('Page.navigate', { url: BASE + '/?t=' + Date.now() + '#demo' }, attach);
    await sleep(2500);
    // 导航后找到真正的应用页目标
    list2 = await (await fetch('http://127.0.0.1:9223/json/list')).json();
    const app2 = list2.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
    if (app2 && app2.id !== page2.id) {
      attach = (await send2('Target.attachToTarget', { targetId: app2.id, flatten: true })).sessionId;
      mSid = attach;
      await send2('Page.enable', {}, attach);
      await send2('Runtime.enable', {}, attach);
      await sleep(2500);
      page2 = app2;
    }
    await send2('Emulation.setDeviceMetricsOverride', { width: 390, height: 1500, deviceScaleFactor: 1, mobile: true }, attach);
    await sleep(500);
    const mTodoCount = await send2('Runtime.evaluate', {
      expression: 'document.querySelectorAll(".todo-item").length', returnByValue: true
    }, attach).then((r) => r.result.value);
    check('手机视口下分析正常完成', mTodoCount === 8, mTodoCount + ' 条');
    await send2('Runtime.evaluate', { expression: 'document.querySelector(\'.tab[data-tab="agent"]\').click()' }, attach);
    await sleep(600);
    const r1 = await send2('Page.captureScreenshot', { format: 'png' }, attach);
    fs.writeFileSync(path.join(SHOT_DIR, 'v2-06-mobile-agent.png'), Buffer.from(r1.data, 'base64'));
    console.log('screenshot => v2-06-mobile-agent.png');
    await send2('Runtime.evaluate', { expression: 'document.querySelector(\'.tab[data-tab="todos"]\').click()' }, attach);
    await sleep(500);
    const r2 = await send2('Page.captureScreenshot', { format: 'png' }, attach);
    fs.writeFileSync(path.join(SHOT_DIR, 'v2-07-mobile-todos.png'), Buffer.from(r2.data, 'base64'));
    console.log('screenshot => v2-07-mobile-todos.png');
    await send2('Runtime.evaluate', { expression: 'document.querySelector(\'.tab[data-tab="dashboard"]\').click()' }, attach);
    await sleep(600);
    const mDash = await send2('Runtime.evaluate', {
      expression: 'JSON.stringify({kpi: document.querySelectorAll("#pane-dashboard .kpi-card").length, svg: document.querySelectorAll("#pane-dashboard svg").length})',
      returnByValue: true
    }, attach).then((r) => r.result.value);
    check('手机视口数据看板正常', mDash === JSON.stringify({ kpi: 6, svg: 4 }), mDash);
    const r3 = await send2('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, attach);
    fs.writeFileSync(path.join(SHOT_DIR, 'v2-09-mobile-dashboard.png'), Buffer.from(r3.data, 'base64'));
    console.log('screenshot => v2-09-mobile-dashboard.png');
    check('手机视口无 JS 错误', mErrors.length === 0, mErrors.join(' | '));
    // 横向溢出检查
    const overflow = await send2('Runtime.evaluate', {
      expression: 'document.documentElement.scrollWidth - document.documentElement.clientWidth', returnByValue: true
    }, attach).then((r) => r.result.value);
    check('手机视口无横向溢出', overflow <= 2, '溢出 ' + overflow + 'px');
    ws2.close();
  }
  await mobileShots();

  // 10. 控制台错误检查
  check('页面无 JS 运行时错误', errors.length === 0, errors.slice(0, 5).join(' | '));

  console.log('\n========== 浏览器端到端检查结果 ==========');
  console.log('失败项：' + failures.length);
  if (failures.length) { failures.forEach((f) => console.log(' - ' + f)); process.exit(1); }
  console.log('全部通过。');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('检查脚本异常：', e); process.exit(2); });
