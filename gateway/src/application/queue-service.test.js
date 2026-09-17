import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../infrastructure/db/sqlite.js';
import { QueueService } from './queue-service.js';

test('listJobsForExport returns every job, not the UI page of 100', () => {
  const db = openDatabase(':memory:');
  const queueService = new QueueService(db);

  for (let i = 0; i < 101; i += 1) {
    queueService.createJob({ content: `job ${i}` });
  }

  assert.equal(queueService.listJobs().length, 100);
  assert.equal(queueService.listJobsForExport().length, 101);
});

test('listAssetsForExport hides .tmp files and is not capped at 100', () => {
  const db = openDatabase(':memory:');
  const queueService = new QueueService(db);

  for (let i = 0; i < 102; i += 1) {
    const job = queueService.createJob({ content: `asset ${i}` });
    db.prepare(`
      INSERT INTO audio_assets (id, source_job_id, filename, relative_path, file_path, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `asset-${i}`,
      job.id,
      i === 0 ? 'pending.tmp' : `clip-${i}.mp3`,
      i === 0 ? 'pending.tmp' : `clip-${i}.mp3`,
      i === 0 ? '/tmp/pending.tmp' : `/tmp/clip-${i}.mp3`,
      `asset ${i}`
    );
  }

  assert.equal(queueService.listAssets().length, 100);
  assert.equal(queueService.listAssetsForExport().length, 101);
  assert.equal(queueService.listAssetsForExport().some((row) => row.filename.endsWith('.tmp')), false);
});
