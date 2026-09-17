import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from './routes.js';

function fakeConfig(overrides = {}) {
  return {
    rootDir: '/fake-root',
    runtime: {
      browserAdapter: 'playwright-cdp',
      vbeeAdapter: 'fake',
      delayPolicy: 'none',
      browserCdpUrl: 'http://127.0.0.1:9222',
      browserHealthTimeoutMs: 800
    },
    security: { authToken: '', corsOrigin: '' },
    ...overrides
  };
}

function fakeDeps(overrides = {}) {
  return {
    queueService: {
      listJobs: () => [],
      listJobsForExport: () => [],
      listAssets: () => [],
      listAssetsForExport: () => []
    },
    fileService: { resolveAudioPath: () => null },
    jobRunner: { status: () => 'running' },
    browserService: { healthcheck: async () => ({ status: 'available', degraded: false }) },
    db: {},
    ...overrides
  };
}

function makeRouter({ config, ...depOverrides } = {}) {
  return createRouter({ config: config || fakeConfig(), ...fakeDeps(), ...depOverrides });
}

function fakeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const lowered = {};
  for (const [key, value] of Object.entries(headers)) lowered[key.toLowerCase()] = value;
  return { method, url, headers: lowered };
}

// Real Node responses merge res.setHeader() into whatever writeHead() sends later
// rather than replacing it - routes.js's CORS headers depend on that (set once at
// the top of route(), survive into whichever branch eventually responds via
// http-utils.js, which only ever calls writeHead). This fake replicates that.
function fakeRes() {
  const res = new EventEmitter();
  const headers = {};
  res.statusCode = null;
  res.body = Buffer.alloc(0);
  res.setHeader = (name, value) => { headers[name.toLowerCase()] = value; };
  res.getHeader = (name) => headers[name.toLowerCase()];
  res.writeHead = (code, more) => {
    res.statusCode = code;
    if (more) {
      for (const [key, value] of Object.entries(more)) headers[key.toLowerCase()] = value;
    }
  };
  res.write = (chunk) => {
    res.body = Buffer.concat([res.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    return true;
  };
  res.end = (chunk) => {
    if (chunk) res.write(chunk);
    res.emit('finish');
  };
  res.destroy = () => { res.emit('finish'); };
  res.headers = headers;
  return res;
}

test('GET /health returns 200 with no token even when authToken is configured', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/health' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body.toString()).ok, true);
});

test('GET /api/queue with no Authorization returns 401 when authToken is configured', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue' }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body.toString()).error, 'unauthorized');
});

test('GET /api/queue with the correct Bearer token returns 200', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue', headers: { authorization: 'Bearer secret' } }), res);

  assert.equal(res.statusCode, 200);
});

test('GET /api/queue with a wrong Bearer token returns 401', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue', headers: { authorization: 'Bearer wrong' } }), res);

  assert.equal(res.statusCode, 401);
});

test('with authToken unset, every route behaves exactly as before (auth is a true no-op)', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: '', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue' }), res);

  assert.equal(res.statusCode, 200);
});

test('GET /api/audio/:filename with a correct ?token= succeeds with no Authorization header', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zc-routes-test-'));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const filePath = path.join(dir, 'sample.mp3');
  await fs.writeFile(filePath, Buffer.from('fake-audio-bytes'));

  const route = makeRouter({
    config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }),
    fileService: { resolveAudioPath: () => filePath }
  });
  const res = fakeRes();
  const finished = new Promise((resolve) => res.once('finish', resolve));

  await route(fakeReq({ url: '/api/audio/sample.mp3?token=secret' }), res);
  await finished;

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.toString(), 'fake-audio-bytes');
});

test('GET /api/audio/:filename with a wrong ?token= returns 401', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/audio/sample.mp3?token=wrong' }), res);

  assert.equal(res.statusCode, 401);
});

test('OPTIONS with CORS_ORIGIN configured returns 204 with Access-Control-Allow-Origin set', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: '', corsOrigin: 'http://localhost:1420' } }) });
  const res = fakeRes();

  await route(fakeReq({ method: 'OPTIONS', url: '/api/queue' }), res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:1420');
});

test('GET /health with CORS_ORIGIN unset has no Access-Control-Allow-Origin header at all', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: '', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/health' }), res);

  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('GET /api/queue.csv returns CSV with attachment headers', async () => {
  const route = makeRouter({
    ...fakeDeps(),
    queueService: {
      listJobs: () => [],
      listJobsForExport: () => [{
        id: 'job-1',
        status: 'done',
        content: 'hello, "world"',
        voice_code: 'fake_voice'
      }]
    }
  });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue.csv' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="queue.csv"');
  const body = res.body.toString('utf8');
  assert.equal(body.startsWith('\uFEFF'), true);
  assert.match(body, /job-1/);
  assert.match(body, /"hello, ""world"""/);
});

test('GET /api/assets.csv uses the export list and is not JSON', async () => {
  const route = makeRouter({
    ...fakeDeps(),
    queueService: {
      listAssets: () => [{ id: 'ui-only' }],
      listAssetsForExport: () => [{ id: 'asset-1', filename: 'clip.mp3', content: 'text' }]
    }
  });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/assets.csv' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-disposition'], 'attachment; filename="assets.csv"');
  const body = res.body.toString('utf8');
  assert.match(body, /asset-1/);
  assert.match(body, /clip\.mp3/);
  assert.equal(body.includes('ui-only'), false);
});

test('GET /api/queue.csv with no Authorization returns 401 when authToken is configured', async () => {
  const route = makeRouter({ config: fakeConfig({ security: { authToken: 'secret', corsOrigin: '' } }) });
  const res = fakeRes();

  await route(fakeReq({ url: '/api/queue.csv' }), res);

  assert.equal(res.statusCode, 401);
});
