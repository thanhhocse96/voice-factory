import { VbeePreviewProtocolRecorder } from '../protocol/preview-recorder.js';

const VBEE_STUDIO_URL = 'https://studio.vbee.vn';

// Placeholder for design/07's "action 4-10s random" step timing.
// Full human-pace scheduler is M5 - not built here.
const PREVIEW_ACTION_DELAY_MS = 6000;

// Resolved from a live session on 2026-09-09 (studio.vbee.vn/studio/text-to-speech).
// The editor is a Draft.js contenteditable (not a plain textarea/input).
const EDITOR_SELECTOR = '#editor-wrapper [contenteditable="true"]';
const PREVIEW_BUTTON_SELECTOR = '#try-listening';
const LOGIN_REDIRECT_PATTERN = /auth\.vbee\.vn\/login/i;

// How long ensureStudioPage polls for either the restore-content dialog or a
// hydrated #try-listening after reload()/goto() (confirmed live, M2_011: the
// dialog's own render can lag well behind the browser's load event).
const STUDIO_READY_TIMEOUT_MS = 15000;
const STUDIO_READY_POLL_MS = 500;

// The preview flow opens its own WebSocket (observed: wss://vbee.vn/api/v1/synthesis/demo)
// as a side effect of clicking the preview button. The audio URL arrives as
// result.audio_link on a server SYNTHESIS frame with result.status === 'SUCCESS' -
// there is no separate fetch step.
const SYNTHESIS_WS_PATTERN = /synthesis\/demo/;
const PREVIEW_CAPTURE_TIMEOUT_MS = 30000;

export class VbeePreviewAdapter {
  constructor({
    browserService,
    ensureStudioPage = defaultEnsureStudioPage,
    extractSessionToken = defaultExtractSessionToken,
    locateEditor = defaultLocateEditor,
    injectPreviewText = defaultInjectPreviewText,
    triggerPreview = defaultTriggerPreview,
    capturePreviewAudioUrl = defaultCapturePreviewAudioUrl,
    actionDelayMs = PREVIEW_ACTION_DELAY_MS
  } = {}) {
    if (!browserService) {
      throw new Error('VbeePreviewAdapter requires a browserService');
    }
    this.browserService = browserService;
    this.steps = {
      ensureStudioPage,
      extractSessionToken,
      locateEditor,
      injectPreviewText,
      triggerPreview,
      capturePreviewAudioUrl
    };
    this.actionDelayMs = actionDelayMs;
  }

  async synthesize(job) {
    return this.browserService.withPage((page) => this.#runPreviewFlow(page, job));
  }

  async #runPreviewFlow(page, job) {
    await this.steps.ensureStudioPage(page);
    await this.steps.extractSessionToken(page);

    const editor = await this.steps.locateEditor(page);
    await this.steps.injectPreviewText(editor, job.content);

    await delay(this.actionDelayMs);

    // capturePreviewAudioUrl must be invoked (armed) before triggerPreview's click:
    // the preview WebSocket opens as a side effect of that click, and a listener
    // attached afterward can miss it entirely. Calling an async function starts it
    // synchronously up to its first await, so this ordering is enough - we still
    // await the click and the capture separately, not one after the other.
    const recorder = new VbeePreviewProtocolRecorder();
    const capturePromise = this.steps.capturePreviewAudioUrl(page, recorder);
    await this.steps.triggerPreview(page);
    const capture = await capturePromise;

    return {
      provider: 'vbee',
      requestId: capture.requestId || `vbee-preview-${job.id}`,
      audioUrl: capture.audioUrl || null,
      localAudioPath: capture.localAudioPath || null,
      metadata: {
        voiceCode: job.voice_code,
        executionMode: 'vbee_preview_download',
        format: capture.format || 'mp3',
        protocolWarnings: capture.protocolWarnings || []
      }
    };
  }
}

