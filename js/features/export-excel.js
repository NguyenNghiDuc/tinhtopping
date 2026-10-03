import { requireSupabase } from '../supabase.js';
import { $, notify } from './shared.js';
import { buildXlsxBlob } from './xlsx-lite.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

const PAGE_SIZE = 500;
const CHUNK_SIZE = 50;
let bootRetryTimer = null;
let bootAttempts = 0;
let exportInProgress = false;
const MAX_BOOT_ATTEMPTS = 40;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function currentLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentLocalMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(isoDate || '');
}

function formatMonth(month) {
  const [y, m] = String(month || '').split('-');
  return y && m ? `${m}/${y}` : String(month || '');
}

function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

async function fetchPagedShifts(buildQuery) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchAllShiftsForDate(client, date) {
  return fetchPagedShifts(() => client
    .from('shifts')
    .select('id,sales_date,shift,employee_id,note')
    .eq('sales_date', date)
    .order('sales_date', { ascending: true })
    .order('shift', { ascending: true })
    .order('id', { ascending: true }));
}

async function fetchAllShiftsForMonth(client, month) {
  const [start, end] = monthBounds(month);
  return fetchPagedShifts(() => client
    .from('shifts')
    .select('id,sales_date,shift,employee_id,note')
    .gte('sales_date', start)
    .lt('sales_date', end)
    .order('sales_date', { ascending: true })
    .order('shift', { ascending: true })
    .order('id', { ascending: true }));
}

async function fetchByIds(client, table, columns, key, ids) {
  if (!ids.length) return [];
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const idChunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await client.from(table).select(columns).in(key, idChunk);
    if (error) throw error;
    all.push(...(data || []));
  }
  return all;
}

async function hydrateRows(shifts) {
  if (!shifts.length) return [];
  const client = requireSupabase();
  const employeeIds = [...new Set(shifts.map((row) => row.employee_id).filter(Boolean))];
  const shiftIds = shifts.map((row) => row.id).filter(Boolean);

  const [employees, toppings] = await Promise.all([
    fetchByIds(client, 'employees', 'id,name', 'id', employeeIds),
    fetchByIds(client, 'shift_toppings', 'shift_id,quantity', 'shift_id', shiftIds)
  ]);

  const employeeMap = new Map(employees.map((row) => [row.id, row.name]));
  const quantityMap = new Map();
  toppings.forEach((row) => {
    quantityMap.set(row.shift_id, (quantityMap.get(row.shift_id) || 0) + Math.max(0, Number(row.quantity) || 0));
  });

  return shifts.map((row) => {
    const quantity = quantityMap.get(row.id) || 0;
    return {
      date: row.sales_date,
      shift: SHIFT_LABELS[row.shift] || row.shift || '',
      employee: employeeMap.get(row.employee_id) || '',
      quantity,
      money: quantity * 1000,
      note: row.note || ''
    };
  });
}

async function loadExcelRowsForDate(date) {
  const client = requireSupabase();
  return hydrateRows(await fetchAllShiftsForDate(client, date));
}

async function loadExcelRowsForMonth(month) {
  const client = requireSupabase();
  return hydrateRows(await fetchAllShiftsForMonth(client, month));
}

function buildWorkbook(rows, title, sheetName) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = rows.reduce((sum, row) => sum + row.money, 0);

  return buildXlsxBlob({
    sheetName,
    title,
    headers: ['Ngày', 'Ca', 'Nhân viên', 'Topping', 'Tiền', 'Ghi chú'],
    rows: rows.map((row) => [formatDate(row.date), row.shift, row.employee, row.quantity, row.money, row.note]),
    totals: ['Tổng cộng', '', '', totalQuantity, totalMoney, ''],
    widths: [13, 12, 24, 11, 14, 36]
  });
}

function setStatus(html, kind = '') {
  const host = $('#excelExportResult');
  if (!host) return null;
  host.hidden = false;
  host.innerHTML = `<div class="feature-warning ${kind === 'ok' ? 'feature-ok' : ''}">${html}</div>`;
  return host.firstElementChild;
}

function clearOldObjectUrl() {
  const host = $('#excelExportResult');
  if (!host) return;
  const previousUrl = host.dataset.objectUrl;
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
    delete host.dataset.objectUrl;
  }
}

function createDownload(filename, blob, summary) {
  const host = $('#excelExportResult');
  if (!host) throw new Error('Không tìm thấy vùng tải file Excel.');
  clearOldObjectUrl();

  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;

  const box = setStatus(`<strong>Đã tạo file Excel.</strong><br><span>${esc(summary)}</span><br>`, 'ok');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.className = 'feature-btn primary';
  link.style.cssText = 'display:inline-flex;align-items:center;margin-top:10px;text-decoration:none';
  link.textContent = `⬇ Tải ${filename}`;
  box?.appendChild(link);
  return link;
}

