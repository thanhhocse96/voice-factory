import test from 'node:test';
import assert from 'node:assert/strict';
import { VbeePreviewAdapter, redactSensitiveFields } from './vbee-preview.js';

const PREVIEW_BUTTON_SELECTOR = '#try-listening';
const RESTORE_DIALOG_SELECTOR = '[data-id="reload-prev-session"]';
const SYNTHESIS_WS_URL = 'wss://vbee.vn/api/v1/synthesis/demo';
const VBEE_STUDIO_URL_STUB = 'https://studio.vbee.vn/';

function noopSteps(overrides = {}) {
  return {
    installTokenCapture: async () => {},
    ensureStudioPage: async () => {},
    extractSessionToken: async () => {},
    requestPreviewSynthesis: async () => ({
      audioUrl: 'https://cdn.example/preview.mp3',
      requestId: 'req-123',
      format: 'mp3',
      protocolWarnings: []
    }),
    ...overrides
  };
}

function fakeBrowserService(page) {
  const calls = [];
  return {
    calls,
    async withPage(fn) {
      calls.push('withPage');
      return fn(page || { url: () => VBEE_STUDIO_URL_STUB });
    }
  };
}

function fakePlaywrightPage({
  url = 'https://studio.vbee.vn/studio/text-to-speech',
  hasPreviewButton = true,
  hasRestoreDialog = false,
  hasToken = true,
  evaluateImpl = null
} = {}) {
  const calls = [];

  const previewButtonLocator = {
    count: async () => (hasPreviewButton ? 1 : 0),
    waitFor: async (opts) => {
      calls.push(['previewButton.waitFor', opts]);
      if (!hasPreviewButton) throw new Error('TimeoutError: locator not found');
    },
    click: async () => { calls.push(['previewButton.click']); }
  };

  const restoreDialogLocator = {
    count: async () => (hasRestoreDialog ? 1 : 0),
    click: async () => { calls.push(['restoreDialog.click']); }
  };

  const page = {
    calls,
    url: () => url,
    goto: async (target) => { calls.push(['goto', target]); },
    reload: async () => { calls.push(['reload']); },
    waitForTimeout: async (ms) => { calls.push(['waitForTimeout', ms]); },
    addInitScript: async () => { calls.push(['addInitScript']); },
    waitForFunction: async (fn, opts) => {
      calls.push(['waitForFunction', opts]);
      if (!hasToken) throw new Error('TimeoutError: token not captured');
    },
    evaluate: async (fn, arg) => {
      calls.push(['evaluate', arg]);
      if (evaluateImpl) return evaluateImpl(fn, arg);
      return {
        ok: true,
        audioUrl: 'https://cdn.example/audio.mp3',
        requestId: 'req-xyz',
        frames: [
          { direction: 'client', type: 'INIT', payload: { type: 'INIT', accessToken: '[REDACTED]' } },
          { direction: 'server', type: 'INIT', status: 1, payload: { type: 'INIT', status: 1 } },
          { direction: 'client', type: 'SYNTHESIS', payload: { type: 'SYNTHESIS', accessToken: '[REDACTED]', payload: { text: arg.content } } },
          { direction: 'server', type: 'SYNTHESIS', status: 'IN_PROGRESS', payload: { type: 'SYNTHESIS', result: { status: 'IN_PROGRESS' } } },
          { direction: 'server', type: 'SYNTHESIS', status: 'SUCCESS', payload: { type: 'SYNTHESIS', result: { status: 'SUCCESS', audio_link: 'https://cdn.example/audio.mp3', request_id: 'req-xyz' } } }
        ]
      };
    },
    locator: (selector) => {
      calls.push(['locator', selector]);
      if (selector === PREVIEW_BUTTON_SELECTOR) return previewButtonLocator;
      if (selector === RESTORE_DIALOG_SELECTOR) return restoreDialogLocator;
      throw new Error(`unexpected selector: ${selector}`);
    }
  };
  return page;
}

test('VbeePreviewAdapter maps a successful preview flow to the normalized shape', async () => {
  const browserService = fakeBrowserService();
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps()
  });

  const result = await adapter.synthesize({ id: 'job-1', voice_code: 'hn-female-1', content: 'hello' });

  assert.deepEqual(browserService.calls, ['withPage']);
  assert.equal(result.provider, 'vbee');
  assert.equal(result.requestId, 'req-123');
  assert.equal(result.audioUrl, 'https://cdn.example/preview.mp3');
  assert.equal(result.localAudioPath, null);
  assert.equal(result.metadata.voiceCode, 'hn-female-1');
  assert.equal(result.metadata.executionMode, 'vbee_preview_download');
  assert.equal(result.metadata.format, 'mp3');
});

