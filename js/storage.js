const LEGACY_RECORDS_KEY = 'topping-sales-v2';
const OLDEST_RECORDS_KEY = 'topping-sales-v1';
const MIGRATION_MARKER_KEY = 'topping-sales-supabase-migrated';

function normalizeLegacyRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) return null;
  if (!['morning', 'afternoon', 'evening'].includes(record.shift)) return null;
  return {
    date: record.date,
    shift: record.shift,
    employee: String(record.employee || 'Chưa nhập').trim() || 'Chưa nhập',
    quantities: Array.from({ length: 9 }, (_, index) => Math.max(0, Math.floor(Number(record.quantities?.[index]) || 0))),
    note: String(record.note || '')
  };
}

export function getLegacySalesRecords() {
  try {
    if (localStorage.getItem(MIGRATION_MARKER_KEY)) return [];
    const saved = localStorage.getItem(LEGACY_RECORDS_KEY);
    let parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed) || !parsed.length) parsed = JSON.parse(localStorage.getItem(OLDEST_RECORDS_KEY) || '{}');
    const records = Array.isArray(parsed) ? parsed : Object.values(parsed);
    return records.map(normalizeLegacyRecord).filter(Boolean);
  } catch {
    return [];
  }
}

export function markLegacySalesMigrated() {
  localStorage.setItem(MIGRATION_MARKER_KEY, new Date().toISOString());
}