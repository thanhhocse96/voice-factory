export const OWNERSHIP = Object.freeze({
  VBEE: 'vbee',
  PERSONAL: 'personal',
  COMMUNITY: 'community',
  UNKNOWN: 'unknown'
});

const CODE_FIELD_CANDIDATES = ['voice_code', 'voiceCode', 'voicecode', 'code', 'voice_id', 'id'];
const NAME_FIELD_CANDIDATES = ['voice_name', 'voiceName', 'name', 'title', 'label'];
const GENDER_FIELD_CANDIDATES = ['gender', 'sex'];
const LANGUAGE_FIELD_CANDIDATES = ['language_code', 'language', 'lang', 'locale'];
const SAMPLE_FIELD_CANDIDATES = ['sample_url', 'sampleUrl', 'audio_url', 'audioUrl', 'preview_url', 'previewUrl'];
const OWNERSHIP_FIELD_CANDIDATES = ['ownership', 'ownership_type', 'voice_type', 'is_personal', 'isPersonal'];

export function classifyOwnership(value) {
  if (value === true) return OWNERSHIP.PERSONAL;
  if (value === false) return OWNERSHIP.UNKNOWN;
  const text = String(value ?? '')
    .toLowerCase()
    .trim();
  if (!text) return OWNERSHIP.UNKNOWN;
  if (/personal|c[aá] nh[aâ]n|private|my voice|own voice|self/.test(text)) return OWNERSHIP.PERSONAL;
  if (/cong dong|c[oôộ]ng [dđ]ồng|community|chia se|shared/.test(text)) return OWNERSHIP.COMMUNITY;
  if (/vbee|official|hang hang/.test(text)) return OWNERSHIP.VBEE;
  return OWNERSHIP.UNKNOWN;
}

export function normalizeGender(value) {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .toLowerCase()
    .trim();
  if (/^f(emale)?$/.test(text) || /^n[uữ]$/.test(text)) return 'female';
  if (/^m(ale)?$/.test(text) || text === 'nam') return 'male';
  return text || null;
}

function pick(object, candidates) {
  for (const key of candidates) {
    if (object && typeof object === 'object' && object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

export function extractVoicesArray(payload, arrayField = '') {
  if (!payload || typeof payload !== 'object') return [];

  if (arrayField) {
    let target = payload;
    for (const segment of String(arrayField).split('.')) {
      if (!target || typeof target !== 'object') return [];
      target = target[segment];
      if (target === undefined || target === null) return [];
    }
    return Array.isArray(target) ? target : [];
  }

  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') return value;
    if (Array.isArray(value) && value.length === 0) return value;
  }

  for (const container of ['result', 'data', 'body', 'payload']) {
    const value = payload[container];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) {
      const nested = value[key];
      if (Array.isArray(nested) && nested.length > 0 && typeof nested[0] === 'object') return nested;
      if (Array.isArray(nested) && nested.length === 0) return nested;
    }
  }

  return [];
}

export function normalizeVoices(rawList, { source = 'unknown', fields } = {}) {
  const list = Array.isArray(rawList) ? rawList : [];
  const voices = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;

    let code = pick(raw, fields?.codeField ? [fields.codeField] : CODE_FIELD_CANDIDATES);
    if (code === null || code === undefined) continue;
    code = String(code).trim();
    if (!code) continue;
    if (!fields?.codeField && /^[0-9]+$/.test(code) && pick(raw, ['voice_code', 'voiceCode', 'code']) === null) continue;

    const name = pick(raw, fields?.nameField ? [fields.nameField] : NAME_FIELD_CANDIDATES);
    const ownershipRaw = pick(raw, fields?.ownershipField ? [fields.ownershipField] : OWNERSHIP_FIELD_CANDIDATES);
    let ownership;
    if (ownershipRaw === null || ownershipRaw === undefined || ownershipRaw === false) {
      ownership = OWNERSHIP.VBEE;
    } else {
      ownership = classifyOwnership(ownershipRaw);
    }

    voices.push({
      code,
      name: name === null || name === undefined ? code : String(name),
      gender: normalizeGender(pick(raw, fields?.genderField ? [fields.genderField] : GENDER_FIELD_CANDIDATES)),
      language: pick(raw, fields?.languageField ? [fields.languageField] : LANGUAGE_FIELD_CANDIDATES) ?? null,
      ownership,
      sampleUrl: pick(raw, fields?.sampleField ? [fields.sampleField] : SAMPLE_FIELD_CANDIDATES) ?? null,
      source
    });
  }

  return voices;
}

export function mergeVoiceCatalogs(...catalogs) {
  const byCode = new Map();
  for (const voice of catalogs.flat()) {
    if (!voice || voice.code === null || voice.code === undefined) continue;
    const key = String(voice.code);
    const existing = byCode.get(key);
    if (!existing) {
      byCode.set(key, { ...voice, code: key });
      continue;
    }
    if (existing.ownership === OWNERSHIP.UNKNOWN && voice.ownership !== OWNERSHIP.UNKNOWN) {
      byCode.set(key, { ...voice, code: key });
    }
  }
  return Array.from(byCode.values());
}