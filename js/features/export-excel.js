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

function formatDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(isoDate || '');
}

async function fetchAllShifts(client, date) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('shifts')
      .select('id,sales_date,shift,employee_id,note')
      .eq('sales_date', date)
      .order('shift', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchByIds(client, table, columns, key, ids) {
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const idChunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await client.from(table).select(columns).in(key, idChunk);
    if (error) throw error;
    all.push(...(data || []));
  }
  return all;
}

async function loadExcelRows(date) {
  const client = requireSupabase();
  const shifts = await fetchAllShifts(client, date);
  if (!shifts.length) return [];

  const employeeIds = [...new Set(shifts.map((row) => row.employee_id).filter(Boolean))];
  const shiftIds = shifts.map((row) => row.id);

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

function buildWorkbook(rows, date) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = rows.reduce((sum, row) => sum + row.money, 0);

  return buildXlsxBlob({
    sheetName: `Topping ${formatDate(date)}`,
    title: `BÁO CÁO TOPPING NGÀY ${formatDate(date)}`,
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

function showManualDownload(filename, blob, summary) {
  const host = $('#excelExportResult');
  if (!host) return;

  const previousUrl = host.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;

  const box = setStatus(`<strong>File Excel đã tạo xong.</strong><br><span>${esc(summary)}</span><br><span>Nếu hộp lưu file không mở hoặc bạn đã đóng nó, bấm nút dưới đây.</span><br>`, 'ok');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.className = 'feature-btn primary';
  link.style.cssText = 'display:inline-flex;align-items:center;margin-top:10px;text-decoration:none';
  link.textContent = `⬇ Tải ${filename}`;
  box?.appendChild(link);
}

function startNativeSave(filename) {
  if (!window.isSecureContext || typeof window.showSaveFilePicker !== 'function') return null;
  try {
    return window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Excel Workbook',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
        }
      }]
    });
  } catch (error) {
    console.warn('[Excel] Không mở được hộp lưu file.', error);
    return null;
  }
}

async function exportExcel() {
  const button = $('#featureExcel');
  if (!button) return;

  const dateInput = $('#excelDate');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateInput?.value || '') ? dateInput.value : currentLocalDate();
  const filename = `topping-${date}.xlsx`;
  const oldText = button.textContent;

  // Quan trọng: mở hộp Save ngay trong click của người dùng, trước mọi await.
  // Chrome sẽ giữ user activation và cho phép lưu file thật.
  const saveHandlePromise = startNativeSave(filename);

  button.disabled = true;
  button.textContent = 'Đang tạo Excel...';
  setStatus(`Đang lấy dữ liệu ngày ${esc(formatDate(date))}...`);

  try {
    console.info('[Excel] Bắt đầu xuất ngày', date);
    const rows = await loadExcelRows(date);
    console.info('[Excel] Số dòng lấy được', rows.length);

    if (!rows.length) {
      setStatus(`<strong>Ngày ${esc(formatDate(date))} chưa có dữ liệu để xuất.</strong><br>Hãy chọn ngày có nhập topping.`);
      notify(`Ngày ${formatDate(date)} chưa có dữ liệu để xuất.`, 5000);
      return;
    }

    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const blob = buildWorkbook(rows, date);
    const summary = `${rows.length} dòng, tổng ${totalQuantity.toLocaleString('vi-VN')} topping.`;

    // Luôn dựng nút tải tay trước để có fallback chắc chắn.
    showManualDownload(filename, blob, summary);

    if (saveHandlePromise) {
      try {
        const fileHandle = await saveHandlePromise;
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(`<strong>Đã lưu ${esc(filename)} thành công.</strong><br><span>${esc(summary)}</span>`, 'ok');
        notify(`Đã lưu ${filename}`, 4000);
        return;
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Excel] Save picker lỗi, dùng nút tải dự phòng.', error);
        }
      }
    }

    notify('File đã tạo xong. Bấm nút tải Excel bên dưới.', 5000);
  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message || 'Lỗi không xác định';
    setStatus(`<strong>Xuất Excel lỗi:</strong> ${esc(message)}`);
    notify(`Xuất Excel lỗi: ${message}`, 6000);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function boot() {
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
    <p class="muted">Chọn ngày có dữ liệu rồi bấm Xuất Excel. Chrome sẽ mở hộp chọn nơi lưu file.</p>
    <div class="feature-toolbar">
      <label>Ngày / tháng / năm<input id="excelDate" type="date"></label>
      <button class="feature-btn primary" id="featureExcel" type="button">Xuất Excel</button>
    </div>
    <div id="excelExportResult" style="margin-top:12px" hidden></div>
  `;
  host.prepend(panel);

  const dateInput = $('#excelDate');
  dateInput.value = currentLocalDate();

  const button = $('#featureExcel');
  button.onclick = () => void exportExcel();
  console.info('[Excel] Panel Xuất Excel đã được khởi tạo.');
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

scheduleBoot();
document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
document.addEventListener('topping:features-ready', scheduleBoot);
document.addEventListener('topping:session-ready', scheduleBoot);
window.addEventListener('pageshow', scheduleBoot);
