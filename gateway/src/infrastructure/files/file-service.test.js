import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileService } from './file-service.js';
import { openDatabase } from '../db/sqlite.js';
import { QueueService } from '../../application/queue-service.js';

async function setup(t, { fetchImpl } = {}) {
  const db = openDatabase(':memory:');
  const queueService = new QueueService(db);
  const audioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-file-service-'));
  const fileService = new FileService({ db, audioDir, fetchImpl });

  t.after(async () => {
    await fs.rm(audioDir, { recursive: true, force: true });
  });

  function createJob(overrides = {}) {
    // A real tts_queue row is required: audio_assets.source_job_id references
    // tts_queue(id), the same way JobRunner only ever passes jobs that came
    // from queueService.pickPendingJob() (never a fabricated in-memory object).
    return queueService.createJob({
      content: 'hello world',
      voice_code: 'hn-female-1',
      speed: 1.0,
      ...overrides
    });
  }

  return { db, audioDir, fileService, createJob };
}

function fetchOk(bytes) {
  return async () => ({
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  });
}

test('finalizeFromDownload writes real bytes and finalizes an asset row', async (t) => {
  const bytes = Buffer.from('fake-mp3-bytes-content');
  const { audioDir, fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();

  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: 'https://cdn.example/preview.mp3',
    localAudioPath: null,
    metadata: {}
  });

  assert.equal(asset.filename.endsWith('.mp3'), true);
  assert.equal(asset.duration_ms, null);
  assert.equal(asset.sample_rate, null);
  assert.equal(asset.channels, null);

  const written = await fs.readFile(path.join(audioDir, asset.filename));
  assert.equal(written.equals(bytes), true);

  const remaining = await fs.readdir(audioDir);
  assert.equal(remaining.some((name) => name.endsWith('.tmp')), false);
});

test('finalizeFromDownload rejects and leaves no file when fetch is not ok', async (t) => {
  const { audioDir, fileService, createJob } = await setup(t, {
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  const job = createJob();

  await assert.rejects(
    () => fileService.finalizeFromDownload(job, { audioUrl: 'https://cdn.example/missing.mp3' }),
    /404/
  );

  const remaining = await fs.readdir(audioDir);
  assert.deepEqual(remaining, []);
});

test('finalizeFromDownload keeps the provider\'s own filename verbatim, even over metadata.format', async (t) => {
  const bytes = Buffer.from('bytes');
  const { fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();

  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: 'https://cdn.example/preview.wav',
    metadata: { format: 'ogg' }
  });

  // The URL's own basename wins wholesale - user's explicit choice to preserve
  // Vbee's real filename rather than re-deriving just the extension.
  assert.equal(asset.filename, 'preview.wav');
});

test('finalizeFromDownload uses Vbee\'s real audio_link basename verbatim (slug + Vbee\'s own request UUID)', async (t) => {
  const bytes = Buffer.from('bytes');
  const { fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();

  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: 'https://vbee-s3.example/tts/sung_ak_la_khau_sung_canh_tranh_voi_m_16_0de09179-29df-4d07-92a1-b7d8d3e7decc.mp3?X-Amz-Expires=3600',
    metadata: { format: 'mp3' }
  });

  assert.equal(asset.filename, 'sung_ak_la_khau_sung_canh_tranh_voi_m_16_0de09179-29df-4d07-92a1-b7d8d3e7decc.mp3');
});

test('finalizeFromDownload falls back to the generated name when the URL has no filename-shaped basename', async (t) => {
  const bytes = Buffer.from('bytes');
  const { fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();

  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: 'https://cdn.example/',
    metadata: { format: 'ogg' }
  });

  // No usable basename in the URL ("" from a bare "/") - falls back to the old
  // scheme, which still honors metadata.format same as before this change.
  assert.equal(asset.filename.endsWith('.ogg'), true);
});

test('finalizeFromDownload defaults to .mp3 when nothing indicates a format', async (t) => {
  const bytes = Buffer.from('bytes');
  const { fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();

  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: 'https://cdn.example/stream?token=abc',
    metadata: {}
  });

  assert.equal(asset.filename.endsWith('.mp3'), true);
});

test('finalizeFromDownload copies from localAudioPath and leaves the source untouched', async (t) => {
  const { fileService, createJob } = await setup(t, {});
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vf-file-service-src-'));
  t.after(async () => { await fs.rm(sourceDir, { recursive: true, force: true }); });

  const sourcePath = path.join(sourceDir, 'source.wav');
  const bytes = Buffer.from('local-source-bytes');
  await fs.writeFile(sourcePath, bytes);

  const job = createJob();
  const asset = await fileService.finalizeFromDownload(job, {
    audioUrl: null,
    localAudioPath: sourcePath,
    metadata: {}
  });

  assert.equal(asset.filename.endsWith('.wav'), true);
  const sourceStillThere = await fs.readFile(sourcePath);
  assert.equal(sourceStillThere.equals(bytes), true);
});

test('finalizeFromDownload rolls back the DB transaction on a NOT NULL violation', async (t) => {
  const bytes = Buffer.from('bytes');
  const { db, fileService, createJob } = await setup(t, { fetchImpl: fetchOk(bytes) });
  const job = createJob();
  // tts_log.content is NOT NULL - forces a mid-transaction failure. The real
  // tts_queue row (job.id) still has valid content; only the in-memory object
  // passed to finalizeFromDownload is corrupted, which is enough since this
  // method never re-reads content from the DB.
  const brokenJob = { ...job, content: null };

  await assert.rejects(() => fileService.finalizeFromDownload(brokenJob, {
    audioUrl: 'https://cdn.example/preview.mp3',
    metadata: {}
  }));

  const row = db.prepare('SELECT * FROM audio_assets WHERE source_job_id = ?').get(job.id);
  assert.equal(row, undefined);
});

test('createFakeAsset still produces a playable silent WAV with known duration (regression baseline)', async (t) => {
  const { fileService, createJob } = await setup(t, {});
  const job = createJob();

  const asset = await fileService.createFakeAsset(job);

  assert.equal(asset.filename.endsWith('.wav'), true);
  assert.ok(asset.duration_ms > 0);
  assert.ok(asset.sample_rate > 0);
  assert.ok(asset.channels > 0);
});
