/*!
 * 文策析 AI 智能办公助手 —— MobileClaw 平台适配层（预留接口，未接入）
 *
 * 诚实声明：
 * 本项目当前未内置任何手机控制能力，也未实现 MobileClaw 平台调用。
 * 原因：缺少官方 SDK / 能力文档，无法确认授权方式与可调用动作；
 * 为避免把“模拟执行”伪装成“真实执行”，此适配层仅定义接口契约并显式返回未连接。
 *
 * 接入方式（待官方文档确认后实现）：
 *   1. MobileClaw.connect({ token / device }) 完成授权；
 *   2. 实现 calendar.create（在手机日历建事件）、message.send（向指定人发任务消息）、
 *      reminder.create（建手机提醒）三个动作；
 *   3. 在 agent.js 的工具注册表中增加 mobileclaw_* 工具，复用现有 plan→确认→执行→校验 流程；
 *   4. 所有动作必须保留用户逐条确认与执行日志，禁止未经确认直接操作手机。
 *
 * 当前演示路径：由本项目工具层生成 .ics / CSV / 派任务消息，这些产物可在手机端
 * 直接导入或粘贴，是平台通道接通前的真实可执行替代方案。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MobileClawAdapter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOT_CONNECTED = 'MOBILECLAW_NOT_CONNECTED';

  var MobileClawAdapter = {
    id: 'mobileclaw',
    name: 'MobileClaw 手机执行通道',
    connected: false,
    // 计划接入的动作清单（尚未实现，禁止在 UI 中显示为已具备）
    plannedCapabilities: [
      { id: 'calendar.create', desc: '在手机日历创建任务事件（含提醒）' },
      { id: 'message.send', desc: '经用户确认后向指定责任人发送任务消息' },
      { id: 'reminder.create', desc: '在手机上创建到期提醒' }
    ],
    connect: function () {
      return {
        connected: false,
        code: NOT_CONNECTED,
        reason: '尚未接入 MobileClaw 官方 SDK：请在赛题/官方文档中确认授权方式、设备接口与可用动作后，按 src/core/adapters/mobileclaw.js 顶部说明接入。'
      };
    },
    status: function () {
      return {
        connected: false,
        code: NOT_CONNECTED,
        currentFallback: '本地工具已可真实产出：日历 .ics（手机可导入）、待办 CSV（飞书/钉钉可导入）、派任务消息（复制后人工发送）'
      };
    },
    execute: function () {
      var err = new Error('MobileClaw 通道未连接，未执行任何手机操作（不模拟、不伪造）');
      err.code = NOT_CONNECTED;
      throw err;
    }
  };

  return MobileClawAdapter;
});
