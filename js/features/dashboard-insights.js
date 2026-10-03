import { $, money, fetchMonthRows, rowQuantity } from './shared.js';

const shiftLabels = { morning: 'Ca Sáng', afternoon: 'Ca Chiều', evening: 'Ca Tối' };

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const monthNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

function prevMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function shortName(name, max = 13) {
  const text = String(name || 'Không rõ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function drawEmployeeBarChart(svg, entries) {
  if (!svg) return;

  if (!entries.length) {
    svg.setAttribute('viewBox', '0 0 900 280');
    svg.innerHTML = '<text x="450" y="140" text-anchor="middle" fill="#64748b">Chưa có dữ liệu nhân viên</text>';
    return;
  }

  const width = Math.max(900, entries.length * 110 + 110);
  const height = 320;
  const left = 58;
  const right = 30;
  const top = 35;
  const bottom = 78;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - right;
  const maxValue = Math.max(...entries.map(([, value]) => value), 1);
  const slot = chartWidth / entries.length;
  const barWidth = Math.min(58, slot * 0.62);

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = top + chartHeight - chartHeight * ratio;
    const value = Math.round(maxValue * ratio);
    return `
      <line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
      <text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${value.toLocaleString('vi-VN')}</text>
    `;
  }).join('');

  const bars = entries.map(([name, value], index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const barHeight = value > 0 ? Math.max(2, (value / maxValue) * chartHeight) : 0;
    const y = top + chartHeight - barHeight;
    const center = x + barWidth / 2;
    const valueY = Math.max(16, y - 8);
    const amount = value * 1000;

    return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="7" fill="#2563eb">
          <title>${esc(name)}: ${value.toLocaleString('vi-VN')} topping · ${money(amount)}</title>
        </rect>
        <text x="${center}" y="${valueY}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${value.toLocaleString('vi-VN')}</text>
        <text x="${center}" y="${height - 45}" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">${esc(shortName(name))}</text>
        <text x="${center}" y="${height - 27}" text-anchor="middle" font-size="10" fill="#64748b">${money(amount)}</text>
      </g>
    `;
  }).join('');

  svg.innerHTML = `
    ${grid}
    <line x1="${left}" y1="${top + chartHeight}" x2="${width - right}" y2="${top + chartHeight}" stroke="#94a3b8"/>
    ${bars}
  `;
}

async function render() {
  const host = $('#feature-dashboard-host');
  if (!host) return;

  host.innerHTML = '<section class="feature-panel"><p class="muted">Đang tải tổng quan...</p></section>';

  try {
    const month = $('#recordsMonth')?.value || monthNow();
    const rows = await fetchMonthRows(month);
    const previousRows = await fetchMonthRows(prevMonth(month));
    const date = today();
    const todayRows = rows.filter((row) => row.sales_date === date);
    const todayQty = todayRows.reduce((sum, row) => sum + rowQuantity(row), 0);
    const monthQty = rows.reduce((sum, row) => sum + rowQuantity(row), 0);
    const prevQty = previousRows.reduce((sum, row) => sum + rowQuantity(row), 0);
    const shifts = new Set(todayRows.map((row) => row.shift));
    const missing = Object.keys(shiftLabels).filter((shift) => !shifts.has(shift));

    const byEmployee = {};
    rows.forEach((row) => {
      const name = row.employees?.name || 'Không rõ';
      byEmployee[name] = (byEmployee[name] || 0) + rowQuantity(row);
    });

    const employeeEntries = Object.entries(byEmployee)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));
    const top = employeeEntries.slice(0, 5);

    host.innerHTML = `
      <div class="feature-grid">
        <div class="feature-card"><small>Topping hôm nay</small><strong>${todayQty.toLocaleString('vi-VN')}</strong></div>
        <div class="feature-card"><small>Doanh thu hôm nay</small><strong>${money(todayQty * 1000)}</strong></div>
        <div class="feature-card"><small>Tháng này</small><strong>${monthQty.toLocaleString('vi-VN')} topping</strong></div>
        <div class="feature-card"><small>So tháng trước</small><strong>${prevQty ? `${((monthQty - prevQty) / prevQty * 100).toFixed(1)}%` : '-'}</strong></div>
      </div>
      <section class="feature-panel">
        <h3>Trạng thái hôm nay</h3>
        <div class="${missing.length ? 'feature-warning' : 'feature-warning feature-ok'}">${missing.length ? `Còn thiếu: ${missing.map((shift) => shiftLabels[shift]).join(', ')}` : 'Đã có dữ liệu đủ 3 ca.'}</div>
      </section>
      <section class="feature-panel">
        <h3>Top nhân viên tháng</h3>
        ${top.map(([name, quantity], index) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eef2f7"><span>${index + 1}. ${esc(name)}</span><strong>${quantity.toLocaleString('vi-VN')}</strong></div>`).join('') || '<p class="muted">Chưa có dữ liệu.</p>'}
      </section>
      <section class="feature-panel">
        <h3>Biểu đồ topping theo nhân viên</h3>
        <p class="muted">Mỗi cột là tổng topping của một nhân viên trong tháng đang chọn.</p>
        <div style="overflow-x:auto;padding-bottom:4px">
          <svg id="featureEmployeeChart" style="width:100%;min-width:900px;height:320px;display:block"></svg>
        </div>
      </section>
    `;

    drawEmployeeBarChart($('#featureEmployeeChart'), employeeEntries);
  } catch (error) {
    host.innerHTML = `<section class="feature-panel"><p class="feature-warning">${esc(error.message || 'Không tải được tổng quan.')}</p></section>`;
  }
}

render();
$('#recordsMonth')?.addEventListener('change', render);
document.addEventListener('topping:settings-changed', render);
