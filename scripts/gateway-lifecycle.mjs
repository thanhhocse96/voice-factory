#!/usr/bin/env node
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(rootDir, '.local', 'runtime');
const statePath = path.join(runtimeDir, 'gateway-lifecycle.json');
const logPath = path.join(runtimeDir, 'gateway.log');

const config = {
  host: process.env.GATEWAY_HOST || '127.0.0.1',
  port: Number(process.env.PORT || process.env.GATEWAY_PORT || 3000),
  healthTimeoutMs: Number(process.env.GATEWAY_HEALTH_TIMEOUT_MS || 800),
  startupTimeoutMs: Number(process.env.GATEWAY_STARTUP_TIMEOUT_MS || 12000)
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
    console.error('Usage: node scripts/gateway-lifecycle.mjs <start|status|stop>');
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode || 1;
}

async function start() {
  const health = await getHealth();
  if (health.ok) {
    await writeState({
      mode: 'external-or-existing',
      pid: null,
      url: gatewayUrl(),
      startedAt: new Date().toISOString()
    });
    return print({
      ok: true,
      action: 'already_running',
      url: gatewayUrl(),
      health: health.data
    });
  }

  if (await isPortOpen(config.host, config.port)) {
    const error = new Error(`Gateway port is occupied but /health is not available: ${gatewayUrl()}`);
    error.exitCode = 3;
    throw error;
  }

  await fs.mkdir(runtimeDir, { recursive: true });
  const out = await fs.open(logPath, 'a');
  // Spawns node directly (matching package.json's own "dev"/"start" script) rather than
  // `npm run dev`: on Windows, `npm` resolves to npm.cmd, which spawn() with shell:false
  // (the default) cannot execute directly - confirmed live, this silently produced no
  // child process at all when launched from the Tauri shell. process.execPath is the
  // exact node binary already running this script, so it's guaranteed to exist with no
  // extra PATH lookup, and avoids depending on npm being present at all.
  const child = spawn(process.execPath, ['--experimental-sqlite', 'server.js'], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', out.fd, out.fd],
    shell: false,
    env: process.env
  });
  child.unref();

  await writeState({
    mode: 'managed',
    pid: child.pid,
    processGroupId: child.pid,
    url: gatewayUrl(),
    logPath,
    startedAt: new Date().toISOString()
  });

  const ready = await waitForHealth(config.startupTimeoutMs);
  if (!ready.ok) {
    const error = new Error(`Gateway did not become healthy within ${config.startupTimeoutMs}ms. Log: ${logPath}`);
    error.exitCode = 4;
    throw error;
  }

  print({
    ok: true,
    action: 'started',
    pid: child.pid,
    url: gatewayUrl(),
    health: ready.data
  });
}

async function status() {
  let state = await readState();
  const health = await getHealth();
  const portOpen = health.ok ? true : await isPortOpen(config.host, config.port);
  let staleStateCleared = false;

  if (state?.mode === 'external-or-existing' && !portOpen) {
    await fs.rm(statePath, { force: true });
    state = null;
    staleStateCleared = true;
  }

  print({
    ok: health.ok,
    url: gatewayUrl(),
    portOpen,
    staleStateCleared,
    state,
    health: health.data || null,
    error: health.error || null
  });
}

async function stop() {
  const state = await readState();
  if (!state || state.mode !== 'managed' || !state.pid) {
    return print({
      ok: true,
      action: 'not_stopped',
      reason: 'Gateway is not managed by lifecycle state',
      state
    });
  }

  try {
    if (state.processGroupId && process.platform !== 'win32') {
      process.kill(-state.processGroupId, 'SIGTERM');
    } else {
      process.kill(state.pid, 'SIGTERM');
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }

  await fs.rm(statePath, { force: true });
  print({
    ok: true,
    action: 'stopped',
    pid: state.pid
  });
}

async function getHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.healthTimeoutMs);
  try {
    const response = await fetch(`${gatewayUrl()}/health`, { signal: controller.signal });
    const data = await response.json();
    return { ok: response.ok && data.ok === true, data };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await getHealth();
    if (health.ok) return health;
    await sleep(400);
  }
  return { ok: false };
}

async function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(600, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(state) {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

function gatewayUrl() {
  return `http://${config.host}:${config.port}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function print(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
