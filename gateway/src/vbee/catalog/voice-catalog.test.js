import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOwnership,
  extractVoicesArray,
  mergeVoiceCatalogs,
  normalizeGender,
  normalizeVoices,
  OWNERSHIP
} from './voice-catalog.js';

test('normalizeVoices maps a flat official-style list with auto-detected fields', () => {
  const raw = [
    { voice_code: 'hn_female_ngochuyen_full_48k-fhg', voice_name: 'Ngọc Huyền', gender: 'female', language_code: 'vi-VN' },
    { voice_code: 'sg_male_phuclong_call_44k-fhg', voice_name: 'Phúc Long', gender: 'male', language_code: 'vi-VN' },
    { voice_code: 'my_personal_voice', voice_name: 'Giọng tôi', is_personal: true }
  ];

  const voices = normalizeVoices(raw, { source: 'vbee-preview' });

  assert.equal(voices.length, 3);
  assert.equal(voices[0].code, 'hn_female_ngochuyen_full_48k-fhg');
  assert.equal(voices[0].name, 'Ngọc Huyền');
  assert.equal(voices[0].gender, 'female');
  assert.equal(voices[0].ownership, OWNERSHIP.VBEE);
  assert.equal(voices[0].source, 'vbee-preview');
  assert.equal(voices[2].ownership, OWNERSHIP.PERSONAL);
});

test('normalizeVoices requires a code-like value and drops non-matching entries', () => {
  const voices = normalizeVoices([
    { id: 42, name: 'numeric id only' },
    { voice_code: '', name: 'empty code' },
    { voice_code: 'ok-voice', name: 'ok' },
    'not-an-object'
  ]);

  assert.equal(voices.length, 1);
  assert.equal(voices[0].code, 'ok-voice');
});

test('normalizeVoices falls back to the code when the name is missing', () => {
  const voices = normalizeVoices([{ voice_code: 'orphan-voice' }]);
  assert.equal(voices[0].name, 'orphan-voice');
});

test('normalizeVoices accepts explicit field mapping when the catalog shape is unusual', () => {
  const voices = normalizeVoices([{ id: 'custom-code', title: 'Custom', kind: 'Ca Nhan' }], {
    fields: { codeField: 'id', nameField: 'title', ownershipField: 'kind' }
  });
  assert.equal(voices[0].code, 'custom-code');
  assert.equal(voices[0].name, 'Custom');
  assert.equal(voices[0].ownership, OWNERSHIP.PERSONAL);
});

test('normalizeVoices treats an explicit is_personal:false as a provider voice', () => {
  const voices = normalizeVoices([{ voice_code: 'hn_male_ducthinh_full_48k-fhg', voice_name: 'Đức Thịnh', is_personal: false }]);
  assert.equal(voices[0].ownership, OWNERSHIP.VBEE);
});

test('normalizeGender normalizes Vietnamese and English gender labels', () => {
  assert.equal(normalizeGender('Nữ'), 'female');
  assert.equal(normalizeGender('female'), 'female');
  assert.equal(normalizeGender('nam'), 'male');
  assert.equal(normalizeGender('M'), 'male');
  assert.equal(normalizeGender(null), null);
  assert.equal(normalizeGender(undefined), null);
});

test('classifyOwnership maps the common provider vocabulary', () => {
  assert.equal(classifyOwnership('vbee'), OWNERSHIP.VBEE);
  assert.equal(classifyOwnership('Giọng Vbee'), OWNERSHIP.VBEE);
  assert.equal(classifyOwnership('Cá nhân'), OWNERSHIP.PERSONAL);
  assert.equal(classifyOwnership('Cộng đồng'), OWNERSHIP.COMMUNITY);
  assert.equal(classifyOwnership('community'), OWNERSHIP.COMMUNITY);
  assert.equal(classifyOwnership(''), OWNERSHIP.UNKNOWN);
  assert.equal(classifyOwnership(undefined), OWNERSHIP.UNKNOWN);
});

test('extractVoicesArray follows an explicit dot-separated path', () => {
  const payload = { result: { voices: [{ voice_code: 'a' }, { voice_code: 'b' }] } };
  assert.equal(extractVoicesArray(payload, 'result.voices').length, 2);
  assert.deepEqual(extractVoicesArray(payload, 'missing.path'), []);
});

test('extractVoicesArray auto-detects a top-level array of objects', () => {
  const payload = { voices: [{ voice_code: 'a' }] };
  assert.equal(extractVoicesArray(payload).length, 1);
});

test('extractVoicesArray auto-detects a nested array under common containers', () => {
  const payload = { data: { list: [{ voice_code: 'a' }] } };
  assert.equal(extractVoicesArray(payload).length, 1);
  assert.deepEqual(extractVoicesArray({}), []);
  assert.deepEqual(extractVoicesArray(null), []);
});

test('mergeVoiceCatalogs unions by code and upgrades UNKNOWN ownership', () => {
  const a = normalizeVoices([{ voice_code: 'shared', voice_name: 'Lite', ownership: 'third-party' }], { source: 'vbee-preview' });
  const b = normalizeVoices([{ voice_code: 'shared', voice_name: 'Full', is_personal: true }], { source: 'official' });
  const c = normalizeVoices([{ voice_code: 'only-b', voice_name: 'Only B', is_personal: true }], { source: 'official' });

  const merged = mergeVoiceCatalogs(a, b, c);

  assert.equal(merged.length, 2);
  const shared = merged.find((voice) => voice.code === 'shared');
  assert.equal(shared.name, 'Full');
  assert.equal(shared.ownership, OWNERSHIP.PERSONAL);
  assert.equal(shared.source, 'official');
});