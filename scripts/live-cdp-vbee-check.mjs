#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
const vbeeHostPattern = process.env.VBEE_HOST_PATTERN || 'vbee';
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const reportPath = process.env.LIVE_CDP_REPORT_PATH
  || path.join(rootDir, '.local', 'runtime', 'live-cdp-vbee-check.json');

const report = {
  checkedAt: new Date().toISOString(),
  cdpUrl,
  vbeeHostPattern,
  cdp: {
    ok: false
  },
  vbeeTabs: [],
  notes: [
    'This report intentionally stores only sanitized CDP tab metadata.',
    'Do not add cookies, tokens, JWTs, request bodies, or screenshots here.'
  ]
};

try {
  const version = await getJson(`${cdpUrl}/json/version`);
  report.cdp = {
    ok: true,
    browser: version.Browser || null,
    protocolVersion: version['Protocol-Version'] || null,
    webSocketDebuggerUrlPresent: Boolean(version.webSocketDebuggerUrl)
  };

  const tabs = await getJson(`${cdpUrl}/json/list`);
  report.vbeeTabs = tabs
    .filter((tab) => isVbeeTab(tab, vbeeHostPattern))
    .map((tab) => ({
      id: tab.id || null,
      type: tab.type || null,
      title: sanitize(tab.title),
      urlHost: safeHost(tab.url),
      attached: Boolean(tab.webSocketDebuggerUrl)
    }));
} catch (error) {
  report.error = error.message;
}

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.error(`Live CDP report written to ${reportPath}`);

if (!report.cdp.ok) process.exitCode = 2;
else if (report.vbeeTabs.length === 0) process.exitCode = 3;

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function isVbeeTab(tab, pattern) {
  const haystack = `${tab.url || ''} ${tab.title || ''}`.toLowerCase();
  return haystack.includes(pattern.toLowerCase());
}

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return null;
  }
}

function sanitize(value) {
  return String(value || '')
    .replaceAll(/\s+/g, ' ')
    .slice(0, 120);
}
