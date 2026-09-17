import crypto from 'node:crypto';

function normalizeJob(input) {
  return {
    id: crypto.randomUUID(),
    content: String(input.content || '').trim(),
    voice_code: String(input.voice_code || input.voiceCode || 'fake_voice'),
    speed: Number(input.speed ?? 1.05),
    incognito: input.incognito ? 1 : 0,
    project_id: input.project_id ?? input.projectId ?? null,
    group_id: input.group_id ?? input.groupId ?? null,
    priority: Number(input.priority ?? 5)
  };
}

export class QueueService {
  constructor(db) {
    this.db = db;
  }

  createJob(input) {
    const job = normalizeJob(input);
    if (!job.content) {
      const error = new Error('content is required');
      error.statusCode = 400;
      throw error;
    }

    this.db.prepare(`
      INSERT INTO tts_queue (
        id, content, voice_code, speed, incognito, project_id, group_id, priority, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      job.id,
      job.content,
      job.voice_code,
      job.speed,
      job.incognito,
      job.project_id,
      job.group_id,
      job.priority
    );

    return this.getJob(job.id);
  }

  listJobs() {
    return this.db.prepare(`
      SELECT *
      FROM tts_queue
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
  }

  listJobsForExport() {
    return this.db.prepare(`
      SELECT *
      FROM tts_queue
      ORDER BY created_at DESC
    `).all();
  }

  getJob(id) {
    return this.db.prepare('SELECT * FROM tts_queue WHERE id = ?').get(id);
  }

  pickPendingJob() {
    const job = this.db.prepare(`
      SELECT *
      FROM tts_queue
      WHERE status = 'pending'
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `).get();

    if (!job) return null;

    const result = this.db.prepare(`
      UPDATE tts_queue
      SET status = 'typing_delay', notes = 'Picked by fake worker'
      WHERE id = ? AND status = 'pending'
    `).run(job.id);

    return result.changes === 1 ? this.getJob(job.id) : null;
  }

  markStatus(id, status, notes = null) {
    this.db.prepare(`
      UPDATE tts_queue
      SET status = ?, notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(status, notes, id);
    return this.getJob(id);
  }

  retryJob(id) {
    this.db.prepare(`
      UPDATE tts_queue
      SET status = 'pending',
          retry_count = retry_count + 1,
          notes = 'Retry requested'
      WHERE id = ? AND status IN ('failed', 'failed_file_lock', 'cancelled')
    `).run(id);
    return this.getJob(id);
  }

  cancelJob(id) {
    this.db.prepare(`
      UPDATE tts_queue
      SET status = 'cancelled', notes = 'Cancelled by API'
      WHERE id = ? AND status NOT IN ('done', 'cancelled')
    `).run(id);
    return this.getJob(id);
  }

  listAssets() {
    return this.db.prepare(`
      SELECT *
      FROM audio_assets
      WHERE filename NOT LIKE '%.tmp'
      ORDER BY created_at DESC
      LIMIT 100
    `).all();
  }

  listAssetsForExport() {
    return this.db.prepare(`
      SELECT *
      FROM audio_assets
      WHERE filename NOT LIKE '%.tmp'
      ORDER BY created_at DESC
    `).all();
  }
}
