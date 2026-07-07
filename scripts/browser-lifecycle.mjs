#!/usr/bin/env node
/**
 * Browser lifecycle manager for VoiceFactory (M2+).
 * Mirrors gateway-lifecycle.mjs pattern.
 * Supports start/status/stop for headed Brave/Chromium with CDP.
 *
 * Usage: node scripts/browser-lifecycle.mjs <start|status|stop>
 *
 * Cross-platform notes:
 * - On Windows: spawns brave.exe directly.
 * - On WSL: attempts to launch via Windows host (cmd.exe or powershell).
 * - Profile in .local/runtime/brave-profile or env BROWSER_PROFILE_DIR.
 * - Default CDP 9222, opens to studio.vbee.vn for login.
 *
 * Does not require Playwright (uses CDP HTTP for check).
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
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: node scripts/browser-lifecycle.mjs <start|status|stop>');
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
    config.targetUrl
  ];

  let spawnCmd;
  let spawnArgs;
  if (process.platform === 'win32') {
    spawnCmd = browserExe;
    spawnArgs = baseArgs;
  } else {
    spawnCmd = 'cmd.exe';
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

  try {
    process.kill(state.pid, 'SIGTERM');
    // On Windows may need taskkill
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${state.pid} /F`, { stdio: 'ignore' });
      } catch {}
    }
  } catch (e) {
    // may already dead
  }

  await fs.rm(statePath, { force: true });

  return print({
    ok: true,
    action: 'stopped',
    cdpUrl: cdpUrl()
  });
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

function getLaunchArgs(exePath, args) {
  if (process.platform === 'win32') {
    return [exePath, ...args];
  }
  // WSL -> Windows host
  // Use cmd /c start "" "path" flags...
  // Escape for cmd
  const quoted = `"${exePath}"`;
  const allArgs = [quoted, ...args].join(' ');
  return ['/c', 'start', '""', allArgs];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
