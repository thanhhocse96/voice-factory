import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  helpText,
  assertWindowsHost,
  sanitizeResult
} from './vbee-windows-direct-api.mjs';

test('parseArgs defaults to probe when --text is omitted', () => {
  const args = parseArgs([]);
  assert.equal(args.mode, 'probe');
  assert.equal(args.cdpUrl, 'http://127.0.0.1:9222');
  assert.equal(args.speed, 1.05);
});

test('parseArgs synthesize mode takes text, voice, and speed', () => {
  const args = parseArgs([
    '--text', 'xin chào',
    '--voice', 'sg_female_tuongvy_call_44k-fhg',
    '--speed', '1.2',
    '--cdp', 'http://127.0.0.1:9333'
  ]);
  assert.equal(args.mode, 'synthesize');
  assert.equal(args.text, 'xin chào');
  assert.equal(args.voice, 'sg_female_tuongvy_call_44k-fhg');
  assert.equal(args.speed, 1.2);
  assert.equal(args.cdpUrl, 'http://127.0.0.1:9333');
});

test('parseArgs rejects unknown flags and bad speed', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  assert.throws(() => parseArgs(['--speed', '0']), /positive number/);
});

test('assertWindowsHost refuses Linux unless --force', () => {
  assert.throws(() => assertWindowsHost({ platform: 'linux', force: false }), /Windows Brave CDP/);
  assert.doesNotThrow(() => assertWindowsHost({ platform: 'win32', force: false }));
  assert.doesNotThrow(() => assertWindowsHost({ platform: 'linux', force: true }));
});

test('sanitizeResult drops token-shaped fields and keeps audioUrl', () => {
  const safe = sanitizeResult({
    ok: true,
    mode: 'synthesize',
    platform: 'win32',
    cdpUrl: 'http://127.0.0.1:9222',
    pageUrlHost: 'studio.vbee.vn',
    tokenCaptured: true,
    audioUrl: 'https://cdn.example/a.mp3',
    requestId: 'req-1',
    accessToken: 'super-secret-jwt-should-never-leak',
    protocolWarnings: []
  });

  assert.equal(safe.audioUrl, 'https://cdn.example/a.mp3');
  assert.equal(safe.tokenCaptured, true);
  assert.equal(JSON.stringify(safe).includes('super-secret-jwt-should-never-leak'), false);
  assert.equal('accessToken' in safe, false);
});

test('helpText names the Linux worker as production and does not mention pasting a JWT', () => {
  const text = helpText();
  assert.match(text, /Linux Gateway/);
  assert.match(text, /Windows Node/);
  assert.doesNotMatch(text, /JWT|paste token|accessToken/i);
});
