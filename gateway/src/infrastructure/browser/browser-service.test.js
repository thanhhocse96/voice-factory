import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserService } from './browser-service.js';
import { PlaywrightCdpAdapter } from './adapters/playwright-cdp.js';

test('BrowserService returns unavailable when adapter is missing', async () => {
  const service = new BrowserService({ adapter: null });
  const health = await service.healthcheck();

  assert.equal(health.status, 'unavailable');
  assert.equal(health.degraded, true);
});

test('PlaywrightCdpAdapter reports available CDP version endpoint', async () => {
  const adapter = new PlaywrightCdpAdapter({
    cdpUrl: 'http://127.0.0.1:9222',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        Browser: 'Chrome/123',
        'Protocol-Version': '1.3'
      })
    })
  });

  const health = await adapter.healthcheck();

  assert.equal(health.status, 'available');
  assert.equal(health.degraded, false);
  assert.equal(health.browser, 'Chrome/123');
  assert.equal(health.protocolVersion, '1.3');
});

test('PlaywrightCdpAdapter degrades when CDP fetch fails', async () => {
  const adapter = new PlaywrightCdpAdapter({
    cdpUrl: 'http://127.0.0.1:9222',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    }
  });

  const health = await adapter.healthcheck();

  assert.equal(health.status, 'unavailable');
  assert.equal(health.degraded, true);
  assert.match(health.error, /ECONNREFUSED/);
});
