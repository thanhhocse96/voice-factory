#!/usr/bin/env node
/**
 * Browser lifecycle manager for VoiceFactory (M2+).
 * Mirrors gateway-lifecycle.mjs pattern.
 * Supports start/status/stop/close for headed Brave/Chromium with CDP.
 *
 * Usage: node scripts/browser-lifecycle.mjs <start|status|stop|close>
 *
 * Cross-platform notes:
 * - On Windows: spawns brave.exe directly.
 * - On WSL: attempts to launch via Windows host (powershell.exe Start-Process).
 * - Profile in .local/runtime/brave-profile or env BROWSER_PROFILE_DIR.
 * - Default CDP 9222, opens to studio.vbee.vn for login.
 *
 * Does not require Playwright (CDP HTTP for check, native WebSocket for
 * graceful close on Node >= 22).
 * Stealth flags included for Vbee.
 */

import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(rootDir, '.local', 'runtime');
const statePath = path.join(runtimeDir, 'browser-lifecycle.json');

const config = {
  cdpHost: process.env.BROWSER_CDP_HOST || '127.0.0.1',
  cdpPort: Number(process.env.CDP_PORT || process.env.BROWSER_CDP_PORT || 9222),
  healthTimeoutMs: Number(process.env.BROWSER_HEALTH_TIMEOUT_MS || 2000),
  startupTimeoutMs: Number(process.env.BROWSER_STARTUP_TIMEOUT_MS || 15000),
  gracefulCloseTimeoutMs: Number(process.env.BROWSER_GRACEFUL_CLOSE_TIMEOUT_MS || 8000),
  cdpCloseTimeoutMs: Number(process.env.BROWSER_CDP_CLOSE_TIMEOUT_MS || 2000),
  profileDir: process.env.BROWSER_PROFILE_DIR || path.join(runtimeDir, 'brave-profile'),
  targetUrl: process.env.BROWSER_TARGET_URL || 'https://studio.vbee.vn',
  // Brave on Windows typical path; override with BROWSER_PATH
  browserPath: process.env.BROWSER_PATH || (process.platform === 'win32'
    ? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    : '/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe') // WSL common
};

const command = process.argv[2] || 'status';

