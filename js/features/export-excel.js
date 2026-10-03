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

function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
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

function buildExcelHtml(rows, month) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = rows.reduce((sum, row) => sum + row.money, 0);

  const body = rows.map((row) => `
    <tr>
      <td>${esc(row.date)}</td>
      <td>${esc(row.shift)}</td>
      <td>${esc(row.employee)}</td>
      <td style="mso-number-format:'0'">${row.quantity}</td>
      <td style="mso-number-format:'#,##0'">${row.money}</td>
      <td>${esc(row.note)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta charset="utf-8">
  <meta name="ProgId" content="Excel.Sheet">
  <style>
    table{border-collapse:collapse;font-family:Arial,sans-serif}
    th,td{border:1px solid #999;padding:6px 9px}
    th{font-weight:700;background:#eef2ff}
  </style>
</head>
<body>
  <table>
    <tr><th colspan="6">BÁO CÁO TOPPING THÁNG ${esc(month)}</th></tr>
    <tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th><th>Ghi chú</th></tr>
    ${body}
    <tr><th colspan="3">Tổng cộng</th><th>${totalQuantity}</th><th>${totalMoney}</th><th></th></tr>
  </table>
</body>
</html>`;
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
  link.className = 'feature-btn primary';
  link.style.display = 'inline-flex';
  link.style.marginTop = '10px';
  link.textContent = `⬇ Tải ${filename}`;
  link.addEventListener('click', () => notify(`Đang tải ${filename}...`));

  box.appendChild(link);
  host.appendChild(box);
  return link;
}

async function exportExcel() {
  const button = $('#featureExcel');
  if (!button) return;

  const month = $('#recordsMonth')?.value || new Date().toISOString().slice(0, 7);
  const filename = `topping-${month}.xls`;
  const oldText = button.textContent;

  button.disabled = true;
  button.textContent = 'Đang tạo Excel...';

  try {
    console.info('[Excel] Bắt đầu xuất tháng', month);
    const rows = await loadExcelRows(month);
    console.info('[Excel] Số dòng lấy được', rows.length);

    if (!rows.length) {
      notify(`Tháng ${month} chưa có dữ liệu để xuất.`);
      return;
    }

    const blob = new Blob(['\ufeff', buildExcelHtml(rows, month)], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    });

    const link = renderDownloadButton(filename, blob);

    // Desktop thường tải ngay. Nếu bị chặn thì nút tải thủ công vẫn luôn hiển thị.
    try {
      link.click();
    } catch (error) {
      console.warn('[Excel] Trình duyệt chặn tải tự động.', error);
    }

    notify('Đã tạo file Excel. Nếu chưa tải xuống, bấm nút tải ngay bên dưới.');
  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message || 'Lỗi không xác định';
    const host = getResultHost();
    if (host) host.innerHTML = `<div class="feature-warning"><strong>Xuất Excel lỗi:</strong> ${esc(message)}</div>`;
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
    <p class="muted">Xuất dữ liệu tháng đang chọn thành file Excel riêng.</p>
    <div class="feature-toolbar">
      <button class="feature-btn primary" id="featureExcel" type="button">Xuất Excel</button>
    </div>
  `;
  host.prepend(panel);
  $('#featureExcel').addEventListener('click', () => void exportExcel());
}

boot();
