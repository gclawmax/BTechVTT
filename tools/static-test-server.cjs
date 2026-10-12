// Minimal static file server for BTechVTT test rigs (Node core only).
// Purpose: replace python3 -m http.server as the pipe under the live tests,
// after evidence that parallel localhost downloads through the python server
// intermittently die (ERR_CONNECTION_RESET) on this machine. Every request is
// answered from a fresh fd read; failures are contained per-request.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || '/Users/mattperkins/dev/BTechVTT';
const PORT = Number(process.env.PORT || 8794);
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.md':'text/markdown' };

const server = http.createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, path.normalize(rel === '/' ? '/index.html' : rel));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  } catch { try { res.writeHead(500); res.end('err'); } catch {} }
});
server.on('clientError', (err, socket) => { try { socket.destroy(); } catch {} });
server.listen(PORT, '127.0.0.1', () => console.log(`static-test-server on ${PORT} root=${ROOT}`));
