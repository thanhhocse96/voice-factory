import { VbeePreviewProtocolRecorder } from '../protocol/preview-recorder.js';
import { extractVoicesArray, normalizeVoices } from '../catalog/voice-catalog.js';

const VBEE_STUDIO_URL = 'https://studio.vbee.vn';
const LOGIN_REDIRECT_PATTERN = /auth\.vbee\.vn\/login/i;
const PREVIEW_BUTTON_SELECTOR = '#try-listening';
const SYNTHESIS_WS_URL = 'wss://vbee.vn/api/v1/synthesis/demo';
const PREVIEW_CAPTURE_TIMEOUT_MS = 30000;
const TOKEN_CAPTURE_TIMEOUT_MS = 10000;
const CATALOG_FETCH_TIMEOUT_MS = 15000;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

const STUDIO_READY_TIMEOUT_MS = 15000;
const STUDIO_READY_POLL_MS = 500;

export class VbeePreviewAdapter {
  constructor({
    browserService,
    installTokenCapture = defaultInstallTokenCapture,
    ensureStudioPage = defaultEnsureStudioPage,
    extractSessionToken = defaultExtractSessionToken,
    requestPreviewSynthesis = defaultRequestPreviewSynthesis,
    fetchCatalogFromPage = defaultFetchCatalogFromPage,
    voicesUrl = '',
    catalogArrayField = '',
    catalogCacheTtlMs = CATALOG_CACHE_TTL_MS,
    actionDelayMs = 0
  } = {}) {
    if (!browserService) {
      throw new Error('VbeePreviewAdapter requires a browserService');
    }
    this.browserService = browserService;
    this.steps = {
      installTokenCapture,
      ensureStudioPage,
      extractSessionToken,
      requestPreviewSynthesis,
      fetchCatalogFromPage
    };
    this.voicesUrl = voicesUrl;
    this.catalogArrayField = catalogArrayField;
    this.catalogCacheTtlMs = catalogCacheTtlMs;
    this.actionDelayMs = actionDelayMs;
    this._catalogCache = null;
    this._catalogCacheAt = 0;
  }

