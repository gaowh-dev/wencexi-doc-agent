/*!
 * 文策析 · 零依赖 DOCX 解析器（Node.js 环境）
 *
 * 仅使用 Node 内置 zlib：DOCX 本质是 ZIP 包，正文在 word/document.xml。
 * 本模块实现一个最小 ZIP 读取器（支持 stored / deflate 两种压缩方式），
 * 提取 document.xml 并按段落/制表/换行还原为纯文本，供「上传办公文档」使用。
 *
 * 浏览器静态模式（file://）下无 Node 环境，不使用本模块；前端会提示用服务模式打开。
 */
'use strict';

const zlib = require('zlib');

const SIG_EOCD = 0x06054b50;   // End of central directory
const SIG_CD = 0x02014b50;     // Central directory file header
const SIG_LFH = 0x04034b50;    // Local file header
const MAX_TEXT = 5 * 1024 * 1024; // 解压后正文上限 5MB，防止异常文件拖垮页面

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
}

/**
 * 把 word/document.xml 还原为纯文本：
 * - <w:t> 文本节点
 * - <w:tab/> 制表符，<w:br/> 换行
 * - </w:p> 段落结束换行
 */
function xmlToText(xml) {
  const out = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) {
      out.push(decodeXmlEntities(m[1]));
    } else if (m[0] === '<w:tab/>') {
      out.push('\t');
    } else {
      out.push('\n'); // <w:br/> 或段落结束
    }
  }
  let text = out.join('');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * 解析 DOCX（Buffer）→ 正文文本
 * @param {Buffer} buf docx 文件字节
 * @returns {string} 纯文本
 * @throws {Error} 不是合法 docx / 缺少正文 / 正文过大时抛出明确错误
 */
function parseDocx(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('文件内容不是有效字节流');
  if (buf.length < 22) throw new Error('文件过小，不是有效的 Word（.docx）文档');

  // 1. 定位 EOCD（从尾部查找，允许其后面带注释）
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 Word（.docx）文档（缺少 ZIP 结构）；.doc 旧格式请先另存为 .docx');

  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // 2. 遍历中央目录，找 word/document.xml
  let documentXmlBuf = null;
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== SIG_CD) throw new Error('ZIP 目录结构损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if (name === 'word/document.xml') {
      // 3. 读本地文件头（额外字段长度可能与目录里不一致，以本地头为准）
      if (buf.readUInt32LE(localOffset) !== SIG_LFH) throw new Error('ZIP 本地文件头损坏');
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) {
        documentXmlBuf = raw;
      } else if (method === 8) {
        documentXmlBuf = zlib.inflateRawSync(raw);
      } else {
        throw new Error('不支持的 ZIP 压缩方式（' + method + '）');
      }
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!documentXmlBuf) throw new Error('该 Word 文档中未找到正文（word/document.xml），可能是空白文档或非 .docx 文件');

  const xml = documentXmlBuf.toString('utf8');
  const text = xmlToText(xml);
  if (text.length > MAX_TEXT) throw new Error('文档正文超过 5MB 上限，请拆分后再上传');
  if (!text.length) throw new Error('未从 Word 文档中提取到任何文字，请确认文档包含文本内容');
  return text;
}

module.exports = { parseDocx, xmlToText };