test('VbeePreviewAdapter propagates a step failure', async () => {
  const browserService = fakeBrowserService();
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({
      extractSessionToken: async () => {
        throw new Error('session token missing');
      }
    })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    /session token missing/
  );
});

test('VbeePreviewAdapter requires a browserService', () => {
  assert.throws(() => new VbeePreviewAdapter({}), /browserService/);
});

test('default installTokenCapture registers addInitScript before reload', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({
      installTokenCapture: undefined,
      ensureStudioPage: undefined
    })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  const names = page.calls.map(([name]) => name);
  const installIdx = names.indexOf('addInitScript');
  const reloadIdx = names.indexOf('reload');
  assert.ok(installIdx !== -1, 'addInitScript should be called');
  assert.ok(reloadIdx !== -1, 'reload should be called');
  assert.ok(installIdx < reloadIdx, 'token hook must be installed before reload');
});

test('default ensureStudioPage reloads (not navigates) when already on the studio page', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(page.calls.some(([name]) => name === 'reload'));
  assert.ok(!page.calls.some(([name]) => name === 'goto'));
});

test('default ensureStudioPage navigates when not yet on the studio page', async () => {
  const page = fakePlaywrightPage({ url: 'https://vbee.vn/' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(page.calls.some(([name, target]) => name === 'goto' && target === 'https://studio.vbee.vn'));
  assert.ok(!page.calls.some(([name]) => name === 'reload'));
});

test('default ensureStudioPage no longer types into or clears the editor', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(!page.calls.some(([name]) => name === 'keyboard.press'));
  assert.ok(!page.calls.some(([name]) => name === 'editor.click'));
  assert.ok(!page.calls.some(([name]) => name === 'editor.pressSequentially'));
});

test('default ensureStudioPage dismisses the restore-content dialog when it appears', async () => {
  const page = fakePlaywrightPage({ hasRestoreDialog: true });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(page.calls.some(([name]) => name === 'restoreDialog.click'));
});

test('default ensureStudioPage proceeds normally when no restore dialog appears', async () => {
  const page = fakePlaywrightPage({ hasRestoreDialog: false });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(!page.calls.some(([name]) => name === 'restoreDialog.click'));
});

test('default extractSessionToken passes when on studio with preview control and captured token', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech', hasPreviewButton: true, hasToken: true });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ extractSessionToken: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });
  assert.ok(page.calls.some(([name]) => name === 'waitForFunction'));
});

test('default extractSessionToken rejects when redirected to the login page', async () => {
  const page = fakePlaywrightPage({ url: 'https://auth.vbee.vn/login?session=abc' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ extractSessionToken: undefined })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    /not authenticated/
  );
});

test('default extractSessionToken rejects when the preview control is missing', async () => {
  const page = fakePlaywrightPage({ hasPreviewButton: false });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ extractSessionToken: undefined })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    /session signal not found/
  );
});

test('default extractSessionToken rejects when the page never captures a token', async () => {
  const page = fakePlaywrightPage({ hasToken: false });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ extractSessionToken: undefined })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    /token was not captured/
  );
});

test('default requestPreviewSynthesis drives the WS round trip in page.evaluate and never sends the token as an evaluate argument', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ requestPreviewSynthesis: undefined })
  });

  const result = await adapter.synthesize({
    id: 'job-1',
    voice_code: 'sg_female_tuongvy_call_44k-fhg',
    speed: 1.05,
    content: 'xin chào'
  });

  const evaluateCall = page.calls.find(([name]) => name === 'evaluate');
  assert.ok(evaluateCall, 'page.evaluate should run the synthesis request');
  assert.deepEqual(evaluateCall[1], {
    content: 'xin chào',
    voiceCode: 'sg_female_tuongvy_call_44k-fhg',
    speed: 1.05,
    wsUrl: SYNTHESIS_WS_URL,
    timeoutMs: 30000
  });
  assert.equal(JSON.stringify(evaluateCall[1]).includes('accessToken'), false);
  assert.equal(JSON.stringify(evaluateCall[1]).includes('Bearer'), false);
  assert.equal(result.audioUrl, 'https://cdn.example/audio.mp3');
  assert.equal(result.requestId, 'req-xyz');
  assert.deepEqual(result.metadata.protocolWarnings, []);
});

test('default requestPreviewSynthesis does not click the editor or type keystrokes', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({
      installTokenCapture: undefined,
      ensureStudioPage: undefined,
      extractSessionToken: undefined,
      requestPreviewSynthesis: undefined
    })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'một đoạn văn dài' });

  const names = page.calls.map(([name]) => name);
  assert.ok(!names.includes('editor.pressSequentially'));
  assert.ok(!names.includes('keyboard.press'));
  assert.ok(!names.includes('previewButton.click'));
  assert.ok(names.includes('evaluate'));
});

