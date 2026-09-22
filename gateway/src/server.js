import http from 'node:http';
import { createRouter } from './api/routes.js';
import { QueueService } from './application/queue-service.js';
import { JobRunner } from './application/job-runner.js';
import { loadConfig } from './config.js';
import { BrowserService } from './infrastructure/browser/browser-service.js';
import { PlaywrightCdpAdapter } from './infrastructure/browser/adapters/playwright-cdp.js';
import { openDatabase } from './infrastructure/db/sqlite.js';
import { FileService } from './infrastructure/files/file-service.js';
import { FakeVbeeAdapter } from './vbee/adapters/fake-vbee.js';
import { VbeePreviewAdapter } from './vbee/adapters/vbee-preview.js';

function createVbeeAdapter(config, browserService) {
  if (config.runtime.vbeeAdapter === 'vbee-preview') {
    return new VbeePreviewAdapter({
      browserService,
      voicesUrl: config.runtime.voiceCatalog.url,
      catalogArrayField: config.runtime.voiceCatalog.arrayField
    });
  }
  return new FakeVbeeAdapter();
}

export async function startGateway() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const queueService = new QueueService(db);
  const fileService = new FileService({ db, audioDir: config.audioDir });
  const browserService = new BrowserService({
    adapter: new PlaywrightCdpAdapter({
      cdpUrl: config.runtime.browserCdpUrl,
      timeoutMs: config.runtime.browserHealthTimeoutMs
    })
  });

  const vbeeAdapter = createVbeeAdapter(config, browserService);
  const jobRunner = new JobRunner({
    queueService,
    fileService,
    vbeeAdapter,
    pollMs: config.worker.pollMs
  });

  if (config.worker.enabled) jobRunner.start();

  const router = createRouter({ config, queueService, fileService, jobRunner, browserService, db, vbeeAdapter });
  const server = http.createServer(router);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });

  console.log(`[gateway] listening on http://${config.host}:${config.port}`);
  return { server, db, jobRunner, config };
}
