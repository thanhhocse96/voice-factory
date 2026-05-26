import path from 'node:path';
import { readJson, sendError, sendFile, sendJson, sendStaticFile } from './http-utils.js';

export function createRouter({ config, queueService, fileService, jobRunner, browserService, db }) {
  const publicDir = path.join(config.rootDir, 'public');

  return async function route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

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
          vbeeSession: config.runtime.vbeeAdapter === 'fake' ? 'fake' : 'unknown',
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
