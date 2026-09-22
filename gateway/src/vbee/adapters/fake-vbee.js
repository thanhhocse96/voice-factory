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

  async listVoices() {
    return {
      ok: true,
      source: 'fake',
      fetchedAt: null,
      voices: [
        { code: 'fake_voice', name: 'Fake Voice (demo)', gender: 'female', language: 'vi-VN', ownership: 'vbee', sampleUrl: null, source: 'fake' },
        { code: 'hn_female_ngochuyen_full_48k-fhg', name: 'Ngọc Huyền', gender: 'female', language: 'vi-VN', ownership: 'vbee', sampleUrl: null, source: 'fake' },
        { code: 'sg_female_tuongvy_call_44k-fhg', name: 'Tường Vy', gender: 'female', language: 'vi-VN', ownership: 'vbee', sampleUrl: null, source: 'fake' },
        { code: 'hn_male_ducthinh_full_48k-fhg', name: 'Đức Thịnh', gender: 'male', language: 'vi-VN', ownership: 'vbee', sampleUrl: null, source: 'fake' },
        { code: 'my_personal_voice_demo', name: 'Giọng cá nhân demo', gender: null, language: null, ownership: 'personal', sampleUrl: null, source: 'fake' }
      ]
    };
  }
}
