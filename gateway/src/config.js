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
      vbeeAdapter: process.env.VBEE_ADAPTER || 'fake', // 'fake' | 'vbee-preview' (docs/design/08 Phase C)
      delayPolicy: process.env.DELAY_POLICY || 'none',
      browserCdpUrl: process.env.CDP_URL || 'http://127.0.0.1:9222',
      browserHealthTimeoutMs: intFromEnv('BROWSER_HEALTH_TIMEOUT_MS', 800),
      voiceCatalog: {
        // Studio catalog URL read through the authenticated page context. Until
        // that endpoint shape is captured live, auto-detection in
        // voice-catalog.js + VBEE_VOICES_ARRAY_FIELD carry the mapping.
        url: process.env.VBEE_VOICES_URL || '',
        arrayField: process.env.VBEE_VOICES_ARRAY_FIELD || ''
      }
    },
    // Kept out of `runtime` on purpose: /health echoes `runtime` wholesale, and
    // authToken must never appear in an unauthenticated response (docs/design/08 Phase D).
    security: {
      authToken: process.env.GATEWAY_AUTH_TOKEN || '', // '' = auth off (1-machine default)
      corsOrigin: process.env.CORS_ORIGIN || '' // '' = no CORS headers (same-origin default)
    }
  };
}
