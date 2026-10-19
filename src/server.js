/*!
 * 智办通 AI 智能办公助手 —— 零依赖静态服务器
 * 使用 Node.js 内置模块，无需 npm install 即可运行。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
// 默认只监听本机回环地址，避免局域网其他设备访问你的材料；如确需局域网访问，设置 HOST=0.0.0.0
const HOST = process.env.HOST || '127.0.0.1';

// 安全响应头（本地办公材料场景：默认禁止外部脚本、对象嵌入与跨域框架）
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function safeResolve(urlPath) {
  // /src 开头映射到项目根下的 src，其余一律映射到 public 目录
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch (e) {
    // 畸形百分号编码（如 /%E0%A4%A）会抛 URIError：返回 false 由调用方安全拒绝（400），不能让进程退出
    if (e instanceof URIError) return false;
    throw e;
  }
  const clean = path.normalize(decoded.replace(/^(\.\.[/\\])+/, ''));
  let target;
  if (clean.startsWith(path.sep + 'src' + path.sep) || clean === path.sep + 'src') {
    target = path.join(ROOT, clean);
  } else {
    target = path.join(PUBLIC_DIR, clean);
  }
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR) && !target.startsWith(path.join(ROOT, 'src'))) {
    return null;
  }
  return target;
}

const server = http.createServer((req, res) => {
  // 健康检查
  if (req.url.startsWith('/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, app: '智办通AI智能办公助手', time: new Date().toISOString() }));
    return;
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  let filePath = safeResolve(urlPath);
  if (filePath === false) {
    // 畸形 URL 编码：客户端错误，安全拒绝
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('400 Bad Request: malformed URI');
    return;
  }
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 单页回退到 index.html
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('404 Not Found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        ...SECURITY_HEADERS
      });
      res.end(data);
    });
  });
});

function listen(port) {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log('端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ' …');
      listen(port + 1);
    } else {
      console.error('服务器启动失败：', e);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const url = 'http://localhost:' + port;
    const line = '======================================================';
    console.log(line);
    console.log('  智办通 AI 智能办公助手 已启动');
    console.log('  访问地址：' + url);
    console.log('  监听地址：' + HOST + '（仅本机可访问；如需局域网访问请设 HOST=0.0.0.0）');
    console.log('  按 Ctrl + C 可停止服务');
    console.log(line);
    openBrowser(url);
  });
}

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const platform = os.platform();
  if (platform === 'win32') {
    exec('start "" "' + url + '"');
  } else if (platform === 'darwin') {
    exec('open "' + url + '"');
  } else {
    exec('xdg-open "' + url + '"');
  }
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

listen(PORT);