test('default requestPreviewSynthesis maps a failed page-context round trip to a job error without token-shaped fields', async () => {
  const page = fakePlaywrightPage({
    evaluateImpl: async () => ({
      ok: false,
      error: 'synthesis-failed',
      accessToken: 'super-secret-jwt-should-never-leak'
    })
  });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ requestPreviewSynthesis: undefined })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    (error) => {
      assert.match(error.message, /preview API request failed \(synthesis-failed\)/);
      assert.equal(error.message.includes('super-secret-jwt-should-never-leak'), false);
      return true;
    }
  );
});

test('redactSensitiveFields replaces token-shaped fields at any depth without touching the rest', () => {
  const input = {
    type: 'SYNTHESIS',
    accessToken: 'super-secret-jwt-should-never-leak',
    payload: {
      text: 'hello',
      headers: { Authorization: 'Bearer super-secret-jwt-should-never-leak' }
    }
  };

  const redacted = redactSensitiveFields(input);

  assert.equal(redacted.accessToken, '[REDACTED]');
  assert.equal(redacted.payload.headers.Authorization, '[REDACTED]');
  assert.equal(redacted.type, 'SYNTHESIS');
  assert.equal(redacted.payload.text, 'hello');
  assert.equal(input.accessToken, 'super-secret-jwt-should-never-leak');
});

test('listVoices degrades to a warning when no voicesUrl is configured', async () => {
  const browserService = fakeBrowserService();
  const adapter = new VbeePreviewAdapter({ browserService, ...noopSteps() });

  const catalog = await adapter.listVoices();

  assert.equal(catalog.ok, true);
  assert.equal(catalog.source, 'vbee-preview');
  assert.deepEqual(catalog.voices, []);
  assert.match(catalog.warning, /VBEE_VOICES_URL/);
  assert.deepEqual(browserService.calls, []);
});

test('listVoices fetches the studio catalog in page context and normalizes it', async () => {
  const page = fakePlaywrightPage({
    evaluateImpl: async () => ({
      ok: true,
      data: {
        result: {
          voices: [
            { voice_code: 'hn_female_ngochuyen_full_48k-fhg', voice_name: 'Ngọc Huyền', gender: 'female' },
            { voice_code: 'my_personal_voice', voice_name: 'Giọng tôi', is_personal: true }
          ]
        }
      }
    })
  });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    voicesUrl: 'https://studio.vbee.vn/api/catalog/voices',
    ...noopSteps()
  });

  const catalog = await adapter.listVoices();

  assert.equal(catalog.ok, true);
  assert.equal(catalog.source, 'vbee-preview');
  assert.ok(catalog.fetchedAt);
  assert.equal(catalog.warning, null);
  assert.equal(catalog.voices.length, 2);
  assert.equal(catalog.voices[0].code, 'hn_female_ngochuyen_full_48k-fhg');
  assert.equal(catalog.voices[0].ownership, 'vbee');
  assert.equal(catalog.voices[1].ownership, 'personal');

  const evaluateCall = page.calls.find(([name]) => name === 'evaluate');
  assert.ok(evaluateCall, 'catalog fetch should run through page.evaluate');
  assert.equal(JSON.stringify(evaluateCall[1]).includes('Bearer'), false);
  assert.equal(JSON.stringify(evaluateCall[1]).includes('accessToken'), false);
});

test('listVoices caches the catalog across calls within the TTL', async () => {
  const page = fakePlaywrightPage({
    evaluateImpl: async () => ({ ok: true, data: { voices: [{ voice_code: 'a-voice', voice_name: 'A' }] } })
  });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    voicesUrl: 'https://studio.vbee.vn/api/catalog/voices',
    ...noopSteps()
  });

  await adapter.listVoices();
  await adapter.listVoices();

  const evaluateCount = page.calls.filter(([name]) => name === 'evaluate').length;
  assert.equal(evaluateCount, 1);
});

test('listVoices degrades to a warning, not a throw, when the studio session fails', async () => {
  const browserService = fakeBrowserService();
  const adapter = new VbeePreviewAdapter({
    browserService,
    voicesUrl: 'https://studio.vbee.vn/api/catalog/voices',
    ...noopSteps({
      extractSessionToken: async () => {
        throw new Error('session token missing');
      }
    })
  });

  const catalog = await adapter.listVoices();

  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.voices, []);
  assert.match(catalog.warning, /voice catalog unavailable/);
});

test('listVoices maps a failed catalog request to a warning with no voices', async () => {
  const page = fakePlaywrightPage({ evaluateImpl: async () => ({ ok: false, error: 'http-500' }) });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    voicesUrl: 'https://studio.vbee.vn/api/catalog/voices',
    ...noopSteps()
  });

  const catalog = await adapter.listVoices();

  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.voices, []);
  assert.match(catalog.warning, /http-500/);
});
