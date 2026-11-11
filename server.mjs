import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8790);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((request, response) => {
  const rawPath = decodeURIComponent((request.url || '/').split('?')[0]);
  const requestPath = rawPath === '/' ? 'index.html' : rawPath;
  const safePath = path.normalize(requestPath).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) {
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
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    response.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Orange Protocol running at http://127.0.0.1:${port}`);
});