try {
  if (command === 'start') {
    await start();
  } else if (command === 'status') {
    await status();
  } else if (command === 'stop') {
    await stop();
  } else if (command === 'close') {
    await close();
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: node scripts/browser-lifecycle.mjs <start|status|stop|close>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
}

async function start() {
  const health = await getCdpHealth();
  if (health.ok) {
    await writeState({
      mode: 'external-or-existing',
      pid: null,
      cdpUrl: cdpUrl(),
      startedAt: new Date().toISOString()
    });
    return print({
      ok: true,
      action: 'already_running',
      cdpUrl: cdpUrl(),
      health
    });
  }

  // Ensure profile
  await fs.mkdir(config.profileDir, { recursive: true });

  // Check port before spawn (basic)
  const portInUse = await isPortOpen(config.cdpHost, config.cdpPort);
  if (portInUse) {
    return print({
      ok: false,
      action: 'port_occupied',
      cdpUrl: cdpUrl(),
      error: `Port ${config.cdpPort} in use but CDP health failed`
    });
  }

  const browserExe = getBrowserCommand();
  const baseArgs = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.profileDir}`,
    '--disable-blink-features=AutomationControlled',
    '--disable-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    // Keep Vbee/CSP session cookies alive across restarts: Chromium only
    // preserves session cookies on startup when "continue where I left off"
    // is active, which this flag enables for the session.
    '--restore-last-session',
    config.targetUrl
  ];

  let spawnCmd;
  let spawnArgs;
  if (process.platform === 'win32') {
    spawnCmd = browserExe;
    spawnArgs = baseArgs;
  } else {
    spawnCmd = 'powershell.exe';
    spawnArgs = getLaunchArgs(browserExe, baseArgs);
  }

  console.error(`[browser] spawning ${spawnCmd} ${spawnArgs.join(' ')}`);

  const child = spawn(spawnCmd, spawnArgs, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true
  });

  child.unref();

  // Wait for CDP
  const started = Date.now();
  let lastHealth = null;
  while (Date.now() - started < config.startupTimeoutMs) {
    lastHealth = await getCdpHealth();
    if (lastHealth.ok) {
      await writeState({
        mode: 'managed',
        pid: child.pid,
        cdpUrl: cdpUrl(),
        startedAt: new Date().toISOString()
      });
      return print({
        ok: true,
        action: 'started',
        cdpUrl: cdpUrl(),
        health: lastHealth
      });
    }
    await sleep(500);
  }

  return print({
    ok: false,
    action: 'start_failed',
    cdpUrl: cdpUrl(),
    error: 'Browser started but CDP not reachable in time',
    lastHealth
  });
}

async function status() {
  const health = await getCdpHealth();
  const state = await readState();
  const portOpen = await isPortOpen(config.cdpHost, config.cdpPort);

  let action = 'unknown';
  if (health.ok) {
    action = state && state.mode === 'managed' ? 'started' : 'external-or-existing';
  } else if (portOpen) {
    action = 'port_occupied';
  }

  return print({
    ok: health.ok,
    action,
    cdpUrl: cdpUrl(),
    portOpen,
    health: health.data || null,
    state,
    error: health.error || null
  });
}

async function stop() {
  const state = await readState();
  if (!state || state.mode !== 'managed' || !state.pid) {
    return print({
      ok: true,
      action: 'not_stopped',
      reason: 'Browser not managed by lifecycle or no pid',
      state
    });
  }

  // Graceful close order: CDP Browser.close first (so Chromium flushes the
  // profile / session cookies), then process-level graceful fallback. Never
  // force-kill by default -- a hard kill can drop the cookie flush and force
  // a Vbee re-login on the next start.
  const closedViaCdp = await closeViaCdp();
  const closedViaProcess = closedViaCdp ? false : await closeViaProcess(state.pid);

  const portClosed = await waitForPortClosed(config.gracefulCloseTimeoutMs);

  await fs.rm(statePath, { force: true });

  return print({
    ok: portClosed,
    action: portClosed ? 'stopped' : 'close_timeout',
    closeMethod: closedViaCdp ? 'cdp' : closedViaProcess ? 'process' : 'none',
    cdpUrl: cdpUrl(),
    error: portClosed
      ? null
      : `CDP ${cdpUrl()} still reachable after graceful close; profile may not have flushed`
  });
}

async function close() {
  const closed = await closeViaCdp();
  return print({
    ok: closed,
    action: closed ? 'closed' : 'not_reachable',
    cdpUrl: cdpUrl()
  });
}

// Sends Browser.close over the CDP browser websocket. Works for browsers we
// started or external/remote ones, including WSL->Windows Brave where the
// process PID is the powershell.exe wrapper and pid-based kill cannot work.
async function closeViaCdp() {
  let targetUrl = null;
  try {
    const res = await fetch(`${cdpUrl()}/json/version`, {
      signal: AbortSignal.timeout(config.healthTimeoutMs)
    });
    if (!res.ok) return false;
    const data = await res.json();
    targetUrl = data.webSocketDebuggerUrl;
    if (!targetUrl) return false;
  } catch {
    return false;
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(true), config.cdpCloseTimeoutMs);
    const ws = new WebSocket(targetUrl);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    });
    ws.addEventListener('message', () => finish(true));
    ws.addEventListener('close', () => finish(true));
    ws.addEventListener('error', () => finish(false));
  });
}

// Graceful process-level fallback: WM_CLOSE / SIGTERM (no -9, no /F) so the
// browser gets a chance to flush its profile before exiting.
async function closeViaProcess(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForPortClosed(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isPortOpen(config.cdpHost, config.cdpPort))) return true;
    await sleep(250);
  }
  return false;
}

function cdpUrl() {
  return `http://${config.cdpHost}:${config.cdpPort}`;
}

async function getCdpHealth() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.healthTimeoutMs);
  try {
    const res = await fetch(`${cdpUrl()}/json/version`, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, error: `CDP /json/version returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function readState() {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(state) {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function getBrowserCommand() {
  // Always return the brave exe path; launch wrapper handles host vs native
  return config.browserPath;
}

function toWindowsPath(p) {
  if (process.platform === 'win32') return p;
  // Convert /mnt/c/foo -> C:\foo
  return p
    .replace(/^\/mnt\/([a-z])/i, (_, d) => d.toUpperCase() + ':')
    .replace(/\//g, '\\');
}

function getLaunchArgs(exePath, args) {
  if (process.platform === 'win32') {
    return [exePath, ...args];
  }
  // WSL -> Windows: use PowerShell Start-Process (more reliable for GUI apps than 'start')
  const winExe = toWindowsPath(exePath);
  const argList = args.map(a => `"${a.replace(/"/g, '""')}"`).join(',');
  // Build command string for powershell -Command
  return [
    '-NoProfile',
    '-Command',
    `Start-Process -FilePath "${winExe}" -ArgumentList ${argList} -WindowStyle Normal`
  ];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
