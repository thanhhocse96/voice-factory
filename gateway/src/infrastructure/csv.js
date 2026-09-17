const UTF8_BOM = '\uFEFF';

export const QUEUE_CSV_COLUMNS = [
  'id',
  'status',
  'content',
  'voice_code',
  'speed',
  'incognito',
  'project_id',
  'group_id',
  'priority',
  'retry_count',
  'created_at',
  'processed_at',
  'relative_path',
  'notes'
];

export const ASSET_CSV_COLUMNS = [
  'id',
  'filename',
  'content',
  'voice_code',
  'speed',
  'duration_ms',
  'created_at',
  'relative_path',
  'source_job_id',
  'project_id'
];

export function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function rowsToCsv(columns, rows, { bom = true } = {}) {
  const header = columns.map(csvEscape).join(',');
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','));
  const csv = [header, ...lines].join('\r\n') + '\r\n';
  return bom ? UTF8_BOM + csv : csv;
}

export function queueToCsv(jobs) {
  return rowsToCsv(QUEUE_CSV_COLUMNS, jobs);
}

export function assetsToCsv(assets) {
  return rowsToCsv(ASSET_CSV_COLUMNS, assets);
}
