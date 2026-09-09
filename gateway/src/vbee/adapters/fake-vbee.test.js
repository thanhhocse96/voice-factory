import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeVbeeAdapter } from './fake-vbee.js';

test('FakeVbeeAdapter returns normalized contract shape', async () => {
  const adapter = new FakeVbeeAdapter();
  const job = { id: 'job-1', voice_code: 'hn-female-1' };

  const result = await adapter.synthesize(job);

  assert.equal(result.provider, 'fake');
  assert.equal(result.requestId, 'fake-job-1');
  assert.equal(result.audioUrl, null);
  assert.equal(result.localAudioPath, null);
  assert.equal(result.metadata.voiceCode, 'hn-female-1');
  assert.equal(result.metadata.executionMode, 'fake');
  assert.deepEqual(result.metadata.protocolWarnings, []);
});

test('FakeVbeeAdapter result never signals a downloadable asset', async () => {
  const adapter = new FakeVbeeAdapter();
  const result = await adapter.synthesize({ id: 'job-2', voice_code: 'x' });

  assert.equal(Boolean(result.audioUrl || result.localAudioPath), false);
});
