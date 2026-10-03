import { $, fetchMonthRows, rowQuantity, money, installStyle } from './shared.js';

const SHIFT_LABELS = { morning: 'Ca Sáng', afternoon: 'Ca Chiều', evening: 'Ca Tối' };

async function refreshOptions() {
  const select = $('#employeeReportSelect');
  const month = $('#statisticsMonth')?.value || $('#recordsMonth')?.value;
  if (!select || !month) return;
  try {
    const rows = await fetchMonthRows(month);
    const current = select.value;
    const names = [...new Set(rows.map((row) => row.employees?.name).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'vi'));
    select.innerHTML = '<option value="">Chọn nhân viên</option>' + names.map((name) => `<option value="${name.replace(/"/g,'&quot;')}">${name}</option>`).join('');
    if (names.includes(current)) select.value = current;
  } catch (error) {
    console.warn('Không tải được danh sách báo cáo nhân viên.', error);
  }
}

async function loadReport() {
  const month = $('#statisticsMonth')?.value;
  const select = $('#employeeReportSelect');
  const output = $('#employeeReportOutput');
  if (!month || !select?.value || !output) return;
  output.innerHTML = '<p class="muted">Đang tải...</p>';
  try {
    const rows = (await fetchMonthRows(month)).filter((row) => row.employees?.name === select.value);
    const totalQty = rows.reduce((sum, row) => sum + rowQuantity(row), 0);
    output.innerHTML = `
      <div class="feature-report-summary">
        <div><span>Số ca</span><strong>${rows.length}</strong></div>
        <div><span>Tổng topping</span><strong>${totalQty.toLocaleString('vi-VN')}</strong></div>
        <div><span>Tổng tiền</span><strong>${money(totalQty * 1000)}</strong></div>
      </div>
      <div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Ngày</th><th>Ca</th><th class="numeric">Topping</th><th class="numeric">Tiền</th></tr></thead><tbody>
        ${rows.map((row) => { const q = rowQuantity(row); return `<tr><td>${row.sales_date.split('-').reverse().join('/')}</td><td>${SHIFT_LABELS[row.shift] || row.shift}</td><td class="numeric">${q.toLocaleString('vi-VN')}</td><td class="numeric">${money(q * 1000)}</td></tr>`; }).join('') || '<tr><td colspan="4">Chưa có dữ liệu.</td></tr>'}
      </tbody></table></div>`;
  } catch (error) {
    output.innerHTML = `<p class="muted">${error?.message || 'Không tải được báo cáo.'}</p>`;
  }
}

function init() {
  if (document.body.dataset.featureEmployeeReport === '1') return;
  document.body.dataset.featureEmployeeReport = '1';
  const statsPanel = $('#view-statistics .stats-panel');
  if (!statsPanel || $('#employeeReportPanel')) return;

  installStyle('feature-employee-report-style', `
    .feature-report-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb}
    .feature-report-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px}
    .feature-report-controls label{display:grid;gap:5px;font:700 11px 'DM Sans',sans-serif;color:#64748b}
    .feature-report-controls select{min-width:220px;min-height:38px;border:1px solid #dbe3ef;border-radius:8px;padding:7px 10px;background:#fff}
    .feature-report-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
    .feature-report-summary>div{padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}
    .feature-report-summary span{display:block;font-size:11px;color:#64748b}.feature-report-summary strong{display:block;margin-top:4px;font-size:18px}
    @media(max-width:760px){.feature-report-summary{grid-template-columns:1fr}.feature-report-controls>*{width:100%}.feature-report-controls select{width:100%;min-width:0}}
  `);

  const panel = document.createElement('div');
  panel.id = 'employeeReportPanel';
  panel.className = 'feature-report-panel';
  panel.innerHTML = `
    <div class="panel-title"><div><h3>Báo cáo chi tiết nhân viên</h3><p class="muted">Xem từng ca, tổng topping và tổng tiền theo tháng.</p></div></div>
    <div class="feature-report-controls">
      <label>Nhân viên<select id="employeeReportSelect"><option value="">Chọn nhân viên</option></select></label>
      <button type="button" id="loadEmployeeReport" class="advanced-toolbar-button">Xem báo cáo</button>
    </div>
    <div id="employeeReportOutput"></div>`;
  statsPanel.appendChild(panel);

  $('#loadEmployeeReport')?.addEventListener('click', () => void loadReport());
  $('#statisticsMonth')?.addEventListener('change', () => void refreshOptions());
  void refreshOptions();
}

init();
