import { requireSupabase } from './supabase.js';

const $ = (selector) => document.querySelector(selector);
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;
const num = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

function installStyle() {
  if ($('#all-employee-stats-style')) return;
  const style = document.createElement('style');
  style.id = 'all-employee-stats-style';
  style.textContent = `
    #employeeStatsBody tr.employee-stat-row td { padding-top: 14px; padding-bottom: 14px; }
    #employeeStatsBody tr.employee-stat-row:hover { background: #f8fbff; }
    #employeeStatsBody .employee-stat-name { font-weight: 700; color: var(--ink); }
    #employeeStatsBody .employee-stat-zero { color: #94a3b8; }
    #employeeStatsBody tr.employee-stat-total td {
      padding-top: 15px; padding-bottom: 15px; border-top: 2px solid #bfdbfe;
      background: #eff6ff; color: #1d4ed8; font-weight: 800;
    }
    #employeeStatsBody tr.employee-stat-total td:first-child { border-radius: 0 0 0 10px; }
    #employeeStatsBody tr.employee-stat-total td:last-child { border-radius: 0 0 10px 0; }
    html.dark #employeeStatsBody tr.employee-stat-row:hover { background: #172033; }
    html.dark #employeeStatsBody tr.employee-stat-total td { background: #172554; color: #bfdbfe; border-color: #1d4ed8; }
  `;
  document.head.appendChild(style);
}

async function renderAllEmployeesStats() {
  const month = $('#statisticsMonth')?.value;
  const body = $('#employeeStatsBody');
  if (!month || !body) return;

  const requestId = `${month}-${Date.now()}`;
  body.dataset.allEmployeeStatsRequest = requestId;

  try {
    const client = requireSupabase();
    const [start, end] = monthBounds(month);
    const [employeesResult, shiftsResult] = await Promise.all([
      client.from('employees').select('id,name,active').order('name', { ascending: true }),
      client.from('shifts')
        .select('id,employee_id,shift_toppings(quantity)')
        .gte('sales_date', start)
        .lt('sales_date', end)
    ]);

    if (employeesResult.error) throw employeesResult.error;
    if (shiftsResult.error) throw shiftsResult.error;
    if (body.dataset.allEmployeeStatsRequest !== requestId) return;

    const totalsByEmployee = new Map();
    (employeesResult.data || []).forEach((employee) => {
      totalsByEmployee.set(employee.id, {
        id: employee.id,
        name: employee.name,
        active: employee.active,
        shiftCount: 0,
        toppings: 0,
        money: 0
      });
    });

    (shiftsResult.data || []).forEach((shift) => {
      const item = totalsByEmployee.get(shift.employee_id);
      if (!item) return;
      const quantity = (shift.shift_toppings || []).reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0);
      item.shiftCount += 1;
      item.toppings += quantity;
      item.money += quantity * 1000;
    });

    const employeeRows = [...totalsByEmployee.values()];
    const totals = employeeRows.reduce((acc, employee) => {
      acc.shiftCount += employee.shiftCount;
      acc.toppings += employee.toppings;
      acc.money += employee.money;
      return acc;
    }, { shiftCount: 0, toppings: 0, money: 0 });

    body.innerHTML = employeeRows.map((employee) => {
      const zeroClass = employee.shiftCount === 0 ? ' employee-stat-zero' : '';
      const status = employee.active ? '' : ' <small style="font-weight:600;color:#94a3b8">(đã nghỉ)</small>';
      return `
        <tr class="employee-stat-row${zeroClass}">
          <td class="employee-stat-name">${escapeHtml(employee.name)}${status}</td>
          <td class="numeric">${num(employee.shiftCount)}</td>
          <td class="numeric">${num(employee.toppings)}</td>
          <td class="numeric row-total">${money(employee.money)}</td>
        </tr>`;
    }).join('') + `
      <tr class="employee-stat-total">
        <td>TỔNG TOÀN QUÁN</td>
        <td class="numeric">${num(totals.shiftCount)}</td>
        <td class="numeric">${num(totals.toppings)}</td>
        <td class="numeric">${money(totals.money)}</td>
      </tr>`;

    const empty = $('#employeeStatsEmpty');
    if (empty) empty.hidden = employeeRows.length > 0;
  } catch (error) {
    console.error('Không tải được bảng thống kê đầy đủ nhân viên.', error);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function boot() {
  installStyle();
  const month = $('#statisticsMonth');
  if (month) month.addEventListener('change', () => setTimeout(renderAllEmployeesStats, 80));

  const statsButton = document.querySelector('[data-view="statistics"]');
  statsButton?.addEventListener('click', () => setTimeout(renderAllEmployeesStats, 120));

  const body = $('#employeeStatsBody');
  if (body) {
    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!body.querySelector('.employee-stat-total')) void renderAllEmployeesStats();
      }, 100);
    });
    observer.observe(body, { childList: true });
  }

  setTimeout(renderAllEmployeesStats, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
