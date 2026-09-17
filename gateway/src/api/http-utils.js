import fs from 'node:fs';
import path from 'node:path';

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendCsv(res, filename, csv) {
  const body = Buffer.from(csv, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  res.end(body);
}

export function sendError(res, error) {
  sendJson(res, error.statusCode || 500, {
    ok: false,
    error: error.message || 'Internal Server Error'
  });
}

export function sendFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'audio not found' }));
  });
  res.writeHead(200, { 'content-type': contentTypeFor(filePath) });
  stream.pipe(res);
}

export function sendStaticFile(res, rootDir, requestPath) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(rootDir, relativePath);
  const root = path.resolve(rootDir);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return sendJson(res, 400, { ok: false, error: 'invalid static path' });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return sendJson(res, 404, { ok: false, error: 'not found' });
    }
  } catch {
    return sendJson(res, 404, { ok: false, error: 'not found' });
  }

  const stream = fs.createReadStream(resolved);
  stream.on('error', () => {
    res.destroy();
  });
  res.writeHead(200, { 'content-type': contentTypeFor(resolved) });
  stream.pipe(res);
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}
