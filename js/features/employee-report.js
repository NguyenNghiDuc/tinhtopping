import { requireSupabase } from '../supabase.js';
import { $, fetchMonthRows, rowQuantity, money, installStyle } from './shared.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

let toppingPrice = 1000;
let currentRows = [];

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonth() {
  return localIsoDate().slice(0, 7);
}

function currentIsoWeek() {
  const now = new Date();
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayOfWeek = utcDate.getUTCDay() || 7;

  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayOfWeek);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const elapsedDays = Math.floor((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1;
  const weekNumber = Math.ceil(elapsedDays / 7);

  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

function weekBounds(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(value || ''));
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) return null;

  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function loadToppingPrice() {
  try {
    const result = await requireSupabase()
      .from('app_settings')
      .select('topping_price')
      .eq('id', true)
      .maybeSingle();

    const configuredPrice = Number(result.data?.topping_price);
    if (!result.error && Number.isFinite(configuredPrice) && configuredPrice > 0) {
      toppingPrice = configuredPrice;
    }
  } catch (error) {
    console.warn('Không tải được giá topping cho báo cáo.', error);
  }
}

async function getPeriodRows() {
  const mode = $('#employeeReportPeriod')?.value || 'month';

  if (mode === 'day') {
    const date = $('#employeeReportDate')?.value || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];

    const rows = await fetchMonthRows(date.slice(0, 7));
    return rows.filter((row) => row.sales_date === date);
  }

  if (mode === 'week') {
    const bounds = weekBounds($('#employeeReportWeek')?.value || '');
    if (!bounds) return [];

    const [start, end] = bounds;
    const startMonth = start.slice(0, 7);
    const endMonth = end.slice(0, 7);
    const rows = await fetchMonthRows(startMonth);

    if (endMonth !== startMonth) {
      rows.push(...await fetchMonthRows(endMonth));
    }

    return rows.filter((row) => row.sales_date >= start && row.sales_date <= end);
  }

  const month = $('#employeeReportMonth')?.value || '';
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return fetchMonthRows(month);
}

function employeeKey(row) {
  return String(row.employee_id || row.employees?.name || '');
}

async function refreshOptions() {
  const select = $('#employeeReportSelect');
  if (!select) return;

  try {
    currentRows = await getPeriodRows();
    const previous = select.value;
    const employees = new Map();

    for (const row of currentRows) {
      const id = employeeKey(row);
      const name = row.employees?.name || 'Không rõ';
      if (id && !employees.has(id)) employees.set(id, name);
    }

    const options = [...employees.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));

    select.innerHTML = '<option value="">Chọn nhân viên</option>' + options
      .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
      .join('');

    select.value = options.some(([id]) => id === previous) ? previous : '';

    const output = $('#employeeReportOutput');
    if (output) output.innerHTML = '<p class="muted">Chọn nhân viên rồi bấm “Xem báo cáo”.</p>';
  } catch (error) {
    console.error('Không tải được danh sách nhân viên cho báo cáo.', error);
    select.innerHTML = '<option value="">Không tải được danh sách</option>';
  }
}