  async synthesize(job) {
    return this.browserService.withPage((page) => this.#runPreviewFlow(page, job));
  }

  async listVoices() {
    if (!this.voicesUrl) {
      return {
        ok: true,
        source: 'vbee-preview',
        fetchedAt: null,
        voices: [],
        warning: 'VBEE_VOICES_URL not configured - voice catalog disabled. Type a voice code manually.'
      };
    }

    const now = Date.now();
    if (this._catalogCache && now - this._catalogCacheAt < this.catalogCacheTtlMs) {
      return this._catalogCache;
    }

    try {
      const catalog = await this.browserService.withPage((page) => this.#fetchCatalog(page));
      this._catalogCache = catalog;
      this._catalogCacheAt = Date.now();
      return catalog;
    } catch {
      return {
        ok: true,
        source: 'vbee-preview',
        fetchedAt: null,
        voices: [],
        warning: 'voice catalog unavailable (session or network)'
      };
    }
  }

  async #fetchCatalog(page) {
    await this.steps.installTokenCapture(page);
    await this.steps.ensureStudioPage(page);
    await this.steps.extractSessionToken(page);

    const result = await this.steps.fetchCatalogFromPage(page, {
      url: this.voicesUrl,
      arrayField: this.catalogArrayField,
      timeoutMs: CATALOG_FETCH_TIMEOUT_MS
    });

    if (!result || !result.ok) {
      return {
        ok: true,
        source: 'vbee-preview',
        fetchedAt: null,
        voices: [],
        warning: `voice catalog request failed (${(result && result.error) || 'unknown'})`
      };
    }

    const raw = extractVoicesArray(result.data, this.catalogArrayField);
    const voices = normalizeVoices(raw, { source: 'vbee-preview' });

    return {
      ok: true,
      source: 'vbee-preview',
      fetchedAt: new Date().toISOString(),
      voices,
      warning: voices.length ? null : 'voice catalog loaded but no voices found'
    };
  }

  async #runPreviewFlow(page, job) {
    // addInitScript must be registered before reload/goto so it can see the
    // studio app's own bootstrap Authorization headers (M2_009).
    await this.steps.installTokenCapture(page);
    await this.steps.ensureStudioPage(page);
    await this.steps.extractSessionToken(page);

    if (this.actionDelayMs) await delay(this.actionDelayMs);

    const recorder = new VbeePreviewProtocolRecorder();
    const capture = await this.steps.requestPreviewSynthesis(page, job, recorder);

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

async function defaultInstallTokenCapture(page) {
  if (typeof page.addInitScript !== 'function') {
    throw new Error('Vbee preview API path requires page.addInitScript (Playwright page)');
  }

  await page.addInitScript(() => {
    if (window.__vbeeTokenCaptureInstalled) return;
    window.__vbeeTokenCaptureInstalled = true;
    window.__vbeeTokenCaptured = false;

    function captureAuth(value) {
      if (typeof value !== 'string') return;
      const match = value.match(/^Bearer\s+(.+)$/i);
      if (!match || !match[1]) return;
      window.__vbeeToken = match[1];
      window.__vbeeTokenCaptured = true;
    }

    function captureFromHeaders(headers) {
      if (!headers) return;
      try {
        if (typeof headers.get === 'function') {
          captureAuth(headers.get('authorization') || headers.get('Authorization'));
          return;
        }
        if (Array.isArray(headers)) {
          for (const entry of headers) {
            if (entry && /^authorization$/i.test(String(entry[0]))) captureAuth(String(entry[1]));
          }
          return;
        }
        for (const key of Object.keys(headers)) {
          if (/^authorization$/i.test(key)) captureAuth(headers[key]);
        }
      } catch {
        // ignore malformed header objects from the page
      }
    }

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (init && init.headers) captureFromHeaders(init.headers);
        if (input && typeof input === 'object' && input.headers) captureFromHeaders(input.headers);
      } catch {
        // keep the original fetch going even if capture fails
      }
      return originalFetch.apply(this, arguments);
    };

    const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
      if (key && /^authorization$/i.test(String(key))) captureAuth(value);
      return originalSetHeader.apply(this, arguments);
    };
  });
}

async function defaultEnsureStudioPage(page) {
  // Reload (or first-time navigate) so installTokenCapture's hook sees the
  // studio app's bootstrap calls. Editor typing is no longer part of this
  // flow, so residual player/editor state does not need clearing.
  const currentUrl = page.url();
  if (currentUrl.startsWith(VBEE_STUDIO_URL)) {
    await page.reload();
  } else {
    await page.goto(VBEE_STUDIO_URL);
  }

  const restoreDialogButton = page.locator('[data-id="reload-prev-session"]');
  const previewButton = page.locator(PREVIEW_BUTTON_SELECTOR);
  const deadline = Date.now() + STUDIO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await restoreDialogButton.count()) {
      await restoreDialogButton.click();
      break;
    }
    if (await previewButton.count()) break;
    await page.waitForTimeout(STUDIO_READY_POLL_MS);
  }
}

async function defaultExtractSessionToken(page) {
  if (LOGIN_REDIRECT_PATTERN.test(page.url())) {
    throw new Error('Vbee session not authenticated - redirected to auth.vbee.vn/login (expired session or bot challenge). Log in manually in the managed Brave window.');
  }

  try {
    await page.locator(PREVIEW_BUTTON_SELECTOR).waitFor({ state: 'attached', timeout: 10000 });
  } catch {
    throw new Error('Vbee session signal not found (preview control missing) - not logged in, still loading, or studio UI changed');
  }

  try {
    await page.waitForFunction(() => window.__vbeeTokenCaptured === true, { timeout: TOKEN_CAPTURE_TIMEOUT_MS });
  } catch {
    throw new Error('Vbee session token was not captured from studio page traffic - login may have expired or the app no longer sends an Authorization header on load');
  }
}

