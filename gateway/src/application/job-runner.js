export class JobRunner {
  constructor({ queueService, fileService, vbeeAdapter, pollMs = 1000 }) {
    this.queueService = queueService;
    this.fileService = fileService;
    this.vbeeAdapter = vbeeAdapter;
    this.pollMs = pollMs;
    this.timer = null;
    this.running = false;
    this.processing = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[worker] tick failed', error);
      });
    }, this.pollMs);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return this.running ? 'running' : 'stopped';
  }

  async tick() {
    if (this.processing) return;
    this.processing = true;

    let job = null;
    try {
      job = this.queueService.pickPendingJob();
      if (!job) return;

      this.queueService.markStatus(job.id, 'submitting', 'Submitting to provider');
      const result = await this.vbeeAdapter.synthesize(job);

      this.queueService.markStatus(job.id, 'downloading', 'Finalizing local audio');
      if (result && (result.audioUrl || result.localAudioPath)) {
        await this.fileService.finalizeFromDownload(job, result);
      } else {
        await this.fileService.createFakeAsset(job);
      }
    } catch (error) {
      console.error('[worker] job failed', error);
      if (job) {
        this.queueService.markStatus(job.id, 'failed', error.message || 'Job failed');
      }
    } finally {
      this.processing = false;
    }
  }
}
