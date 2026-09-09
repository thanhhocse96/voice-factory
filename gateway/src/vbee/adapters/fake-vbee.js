export class FakeVbeeAdapter {
  async synthesize(job) {
    return {
      provider: 'fake',
      requestId: `fake-${job.id}`,
      audioUrl: null,
      localAudioPath: null,
      metadata: {
        voiceCode: job.voice_code,
        executionMode: 'fake',
        format: null,
        protocolWarnings: [],
        note: 'M0 fake adapter does not call Vbee'
      }
    };
  }
}
