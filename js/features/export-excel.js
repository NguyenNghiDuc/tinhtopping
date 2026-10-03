import { requireSupabase } from '../supabase.js';
import { $, notify } from './shared.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function getLocalMonthValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

function resolveExportMonth() {
  const explicit = $('#excelExportMonth')?.value || $('#recordsMonth')?.value || getLocalMonthValue();
  if ($('#excelExportMonth')) $('#excelExportMonth').value = explicit;
  return explicit;
}

function setExportStatus(message, tone = 'info') {
  const status = $('#excelExportStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
}

async function loadExcelRows(month) {
  const client = requireSupabase();
  const [start, end] = monthBounds(month);

  // Không dùng embedded relation để tránh PostgREST 400 khi schema cache lệch.
  const shiftsResult = await client
    .from('shifts')
    .select('id,sales_date,shift,employee_id,note')
    .gte('sales_date', start)
    .lt('sales_date', end)
    .order('sales_date', { ascending: true })
    .order('shift', { ascending: true });

  if (shiftsResult.error) throw shiftsResult.error;
  const shifts = shiftsResult.data || [];
  if (!shifts.length) return [];

  const employeeIds = [...new Set(shifts.map((row) => row.employee_id).filter(Boolean))];
  const shiftIds = shifts.map((row) => row.id);

  const [employeesResult, toppingsResult] = await Promise.all([
    employeeIds.length
      ? client.from('employees').select('id,name').in('id', employeeIds)
      : Promise.resolve({ data: [], error: null }),
    shiftIds.length
      ? client.from('shift_toppings').select('shift_id,quantity').in('shift_id', shiftIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (employeesResult.error) throw employeesResult.error;
  if (toppingsResult.error) throw toppingsResult.error;

  const employeeMap = new Map((employeesResult.data || []).map((row) => [row.id, row.name]));
  const quantityMap = new Map();
  (toppingsResult.data || []).forEach((row) => {
    const current = quantityMap.get(row.shift_id) || 0;
    quantityMap.set(row.shift_id, current + Math.max(0, Number(row.quantity) || 0));
  });

  return shifts.map((row) => ({
    date: row.sales_date,
    shift: SHIFT_LABELS[row.shift] || row.shift || '',
    employee: employeeMap.get(row.employee_id) || '',
    quantity: quantityMap.get(row.id) || 0,
    money: (quantityMap.get(row.id) || 0) * 1000,
    note: row.note || ''
  }));
}

function buildExcelCsv(rows, month) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = rows.reduce((sum, row) => sum + row.money, 0);
  const exportDate = getLocalDateValue();

  const escapeCsv = (value) => {
    const stringValue = String(value ?? '');
    const escaped = stringValue.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const lines = [
    ['BÁO CÁO TOPPING THÁNG', month, `Xuất ngày ${exportDate}`],
    ['Ngày', 'Ca', 'Nhân viên', 'Topping', 'Tiền', 'Ghi chú'],
    ...rows.map((row) => [row.date, row.shift, row.employee, String(row.quantity), String(row.money), row.note || '']),
    ['Tổng cộng', '', '', String(totalQuantity), String(totalMoney), '']
  ];

  return lines.map((line) => line.map(escapeCsv).join(',')).join('\n') + '\n';
}

function getResultHost() {
  let host = $('#excelExportResult');
  if (host) return host;

  const panel = $('#excelExportPanel');
  if (!panel) return null;

  host = document.createElement('div');
  host.id = 'excelExportResult';
  host.style.marginTop = '12px';
  panel.appendChild(host);
  return host;
}

function renderDownloadButton(filename, blob) {
  const host = getResultHost();
  if (!host) throw new Error('Không tìm thấy vùng hiển thị file Excel.');

  const previousUrl = host.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;
  host.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'feature-warning feature-ok';
  box.innerHTML = '<strong>File Excel đã tạo xong.</strong><br><span>Bấm nút dưới đây để tải.</span><br>';

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.className = 'feature-btn primary';
  link.style.display = 'inline-flex';
  link.style.marginTop = '10px';
  link.textContent = `⬇ Tải ${filename}`;
  link.addEventListener('click', () => notify(`Đang tải ${filename}...`));

  box.appendChild(link);
  host.appendChild(box);

  setTimeout(() => {
    try {
      const popup = window.open(url, '_blank', 'noopener,noreferrer');
      if (popup) popup.opener = null;
    } catch (error) {
      console.warn('Không mở tab tải dự phòng cho Excel.', error);
    }
  }, 250);

  return link;
}

async function exportExcel() {
  const button = $('#featureExcel');
  if (!button) return;

  const month = resolveExportMonth();
  const exportDate = getLocalDateValue();
  const filename = `topping-${month}-${exportDate}.csv`;
  const oldText = button.textContent;

  button.disabled = true;
  button.textContent = 'Đang tạo Excel...';
  setExportStatus('Đang tạo file Excel...', 'info');

  try {
    console.info('[Excel] Bắt đầu xuất tháng', month);
    const rows = await loadExcelRows(month);
    console.info('[Excel] Số dòng lấy được', rows.length);

    if (!rows.length) {
      const message = `Tháng ${month} chưa có dữ liệu để xuất.`;
      setExportStatus(message, 'warning');
      notify(message);
      return;
    }

    const csv = buildExcelCsv(rows, month);
    const blob = new Blob(['\ufeff', csv], {
      type: 'text/csv;charset=utf-8'
    });

    const link = renderDownloadButton(filename, blob);

    try {
      link.click();
    } catch (error) {
      console.warn('[Excel] Trình duyệt chặn tải tự động, hiển thị nút tải thủ công.', error);
    }

    setExportStatus('File đã được tạo. Nếu chưa tải xuống, bấm nút tải ngay bên dưới.', 'success');
    notify('Đã tạo file Excel. Nếu chưa tải xuống, bấm nút tải ngay bên dưới.');
  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message || 'Lỗi không xác định';
    const host = getResultHost();
    if (host) host.innerHTML = `<div class="feature-warning"><strong>Xuất Excel lỗi:</strong> ${esc(message)}</div>`;
    setExportStatus(`Xuất Excel lỗi: ${message}`, 'error');
    notify(`Xuất Excel lỗi: ${message}`);
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
  panel.innerHTML = `
    <h3>Xuất Excel</h3>
    <p class="muted">Xuất dữ liệu theo tháng đang chọn thành file Excel riêng.</p>
    <div class="feature-toolbar">
      <label class="field-label" for="excelExportMonth">Tháng
        <input id="excelExportMonth" type="month" value="${getLocalMonthValue()}">
      </label>
      <button class="feature-btn primary" id="featureExcel" type="button">Xuất Excel</button>
    </div>
    <div id="excelExportStatus" class="feature-status" hidden></div>
  `;
  host.prepend(panel);
  $('#featureExcel').addEventListener('click', () => void exportExcel());
}

boot();