async function defaultRequestPreviewSynthesis(page, job, recorder) {
  const raw = await page.evaluate(async ({ content, voiceCode, speed, wsUrl, timeoutMs }) => {
    function redact(value) {
      if (!value || typeof value !== 'object') return value;
      const clone = Array.isArray(value) ? [...value] : { ...value };
      for (const key of Object.keys(clone)) {
        if (/token|auth|secret|password/i.test(key)) {
          clone[key] = '[REDACTED]';
        } else if (clone[key] && typeof clone[key] === 'object') {
          clone[key] = redact(clone[key]);
        }
      }
      return clone;
    }

    const accessToken = window.__vbeeToken;
    if (!accessToken) {
      return { ok: false, error: 'token-missing', frames: [] };
    }

    return await new Promise((resolve) => {
      const frames = [];
      let settled = false;
      let timeout = null;
      const ws = new WebSocket(wsUrl);

      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {
          // already closed
        }
        resolve({ ...value, frames });
      }

      timeout = setTimeout(() => {
        finish({ ok: false, error: 'timeout' });
      }, timeoutMs);

      function record(direction, parsed) {
        const semanticStatus = (parsed.result && parsed.result.status) || parsed.status || null;
        frames.push({
          direction,
          type: parsed.type,
          status: semanticStatus,
          payload: redact(parsed)
        });
      }

      ws.onopen = () => {
        const initFrame = { type: 'INIT', accessToken };
        record('client', initFrame);
        ws.send(JSON.stringify(initFrame));
      };

      ws.onerror = () => finish({ ok: false, error: 'ws-error' });

      ws.onmessage = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
        } catch {
          return;
        }
        if (!parsed || parsed.type === 'PING' || parsed.type === 'PONG') return;

        record('server', parsed);

        if (parsed.type === 'INIT' && parsed.status === 1) {
          const synthesisFrame = {
            type: 'SYNTHESIS',
            accessToken,
            payload: {
              text: content,
              voice_code: voiceCode,
              speed
            }
          };
          record('client', synthesisFrame);
          ws.send(JSON.stringify(synthesisFrame));
          return;
        }

        if (parsed.type === 'SYNTHESIS' && parsed.result && parsed.result.status === 'SUCCESS' && parsed.result.audio_link) {
          finish({
            ok: true,
            audioUrl: parsed.result.audio_link,
            requestId: parsed.result.request_id || null
          });
          return;
        }

        if (parsed.type === 'SYNTHESIS' && parsed.result && parsed.result.status === 'FAILED') {
          finish({ ok: false, error: 'synthesis-failed' });
        }
      };
    });
  }, {
    content: job.content,
    voiceCode: job.voice_code,
    speed: job.speed ?? 1.05,
    wsUrl: SYNTHESIS_WS_URL,
    timeoutMs: PREVIEW_CAPTURE_TIMEOUT_MS
  });

  const result = redactSensitiveFields(raw || {});
  if (recorder && Array.isArray(result.frames)) {
    for (const frame of result.frames) {
      if (!frame || typeof frame !== 'object') continue;
      recorder.record(redactSensitiveFields(frame));
    }
  }

  if (!result.ok) {
    throw new Error(`Vbee preview API request failed (${result.error || 'unknown'})`);
  }

  const verification = recorder
    ? recorder.verifyExpectedPreviewSequence()
    : { ok: true, missing: [] };

  return {
    audioUrl: result.audioUrl || null,
    requestId: result.requestId || null,
    format: 'mp3',
    protocolWarnings: verification.ok
      ? []
      : verification.missing.map((m) => `missing ${m.direction} ${m.type}${m.status ? ` (${m.status})` : ''}`)
  };
}

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

async function defaultFetchCatalogFromPage(page, { url } = {}) {
  const result = await page.evaluate(async ({ reqUrl, timeoutMs }) => {
    const accessToken = window.__vbeeToken;
    if (!accessToken) {
      return { ok: false, error: 'token-missing' };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => controller && controller.abort(), timeoutMs);

    try {
      const res = await fetch(reqUrl, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) return { ok: false, error: `http-${res.status}` };
      const data = await res.json();
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'network' };
    } finally {
      clearTimeout(timeout);
    }
  }, { reqUrl: url, timeoutMs: CATALOG_FETCH_TIMEOUT_MS });

  return result && result.ok ? { ...result, data: redactSensitiveFields(result.data) } : result;
}
