import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function safeName(value) {
  return String(value || 'audio')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'audio';
}

function createSilentWav({ sampleRate = 8000, seconds = 1 }) {
  const channels = 1;
  const bitsPerSample = 16;
  const samples = sampleRate * seconds;
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return { buffer, durationMs: seconds * 1000, sampleRate, channels };
}

function resolveAudioExtension(result) {
  const format = result?.metadata?.format;
  if (typeof format === 'string' && /^[a-zA-Z0-9]{2,5}$/.test(format)) {
    return `.${format.toLowerCase()}`;
  }

  if (result?.localAudioPath) {
    const ext = path.extname(result.localAudioPath);
    if (/^\.[a-zA-Z0-9]{2,5}$/.test(ext)) return ext.toLowerCase();
  }

  if (result?.audioUrl) {
    try {
      const ext = path.extname(new URL(result.audioUrl).pathname);
      if (/^\.[a-zA-Z0-9]{2,5}$/.test(ext)) return ext.toLowerCase();
    } catch {
      // malformed URL - fall through to default
    }
  }

  return '.mp3';
}

// Vbee's own audio_link (a real S3 URL, confirmed live in M2_010) already carries a
// meaningful, effectively-unique name: a content slug plus Vbee's own request UUID
// (e.g. "sung_ak_la_khau_..._0de09179-29df-4d07-92a1-b7d8d3e7decc.mp3"). Prefer that
// verbatim over inventing our own name, so a file on disk reads the same as what Vbee
// itself calls it - user's explicit choice over the alternative of keeping our own
// timestamp+job-id scheme. Only falls back to that old scheme when the source has no
// filename-shaped basename (e.g. a route with no extension) - see resolveAudioExtension
// for that fallback's own format-sniffing.
function filenameFromResult(result) {
  const source = result?.audioUrl || result?.localAudioPath;
  if (!source) return null;

  let raw;
  try {
    raw = decodeURIComponent(path.basename(new URL(source).pathname));
  } catch {
    raw = path.basename(source);
  }

  return /^[\w-]+\.[a-zA-Z0-9]{1,6}$/.test(raw) ? raw : null;
}

export class FileService {
  constructor({ db, audioDir, fetchImpl = fetch }) {
    this.db = db;
    this.audioDir = audioDir;
    this.fetchImpl = fetchImpl;
  }

  async ensureReady() {
    await fs.mkdir(this.audioDir, { recursive: true });
  }

  async createFakeAsset(job) {
    await this.ensureReady();

    const assetId = crypto.randomUUID();
    const base = `${Date.now()}-${safeName(job.id)}`;
    const tmpFilename = `${base}.tmp`;
    const filename = `${base}.wav`;
    const tmpPath = path.join(this.audioDir, tmpFilename);
    const finalPath = path.join(this.audioDir, filename);
    const audio = createSilentWav({ seconds: 1 });

    await fs.writeFile(tmpPath, audio.buffer);
    await fs.rename(tmpPath, finalPath);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO audio_assets (
          id, project_id, source_job_id, filename, relative_path, file_path,
          content, voice_code, speed, duration_ms, sample_rate, channels
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        job.project_id,
        job.id,
        filename,
        filename,
        finalPath,
        job.content,
        job.voice_code,
        job.speed,
        audio.durationMs,
        audio.sampleRate,
        audio.channels
      );

      this.db.prepare(`
        UPDATE tts_queue
        SET status = 'done',
            download_complete = 1,
            relative_path = ?,
            file_path = ?,
            processed_at = CURRENT_TIMESTAMP,
            notes = 'Fake adapter generated silent WAV asset'
        WHERE id = ?
      `).run(filename, finalPath, job.id);

      this.db.prepare(`
        INSERT INTO tts_log (
          filename, content, voice_code, speed, incognito, project_id, group_id,
          download_complete, file_path, duration_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ok')
      `).run(
        filename,
        job.content,
        job.voice_code,
        job.speed,
        job.incognito,
        job.project_id,
        job.group_id,
        finalPath,
          audio.durationMs
      );
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }

    return this.db.prepare('SELECT * FROM audio_assets WHERE source_job_id = ?').get(job.id);
  }

  async finalizeFromDownload(job, result) {
    await this.ensureReady();

    if (!result || (!result.audioUrl && !result.localAudioPath)) {
      throw new Error('finalizeFromDownload requires result.audioUrl or result.localAudioPath');
    }

    const assetId = crypto.randomUUID();
    const filename = filenameFromResult(result) || `${Date.now()}-${safeName(job.id)}${resolveAudioExtension(result)}`;
    const tmpFilename = `${filename}.tmp`;
    const tmpPath = path.join(this.audioDir, tmpFilename);
    const finalPath = path.join(this.audioDir, filename);

    if (result.audioUrl) {
      const response = await this.fetchImpl(result.audioUrl);
      if (!response.ok) {
        throw new Error(`finalizeFromDownload: audioUrl fetch failed with status ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(tmpPath, buffer);
    } else {
      await fs.copyFile(result.localAudioPath, tmpPath);
    }
    await fs.rename(tmpPath, finalPath);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO audio_assets (
          id, project_id, source_job_id, filename, relative_path, file_path,
          content, voice_code, speed, duration_ms, sample_rate, channels
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        job.project_id,
        job.id,
        filename,
        filename,
        finalPath,
        job.content,
        job.voice_code,
        job.speed,
        null,
        null,
        null
      );

      this.db.prepare(`
        UPDATE tts_queue
        SET status = 'done',
            download_complete = 1,
            relative_path = ?,
            file_path = ?,
            processed_at = CURRENT_TIMESTAMP,
            notes = 'Provider audio downloaded and finalized'
        WHERE id = ?
      `).run(filename, finalPath, job.id);

      this.db.prepare(`
        INSERT INTO tts_log (
          filename, content, voice_code, speed, incognito, project_id, group_id,
          download_complete, file_path, duration_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ok')
      `).run(
        filename,
        job.content,
        job.voice_code,
        job.speed,
        job.incognito,
        job.project_id,
        job.group_id,
        finalPath,
        null
      );
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }

    return this.db.prepare('SELECT * FROM audio_assets WHERE source_job_id = ?').get(job.id);
  }

  resolveAudioPath(filename) {
    const resolved = path.resolve(this.audioDir, filename);
    const root = path.resolve(this.audioDir);
    if (!resolved.startsWith(root + path.sep)) {
      const error = new Error('invalid audio path');
      error.statusCode = 400;
      throw error;
    }
    return resolved;
  }
}
