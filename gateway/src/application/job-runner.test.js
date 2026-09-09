import test from 'node:test';
import assert from 'node:assert/strict';
import { JobRunner } from './job-runner.js';

function fakeQueueService(job) {
  let picked = false;
  const statusCalls = [];
  return {
    statusCalls,
    pickPendingJob() {
      if (picked) return null;
      picked = true;
      return job;
    },
    markStatus(id, status, notes) {
      statusCalls.push({ id, status, notes });
    }
  };
}

test('JobRunner finalizes via download when adapter returns audioUrl', async () => {
  const job = { id: 'job-1' };
  const queueService = fakeQueueService(job);
  const calls = { finalizeFromDownload: 0, createFakeAsset: 0 };
  const fileService = {
    async finalizeFromDownload() { calls.finalizeFromDownload += 1; },
    async createFakeAsset() { calls.createFakeAsset += 1; }
  };
  const vbeeAdapter = { async synthesize() { return { audioUrl: 'https://x/y.mp3', localAudioPath: null }; } };

  const runner = new JobRunner({ queueService, fileService, vbeeAdapter });
  await runner.tick();

  assert.equal(calls.finalizeFromDownload, 1);
  assert.equal(calls.createFakeAsset, 0);
  assert.deepEqual(queueService.statusCalls.map((c) => c.status), ['submitting', 'downloading']);
});

test('JobRunner falls back to fake asset when adapter returns no downloadable result', async () => {
  const job = { id: 'job-2' };
  const queueService = fakeQueueService(job);
  const calls = { finalizeFromDownload: 0, createFakeAsset: 0 };
  const fileService = {
    async finalizeFromDownload() { calls.finalizeFromDownload += 1; },
    async createFakeAsset() { calls.createFakeAsset += 1; }
  };
  const vbeeAdapter = { async synthesize() { return { audioUrl: null, localAudioPath: null }; } };

  const runner = new JobRunner({ queueService, fileService, vbeeAdapter });
  await runner.tick();

  assert.equal(calls.createFakeAsset, 1);
  assert.equal(calls.finalizeFromDownload, 0);
});

test('JobRunner marks job failed when adapter synthesis rejects, without throwing', async () => {
  const job = { id: 'job-3' };
  const queueService = fakeQueueService(job);
  const fileService = {
    async finalizeFromDownload() {},
    async createFakeAsset() {}
  };
  const vbeeAdapter = { async synthesize() { throw new Error('browser closed'); } };

  const runner = new JobRunner({ queueService, fileService, vbeeAdapter });
  await assert.doesNotReject(() => runner.tick());

  assert.deepEqual(queueService.statusCalls.map((c) => c.status), ['submitting', 'failed']);
  assert.equal(queueService.statusCalls.at(-1).notes, 'browser closed');
});

test('JobRunner marks job failed when finalize step rejects', async () => {
  const job = { id: 'job-4' };
  const queueService = fakeQueueService(job);
  const fileService = {
    async finalizeFromDownload() { throw new Error('disk full'); },
    async createFakeAsset() {}
  };
  const vbeeAdapter = { async synthesize() { return { audioUrl: 'https://x/y.mp3', localAudioPath: null }; } };

  const runner = new JobRunner({ queueService, fileService, vbeeAdapter });
  await runner.tick();

  assert.deepEqual(queueService.statusCalls.map((c) => c.status), ['submitting', 'downloading', 'failed']);
});

test('JobRunner tick is a no-op when queue is empty', async () => {
  const queueService = {
    statusCalls: [],
    pickPendingJob() { return null; },
    markStatus() { throw new Error('should not be called'); }
  };
  const fileService = { async finalizeFromDownload() {}, async createFakeAsset() {} };
  const vbeeAdapter = { async synthesize() { throw new Error('should not be called'); } };

  const runner = new JobRunner({ queueService, fileService, vbeeAdapter });
  await assert.doesNotReject(() => runner.tick());
});
