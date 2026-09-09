import test from 'node:test';
import assert from 'node:assert/strict';
import { VbeePreviewAdapter, redactSensitiveFields } from './vbee-preview.js';

// Selectors/URLs resolved from a live studio.vbee.vn session (see vbee-preview.js).
// Hardcoded here (not imported) so a drift in the source constants fails this test -
// that is the point: it locks the real contract we verified live.
const EDITOR_SELECTOR = '#editor-wrapper [contenteditable="true"]';
const PREVIEW_BUTTON_SELECTOR = '#try-listening';
const SYNTHESIS_WS_URL = 'wss://vbee.vn/api/v1/synthesis/demo';

function noopSteps(overrides = {}) {
  return {
    ensureStudioPage: async () => {},
    extractSessionToken: async () => {},
    locateEditor: async () => 'fake-editor-handle',
    injectPreviewText: async () => {},
    triggerPreview: async () => {},
    capturePreviewAudioUrl: async () => ({
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

// Minimal duck-typed event emitter matching the on/off/emit surface Playwright's
// Page and WebSocket objects expose - no real Playwright involved, matching this
// repo's constructor-injection test convention.
function fakeEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    off(event, handler) {
      const arr = listeners.get(event);
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx !== -1) arr.splice(idx, 1);
    },
    emit(event, payload) {
      for (const handler of (listeners.get(event) || [])) handler(payload);
    },
    listenerCount(event) {
      return (listeners.get(event) || []).length;
    }
  };
}

function fakeWebSocket(url) {
  const emitter = fakeEmitter();
  return {
    url: () => url,
    on: emitter.on,
    off: emitter.off,
    emitFrame(event, data) {
      emitter.emit(event, { payload: JSON.stringify(data) });
    }
  };
}

const RESTORE_DIALOG_SELECTOR = '[data-id="reload-prev-session"]';

function fakePlaywrightPage({
  url = 'https://studio.vbee.vn/studio/text-to-speech',
  hasPreviewButton = true,
  hasRestoreDialog = false,
  hasEditor = true
} = {}) {
  const calls = [];
  const emitter = fakeEmitter();
  let resolveWebSocketArmed;
  const whenWebSocketArmed = new Promise((resolve) => { resolveWebSocketArmed = resolve; });

  const editorLocator = {
    count: async () => (hasEditor ? 1 : 0),
    waitFor: async (opts) => { calls.push(['editor.waitFor', opts]); },
    click: async () => { calls.push(['editor.click']); },
    pressSequentially: async (text, opts) => { calls.push(['editor.pressSequentially', text, opts]); },
    page: () => page
  };

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
    keyboard: {
      press: async (key) => { calls.push(['keyboard.press', key]); }
    },
    locator: (selector) => {
      calls.push(['locator', selector]);
      if (selector === EDITOR_SELECTOR) return editorLocator;
      if (selector === PREVIEW_BUTTON_SELECTOR) return previewButtonLocator;
      if (selector === RESTORE_DIALOG_SELECTOR) return restoreDialogLocator;
      throw new Error(`unexpected selector: ${selector}`);
    },
    on(event, handler) {
      emitter.on(event, handler);
      if (event === 'websocket') resolveWebSocketArmed();
    },
    off: emitter.off,
    emit: emitter.emit,
    whenWebSocketArmed
  };
  return page;
}

const VBEE_STUDIO_URL_STUB = 'https://studio.vbee.vn/';

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
      locateEditor: async () => {
        throw new Error('editor not found');
      }
    })
  });

  await assert.rejects(
    () => adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' }),
    /editor not found/
  );
});

test('VbeePreviewAdapter requires a browserService', () => {
  assert.throws(() => new VbeePreviewAdapter({}), /browserService/);
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
  assert.ok(!page.calls.some(([name]) => name === 'editor.click'), 'nothing to clear on a fresh navigation');
});

test('default ensureStudioPage clears the editor before reloading, to keep the restore dialog from having anything to offer', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech' });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  // Order matters: clearing has to happen before reload, not after.
  const relevantCalls = page.calls.filter(
    ([name]) => name === 'editor.click' || name === 'keyboard.press' || name === 'reload'
  );
  assert.deepEqual(relevantCalls, [
    ['editor.click'],
    ['keyboard.press', 'Control+A'],
    ['keyboard.press', 'Delete'],
    ['reload']
  ]);
});

test('default ensureStudioPage skips clearing when no editor is present before reload', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech', hasEditor: false });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ ensureStudioPage: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.ok(!page.calls.some(([name]) => name === 'editor.click'));
  assert.ok(page.calls.some(([name]) => name === 'reload'), 'reload still proceeds without an editor to clear');
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

test('default extractSessionToken passes when on studio with the preview control present', async () => {
  const page = fakePlaywrightPage({ url: 'https://studio.vbee.vn/studio/text-to-speech', hasPreviewButton: true });
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ extractSessionToken: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });
  assert.ok(page.calls.some(([name]) => name === 'locator'));
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

test('default locateEditor waits for the Draft.js editor and hands it to injectPreviewText', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  let receivedEditor = null;
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({
      locateEditor: undefined,
      injectPreviewText: async (editor) => { receivedEditor = editor; }
    })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  assert.deepEqual(page.calls[0], ['locator', EDITOR_SELECTOR]);
  assert.ok(page.calls.some(([name]) => name === 'editor.waitFor'));
  assert.ok(receivedEditor, 'editor handle should be passed through to injectPreviewText');
});

