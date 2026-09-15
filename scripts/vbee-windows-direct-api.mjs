#!/usr/bin/env node
/**
 * Live probe for the current Windows Brave session (M2_020).
 *
 * Production worker target is Linux (VbeePreviewAdapter in Gateway). This
 * CLI is not that worker. Today the logged-in studio tab is on Windows, so
 * the probe has to attach to Windows CDP to prove token capture + SYNTHESIS
 * before the Linux worker machine exists.
 *
 * Reuses VbeePreviewAdapter: hook Authorization on the page, reload studio,
 * then page.evaluate() INIT/SYNTHESIS. The raw token never prints and never
 * leaves the page.
 *
 * Usage (cmd.exe / PowerShell, because today's Brave is on Windows):
 *
 *   scripts\vbee-windows-direct-api.bat --probe
 *   scripts\vbee-windows-direct-api.bat --text "xin chao" --voice hn-female-1
 *
 * Brave must already be running with --remote-debugging-port=9222 and a
 * logged-in studio.vbee.vn tab.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VbeePreviewAdapter, redactSensitiveFields } from '../gateway/src/vbee/adapters/vbee-preview.js';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

export function parseArgs(argv) {
  const args = {
    probe: false,
    force: false,
    help: false,
    text: '',
    voice: process.env.VBEE_VOICE_CODE || 'hn-female-1',
    speed: Number(process.env.VBEE_SPEED || 1.05),
    cdpUrl: process.env.CDP_URL || DEFAULT_CDP_URL
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };

    if (token === '--probe') args.probe = true;
    else if (token === '--force') args.force = true;
    else if (token === '--help' || token === '-h') args.help = true;
    else if (token === '--text') args.text = String(next() || '');
    else if (token === '--voice') args.voice = String(next() || args.voice);
    else if (token === '--speed') args.speed = Number(next());
    else if (token === '--cdp') args.cdpUrl = String(next() || args.cdpUrl);
    else throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(args.speed) || args.speed <= 0) {
    throw new Error('--speed must be a positive number');
  }

  args.mode = args.text ? 'synthesize' : 'probe';
  if (args.probe && args.text) args.mode = 'synthesize';
  return args;
}

export function helpText() {
  return `Live probe against the current Windows Brave session.
Production worker is the Linux Gateway adapter (VbeePreviewAdapter), not this CLI.

  node scripts\\vbee-windows-direct-api.mjs --probe
  node scripts\\vbee-windows-direct-api.mjs --text "xin chao" --voice <voice_code>

Run with Windows Node only because today's logged-in browser is on Windows.

Options:
  --probe          Capture session token only (boolean). Default if --text is omitted.
  --text <string>  Send SYNTHESIS for this text instead of typing into the editor.
  --voice <code>   Vbee voice_code (default: hn-female-1 or VBEE_VOICE_CODE).
  --speed <n>      Speaking speed (default: 1.05).
  --cdp <url>      CDP URL (default: http://127.0.0.1:9222 or CDP_URL).
  --force          Allow running on non-Windows (debug only).
  -h, --help       Show this help.

Never prints tokens, cookies, or Authorization headers.`;
}

export function assertWindowsHost({ platform = process.platform, force = false } = {}) {
  if (platform === 'win32' || force) return;
  const error = new Error('This probe attaches to today\'s Windows Brave CDP. The Linux Gateway worker is the production path; for this live probe use scripts\\vbee-windows-direct-api.bat from cmd.exe or PowerShell.');
  error.exitCode = 2;
  throw error;
}

export function sanitizeResult(result) {
  const safe = redactSensitiveFields(result && typeof result === 'object' ? result : {});
  return {
    ok: Boolean(safe.ok),
    mode: safe.mode || null,
    platform: safe.platform || null,
    cdpUrl: safe.cdpUrl || null,
    pageUrlHost: safe.pageUrlHost || null,
    tokenCaptured: Boolean(safe.tokenCaptured),
    audioUrl: safe.audioUrl || null,
    requestId: safe.requestId || null,
    protocolWarnings: Array.isArray(safe.protocolWarnings) ? safe.protocolWarnings : []
  };
}

async function connectCdpPage(cdpUrl) {
  const { chromium } = await import('playwright').catch(() => {
    throw new Error('playwright is not installed in this repo. From the project root: npm install');
  });

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    throw new Error(`Cannot connect to ${cdpUrl}. Start Brave with --remote-debugging-port=9222 and log into studio.vbee.vn. (${error.message})`);
  }

  const context = browser.contexts()[0] || await browser.newContext();
  let page = context.pages().find((candidate) => isStudioUrl(candidate.url()))
    || context.pages()[0];
  if (!page) page = await context.newPage();

  return { browser, page };
}

function isStudioUrl(url) {
  try {
    return new URL(url).hostname.endsWith('vbee.vn');
  } catch {
    return false;
  }
}

function pageHost(page) {
  try {
    return new URL(page.url()).host;
  } catch {
    return null;
  }
}

async function run(args) {
  assertWindowsHost({ force: args.force });

  const { browser, page } = await connectCdpPage(args.cdpUrl);
  try {
    const browserService = {
      async withPage(fn) {
        return fn(page);
      }
    };

    const adapter = new VbeePreviewAdapter({
      browserService,
      requestPreviewSynthesis: args.mode === 'probe'
        ? async () => ({
          audioUrl: null,
          requestId: 'probe',
          format: 'mp3',
          protocolWarnings: []
        })
        : undefined
    });

    const job = {
      id: `windows-cli-${Date.now()}`,
      content: args.text || 'probe',
      voice_code: args.voice,
      speed: args.speed
    };

    const synthesis = await adapter.synthesize(job);
    return sanitizeResult({
      ok: true,
      mode: args.mode,
      platform: process.platform,
      cdpUrl: args.cdpUrl,
      pageUrlHost: pageHost(page),
      tokenCaptured: true,
      audioUrl: synthesis.audioUrl,
      requestId: synthesis.requestId,
      protocolWarnings: synthesis.metadata?.protocolWarnings || []
    });
  } finally {
    // connectOverCDP: close() disconnects Playwright, it does not quit Brave.
    try { await browser.close(); } catch { /* already gone */ }
  }
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(helpText());
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(helpText());
    return;
  }

  try {
    const result = await run(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    console.error(JSON.stringify({
      ok: false,
      error: message
    }, null, 2));
    process.exitCode = error.exitCode || 1;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(import.meta.url)).toLowerCase()
    === path.resolve(process.argv[1]).toLowerCase();
}

if (isDirectRun()) {
  await main();
}
