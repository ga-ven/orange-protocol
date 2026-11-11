import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// 容器里必须绑全网段，否则创空间的端口探测连不上；本地默认仍是回环
const port = Number(process.env.PORT || 8790);
const host = process.env.HOST || '127.0.0.1';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 点开头的文件（.git / .env 等）任何情况下都不服务。
// checks/、screenshots/、node_modules/ 只在部署时屏蔽（STRICT=1），
// 本地留着是为了让 Playwright 脚本能取到 checks/iframe-harness.html。
const STRICT = process.env.STRICT === '1';
const DEV_ONLY = new Set(['checks', 'screenshots', 'node_modules']);

function isServed(relativePath) {
  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  return segments.every(
    (segment) => !segment.startsWith('.') && !(STRICT && DEV_ONLY.has(segment)),
  );
}

const server = http.createServer((request, response) => {
  const rawPath = decodeURIComponent((request.url || '/').split('?')[0]);

  if (rawPath === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  const requestPath = rawPath === '/' ? 'index.html' : rawPath;
  const safePath = path.normalize(requestPath).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root) || !isServed(safePath)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`Orange Protocol running at http://${host}:${port}`);
});
