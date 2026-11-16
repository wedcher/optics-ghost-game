// 本機試玩用的靜態檔案伺服器（只給 .claude/launch.json 使用，不是遊戲的一部分）。
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8123;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  // 轉址而不是直接回傳內容：入口頁的連結是相對路徑，網址必須真的在 /prototype/ 底下。
  if (rel === '/') { res.writeHead(302, { Location: '/prototype/index.html' }); res.end(); return; }
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + ROOT + ' at http://localhost:' + PORT + '/'));