test('default injectPreviewText clears the editor then types the content as real keystrokes', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ locateEditor: undefined, injectPreviewText: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'xin chào' });

  const names = page.calls.map(([name]) => name);
  assert.ok(names.includes('editor.click'));
  assert.deepEqual(
    page.calls.filter(([name]) => name === 'keyboard.press').map((c) => c[1]),
    ['Control+A', 'Delete']
  );
  const pressSequentially = page.calls.find(([name]) => name === 'editor.pressSequentially');
  assert.equal(pressSequentially[1], 'xin chào');
});

test('default triggerPreview selects the editor content, then clicks the preview button', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ triggerPreview: undefined })
  });

  await adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });

  // Order matters: selecting is what enables the button, so it must happen
  // before the click, not just at some point during the step.
  const relevantCalls = page.calls.filter(
    ([name]) => name === 'keyboard.press' || name === 'locator' || name === 'previewButton.click'
  );
  assert.deepEqual(relevantCalls, [
    ['keyboard.press', 'Control+A'],
    ['locator', PREVIEW_BUTTON_SELECTOR],
    ['previewButton.click']
  ]);
});

// --- capturePreviewAudioUrl: driven by simulated WebSocket frames, shaped exactly
// like the real traffic captured live from studio.vbee.vn on 2026-09-09. ---

async function runCaptureScenario(page, driveWebSocket) {
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ capturePreviewAudioUrl: undefined })
  });

  const resultPromise = adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });
  await page.whenWebSocketArmed;
  const ws = fakeWebSocket(SYNTHESIS_WS_URL);
  page.emit('websocket', ws);
  await driveWebSocket(ws);
  return resultPromise;
}

test('default capturePreviewAudioUrl resolves with audio_link from the SYNTHESIS SUCCESS frame', async () => {
  const page = fakePlaywrightPage();
  const result = await runCaptureScenario(page, async (ws) => {
    // Full sequence matching a real live capture, so protocolWarnings comes back
    // clean (GET_REMAINING_PREVIEW deliberately excluded - see preview-recorder.js).
    ws.emitFrame('framesent', { type: 'INIT', accessToken: 'super-secret-jwt-should-never-leak' });
    ws.emitFrame('framereceived', { type: 'INIT', status: 1 });
    ws.emitFrame('framesent', { type: 'PING' });
    ws.emitFrame('framereceived', { type: 'PONG' });
    ws.emitFrame('framesent', { type: 'SYNTHESIS', payload: { text: 'hi' }, accessToken: 'super-secret-jwt-should-never-leak' });
    ws.emitFrame('framereceived', {
      type: 'SYNTHESIS',
      status: 1,
      result: { status: 'IN_PROGRESS', request_id: 'req-xyz' }
    });
    ws.emitFrame('framereceived', {
      type: 'SYNTHESIS',
      status: 1,
      result: { request_id: 'req-xyz', status: 'SUCCESS', audio_link: 'https://cdn.example/audio.mp3' }
    });
  });

  assert.equal(result.audioUrl, 'https://cdn.example/audio.mp3');
  assert.equal(result.requestId, 'req-xyz');
  assert.equal(result.metadata.format, 'mp3');
  assert.deepEqual(result.metadata.protocolWarnings, []);
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
  // Original object must be left untouched.
  assert.equal(input.accessToken, 'super-secret-jwt-should-never-leak');
});

test('default capturePreviewAudioUrl ignores a websocket that does not match the synthesis URL pattern', async () => {
  const page = fakePlaywrightPage();
  const browserService = fakeBrowserService(page);
  const adapter = new VbeePreviewAdapter({
    browserService,
    actionDelayMs: 0,
    ...noopSteps({ capturePreviewAudioUrl: undefined })
  });

  const resultPromise = adapter.synthesize({ id: 'job-1', voice_code: 'x', content: 'hi' });
  await page.whenWebSocketArmed;

  const unrelated = fakeWebSocket('wss://vbee.vn/api/v1/some-other-channel');
  page.emit('websocket', unrelated);
  unrelated.emitFrame('framereceived', {
    type: 'SYNTHESIS', status: 1, result: { status: 'SUCCESS', audio_link: 'https://cdn.example/wrong.mp3' }
  });

  const real = fakeWebSocket(SYNTHESIS_WS_URL);
  page.emit('websocket', real);
  real.emitFrame('framereceived', {
    type: 'SYNTHESIS', status: 1, result: { request_id: 'req-real', status: 'SUCCESS', audio_link: 'https://cdn.example/right.mp3' }
  });

  const result = await resultPromise;
  assert.equal(result.audioUrl, 'https://cdn.example/right.mp3');
});
