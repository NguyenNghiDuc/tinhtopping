import { requireSupabase } from './supabase.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

let formDirty = false;
let currentRole = null;
let applyingPermissions = false;

const $ = (selector) => document.querySelector(selector);

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function notify(message) {
  const toast = $('#toast');
  if (!toast) {
    window.alert(message);
    return;
  }
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function installStyles() {
  if ($('#productivity-tools-style')) return;
  const style = document.createElement('style');
  style.id = 'productivity-tools-style';
  style.textContent = `
    .productivity-button {
      display:inline-flex;align-items:center;justify-content:center;gap:7px;
      min-height:38px;padding:8px 13px;border-radius:9px;border:1px solid #cbd5e1;
      background:#fff;color:#334155;font:700 12px 'DM Sans',sans-serif;cursor:pointer;
    }
    .productivity-button:hover{background:#f8fafc;border-color:#94a3b8}
    .productivity-button:disabled{opacity:.55;cursor:wait}
    .productivity-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .copy-previous-button{margin-left:auto}
    .role-pill{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font:700 11px 'DM Sans',sans-serif;margin-left:8px}
    @media(max-width:720px){.copy-previous-button{width:100%;margin:10px 0 0}.editor-heading{flex-wrap:wrap}.productivity-button{min-height:42px}}
  `;
  document.head.appendChild(style);
}

function ensureExportButton() {
  const toolbar = $('#view-records .toolbar-actions');
  if (!toolbar || $('#exportMonthExcelButton')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'exportMonthExcelButton';
  button.className = 'productivity-button';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"/></svg>Xuất Excel';
  toolbar.insertBefore(button, $('#addShiftButton'));
  button.addEventListener('click', exportCurrentMonth);
}

function ensureCopyButton() {
  const heading = $('#shiftEditor .editor-heading');
  if (!heading || $('#copyPreviousDayButton')) return;
  const closeButton = $('#closeEditorButton');
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'copyPreviousDayButton';
  button.className = 'productivity-button copy-previous-button';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>Sao chép ngày trước';
  heading.insertBefore(button, closeButton);
  button.addEventListener('click', copyPreviousDay);
}

function previousIsoDate(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

function getRowByEmployeeName(shiftId, employeeName) {
  const column = $(`#batch-column-${shiftId}`);
  if (!column) return null;
  const target = normalizeName(employeeName);
  return [...column.querySelectorAll('.batch-employee-row')].find((row) => {
    const name = row.querySelector('.batch-employee-name')?.textContent;
    return normalizeName(name) === target;
  }) || null;
}

async function copyPreviousDay() {
  const dateInput = $('#shiftDate');
  const editor = $('#shiftEditor');
  if (!dateInput || !editor || editor.hidden || !dateInput.value) return;

  const hasEnteredData = [...editor.querySelectorAll('[data-batch-quantity]')].some((input) => Number(input.value || 0) > 0)
    || [...editor.querySelectorAll('[data-batch-note]')].some((input) => input.value.trim());
  if (hasEnteredData && !window.confirm('Ngày hiện tại đang có dữ liệu trên form. Sao chép ngày trước sẽ ghi đè số topping và ghi chú đang nhập. Tiếp tục?')) return;

  const button = $('#copyPreviousDayButton');
  const previousDate = previousIsoDate(dateInput.value);
  const originalText = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Đang sao chép...';

  try {
    const client = requireSupabase();
    const result = await client
      .from('shifts')
      .select('shift,note,employees(name),shift_toppings(quantity)')
      .eq('sales_date', previousDate)
      .order('shift');
    if (result.error) throw result.error;
    const sourceRows = result.data || [];
    if (!sourceRows.length) {
      notify(`Ngày ${previousDate.split('-').reverse().join('/')} chưa có dữ liệu để sao chép.`);
      return;
    }

    for (const shiftId of Object.keys(SHIFT_LABELS)) {
      const addAll = $(`#batch-column-${shiftId} [data-batch-action="add-all"]`);
      if (addAll && !addAll.disabled) addAll.click();
    }

    for (const source of sourceRows) {
      const shiftId = source.shift;
      const employeeName = source.employees?.name || '';
      const quantity = (source.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
      const row = getRowByEmployeeName(shiftId, employeeName);
      const input = row?.querySelector('[data-batch-quantity]');
      if (input) {
        input.value = String(quantity);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    for (const shiftId of Object.keys(SHIFT_LABELS)) {
      const firstSource = sourceRows.find((row) => row.shift === shiftId);
      const note = $(`[data-batch-note="${shiftId}"]`);
      if (note) {
        note.value = firstSource?.note || '';
        note.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    formDirty = true;
    notify(`Đã sao chép dữ liệu từ ngày ${previousDate.split('-').reverse().join('/')}. Kiểm tra lại rồi bấm LƯU TẤT CẢ.`);
  } catch (error) {
    console.error('Không sao chép được dữ liệu ngày trước.', error);
    window.alert(error?.message || 'Không sao chép được dữ liệu ngày trước.');
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

function excelCell(value, type = 'String') {
  return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

async function exportCurrentMonth() {
  const month = $('#recordsMonth')?.value;
  if (!month) return window.alert('Vui lòng chọn tháng cần xuất.');
  const button = $('#exportMonthExcelButton');
  const originalText = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Đang xuất...';

  try {
    const [year, monthNumber] = month.split('-').map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    const client = requireSupabase();
    const result = await client
      .from('shifts')
      .select('sales_date,shift,note,employees(name),shift_toppings(quantity)')
      .gte('sales_date', `${month}-01`)
      .lt('sales_date', end)
      .order('sales_date', { ascending: true })
      .order('shift');
    if (result.error) throw result.error;

    const rows = result.data || [];
    let totalToppings = 0;
    let totalMoney = 0;
    const tableRows = rows.map((row) => {
      const quantity = (row.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
      const money = quantity * 1000;
      totalToppings += quantity;
      totalMoney += money;
      const [y, m, d] = row.sales_date.split('-');
      return `<Row>${excelCell(`${d}/${m}/${y}`)}${excelCell(SHIFT_LABELS[row.shift] || row.shift)}${excelCell(row.employees?.name || '')}${excelCell(quantity, 'Number')}${excelCell(money, 'Number')}${excelCell(row.note || '')}</Row>`;
    }).join('');

    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Topping ${escapeXml(month)}"><Table><Row>${excelCell('Ngày')}${excelCell('Ca')}${excelCell('Nhân viên')}${excelCell('Số topping')}${excelCell('Tiền topping')}${excelCell('Ghi chú')}</Row>${tableRows}<Row>${excelCell('TỔNG THÁNG')}${excelCell('')}${excelCell('')}${excelCell(totalToppings, 'Number')}${excelCell(totalMoney, 'Number')}${excelCell('')}</Row></Table></Worksheet></Workbook>`;
    const blob = new Blob(['\ufeff', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `topping-${month}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Đã xuất Excel tháng ${monthNumber}/${year}: ${rows.length} dòng, ${totalToppings.toLocaleString('vi-VN')} topping.`);
  } catch (error) {
    console.error('Không xuất được Excel.', error);
    window.alert(error?.message || 'Không xuất được Excel tháng này.');
  } finally {
    button.disabled = false;
    button.innerHTML = originalText;
  }
}

function markDirtyFromEditor(event) {
  const editor = $('#shiftEditor');
  if (!editor || editor.hidden || !editor.contains(event.target)) return;
  if (event.target.closest('#copyPreviousDayButton')) return;
  if (event.type === 'click' && !event.target.closest('[data-batch-action], .batch-remove-button')) return;
  formDirty = true;
}

function confirmDiscard() {
  if (!formDirty || $('#shiftEditor')?.hidden) return true;
  return window.confirm('Bạn đang có thay đổi chưa lưu. Nếu rời khỏi đây, các thay đổi trên form sẽ bị mất.');
}

function installUnsavedProtection() {
  const editor = $('#shiftEditor');
  if (!editor || editor.dataset.unsavedProtection === '1') return;
  editor.dataset.unsavedProtection = '1';
  editor.addEventListener('input', markDirtyFromEditor, true);
  editor.addEventListener('change', markDirtyFromEditor, true);
  editor.addEventListener('click', markDirtyFromEditor, true);

  window.addEventListener('beforeunload', (event) => {
    if (!formDirty || $('#shiftEditor')?.hidden) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('click', (event) => {
    const leaveTarget = event.target.closest('.nav-link, #signOutButton, #closeEditorButton, #cancelEditorButton');
    if (!leaveTarget) return;
    if (!confirmDiscard()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    formDirty = false;
  }, true);

  const observer = new MutationObserver(() => {
    if (editor.hidden) formDirty = false;
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['hidden'] });
}

async function loadRole() {
  try {
    const client = requireSupabase();
    const sessionResult = await client.auth.getSession();
    const user = sessionResult.data?.session?.user;
    if (!user) {
      currentRole = null;
      return;
    }
    const roleResult = await client.from('user_profiles').select('role').eq('user_id', user.id).maybeSingle();
    if (roleResult.error) throw roleResult.error;
    currentRole = roleResult.data?.role || 'employee';
    applyRolePermissions();
  } catch (error) {
    console.error('Không đọc được quyền người dùng.', error);
  }
}

function applyRolePermissions() {
  if (applyingPermissions || !currentRole) return;
  applyingPermissions = true;
  try {
    const manager = currentRole === 'manager';
    document.body.dataset.userRole = currentRole;

    const signedInLabel = $('#signedInLabel');
    if (signedInLabel && !signedInLabel.querySelector('.role-pill')) {
      const pill = document.createElement('span');
      pill.className = 'role-pill';
      pill.textContent = manager ? 'Quản lý' : 'Nhân viên';
      signedInLabel.appendChild(pill);
    }

    if (!manager) {
      document.querySelectorAll('[data-view="statistics"], [data-view="employees"], #addEmployeeButton, .history-record-actions, [data-delete-day], #view-employees, #view-statistics').forEach((element) => {
        element.hidden = true;
        element.style.display = 'none';
      });
      const activeRestricted = document.querySelector('.nav-link.active[data-view="statistics"], .nav-link.active[data-view="employees"]');
      if (activeRestricted) document.querySelector('.nav-link[data-view="records"]')?.click();
    }
  } finally {
    applyingPermissions = false;
  }
}

function installPermissionObserver() {
  const root = $('#application');
  if (!root || root.dataset.roleObserver === '1') return;
  root.dataset.roleObserver = '1';
  const observer = new MutationObserver(() => {
    if (currentRole) queueMicrotask(applyRolePermissions);
  });
  observer.observe(root, { childList: true, subtree: true });
}

function rememberWorkingPeriod() {
  const month = $('#recordsMonth');
  const summaryDate = $('#summaryDate');
  if (month) {
    const remembered = localStorage.getItem('topping:lastMonth');
    if (remembered && /^\d{4}-\d{2}$/.test(remembered)) month.value = remembered;
    month.addEventListener('change', () => localStorage.setItem('topping:lastMonth', month.value));
  }
  if (summaryDate) {
    summaryDate.addEventListener('change', () => localStorage.setItem('topping:lastDate', summaryDate.value));
  }
}

function boot() {
  installStyles();
  ensureExportButton();
  ensureCopyButton();
  installUnsavedProtection();
  installPermissionObserver();
  rememberWorkingPeriod();
  void loadRole();

  const observer = new MutationObserver(() => {
    ensureExportButton();
    ensureCopyButton();
    if (currentRole) applyRolePermissions();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const authObserver = new MutationObserver(() => {
    const application = $('#application');
    if (application && !application.hidden) void loadRole();
  });
  const application = $('#application');
  if (application) authObserver.observe(application, { attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
