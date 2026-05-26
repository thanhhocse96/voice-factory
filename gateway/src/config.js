import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig() {
  const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
  return {
    rootDir,
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST || '127.0.0.1',
    dbPath: process.env.DATABASE_PATH || path.join(dataDir, 'tts.db'),
    audioDir: process.env.AUDIO_DIR || path.join(dataDir, 'audio'),
    worker: {
      enabled: process.env.WORKER_ENABLED !== '0',
      pollMs: intFromEnv('WORKER_POLL_MS', 1000)
    },
    runtime: {
      browserAdapter: process.env.BROWSER_ADAPTER || 'playwright-cdp',
      vbeeAdapter: process.env.VBEE_ADAPTER || 'fake',
      delayPolicy: process.env.DELAY_POLICY || 'none',
      browserCdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
      browserHealthTimeoutMs: intFromEnv('BROWSER_HEALTH_TIMEOUT_MS', 800)
    }
  };
}
