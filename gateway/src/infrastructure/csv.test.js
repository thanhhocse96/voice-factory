import test from 'node:test';
import assert from 'node:assert/strict';
import { assetsToCsv, csvEscape, queueToCsv, rowsToCsv } from './csv.js';

test('csvEscape quotes commas, quotes, and newlines', () => {
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
});

test('rowsToCsv writes a UTF-8 BOM, CRLF rows, and a trailing newline', () => {
  const csv = rowsToCsv(['id', 'content'], [{ id: 1, content: 'hello, world' }]);
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv, '\uFEFFid,content\r\n1,"hello, world"\r\n');
});

test('rowsToCsv can omit the BOM', () => {
  const csv = rowsToCsv(['id'], [{ id: 'a' }], { bom: false });
  assert.equal(csv, 'id\r\na\r\n');
});

test('empty export still has a header row', () => {
  const csv = queueToCsv([]);
  assert.match(csv, /^(\uFEFF)?id,status,content,/);
  assert.equal(csv.trim().split('\r\n').length, 1);
});

test('queueToCsv and assetsToCsv only emit their declared columns', () => {
  const queueCsv = queueToCsv([{
    id: 'job-1',
    status: 'done',
    content: 'Xin chao',
    voice_code: 'fake_voice',
    speed: 1.05,
    incognito: 1,
    file_path: '/secret/local/path.mp3',
    extra: 'ignored'
  }]);
  assert.equal(queueCsv.includes('/secret/local/path.mp3'), false);
  assert.equal(queueCsv.includes('ignored'), false);
  assert.match(queueCsv, /job-1/);
  assert.match(queueCsv, /Xin chao/);

  const assetCsv = assetsToCsv([{
    id: 'asset-1',
    filename: 'clip.mp3',
    content: 'Xin chao',
    file_path: '/secret/local/path.mp3'
  }]);
  assert.equal(assetCsv.includes('/secret/local/path.mp3'), false);
  assert.match(assetCsv, /clip\.mp3/);
});