async function loadReport() {
  const select = $('#employeeReportSelect');
  const output = $('#employeeReportOutput');
  if (!select || !output) return;

  if (!select.value) {
    output.innerHTML = '<p class="muted">Hãy chọn nhân viên cần xem.</p>';
    return;
  }

  output.innerHTML = '<p class="muted">Đang tải...</p>';

  try {
    currentRows = await getPeriodRows();
    const rows = currentRows.filter((row) => employeeKey(row) === select.value);
    const totalToppings = rows.reduce((sum, row) => sum + rowQuantity(row), 0);
    const totalMoney = totalToppings * toppingPrice;
    const employeeName = rows[0]?.employees?.name || select.selectedOptions[0]?.textContent || '';

    const tableRows = rows.map((row) => {
      const quantity = rowQuantity(row);
      const date = String(row.sales_date || '').split('-').reverse().join('/');
      const shift = SHIFT_LABELS[row.shift] || row.shift || '';

      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(shift)}</td>
        <td class="numeric">${quantity.toLocaleString('vi-VN')}</td>
        <td class="numeric">${money(quantity * toppingPrice)}</td>
      </tr>`;
    }).join('');

    output.innerHTML = `
      <div class="feature-report-summary">
        <div><span>Nhân viên</span><strong>${escapeHtml(employeeName)}</strong></div>
        <div><span>Số ca</span><strong>${rows.length}</strong></div>
        <div><span>Tổng topping</span><strong>${totalToppings.toLocaleString('vi-VN')}</strong></div>
        <div><span>Tổng tiền</span><strong>${money(totalMoney)}</strong></div>
      </div>
      <div class="table-scroll">
        <table class="data-table compact-table">
          <thead>
            <tr><th>Ngày</th><th>Ca</th><th class="numeric">Topping</th><th class="numeric">Tiền</th></tr>
          </thead>
          <tbody>${tableRows || '<tr><td colspan="4">Chưa có dữ liệu.</td></tr>'}</tbody>
        </table>
      </div>`;
  } catch (error) {
    console.error('Không tải được báo cáo nhân viên.', error);
    output.innerHTML = `<p class="muted">${escapeHtml(error?.message || 'Không tải được báo cáo.')}</p>`;
  }
}

function syncPeriodControls() {
  const mode = $('#employeeReportPeriod')?.value || 'month';
  const monthInput = $('#employeeReportMonth');
  const weekInput = $('#employeeReportWeek');
  const dateInput = $('#employeeReportDate');

  if (monthInput) monthInput.hidden = mode !== 'month';
  if (weekInput) weekInput.hidden = mode !== 'week';
  if (dateInput) dateInput.hidden = mode !== 'day';

  void refreshOptions();
}

function init() {
  if (document.body.dataset.featureEmployeeReport === '1') return;

  const statsPanel = $('#view-statistics .stats-panel');
  if (!statsPanel) return;

  if ($('#employeeReportPanel')) {
    document.body.dataset.featureEmployeeReport = '1';
    return;
  }

  document.body.dataset.featureEmployeeReport = '1';

  installStyle('feature-employee-report-style', `
    .feature-report-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb}
    .feature-report-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px}
    .feature-report-controls label{display:grid;gap:5px;font:700 11px 'DM Sans',sans-serif;color:#64748b}
    .feature-report-controls select,.feature-report-controls input{min-height:38px;border:1px solid #dbe3ef;border-radius:8px;padding:7px 10px;background:#fff}
    .feature-report-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
    .feature-report-summary>div{padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}
    .feature-report-summary span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}
    .feature-report-summary strong{display:block;font-size:17px;overflow-wrap:anywhere}
    @media(max-width:900px){.feature-report-summary{grid-template-columns:1fr 1fr}}
    @media(max-width:760px){.feature-report-summary{grid-template-columns:1fr}.feature-report-controls>*{width:100%}.feature-report-controls select,.feature-report-controls input{width:100%;box-sizing:border-box}}
  `);

  const today = localIsoDate();
  const panel = document.createElement('div');
  panel.id = 'employeeReportPanel';
  panel.className = 'feature-report-panel';
  panel.innerHTML = `
    <div class="panel-title">
      <div>
        <h3>Báo cáo chi tiết nhân viên</h3>
        <p class="muted">Xem theo ngày, tuần hoặc tháng.</p>
      </div>
    </div>
    <div class="feature-report-controls">
      <label>Kỳ
        <select id="employeeReportPeriod">
          <option value="month">Tháng</option>
          <option value="week">Tuần</option>
          <option value="day">Ngày</option>
        </select>
      </label>
      <input id="employeeReportMonth" type="month" value="${currentMonth()}" aria-label="Tháng báo cáo">
      <input id="employeeReportWeek" type="week" value="${currentIsoWeek()}" aria-label="Tuần báo cáo" hidden>
      <input id="employeeReportDate" type="date" value="${today}" aria-label="Ngày báo cáo" hidden>
      <label>Nhân viên
        <select id="employeeReportSelect"><option value="">Chọn nhân viên</option></select>
      </label>
      <button type="button" id="loadEmployeeReport" class="feature-btn">Xem báo cáo</button>
    </div>
    <div id="employeeReportOutput"><p class="muted">Đang chuẩn bị dữ liệu...</p></div>`;

  statsPanel.appendChild(panel);

  $('#employeeReportPeriod')?.addEventListener('change', syncPeriodControls);

  for (const id of ['employeeReportMonth', 'employeeReportWeek', 'employeeReportDate']) {
    $(`#${id}`)?.addEventListener('change', () => void refreshOptions());
  }

  $('#loadEmployeeReport')?.addEventListener('click', () => void loadReport());

  void (async () => {
    await loadToppingPrice();
    await refreshOptions();
  })();
}

init();
