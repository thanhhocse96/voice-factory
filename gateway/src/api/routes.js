import path from 'node:path';
import { assetsToCsv, queueToCsv } from '../infrastructure/csv.js';
import { readJson, sendCsv, sendError, sendFile, sendJson, sendStaticFile } from './http-utils.js';

const VBEE_SESSION_LABELS = {
  fake: 'fake',
  'vbee-preview': 'browser-session'
};

function bearerTokenFrom(headerValue) {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
  return headerValue.slice('Bearer '.length).trim();
}

// GET-only, and only the routes a remote UI must reach before it has a token
// (the static shell) or that monitoring needs regardless of auth (/health).
function isAuthExempt(method, pathname) {
  if (method !== 'GET') return false;
  return pathname === '/health' || pathname === '/' || pathname.startsWith('/dev/');
}

export function createRouter({ config, queueService, fileService, jobRunner, browserService, db, vbeeAdapter }) {
  const publicDir = path.join(config.rootDir, 'public');
  const { authToken = '', corsOrigin = '' } = config.security || {};
  const voiceCatalog = vbeeAdapter || {
    listVoices: async () => ({ ok: true, source: 'none', fetchedAt: null, voices: [], warning: null })
  };

  return async function route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      // Set before auth so a failed/exempt request still carries CORS headers
      // (a browser preflight never sends Authorization, and a 401 still needs
      // Access-Control-Allow-Origin or the browser reports an opaque CORS
      // failure instead of a readable 401). res.writeHead() later merges with
      // headers set here rather than replacing them (Node's documented
      // behavior) - every response path in http-utils.js only calls writeHead.
      if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
      }

      // A bare browser <audio src> cannot carry an Authorization header, so
      // /api/audio/:filename alone accepts a ?token= fallback (docs/design/08
      // Phase D.3). Weaker than a header - can end up in browser history/logs -
      // but scoped to exactly one read-only route, not a blanket exemption.
      if (authToken && !isAuthExempt(req.method, url.pathname)) {
        const audioMatch = req.method === 'GET' && url.pathname.match(/^\/api\/audio\/([^/]+)$/);
        const token = bearerTokenFrom(req.headers.authorization) || (audioMatch ? url.searchParams.get('token') : null);
        if (token !== authToken) {
          return sendJson(res, 401, { ok: false, error: 'unauthorized' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        const browserHealth = await browserService.healthcheck();
        const providerDegraded = config.runtime.vbeeAdapter !== 'fake';
        const degraded = providerDegraded || browserHealth.degraded;

        return sendJson(res, 200, {
          ok: true,
          gateway: 'running',
          db: db ? 'ok' : 'unavailable',
          browserCdp: browserHealth.status,
          browser: browserHealth,
          vbeeSession: VBEE_SESSION_LABELS[config.runtime.vbeeAdapter] || 'unknown',
          worker: jobRunner.status(),
          degraded,
          runtime: config.runtime
        });
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/dev/'))) {
        const staticPath = url.pathname === '/' ? '/' : url.pathname.slice('/dev'.length) || '/';
        return sendStaticFile(res, publicDir, staticPath);
      }

      if (req.method === 'POST' && url.pathname === '/api/queue') {
        const body = await readJson(req);
        const job = queueService.createJob(body);
        return sendJson(res, 201, { ok: true, job });
      }

      if (req.method === 'GET' && url.pathname === '/api/queue') {
        return sendJson(res, 200, { ok: true, jobs: queueService.listJobs() });
      }

      if (req.method === 'GET' && url.pathname === '/api/queue.csv') {
        return sendCsv(res, 'queue.csv', queueToCsv(queueService.listJobsForExport()));
      }

      if (req.method === 'GET' && url.pathname === '/api/voices') {
        const catalog = await voiceCatalog.listVoices();
        return sendJson(res, 200, { ok: true, ...catalog });
      }

      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        const job = queueService.getJob(jobMatch[1]);
        return job
          ? sendJson(res, 200, { ok: true, job })
          : sendJson(res, 404, { ok: false, error: 'job not found' });
      }

      const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
      if (req.method === 'POST' && retryMatch) {
        return sendJson(res, 200, { ok: true, job: queueService.retryJob(retryMatch[1]) });
      }

      const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
      if (req.method === 'POST' && cancelMatch) {
        return sendJson(res, 200, { ok: true, job: queueService.cancelJob(cancelMatch[1]) });
      }

      if (req.method === 'GET' && url.pathname === '/api/assets') {
        return sendJson(res, 200, { ok: true, assets: queueService.listAssets() });
      }

      if (req.method === 'GET' && url.pathname === '/api/assets.csv') {
        return sendCsv(res, 'assets.csv', assetsToCsv(queueService.listAssetsForExport()));
      }

      const audioMatch = url.pathname.match(/^\/api\/audio\/([^/]+)$/);
      if (req.method === 'GET' && audioMatch) {
        const filePath = fileService.resolveAudioPath(decodeURIComponent(audioMatch[1]));
        return sendFile(res, filePath);
      }

      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return sendError(res, error);
    }
  };
}