async function defaultEnsureStudioPage(page) {
  // Always reload, even when already on the studio page: a finished job can
  // leave residual UI open (an audio preview player docked at the bottom)
  // that silently stalls the next job's typing (confirmed live, M2_010). An
  // earlier attempt at this reverted because a fresh navigation can land
  // Vbee's own responsive routing on /m/... on a narrow window - that risk is
  // still open (see M2_010/M2_011's Known Limits), not fixed by this change.
  const currentUrl = page.url();
  if (currentUrl.startsWith(VBEE_STUDIO_URL)) {
    await clearEditorBeforeReload(page);
    await page.reload();
  } else {
    await page.goto(VBEE_STUDIO_URL);
  }

  // Reloading/navigating can trigger a "restore previous content?" dialog
  // (confirmed live, M2_011 - real markup carries data-id="reload-prev-session"
  // / "not-reload-prev-session"). Agree to it: injectPreviewText clears the
  // editor with its own Control+A/Delete before typing new content regardless
  // of what got restored, so which choice is made here does not matter beyond
  // getting the dialog out of the way.
  //
  // Polls for either signal rather than one fixed-window wait: confirmed live
  // that the dialog can render several seconds *after* reload()/goto() already
  // resolved (it depends on the React app's own post-load init, not the
  // browser's load event), so a wait that starts too early can end right
  // before the dialog appears - and then a later, separate wait for the
  // button just sees the now-visible dialog block it for that entire window
  // too. A single loop watching both avoids that gap.
  const restoreDialogButton = page.locator('[data-id="reload-prev-session"]');
  const previewButton = page.locator(PREVIEW_BUTTON_SELECTOR);
  const deadline = Date.now() + STUDIO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await restoreDialogButton.count()) {
      await restoreDialogButton.click();
      break;
    }
    if (await previewButton.count()) break; // hydrated already, no dialog appeared
    await page.waitForTimeout(STUDIO_READY_POLL_MS);
  }
}

// Tried (user's proposal, 2026-09-09) on the theory that the restore dialog only has
// something to offer because the previous job left text sitting in the editor, so
// clearing it here, right before reload, would leave nothing to prompt about. Live
// diagnostic logging disproved that: the dialog still appeared immediately after this
// ran and successfully cleared the editor. Most likely Vbee already autosaves/persists
// the draft on its own debounce sometime during the *previous* job's typing, well
// before this function runs on the *next* job - by the time we clear it here, the
// dialog's trigger has already been captured elsewhere. Kept anyway as a harmless,
// zero-cost step (it does successfully empty the editor, which is never wrong to do
// before a reload) - but the restore-dialog polling below is what actually makes this
// reliable, not this function. Do not extend this into a real fix without new live
// evidence (e.g. a wait between clearing and reloading, to test the debounce theory).
async function clearEditorBeforeReload(page) {
  const editor = page.locator(EDITOR_SELECTOR);
  if (!(await editor.count())) return;
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
}

// Resolved via a live human-supervised session (docs/design/08 C.4). Token-related
// steps are presence/validity checks only - never return or log the raw token/cookie
// value (hard invariant: no credentials/JWT in Gateway/JobRunner/UI/logs). This is
// also enforced structurally here, not just by convention: Vbee's session cookie is
// httpOnly (confirmed live - absent from document.cookie/localStorage/sessionStorage),
// so page-JS-based code has no way to read the raw value even if it tried. The
// WebSocket protocol frames do carry an accessToken field on every client message
// (confirmed live) - capturePreviewAudioUrl below redacts it before it ever reaches
// the protocol recorder, so it never sits in memory unredacted either.

async function defaultExtractSessionToken(page) {
  if (LOGIN_REDIRECT_PATTERN.test(page.url())) {
    throw new Error('Vbee session not authenticated - redirected to auth.vbee.vn/login (expired session or bot challenge). Log in manually in the managed Brave window.');
  }
  // Waits rather than an instant count(): confirmed live (M2_011) that right
  // after ensureStudioPage's reload, the React app can still be fetching user
  // state and has not rendered #try-listening yet even though the page itself
  // has finished loading. An instant snapshot check races that hydration.
  try {
    await page.locator(PREVIEW_BUTTON_SELECTOR).waitFor({ state: 'attached', timeout: 10000 });
  } catch {
    throw new Error('Vbee session signal not found (preview control missing) - not logged in, still loading, or studio UI changed');
  }
}

