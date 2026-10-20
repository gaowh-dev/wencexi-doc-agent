/*!
 * 文策析 DOCX 解析与「Word 上传→任务拆解」链路测试
 * 运行：npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseDocx, xmlToText } = require(path.join(__dirname, '..', 'src', 'core', 'docx-parse.js'));
const E = require(path.join(__dirname, '..', 'src', 'core', 'engine.js'));

const FIXTURE = path.join(__dirname, 'fixtures', 'sample.docx');

test('DOCX：从真实 .docx 夹具提取正文（段落/换行/无 XML 标签）', () => {
  const text = parseDocx(fs.readFileSync(FIXTURE));
  assert.ok(text.includes('文策析项目周例会会议纪要'));
  assert.ok(text.includes('张伟请在本周四前完成前端兼容性修复'));
  assert.ok(text.includes('李娟负责本周内完成回归测试'));
  assert.ok(text.includes('下周三前的上线评审会议由王磊负责'));
  assert.ok(!/<w:|<?xml/.test(text), '正文中不应残留 XML 标签');
  assert.ok(text.split('\n').length >= 7, '应还原出至少 7 个段落');
});

test('DOCX：提取文本可直接进入引擎，识别出责任人与任务', () => {
  const text = parseDocx(fs.readFileSync(FIXTURE));
  const r = E.processAll(text, { title: '会议纪要', baseDate: new Date(2026, 9, 20) });
  const owners = r.todos.map((t) => (t.owners || []).join('')).join('|');
  assert.ok(owners.includes('张伟'), '应识别责任人张伟，实际：' + owners);
  assert.ok(owners.includes('李娟'), '应识别责任人李娟，实际：' + owners);
  assert.ok(owners.includes('王磊'), '应识别责任人王磊，实际：' + owners);
  assert.ok(r.todos.length >= 3, 'Word 文档应拆出至少 3 条任务，实际 ' + r.todos.length);
});

test('DOCX：非 zip/非 docx 字节抛出明确错误', () => {
  assert.throws(() => parseDocx(Buffer.from('这只是一个普通文本文件，不是Word文档', 'utf8')), /Word|ZIP|docx/i);
  assert.throws(() => parseDocx(Buffer.from([0x50, 0x4b, 0x03, 0x04])), /Word|ZIP|docx/i);
});

test('DOCX：xmlToText 处理制表、换行与实体', () => {
  const xml = '<w:p><w:r><w:t>任务一</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">张伟 &amp; 李娟</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>第二段</w:t></w:r></w:p>';
  const t = xmlToText(xml);
  assert.ok(t.includes('任务一\t张伟 & 李娟'));
  assert.ok(t.includes('第二段'));
});
