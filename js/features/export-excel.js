import { requireSupabase } from '../supabase.js';
import { $ } from './shared.js';
import { buildXlsxBlob } from './xlsx-lite.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

const PAGE_SIZE = 500;
const IN_CHUNK_SIZE = 50;

function getLocalMonthValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatDateVi(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatMonthVi(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : String(value || '');
}

function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

function resolveExportMonth() {
  const explicit = $('#excelMonth')?.value || $('#recordsMonth')?.value || getLocalMonthValue();
  if ($('#excelMonth')) $('#excelMonth').value = explicit;
  return explicit;
}

function setExportStatus(message, tone = 'info') {
  const status = $('#excelExportResult');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
}

function chunk(list, size) {
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
}

async function fetchPaged(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const result = await makeQuery().range(from, to);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchByChunks(ids, buildQuery) {
  if (!ids.length) return [];
  const all = [];
  for (const idChunk of chunk(ids, IN_CHUNK_SIZE)) {
    const rows = await fetchPaged(() => buildQuery(idChunk));
    all.push(...rows);
  }
  return all;
}

async function loadExcelRows(month) {
  const client = requireSupabase();
  const [start, end] = monthBounds(month);

  const shifts = await fetchPaged(() => client
    .from('shifts')
    .select('id,sales_date,shift,employee_id,note')
    .gte('sales_date', start)
    .lt('sales_date', end)
    .order('sales_date', { ascending: true })
    .order('shift', { ascending: true })
    .order('id', { ascending: true }));

  if (!shifts.length) return [];

  const employeeIds = [...new Set(shifts.map((row) => row.employee_id).filter(Boolean))];
  const shiftIds = shifts.map((row) => row.id).filter(Boolean);

  const employees = await fetchByChunks(
    employeeIds,
    (ids) => client.from('employees').select('id,name').in('id', ids).order('name', { ascending: true })
  );

  const toppings = await fetchByChunks(
    shiftIds,
    (ids) => client.from('shift_toppings').select('shift_id,quantity').in('shift_id', ids).order('shift_id', { ascending: true })
  );

  const employeeMap = new Map(employees.map((row) => [row.id, row.name]));
  const quantityMap = new Map();
  toppings.forEach((row) => {
    const current = quantityMap.get(row.shift_id) || 0;
    quantityMap.set(row.shift_id, current + Math.max(0, Number(row.quantity) || 0));
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

function renderDownloadButton(filename, blob, rowCount, totalQuantity) {
  const host = $('#excelExportResult');
  if (!host) throw new Error('Không tìm thấy vùng hiển thị kết quả xuất Excel.');

  const previousUrl = host.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;
  host.replaceChildren();
  host.hidden = false;
  host.dataset.tone = 'success';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');

  const summary = document.createElement('p');
  summary.textContent = `Đã tạo ${rowCount} dòng. Tổng topping: ${totalQuantity.toLocaleString('vi-VN')}.`;
  host.appendChild(summary);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.className = 'feature-btn primary';
  link.style.display = 'inline-flex';
  link.textContent = `Tải ${filename}`;
  host.appendChild(link);
  return link;
}

async function exportExcel() {
  const button = $('#featureExcel');
  if (!button) return;

  const month = resolveExportMonth();
  const filename = `topping-${month}.xlsx`;
  const oldText = button.textContent;

  button.disabled = true;
  button.textContent = 'Đang tạo Excel...';
  setExportStatus('Đang lấy dữ liệu...', 'info');

  try {
    console.info('[Excel] Bắt đầu xuất tháng', month);
    const rows = await loadExcelRows(month);
    console.info('[Excel] Số dòng lấy được', rows.length);

    if (!rows.length) {
      const message = `Tháng ${formatMonthVi(month)} chưa có dữ liệu để xuất.`;
      setExportStatus(message, 'warning');
      return;
    }

    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const headers = ['Ngày', 'Ca', 'Nhân viên', 'Topping', 'Tiền', 'Ghi chú'];
    const data = rows.map((row) => [
      formatDateVi(row.date),
      row.shift,
      row.employee,
      row.quantity,
      row.money,
      row.note
    ]);
    const totals = ['Tổng cộng', '', '', totalQuantity, totalQuantity * 1000, ''];
    const blob = buildXlsxBlob({
      sheetName: `Topping ${formatMonthVi(month)}`,
      title: `BÁO CÁO TOPPING THÁNG ${formatMonthVi(month)}`,
      headers,
      rows: data,
      totals,
      widths: [13, 14, 24, 14, 16, 36]
    });
    const link = renderDownloadButton(filename, blob, rows.length, totalQuantity);

    try {
      link.click();
    } catch (error) {
      console.warn('[Excel] Tải tự động bị chặn. Dùng nút tải thủ công.', error);
    }

  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message ?? String(error);
    setExportStatus(message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function boot() {
  const host = $('#feature-tools-host');
  if (!host || $('#excelExportPanel')) return;

  const panel = document.createElement('section');
  panel.className = 'feature-panel';
  panel.id = 'excelExportPanel';
  const initialMonth = $('#recordsMonth')?.value || getLocalMonthValue();
  panel.innerHTML = `
    <h3>Xuất Excel</h3>
    <p class="muted">Chọn tháng cần xuất dữ liệu.</p>
    <div class="feature-toolbar">
      <label class="field-label" for="excelMonth">Tháng
        <input id="excelMonth" type="month" value="${initialMonth}">
      </label>
      <button class="feature-btn primary" id="featureExcel" type="button">Xuất Excel</button>
    </div>
    <div id="excelExportResult" class="feature-status" style="margin-top: 12px" hidden></div>
  `;
  host.prepend(panel);
  $('#featureExcel').addEventListener('click', () => void exportExcel());
}

boot();