async function defaultLocateEditor(page) {
  const editor = page.locator(EDITOR_SELECTOR);
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  return editor;
}

async function defaultInjectPreviewText(editor, content) {
  // Draft.js keeps its own EditorState mirroring the DOM; setting textContent/value
  // directly does not sync it (Draft.js ignores or reverts the change). Only real
  // input events (keyboard or execCommand) are observed by its change handlers, so
  // this drives real keystrokes rather than fill()/evaluate().
  await editor.click();
  const page = editor.page();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await editor.pressSequentially(content, { delay: 20 });
}

async function defaultTriggerPreview(page) {
  // Confirmed live (2026-09-09): #try-listening stays disabled after programmatic
  // text injection alone, across every injection method tried (see M2_009). The
  // gate is not Draft.js change-detection - it is that the editor's content must
  // be actively selected. Re-selecting it here is what actually enables the button.
  await page.keyboard.press('Control+A');
  await page.locator(PREVIEW_BUTTON_SELECTOR).click();
}

async function defaultCapturePreviewAudioUrl(page, recorder) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeSocket = null;

    const timeout = setTimeout(() => {
      finish(() => reject(new Error('capturePreviewAudioUrl timed out waiting for a SYNTHESIS SUCCESS frame')));
    }, PREVIEW_CAPTURE_TIMEOUT_MS);

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      page.off('websocket', onWebSocket);
      if (activeSocket) {
        activeSocket.off('framesent', onFrameSent);
        activeSocket.off('framereceived', onFrameReceived);
      }
      action();
    }

    function parseFrame(payload) {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8');
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    function onFrameSent({ payload }) {
      const parsed = parseFrame(payload);
      if (!parsed || parsed.type === 'PING' || parsed.type === 'PONG') return;
      recorder.record({ direction: 'client', type: parsed.type, payload: redactSensitiveFields(parsed) });
    }

    function onFrameReceived({ payload }) {
      const parsed = parseFrame(payload);
      if (!parsed || parsed.type === 'PING' || parsed.type === 'PONG') return;

      const semanticStatus = (parsed.result && parsed.result.status) || parsed.status || null;
      recorder.record({ direction: 'server', type: parsed.type, status: semanticStatus, payload: parsed });

      if (parsed.type === 'SYNTHESIS' && parsed.result && parsed.result.status === 'SUCCESS' && parsed.result.audio_link) {
        const verification = recorder.verifyExpectedPreviewSequence();
        finish(() => resolve({
          audioUrl: parsed.result.audio_link,
          requestId: parsed.result.request_id,
          format: 'mp3',
          protocolWarnings: verification.ok
            ? []
            : verification.missing.map((m) => `missing ${m.direction} ${m.type}${m.status ? ` (${m.status})` : ''}`)
        }));
      }
    }

    function onWebSocket(ws) {
      if (!SYNTHESIS_WS_PATTERN.test(ws.url())) return;
      activeSocket = ws;
      ws.on('framesent', onFrameSent);
      ws.on('framereceived', onFrameReceived);
    }

    page.on('websocket', onWebSocket);
  });
}

// Defense in depth beyond the httpOnly cookie: every client frame on the synthesis
// WebSocket carries a plaintext accessToken field (confirmed live). Strip it before
// the frame ever reaches the protocol recorder, so even an in-memory dump of
// recorder.snapshot() can't surface it.
export function redactSensitiveFields(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = Array.isArray(value) ? [...value] : { ...value };
  for (const key of Object.keys(clone)) {
    if (/token|auth|secret|password/i.test(key)) {
      clone[key] = '[REDACTED]';
    } else if (clone[key] && typeof clone[key] === 'object') {
      clone[key] = redactSensitiveFields(clone[key]);
    }
  }
  return clone;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
