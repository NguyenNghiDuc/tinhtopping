import { requireSupabase } from './supabase.js';

const SHIFTS = [
  { id: 'morning', label: 'Ca Sáng' },
  { id: 'afternoon', label: 'Ca Chiều' },
  { id: 'evening', label: 'Ca Tối' }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('vi');
const localAuditKey = 'topping_audit_log_v1';
const offlineDraftKey = 'topping_offline_draft_v1';
let auditTableAvailable = null;
let editorBaseline = null;
let editorBaselineDate = null;
let pendingSaveSummary = null;
let undoState = null;
let usageScores = {};
let advancedInstalling = false;

function notify(message, duration = 3200) {
  const toast = $('#toast');
  if (!toast) return window.alert(message);
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function installAdvancedStyles() {
  if ($('#advanced-tools-style')) return;
  const style = document.createElement('style');
  style.id = 'advanced-tools-style';
  style.textContent = `
    .advanced-shift-tools{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 4px}
    .advanced-mini-button,.advanced-toolbar-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 10px;border:1px solid #d6deea;border-radius:8px;background:#fff;color:#475569;font:700 11px 'DM Sans',sans-serif;cursor:pointer}
    .advanced-mini-button:hover,.advanced-toolbar-button:hover{background:#f8fafc;border-color:#aebbd0;color:#1e40af}
    .advanced-mini-button.danger-lite:hover{color:#b91c1c;border-color:#fecaca;background:#fef2f2}
    .employee-quick-search{width:100%;min-height:35px;padding:7px 10px;border:1px solid #dbe3ef;border-radius:8px;background:#fff;font:600 12px 'DM Sans',sans-serif;margin-bottom:6px}
    .advanced-toolbar-button{min-height:38px}
    .employee-report-panel{margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb}
    .employee-report-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:14px}
    .employee-report-controls label{display:grid;gap:5px;font:700 11px 'DM Sans',sans-serif;color:#64748b}
    .employee-report-controls select{min-width:220px;min-height:38px;border:1px solid #dbe3ef;border-radius:8px;padding:7px 10px;background:#fff}
    .employee-report-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px}
    .employee-report-summary>div{padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc}
    .employee-report-summary span{display:block;font-size:11px;color:#64748b}.employee-report-summary strong{display:block;margin-top:4px;font-size:18px}
    .advanced-dialog{width:min(840px,92vw);max-height:82vh;border:0;border-radius:14px;padding:0;box-shadow:0 24px 70px rgba(15,23,42,.25)}
    .advanced-dialog::backdrop{background:rgba(15,23,42,.45)}
    .advanced-dialog-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #e2e8f0}.advanced-dialog-head h3{margin:0}
    .advanced-dialog-body{padding:14px 18px;overflow:auto;max-height:65vh}.audit-row{padding:10px 0;border-bottom:1px solid #eef2f7}.audit-row:last-child{border:0}.audit-row small{color:#64748b}.audit-row strong{display:block;margin:2px 0}
    .undo-bar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;background:#0f172a;color:#fff;box-shadow:0 12px 35px rgba(15,23,42,.3);font:600 12px 'DM Sans',sans-serif}.undo-bar button{border:0;border-radius:7px;padding:7px 10px;background:#fff;color:#0f172a;font-weight:800;cursor:pointer}
    .offline-badge{display:none;position:fixed;right:16px;bottom:16px;z-index:9998;padding:8px 11px;border-radius:999px;background:#7f1d1d;color:#fff;font:700 11px 'DM Sans',sans-serif}.offline-badge.show{display:block}
    @media(max-width:760px){
      .toolbar-actions{flex-wrap:wrap}.advanced-toolbar-button{flex:1 1 auto}
      .batch-shift-columns{grid-template-columns:1fr!important}.batch-shift-card{min-width:0}
      .batch-employee-row{grid-template-columns:minmax(0,1fr) minmax(105px,130px) 38px!important;gap:8px!important}
      .batch-employee-name{white-space:normal!important;overflow-wrap:anywhere}.batch-quantity-field input{width:100%!important}
      .employee-report-summary{grid-template-columns:1fr}.employee-report-controls select{min-width:0;width:100%}
      .employee-report-controls>*{width:100%}.advanced-dialog{width:96vw}
    }
  `;
  document.head.appendChild(style);
}

function setAllQuantities(shiftId, mode) {
  const column = $(`#batch-column-${shiftId}`);
  if (!column) return;
  const inputs = $$('[data-batch-quantity]', column);
  inputs.forEach((input) => {
    input.value = mode === 'blank' ? '' : '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  notify(mode === 'blank' ? 'Đã xóa trắng số topping trong ca.' : 'Đã đặt toàn bộ topping trong ca về 0.');
}

function filterEmployeeSelect(shiftId, query) {
  const select = $(`[data-batch-add-select="${shiftId}"]`);
  if (!select) return;
  const needle = normalize(query);
  [...select.options].forEach((option, index) => {
    if (index === 0) return;
    option.hidden = needle ? !normalize(option.textContent).includes(needle) : false;
  });
}

function scoreKey(shiftId, employeeName) {
  return `${shiftId}|${normalize(employeeName)}`;
}

function prioritizeSelect(shiftId) {
  const select = $(`[data-batch-add-select="${shiftId}"]`);
  if (!select || select.dataset.prioritized === '1') return;
  select.dataset.prioritized = '1';
  const first = select.options[0];
  const options = [...select.options].slice(1).sort((a, b) => {
    const diff = (usageScores[scoreKey(shiftId, b.textContent)] || 0) - (usageScores[scoreKey(shiftId, a.textContent)] || 0);
    return diff || a.textContent.localeCompare(b.textContent, 'vi');
  });
  select.replaceChildren(first, ...options);
}

function ensureShiftTools() {
  SHIFTS.forEach((shift) => {
    const column = $(`#batch-column-${shift.id}`);
    const card = $('.batch-shift-card', column || document);
    const addControls = $('.batch-add-controls', column || document);
    if (!column || !card || !addControls) return;

    if (!$('.employee-quick-search', column)) {
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'employee-quick-search';
      search.placeholder = 'Tìm nhanh nhân viên...';
      search.setAttribute('aria-label', `Tìm nhân viên trong ${shift.label}`);
      search.addEventListener('input', () => filterEmployeeSelect(shift.id, search.value));
      addControls.prepend(search);
    }

    if (!$('.advanced-shift-tools', column)) {
      const tools = document.createElement('div');
      tools.className = 'advanced-shift-tools';
      tools.innerHTML = `
        <button type="button" class="advanced-mini-button" data-advanced-zero="${shift.id}">Đặt 0 tất cả</button>
        <button type="button" class="advanced-mini-button danger-lite" data-advanced-clear="${shift.id}">Xóa trắng số</button>
      `;
      addControls.after(tools);
    }
    prioritizeSelect(shift.id);
  });
}

async function loadUsageScores() {
  const month = $('#recordsMonth')?.value;
  if (!month) return;
  try {
    const [year, monthNum] = month.split('-').map(Number);
    const end = monthNum === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
    const result = await requireSupabase().from('shifts').select('shift,employees(name)').gte('sales_date', `${month}-01`).lt('sales_date', end);
    if (result.error) throw result.error;
    usageScores = {};
    (result.data || []).forEach((row) => {
      const key = scoreKey(row.shift, row.employees?.name || '');
      usageScores[key] = (usageScores[key] || 0) + 1;
    });
  } catch (error) {
    console.warn('Không tải được độ ưu tiên nhân viên theo ca.', error);
  }
}

function ensureToolbarButtons() {
  const toolbar = $('#view-records .toolbar-actions');
  if (!toolbar) return;
  if (!$('#backupCsvButton')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'backupCsvButton';
    button.className = 'advanced-toolbar-button manager-only';
    button.textContent = 'Backup CSV';
    button.addEventListener('click', backupCurrentMonthCsv);
    toolbar.insertBefore(button, $('#addShiftButton'));
  }
  if (!$('#auditLogButton')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'auditLogButton';
    button.className = 'advanced-toolbar-button manager-only';
    button.textContent = 'Lịch sử sửa';
    button.addEventListener('click', openAuditDialog);
    toolbar.insertBefore(button, $('#addShiftButton'));
  }
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function fetchMonthRows(month) {
  const [year, monthNum] = month.split('-').map(Number);
  const end = monthNum === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNum + 1).padStart(2, '0')}-01`;
  const result = await requireSupabase().from('shifts')
    .select('id,sales_date,shift,note,employee_id,employees(name),shift_toppings(topping_type_id,quantity)')
    .gte('sales_date', `${month}-01`).lt('sales_date', end)
    .order('sales_date').order('shift');
  if (result.error) throw result.error;
  return result.data || [];
}

async function backupCurrentMonthCsv() {
  const month = $('#recordsMonth')?.value;
  if (!month) return window.alert('Chọn tháng cần backup.');
  const button = $('#backupCsvButton');
  button.disabled = true;
  try {
    const rows = await fetchMonthRows(month);
    const lines = [['id','ngay','ca','nhan_vien','employee_id','topping','tien','ghi_chu'].map(csvCell).join(',')];
    rows.forEach((row) => {
      const quantity = (row.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
      lines.push([row.id,row.sales_date,row.shift,row.employees?.name || '',row.employee_id,quantity,quantity * 1000,row.note || ''].map(csvCell).join(','));
    });
    const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-topping-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Đã backup ${rows.length} dòng dữ liệu tháng ${month}.`);
  } catch (error) {
    window.alert(error?.message || 'Không backup được dữ liệu.');
  } finally {
    button.disabled = false;
  }
}

function ensureEmployeeReport() {
  const statsPanel = $('#view-statistics .stats-panel');
  if (!statsPanel || $('#employeeReportPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'employeeReportPanel';
  panel.className = 'employee-report-panel';
  panel.innerHTML = `
    <div class="panel-title"><div><h3>Báo cáo chi tiết nhân viên</h3><p class="muted">Xem từng ca, tổng topping và tổng tiền của một nhân viên trong tháng.</p></div></div>
    <div class="employee-report-controls">
      <label>Nhân viên<select id="employeeReportSelect"><option value="">Chọn nhân viên</option></select></label>
      <button type="button" id="loadEmployeeReport" class="advanced-toolbar-button">Xem báo cáo</button>
    </div>
    <div id="employeeReportOutput"></div>
  `;
  statsPanel.appendChild(panel);
  $('#loadEmployeeReport')?.addEventListener('click', loadEmployeeReport);
}

async function loadEmployeeReport() {
  const month = $('#statisticsMonth')?.value;
  const select = $('#employeeReportSelect');
  if (!month || !select?.value) return notify('Chọn nhân viên cần xem báo cáo.');
  const rows = await fetchMonthRows(month);
  const selectedName = select.value;
  const employeeRows = rows.filter((row) => (row.employees?.name || '') === selectedName);
  const details = employeeRows.map((row) => {
    const quantity = (row.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
    return { date: row.sales_date, shift: row.shift, quantity, value: quantity * 1000 };
  });
  const totalQty = details.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = details.reduce((sum, row) => sum + row.value, 0);
  const output = $('#employeeReportOutput');
  output.innerHTML = `
    <div class="employee-report-summary"><div><span>Số ca</span><strong>${details.length}</strong></div><div><span>Tổng topping</span><strong>${totalQty.toLocaleString('vi-VN')}</strong></div><div><span>Tổng tiền</span><strong>${money(totalMoney)}</strong></div></div>
    <div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>Ngày</th><th>Ca</th><th class="numeric">Topping</th><th class="numeric">Tiền</th></tr></thead><tbody>${details.map((row) => `<tr><td>${row.date.split('-').reverse().join('/')}</td><td>${SHIFTS.find((s) => s.id === row.shift)?.label || row.shift}</td><td class="numeric">${row.quantity.toLocaleString('vi-VN')}</td><td class="numeric">${money(row.value)}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có dữ liệu.</td></tr>'}</tbody></table></div>`;
}

async function refreshEmployeeReportOptions() {
  const panel = $('#employeeReportPanel');
  if (!panel) return;
  try {
    const rows = await fetchMonthRows($('#statisticsMonth')?.value || $('#recordsMonth')?.value);
    const names = [...new Set(rows.map((row) => row.employees?.name).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'vi'));
    const select = $('#employeeReportSelect');
    const current = select.value;
    select.innerHTML = '<option value="">Chọn nhân viên</option>' + names.map((name) => `<option value="${name.replace(/"/g,'&quot;')}">${name}</option>`).join('');
    if (names.includes(current)) select.value = current;
  } catch (error) {
    console.warn('Không tải được danh sách báo cáo nhân viên.', error);
  }
}

function readLocalAudit() {
  try { return JSON.parse(localStorage.getItem(localAuditKey) || '[]'); } catch { return []; }
}

function writeLocalAudit(item) {
  const items = readLocalAudit();
  items.unshift(item);
  localStorage.setItem(localAuditKey, JSON.stringify(items.slice(0, 200)));
}

async function logAudit(action, entity, entityId, salesDate, details = {}) {
  const item = { action, entity, entityId: entityId || '', salesDate: salesDate || '', details, createdAt: new Date().toISOString() };
  writeLocalAudit(item);
  if (auditTableAvailable === false) return;
  try {
    const client = requireSupabase();
    const result = await client.from('audit_logs').insert({
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      sales_date: salesDate || null,
      details
    });
    if (result.error) throw result.error;
    auditTableAvailable = true;
  } catch (error) {
    if (error?.code === '42P01' || /audit_logs/i.test(error?.message || '')) auditTableAvailable = false;
    else console.warn('Không ghi được lịch sử sửa lên Supabase.', error);
  }
}

function ensureAuditDialog() {
  if ($('#auditDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'auditDialog';
  dialog.className = 'advanced-dialog';
  dialog.innerHTML = `<div class="advanced-dialog-head"><h3>Lịch sử chỉnh sửa</h3><button type="button" class="icon-button" data-close-audit aria-label="Đóng">×</button></div><div class="advanced-dialog-body" id="auditDialogBody"></div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-audit]')) dialog.close();
  });
}

async function openAuditDialog() {
  ensureAuditDialog();
  const dialog = $('#auditDialog');
  const body = $('#auditDialogBody');
  body.innerHTML = '<p class="muted">Đang tải lịch sử...</p>';
  dialog.showModal();
  let items = [];
  if (auditTableAvailable !== false) {
    try {
      const result = await requireSupabase().from('audit_logs').select('action,entity,entity_id,sales_date,details,created_at').order('created_at', { ascending: false }).limit(100);
      if (result.error) throw result.error;
      items = (result.data || []).map((row) => ({ action: row.action, entity: row.entity, entityId: row.entity_id, salesDate: row.sales_date, details: row.details || {}, createdAt: row.created_at }));
      auditTableAvailable = true;
    } catch (error) {
      auditTableAvailable = false;
      items = readLocalAudit();
    }
  } else items = readLocalAudit();
  body.innerHTML = items.length ? items.map((item) => `<div class="audit-row"><small>${new Date(item.createdAt).toLocaleString('vi-VN')}</small><strong>${item.action}</strong><span>${item.salesDate ? `Ngày ${String(item.salesDate).split('-').reverse().join('/')} · ` : ''}${item.details?.message || item.entity || ''}</span></div>`).join('') : '<p class="muted">Chưa có lịch sử chỉnh sửa.</p>';
}

async function snapshotRecord(id) {
  const result = await requireSupabase().from('shifts').select('id,sales_date,shift,employee_id,note,employees(name),shift_toppings(topping_type_id,quantity)').eq('id', id).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function snapshotDay(date) {
  const result = await requireSupabase().from('shifts').select('id,sales_date,shift,employee_id,note,employees(name),shift_toppings(topping_type_id,quantity)').eq('sales_date', date).order('shift');
  if (result.error) throw result.error;
  return result.data || [];
}

function showUndoBar(label, undoFn) {
  $('#advancedUndoBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'advancedUndoBar';
  bar.className = 'undo-bar';
  bar.innerHTML = `<span>${label}</span><button type="button">Hoàn tác</button>`;
  document.body.appendChild(bar);
  let active = true;
  const timer = setTimeout(() => { active = false; bar.remove(); undoState = null; }, 10000);
  $('button', bar).addEventListener('click', async () => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    const button = $('button', bar);
    button.disabled = true;
    button.textContent = 'Đang hoàn tác...';
    try {
      await undoFn();
      bar.remove();
      notify('Đã hoàn tác xóa.');
      const month = $('#recordsMonth');
      if (month) month.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      active = true;
      button.disabled = false;
      button.textContent = 'Hoàn tác';
      window.alert(error?.message || 'Không hoàn tác được dữ liệu.');
    }
  });
}

async function restoreSnapshots(snapshots) {
  const client = requireSupabase();
  for (const row of snapshots) {
    const result = await client.rpc('save_shift', {
      p_shift_id: null,
      p_sales_date: row.sales_date,
      p_shift: row.shift,
      p_employee_id: row.employee_id,
      p_note: row.note || '',
      p_toppings: (row.shift_toppings || []).map((item) => ({ topping_type_id: item.topping_type_id, quantity: Math.max(0, Number(item.quantity) || 0) })).filter((item) => item.quantity > 0)
    });
    if (result.error) throw result.error;
  }
}

function installUndoDeleteCapture() {
  if (document.body.dataset.undoDeleteInstalled === '1') return;
  document.body.dataset.undoDeleteInstalled = '1';
  document.addEventListener('click', async (event) => {
    const recordButton = event.target.closest('[data-action="delete"][data-record-id]');
    const dayButton = event.target.closest('[data-delete-day]');
    const target = recordButton || dayButton;
    if (!target || target.dataset.undoBypass === '1') {
      if (target) delete target.dataset.undoBypass;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const snapshots = recordButton ? [await snapshotRecord(recordButton.dataset.recordId)].filter(Boolean) : await snapshotDay(dayButton.dataset.deleteDay);
      target.dataset.undoBypass = '1';
      target.click();
      undoState = snapshots;
      setTimeout(() => {
        if (!undoState?.length) return;
        const first = undoState[0];
        const label = recordButton ? `Đã xóa ${first.employees?.name || 'bản ghi'}.` : `Đã xóa dữ liệu ngày ${String(first?.sales_date || dayButton.dataset.deleteDay).split('-').reverse().join('/')}.`;
        showUndoBar(label, async () => {
          await restoreSnapshots(undoState || []);
          await logAudit('Hoàn tác xóa', recordButton ? 'shift' : 'day', recordButton?.dataset.recordId || '', first?.sales_date || dayButton.dataset.deleteDay, { message: label });
          undoState = null;
        });
        void logAudit(recordButton ? 'Xóa bản ghi' : 'Xóa cả ngày', recordButton ? 'shift' : 'day', recordButton?.dataset.recordId || '', first?.sales_date || dayButton.dataset.deleteDay, { message: label });
      }, 850);
    } catch (error) {
      console.error('Không chuẩn bị được dữ liệu hoàn tác.', error);
      target.dataset.undoBypass = '1';
      target.click();
    }
  }, true);
}

function serializeEditorDraft() {
  const date = $('#shiftDate')?.value;
  if (!date) return null;
  const shifts = {};
  SHIFTS.forEach((shift) => {
    const column = $(`#batch-column-${shift.id}`);
    shifts[shift.id] = {
      note: $(`[data-batch-note="${shift.id}"]`, column || document)?.value || '',
      rows: $$('.batch-employee-row', column || document).map((row) => ({
        employee: $('.batch-employee-name', row)?.textContent?.trim() || '',
        quantity: $('[data-batch-quantity]', row)?.value || '0'
      }))
    };
  });
  return { date, shifts, savedAt: new Date().toISOString() };
}

function saveOfflineDraft() {
  const draft = serializeEditorDraft();
  if (!draft) return;
  localStorage.setItem(offlineDraftKey, JSON.stringify(draft));
  notify('Mất mạng: đã lưu bản nháp trên máy. Khi có mạng lại, web sẽ khôi phục để đồng bộ.', 5000);
}

function readOfflineDraft() {
  try { return JSON.parse(localStorage.getItem(offlineDraftKey) || 'null'); } catch { return null; }
}

function restoreDraftToEditor(draft) {
  if (!draft || $('#shiftEditor')?.hidden || $('#shiftDate')?.value !== draft.date) return false;
  SHIFTS.forEach((shift) => {
    const addAll = $(`#batch-column-${shift.id} [data-batch-action="add-all"]`);
    if (addAll && !addAll.disabled) addAll.click();
  });
  SHIFTS.forEach((shift) => {
    const source = draft.shifts?.[shift.id];
    if (!source) return;
    $$('.batch-employee-row', $(`#batch-column-${shift.id}`) || document).forEach((row) => {
      const name = $('.batch-employee-name', row)?.textContent?.trim() || '';
      const saved = source.rows?.find((item) => normalize(item.employee) === normalize(name));
      if (!saved) return;
      const input = $('[data-batch-quantity]', row);
      input.value = saved.quantity;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const note = $(`[data-batch-note="${shift.id}"]`);
    if (note) {
      note.value = source.note || '';
      note.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  return true;
}

function installOfflineSupport() {
  if ($('#offlineStatusBadge')) return;
  const badge = document.createElement('div');
  badge.id = 'offlineStatusBadge';
  badge.className = 'offline-badge';
  badge.textContent = 'Đang offline · dữ liệu sẽ lưu nháp';
  document.body.appendChild(badge);
  const update = () => badge.classList.toggle('show', !navigator.onLine);
  update();
  window.addEventListener('offline', update);
  window.addEventListener('online', () => {
    update();
    const draft = readOfflineDraft();
    if (!draft) return notify('Đã có mạng trở lại.');
    if (restoreDraftToEditor(draft)) {
      notify('Đã có mạng lại và đã khôi phục bản nháp. Đang đồng bộ...');
      setTimeout(() => $('#shiftForm')?.requestSubmit(), 500);
    } else {
      notify(`Đã có mạng lại. Có bản nháp ngày ${draft.date.split('-').reverse().join('/')} chờ đồng bộ.` , 5000);
    }
  });
  $('#shiftForm')?.addEventListener('submit', (event) => {
    if (navigator.onLine) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveOfflineDraft();
  }, true);
}

async function captureEditorBaseline() {
  const editor = $('#shiftEditor');
  const date = $('#shiftDate')?.value;
  if (!editor || editor.hidden || !date) return;
  try {
    editorBaseline = await snapshotDay(date);
    editorBaselineDate = date;
    const draft = readOfflineDraft();
    if (draft?.date === date && window.confirm('Có bản nháp chưa đồng bộ của ngày này. Khôi phục bản nháp?')) restoreDraftToEditor(draft);
  } catch (error) {
    console.warn('Không tạo được baseline lịch sử sửa.', error);
  }
}

function rowFingerprint(row) {
  const qty = (row.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  return `${row.shift}|${row.employee_id}|${qty}|${row.note || ''}`;
}

async function auditCompletedSave(date) {
  try {
    const after = await snapshotDay(date);
    const beforeMap = new Map((editorBaseline || []).map((row) => [row.id, rowFingerprint(row)]));
    const afterMap = new Map(after.map((row) => [row.id, rowFingerprint(row)]));
    const created = after.filter((row) => !beforeMap.has(row.id)).length;
    const changed = after.filter((row) => beforeMap.has(row.id) && beforeMap.get(row.id) !== rowFingerprint(row)).length;
    const deleted = (editorBaseline || []).filter((row) => !afterMap.has(row.id)).length;
    await logAudit('Lưu dữ liệu topping', 'day', '', date, { message: `Thêm ${created} · sửa ${changed} · xóa ${deleted} bản ghi`, created, changed, deleted });
    localStorage.removeItem(offlineDraftKey);
  } catch (error) {
    console.warn('Không ghi được audit sau khi lưu.', error);
  }
}

function installSaveEnhancements() {
  const form = $('#shiftForm');
  const editor = $('#shiftEditor');
  if (!form || !editor || form.dataset.advancedSave === '1') return;
  form.dataset.advancedSave = '1';
  form.addEventListener('submit', () => {
    const positives = $$('[data-batch-quantity]', editor).filter((input) => Number(input.value || 0) > 0);
    const shifts = new Set(positives.map((input) => input.dataset.batchShift || input.closest('[data-batch-shift]')?.dataset.batchShift).filter(Boolean));
    pendingSaveSummary = { date: $('#shiftDate')?.value, rows: positives.length, shifts: shifts.size };
  }, true);

  const observer = new MutationObserver(() => {
    if (!editor.hidden) return;
    if (pendingSaveSummary?.date) {
      const summary = pendingSaveSummary;
      pendingSaveSummary = null;
      setTimeout(() => {
        const toast = $('#toast');
        if (toast?.textContent?.includes('Đã lưu dữ liệu topping')) {
          toast.textContent = `Đã lưu ${summary.rows} dòng của ${summary.shifts} ca.`;
        }
      }, 80);
      void auditCompletedSave(summary.date);
    }
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['hidden'] });
}

function installEditorObserver() {
  const editor = $('#shiftEditor');
  const columns = $('#shiftBatchColumns');
  if (!editor || !columns || editor.dataset.advancedObserver === '1') return;
  editor.dataset.advancedObserver = '1';
  const columnsObserver = new MutationObserver(() => queueMicrotask(ensureShiftTools));
  columnsObserver.observe(columns, { childList: true, subtree: true });
  const editorObserver = new MutationObserver(() => {
    if (!editor.hidden) {
      queueMicrotask(ensureShiftTools);
      setTimeout(captureEditorBaseline, 250);
    }
  });
  editorObserver.observe(editor, { attributes: true, attributeFilter: ['hidden'] });
}

function installStatsObserver() {
  const stats = $('#view-statistics');
  if (!stats || stats.dataset.advancedStats === '1') return;
  stats.dataset.advancedStats = '1';
  $('#statisticsMonth')?.addEventListener('change', () => setTimeout(refreshEmployeeReportOptions, 80));
  const observer = new MutationObserver(() => {
    ensureEmployeeReport();
    queueMicrotask(refreshEmployeeReportOptions);
  });
  observer.observe(stats, { attributes: true, attributeFilter: ['hidden', 'class'] });
}

function installGlobalActions() {
  document.addEventListener('click', (event) => {
    const zero = event.target.closest('[data-advanced-zero]');
    const clear = event.target.closest('[data-advanced-clear]');
    if (zero) setAllQuantities(zero.dataset.advancedZero, 'zero');
    if (clear) setAllQuantities(clear.dataset.advancedClear, 'blank');
  });
}

async function installAdvancedTools() {
  if (advancedInstalling) return;
  advancedInstalling = true;
  try {
    installAdvancedStyles();
    ensureToolbarButtons();
    ensureEmployeeReport();
    installGlobalActions();
    installEditorObserver();
    installStatsObserver();
    installUndoDeleteCapture();
    installOfflineSupport();
    installSaveEnhancements();
    await loadUsageScores();
    ensureShiftTools();
    await refreshEmployeeReportOptions();
  } finally {
    advancedInstalling = false;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void installAdvancedTools());
else void installAdvancedTools();

const appObserver = new MutationObserver(() => {
  ensureToolbarButtons();
  ensureEmployeeReport();
  ensureShiftTools();
});
appObserver.observe(document.documentElement, { childList: true, subtree: true });
