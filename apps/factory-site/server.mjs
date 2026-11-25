import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('./dist/', import.meta.url)));
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || '8810');
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
}));

function error(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message);
}

async function lookup(relative) {
  let file;
  try {
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(`${root}${sep}`)) return null;
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (info.isFile()) return { file, size: info.size, type: types.get(extname(path).toLowerCase()) ?? 'application/octet-stream' };
    await file.close();
    return null;
  } catch (failure) {
    await file?.close();
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(failure.code)) return null;
    throw failure;
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return error(response, 405, 'Method not allowed');
  }

  let path;
  try { path = decodeURIComponent(request.url.split('?', 1)[0]); }
  catch { return error(response, 400, 'Bad request'); }
  const segments = path.split('/').filter(Boolean);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(path) || segments.some((part) => part.startsWith('.'))) {
    return error(response, 400, 'Bad request');
  }

  const relative = segments.join('/') || 'index.html';
  const asset = ['assets', 'fonts', 'images', 'mascot'].includes(segments[0]) || Boolean(extname(relative));
  try {
    const result = await lookup(relative) ?? (asset ? null : await lookup('index.html'));
    if (!result) return error(response, 404, 'Not found');
    const { file, size, type } = result;
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': size });
    if (request.method === 'HEAD') {
      await file.close();
      return response.end();
    }
    const stream = file.createReadStream();
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch {
    if (response.headersSent) response.destroy();
    else error(response, 500, 'Internal server error');
  }
});

server.listen(port, host, () => console.log(`Factory site listening on ${host}:${server.address().port}`));