async function runExport({ button, rowsLoader, filename, label, workbookTitle, sheetName }) {
  if (!button || exportInProgress) return;
  exportInProgress = true;
  const oldText = button.textContent;
  button.disabled = true;
  document.querySelectorAll('#featureExcelDay,#featureExcelMonth').forEach((item) => { item.disabled = true; });

  try {
    button.textContent = 'Đang lấy dữ liệu...';
    setStatus(`<strong>Đã nhận lệnh xuất Excel.</strong><br>1/3 · Đang lấy dữ liệu ${esc(label)}...`);
    const rows = await rowsLoader();

    if (!rows.length) {
      setStatus(`<strong>${esc(label)} chưa có dữ liệu để xuất.</strong>`);
      notify(`${label} chưa có dữ liệu để xuất.`, 5000);
      return;
    }

    button.textContent = 'Đang tạo file...';
    setStatus('2/3 · Đang tạo file .xlsx...');

    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const blob = buildWorkbook(rows, workbookTitle, sheetName);
    const summary = `${rows.length} dòng, tổng ${totalQuantity.toLocaleString('vi-VN')} topping.`;
    const link = createDownload(filename, blob, summary);

    button.textContent = 'Đang tải file...';
    try { link.click(); } catch (error) { console.warn('[Excel] Tải tự động bị chặn.', error); }

    const host = $('#excelExportResult');
    const box = setStatus(`<strong>3/3 · Đã tạo file Excel.</strong><br><span>${esc(summary)}</span><br>`, 'ok');
    const manual = document.createElement('a');
    manual.href = host?.dataset.objectUrl || link.href;
    manual.download = filename;
    manual.rel = 'noopener';
    manual.className = 'feature-btn primary';
    manual.style.cssText = 'display:inline-flex;align-items:center;margin-top:10px;text-decoration:none';
    manual.textContent = `⬇ Tải ${filename}`;
    box?.appendChild(manual);
    notify(`Đã tạo ${filename}`, 4000);
  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message || 'Lỗi không xác định';
    setStatus(`<strong>Xuất Excel lỗi:</strong> ${esc(message)}`);
    notify(`Xuất Excel lỗi: ${message}`, 6000);
  } finally {
    exportInProgress = false;
    button.textContent = oldText;
    document.querySelectorAll('#featureExcelDay,#featureExcelMonth').forEach((item) => { item.disabled = false; });
  }
}

function exportDay(button) {
  const dateInput = $('#excelDate');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput?.value || '') ? dateInput.value : currentLocalDate();
  return runExport({
    button,
    rowsLoader: () => loadExcelRowsForDate(date),
    filename: `topping-ngay-${date}.xlsx`,
    label: `ngày ${formatDate(date)}`,
    workbookTitle: `BÁO CÁO TOPPING NGÀY ${formatDate(date)}`,
    sheetName: `Topping ${formatDate(date)}`
  });
}

function exportMonth(button) {
  const monthInput = $('#excelMonth');
  const month = /^\d{4}-\d{2}$/.test(monthInput?.value || '') ? monthInput.value : currentLocalMonth();
  return runExport({
    button,
    rowsLoader: () => loadExcelRowsForMonth(month),
    filename: `topping-thang-${month}.xlsx`,
    label: `tháng ${formatMonth(month)}`,
    workbookTitle: `BÁO CÁO TOPPING THÁNG ${formatMonth(month)}`,
    sheetName: `Topping ${formatMonth(month)}`
  });
}

function installDelegatedClickHandler() {
  if (document.documentElement.dataset.excelDelegatedClick === '2') return;
  document.documentElement.dataset.excelDelegatedClick = '2';

  document.addEventListener('click', (event) => {
    const dayButton = event.target.closest?.('#featureExcelDay');
    if (dayButton) {
      event.preventDefault();
      event.stopPropagation();
      void exportDay(dayButton);
      return;
    }

    const monthButton = event.target.closest?.('#featureExcelMonth');
    if (monthButton) {
      event.preventDefault();
      event.stopPropagation();
      void exportMonth(monthButton);
    }
  }, true);
}

function boot() {
  installDelegatedClickHandler();

  if ($('#excelExportPanel')) {
    if (bootRetryTimer) clearTimeout(bootRetryTimer);
    bootRetryTimer = null;
    return true;
  }

  const host = $('#feature-tools-host');
  if (!host) return false;

  const panel = document.createElement('section');
  panel.className = 'feature-panel';
  panel.id = 'excelExportPanel';
  panel.innerHTML = `
    <h3>Xuất Excel</h3>
    <p class="muted">Có thể xuất riêng 1 ngày hoặc toàn bộ 1 tháng.</p>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
      <div class="feature-card">
        <strong style="font-size:16px;margin-bottom:10px">Xuất 1 ngày</strong>
        <div class="feature-toolbar">
          <label>Ngày / tháng / năm<input id="excelDate" type="date"></label>
          <button class="feature-btn primary" id="featureExcelDay" type="button">Xuất 1 ngày</button>
        </div>
      </div>
      <div class="feature-card">
        <strong style="font-size:16px;margin-bottom:10px">Xuất 1 tháng</strong>
        <div class="feature-toolbar">
          <label>Tháng<input id="excelMonth" type="month"></label>
          <button class="feature-btn primary" id="featureExcelMonth" type="button">Xuất 1 tháng</button>
        </div>
      </div>
    </div>
    <div id="excelExportResult" style="margin-top:12px" hidden></div>
  `;
  host.prepend(panel);

  $('#excelDate').value = currentLocalDate();
  $('#excelMonth').value = currentLocalMonth();
  return true;
}

function scheduleBoot() {
  if (boot()) return;
  if (bootRetryTimer || bootAttempts >= MAX_BOOT_ATTEMPTS) return;
  bootAttempts += 1;
  bootRetryTimer = setTimeout(() => {
    bootRetryTimer = null;
    scheduleBoot();
  }, 250);
}

installDelegatedClickHandler();
scheduleBoot();
document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
document.addEventListener('topping:features-ready', scheduleBoot);
document.addEventListener('topping:session-ready', scheduleBoot);
window.addEventListener('pageshow', scheduleBoot);
