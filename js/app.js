import {
  SHIFTS,
  calculateEmployeeTotals,
  calculateRecordsTotals,
  calculateShiftTotals,
  normalizeQuantity
} from './calculator.js';
import {
  createEmployee,
  deleteSalesRecord,
  getEmployees,
  getSalesForDate,
  getSalesForMonth,
  getShiftNotesForDate,
  getShiftNotesForMonth,
  getToppingTypes,
  getSession,
  getUserRole,
  signIn,
  signOut,
  saveDayToppings,
  updateEmployee
} from './database.js';
import { configurationError, isSupabaseConfigured } from './config.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
const formatMoney = (value) => `${formatNumber(value)}đ`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toIsoDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = toIsoDate();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const formatDate = (value) => validDate(value) ? new Intl.DateTimeFormat('vi-VN').format(new Date(`${value}T12:00:00`)) : value;

let currentUser = null;
let isManager = false;
let employees = [];
let toppingTypes = [];
let records = [];
let dayRecords = [];
let statisticsRecords = [];
let monthShiftNotes = [];
let editingEmployeeId = null;
let toppingPeriod = 'month';
let toastTimer = null;

let batchDate = null;
let batchDirty = false;
let batchRowsByShift = {};
let batchNotesByShift = {};
let originalNotesByShift = {};
let removedBatchRecordIds = new Set();
let editorLoadToken = 0;

const SHIFT_STYLE = {
  morning: { className: 'morning', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>' },
  afternoon: { className: 'afternoon', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 3v3M5.64 6.64l2.12 2.12m8.48 0 2.12-2.12"/></svg>' },
  evening: { className: 'evening', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/></svg>' }
};

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function readableError(error) {
  if (error?.code === '42501') return 'Tài khoản không có quyền thao tác này.';
  if (error?.code === '23505') return 'Dữ liệu bị trùng. Kiểm tra nhân viên, ngày và ca.';
  if (error?.message?.includes('Invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (error?.message?.includes('Failed to fetch')) return 'Không kết nối được Supabase.';
  return error?.message || error?.details || 'Có lỗi xảy ra.';
}

function rowQuantity(row) {
  const value = Number(row?.quantity);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function renderOverview(container, sourceRecords) {
  if (!container) return;
  const totals = calculateRecordsTotals(sourceRecords, toppingTypes);
  container.innerHTML = [
    ['Số ca', formatNumber(totals.shiftCount)],
    ['Tổng topping', formatNumber(totals.totalToppings)],
    ['Doanh thu', formatMoney(totals.totalMoney)]
  ].map(([label, value]) => `<article class="overview-card"><div><p>${label}</p><strong>${value}</strong></div></article>`).join('');
}

function renderRecords() {
  renderOverview($('#monthOverview'), records);
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.date)) grouped.set(record.date, []);
    grouped.get(record.date).push(record);
  }
  const days = [...grouped.entries()].sort(([a], [b]) => b.localeCompare(a));
  const empty = $('#recordsEmpty');
  if (empty) empty.hidden = days.length > 0;
  const body = $('#recordsBody');
  if (!body) return;

  body.innerHTML = days.map(([date, rows]) => {
    const dayTotal = calculateRecordsTotals(rows, toppingTypes);
    const shifts = SHIFTS.map((shift) => {
      const shiftRows = rows.filter((row) => row.shift === shift.id);
      const total = calculateRecordsTotals(shiftRows, toppingTypes);
      const people = shiftRows.map((row) => {
        const qty = (row.quantities || []).reduce((sum, q) => sum + normalizeQuantity(q), 0);
        return `<div class="history-employee-row" data-record-id="${escapeHtml(row.id)}" tabindex="0" role="button">
          <div class="history-employee-main"><span class="history-employee-name">${escapeHtml(row.employee)}</span><small>${formatNumber(qty)} topping</small></div>
          <strong class="history-employee-money">${formatMoney(qty * 1000)}</strong>
          <div class="history-record-actions"><button class="history-action-button edit" type="button" data-action="edit" data-record-id="${escapeHtml(row.id)}">Sửa</button><button class="history-action-button delete" type="button" data-action="delete" data-record-id="${escapeHtml(row.id)}">Xóa</button></div>
        </div>`;
      }).join('');
      return `<div class="history-shift-card ${shift.id}"><div class="history-shift-header"><span>${escapeHtml(shift.label)}</span><strong>${formatNumber(total.totalToppings)} topping · ${formatMoney(total.totalMoney)}</strong></div><div class="history-shift-body">${people || '<div class="history-empty">Chưa có dữ liệu</div>'}</div></div>`;
    }).join('');

    return `<article class="day-record-card" data-date="${date}"><header class="day-record-header"><div class="day-record-date"><span class="eyebrow">Ngày</span><h3>${formatDate(date)}</h3></div><div class="day-record-summary"><span>${formatNumber(dayTotal.totalToppings)} topping</span><strong>${formatMoney(dayTotal.totalMoney)}</strong></div></header><div class="day-record-grid">${shifts}</div></article>`;
  }).join('');
}

function renderDailySummary() {
  const date = $('#summaryDate')?.value;
  const selected = dayRecords.filter((row) => row.date === date);
  const total = calculateRecordsTotals(selected, toppingTypes);
  const host = $('#dailySummary');
  if (!host) return;
  host.innerHTML = SHIFTS.map((shift) => {
    const subtotal = calculateRecordsTotals(selected.filter((row) => row.shift === shift.id), toppingTypes);
    return `<div class="daily-summary-row"><span>${escapeHtml(shift.label)}</span><strong>${formatMoney(subtotal.totalMoney)} · ${formatNumber(subtotal.totalToppings)} topping</strong></div>`;
  }).join('') + `<div class="daily-summary-row day-total"><span>Tổng cả ngày</span><strong>${formatMoney(total.totalMoney)} · ${formatNumber(total.totalToppings)} topping</strong></div>`;
}

function renderEmployeeStatistics() {
  renderOverview($('#statisticsOverview'), statisticsRecords);
  const totals = calculateEmployeeTotals(statisticsRecords, toppingTypes);
  const all = calculateRecordsTotals(statisticsRecords, toppingTypes);
  const body = $('#employeeStatsBody');
  if (!body) return;
  body.innerHTML = totals.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="numeric">${formatNumber(row.shiftCount)}</td><td class="numeric">${formatNumber(row.totalToppings)}</td><td class="numeric row-total">${formatMoney(row.totalMoney)}</td></tr>`).join('') + (totals.length ? `<tr><td><strong>Tổng toàn quán</strong></td><td class="numeric"><strong>${formatNumber(all.shiftCount)}</strong></td><td class="numeric"><strong>${formatNumber(all.totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(all.totalMoney)}</strong></td></tr>` : '');
  const empty = $('#employeeStatsEmpty');
  if (empty) empty.hidden = totals.length > 0;
}

async function renderToppingStatistics() {
  const body = $('#toppingStatsBody');
  if (!body) return;
  try {
    const data = toppingPeriod === 'day' ? await getSalesForDate($('#toppingDate')?.value) : await getSalesForMonth($('#toppingMonth')?.value);
    const totals = calculateRecordsTotals(data, toppingTypes);
    body.innerHTML = `<tr><td>Topping</td><td class="numeric">${formatNumber(totals.totalToppings)}</td><td class="numeric">${formatMoney(totals.totalMoney)}</td></tr><tr><td><strong>Tổng cộng</strong></td><td class="numeric"><strong>${formatNumber(totals.totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(totals.totalMoney)}</strong></td></tr>`;
  } catch (error) {
    console.error(error);
  }
}

function renderEmployees() {
  const body = $('#employeesBody');
  if (!body) return;
  const query = ($('#employeeSearch')?.value || '').trim().toLocaleLowerCase('vi');
  const includeInactive = Boolean($('#showInactiveEmployees')?.checked);
  const filtered = employees.filter((employee) => (includeInactive || employee.active) && employee.name.toLocaleLowerCase('vi').includes(query));
  body.innerHTML = filtered.map((employee) => `<tr><td class="employee-name">${escapeHtml(employee.name)}</td><td><span class="status-badge ${employee.active ? 'active' : 'inactive'}">${employee.active ? 'Đang làm' : 'Đã nghỉ'}</span></td><td>${formatDate(employee.created_at?.slice(0, 10))}</td><td><div class="row-actions"><button class="table-action" type="button" data-employee-action="edit" data-employee-id="${employee.id}">Sửa tên</button><button class="table-action ${employee.active ? 'delete' : ''}" type="button" data-employee-action="toggle" data-active="${employee.active}" data-employee-id="${employee.id}">${employee.active ? 'Nghỉ làm' : 'Đi làm lại'}</button></div></td></tr>`).join('');
  const empty = $('#employeesEmpty');
  if (empty) empty.hidden = filtered.length > 0;
}

function setDatePickerValue(element, value) {
  if (!element) return;
  if (element._flatpickr) element._flatpickr.setDate(value, false);
  else element.value = value;
}

function initializeBatchRows(savedRecords) {
  batchRowsByShift = Object.fromEntries(SHIFTS.map((shift) => [shift.id, savedRecords.filter((record) => record.shift === shift.id).map((record) => ({
    id: record.id,
    employeeId: record.employeeId,
    employee: record.employee,
    quantity: (record.quantities || []).reduce((sum, q) => sum + normalizeQuantity(q), 0),
    originalQuantity: (record.quantities || []).reduce((sum, q) => sum + normalizeQuantity(q), 0)
  }))]));
}

function renderBatchColumn(shiftId) {
  const column = $(`#batch-column-${shiftId}`);
  if (!column) return;
  const shift = SHIFTS.find((item) => item.id === shiftId);
  const style = SHIFT_STYLE[shiftId];
  const rows = batchRowsByShift[shiftId] || [];
  const present = new Set(rows.map((row) => row.employeeId));
  const available = employees.filter((employee) => employee.active && !present.has(employee.id));

  const employeeRows = rows.map((row, index) => `<div class="batch-employee-row" data-batch-shift="${shiftId}" data-batch-index="${index}">
    <span class="batch-employee-name">${escapeHtml(row.employee)}</span>
    <div class="batch-quantity-field">
      <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" value="${escapeHtml(String(row.quantity ?? 0))}" data-batch-quantity data-batch-shift="${shiftId}" aria-label="Số topping của ${escapeHtml(row.employee)}">
      <span data-batch-money>${formatMoney(rowQuantity(row) * 1000)}</span>
    </div>
    <button class="batch-remove-button" type="button" data-batch-action="remove" data-shift="${shiftId}" data-index="${index}" aria-label="Xóa ${escapeHtml(row.employee)}"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button>
  </div>`).join('');

  const shiftQty = rows.reduce((sum, row) => sum + rowQuantity(row), 0);
  column.innerHTML = `<article class="batch-shift-card ${style.className}">
    <header class="batch-shift-heading">${style.icon}<h3>${escapeHtml(shift.label.toLocaleUpperCase('vi'))}</h3></header>
    <div class="batch-roster-heading"><span>Nhân viên</span><span>Số topping / tiền</span><span></span></div>
    <div class="batch-employee-list">${employeeRows || '<p class="batch-no-employees">Chưa có nhân viên trong ca này.</p>'}</div>
    <div class="batch-add-controls"><select data-batch-add-select="${shiftId}" ${available.length ? '' : 'disabled'}><option value="">+ Thêm nhân viên</option>${available.map((employee) => `<option value="${employee.id}">${escapeHtml(employee.name)}</option>`).join('')}</select><button class="batch-add-all" type="button" data-batch-action="add-all" data-shift="${shiftId}" ${available.length ? '' : 'disabled'}>+ Thêm tất cả nhân viên</button></div>
    <label class="batch-note-field">Ghi chú ${escapeHtml(shift.label.toLocaleLowerCase('vi'))}<textarea rows="2" maxlength="500" placeholder="Ghi chú riêng cho ca này" data-batch-note="${shiftId}">${escapeHtml(batchNotesByShift[shiftId] || '')}</textarea></label>
    <footer class="batch-shift-total"><span>Tổng ${escapeHtml(shift.label.toLocaleLowerCase('vi'))}</span><strong><span data-batch-total-toppings>${formatNumber(shiftQty)}</span> topping</strong><strong data-batch-total-money>${formatMoney(shiftQty * 1000)}</strong></footer>
  </article>`;
}

function renderBatchColumns() {
  for (const shift of SHIFTS) renderBatchColumn(shift.id);
  updateBatchTotals();
}

function updateBatchTotals() {
  let dayQty = 0;
  for (const shift of SHIFTS) {
    const column = $(`#batch-column-${shift.id}`);
    const rows = batchRowsByShift[shift.id] || [];
    let shiftQty = 0;
    rows.forEach((row, index) => {
      const qty = rowQuantity(row);
      shiftQty += qty;
      const money = column?.querySelector(`[data-batch-index="${index}"] [data-batch-money]`);
      if (money) money.textContent = formatMoney(qty * 1000);
    });
    const q = column?.querySelector('[data-batch-total-toppings]');
    const m = column?.querySelector('[data-batch-total-money]');
    if (q) q.textContent = formatNumber(shiftQty);
    if (m) m.textContent = formatMoney(shiftQty * 1000);
    dayQty += shiftQty;
  }
  if ($('#batchDayToppings')) $('#batchDayToppings').textContent = formatNumber(dayQty);
  if ($('#batchDayMoney')) $('#batchDayMoney').textContent = formatMoney(dayQty * 1000);
}

function sanitizeQuantityInput(input) {
  const before = input.value;
  const start = input.selectionStart ?? before.length;
  const cleaned = before.replace(/\D/g, '');
  if (cleaned !== before) {
    const leftDigits = before.slice(0, start).replace(/\D/g, '').length;
    input.value = cleaned;
    try { input.setSelectionRange(leftDigits, leftDigits); } catch {}
  }
  return input.value;
}

function handleBatchInput(event) {
  const note = event.target.closest('[data-batch-note]');
  if (note) {
    batchNotesByShift[note.dataset.batchNote] = note.value;
    batchDirty = true;
    return;
  }
  const input = event.target.closest('[data-batch-quantity]');
  if (!input) return;
  const rowEl = input.closest('[data-batch-index]');
  const shiftId = rowEl?.dataset.batchShift;
  const index = Number(rowEl?.dataset.batchIndex ?? -1);
  const row = batchRowsByShift[shiftId]?.[index];
  if (!row) return;
  const value = sanitizeQuantityInput(input);
  row.quantity = value;
  batchDirty = true;
  updateBatchTotals();
}

function handleBatchFocus(event) {
  const input = event.target.closest('[data-batch-quantity]');
  if (!input || input.value !== '0') return;
  requestAnimationFrame(() => {
    if (document.activeElement === input && input.value === '0') input.select();
  });
}

function handleBatchBlur(event) {
  const input = event.target.closest('[data-batch-quantity]');
  if (!input || input.value !== '') return;
  input.value = '0';
  const rowEl = input.closest('[data-batch-index]');
  const shiftId = rowEl?.dataset.batchShift;
  const index = Number(rowEl?.dataset.batchIndex ?? -1);
  const row = batchRowsByShift[shiftId]?.[index];
  if (row) row.quantity = '0';
  updateBatchTotals();
}

function handleBatchEmployeeSelect(event) {
  const select = event.target.closest('[data-batch-add-select]');
  if (!select || !select.value) return;
  const shiftId = select.dataset.batchAddSelect;
  const rows = batchRowsByShift[shiftId] || [];
  const employee = employees.find((item) => item.active && item.id === select.value);
  if (!employee || rows.some((row) => row.employeeId === employee.id)) return;
  rows.push({ id: null, employeeId: employee.id, employee: employee.name, quantity: 0, originalQuantity: 0 });
  batchDirty = true;
  renderBatchColumn(shiftId);
  updateBatchTotals();
  const newInput = $(`#batch-column-${shiftId} [data-batch-index="${rows.length - 1}"] [data-batch-quantity]`);
  newInput?.focus();
}

function handleBatchAction(event) {
  const button = event.target.closest('[data-batch-action]');
  if (!button) return;
  const shiftId = button.dataset.shift;
  const rows = batchRowsByShift[shiftId] || [];
  if (button.dataset.batchAction === 'remove') {
    const [removed] = rows.splice(Number(button.dataset.index), 1);
    if (removed?.id) removedBatchRecordIds.add(removed.id);
    batchDirty = true;
    renderBatchColumn(shiftId);
    updateBatchTotals();
    return;
  }
  if (button.dataset.batchAction === 'add-all') {
    const present = new Set(rows.map((row) => row.employeeId));
    for (const employee of employees.filter((item) => item.active && !present.has(item.id))) {
      rows.push({ id: null, employeeId: employee.id, employee: employee.name, quantity: 0, originalQuantity: 0 });
    }
    batchDirty = true;
    renderBatchColumn(shiftId);
    updateBatchTotals();
  }
}

async function setEditor(dateOrRecord = today) {
  const selectedDate = typeof dateOrRecord === 'object' ? dateOrRecord.date : dateOrRecord;
  const token = ++editorLoadToken;
  batchDate = selectedDate;
  batchDirty = false;
  removedBatchRecordIds = new Set();
  $('#shiftEditor').hidden = false;
  setDatePickerValue($('#shiftDate'), selectedDate);
  if ($('#formError')) $('#formError').hidden = true;
  const host = $('#shiftBatchColumns');
  if (host) host.innerHTML = SHIFTS.map((shift) => `<div id="batch-column-${shift.id}"><p class="muted">Đang tải…</p></div>`).join('');

  try {
    const [saved, notes, loadedEmployees] = await Promise.all([
      getSalesForDate(selectedDate),
      getShiftNotesForDate(selectedDate),
      getEmployees({ includeInactive: isManager })
    ]);
    if (token !== editorLoadToken) return;
    employees = loadedEmployees;
    originalNotesByShift = Object.fromEntries(SHIFTS.map((shift) => [shift.id, notes.find((note) => note.shift === shift.id)?.note || '']));
    batchNotesByShift = { ...originalNotesByShift };
    initializeBatchRows(saved);
    $('#editorHeading').textContent = saved.length ? `Sửa dữ liệu ngày ${formatDate(selectedDate)}` : 'Nhập topping';
    $('#saveShiftButton').textContent = saved.length ? 'LƯU THAY ĐỔI' : 'LƯU TẤT CẢ';
    renderBatchColumns();
    $('#shiftEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if ($('#formError')) { $('#formError').hidden = false; $('#formError').textContent = readableError(error); }
  }
}

function closeEditor() {
  editorLoadToken += 1;
  batchRowsByShift = {};
  batchNotesByShift = {};
  originalNotesByShift = {};
  removedBatchRecordIds = new Set();
  batchDirty = false;
  if ($('#shiftEditor')) $('#shiftEditor').hidden = true;
}

function buildBatchPayload(date) {
  const entries = [];
  for (const shift of SHIFTS) {
    const seen = new Set();
    for (const row of batchRowsByShift[shift.id] || []) {
      const raw = String(row.quantity ?? '').trim();
      const quantity = raw === '' ? 0 : Number(raw);
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Số topping của ${row.employee} phải là số nguyên từ 0 trở lên.`);
      if (seen.has(row.employeeId)) throw new Error(`${row.employee} bị trùng trong ${shift.label}.`);
      seen.add(row.employeeId);
      if (row.id && quantity === row.originalQuantity) continue;
      if (!row.id && quantity === 0) continue;
      entries.push({ id: row.id, shift: shift.id, employee_id: row.employeeId, note: batchNotesByShift[shift.id] || '', toppings: toppingTypes.map((type, index) => ({ topping_type_id: type.id, quantity: index === 0 ? quantity : 0 })) });
    }
  }
  const notes = SHIFTS.filter((shift) => (batchNotesByShift[shift.id] || '') !== (originalNotesByShift[shift.id] || '')).map((shift) => ({ shift: shift.id, note: batchNotesByShift[shift.id] || '' }));
  return { date, entries, notes, deleteIds: [...removedBatchRecordIds] };
}

async function saveBatch(event) {
  event.preventDefault();
  const date = $('#shiftDate')?.value;
  if (!validDate(date)) return showToast('Ngày không hợp lệ.');
  let payload;
  try { payload = buildBatchPayload(date); } catch (error) { return showToast(readableError(error)); }
  if (!payload.entries.length && !payload.notes.length && !payload.deleteIds.length) return showToast('Chưa có thay đổi nào để lưu.');
  const button = $('#saveShiftButton');
  if (button) { button.disabled = true; button.textContent = 'Đang lưu...'; }
  try {
    await saveDayToppings(payload);
    closeEditor();
    await refreshAfterSalesChange(date);
    showToast('Đã lưu dữ liệu topping.');
  } catch (error) {
    console.error(error);
    showToast(readableError(error));
  } finally {
    if (button) { button.disabled = false; button.textContent = 'LƯU TẤT CẢ'; }
  }
}

async function refreshMonthRecords(month = $('#recordsMonth')?.value) {
  if (!month) return;
  [records, monthShiftNotes] = await Promise.all([getSalesForMonth(month), getShiftNotesForMonth(month)]);
  renderRecords();
}

async function refreshDayRecords(date = $('#summaryDate')?.value) {
  if (!date) return;
  dayRecords = await getSalesForDate(date);
  renderDailySummary();
}

async function refreshStatistics(month = $('#statisticsMonth')?.value) {
  if (!month) return;
  statisticsRecords = await getSalesForMonth(month);
  renderEmployeeStatistics();
}

async function refreshAfterSalesChange(date) {
  const month = date.slice(0, 7);
  if ($('#recordsMonth')) $('#recordsMonth').value = month;
  setDatePickerValue($('#summaryDate'), date);
  await Promise.all([refreshMonthRecords(month), refreshDayRecords(date), refreshStatistics($('#statisticsMonth')?.value || month), renderToppingStatistics()]);
}

async function editRecord(id) {
  const record = records.find((row) => row.id === id);
  if (record) await setEditor(record);
}

async function deleteRecord(id) {
  const record = records.find((row) => row.id === id);
  if (!record || !confirm(`Xóa ca của ${record.employee} ngày ${formatDate(record.date)}?`)) return;
  try {
    await deleteSalesRecord(id);
    await refreshAfterSalesChange(record.date);
    showToast('Đã xóa ca bán.');
  } catch (error) {
    showToast(readableError(error));
  }
}

function openEmployeeForm(employee = null) {
  editingEmployeeId = employee?.id || null;
  $('#employeeFormName').value = employee?.name || '';
  $('#employeeForm').hidden = false;
  $('#employeeFormName').focus();
}

function closeEmployeeForm() {
  editingEmployeeId = null;
  $('#employeeForm').hidden = true;
  $('#employeeForm').reset();
}

async function saveEmployee(event) {
  event.preventDefault();
  const name = $('#employeeFormName').value.trim();
  if (!name) return;
  try {
    if (editingEmployeeId) await updateEmployee(editingEmployeeId, { name });
    else await createEmployee(name);
    closeEmployeeForm();
    employees = await getEmployees({ includeInactive: isManager });
    renderEmployees();
  } catch (error) {
    showToast(readableError(error));
  }
}

async function handleEmployeeAction(event) {
  const button = event.target.closest('[data-employee-action]');
  if (!button) return;
  const employee = employees.find((item) => item.id === button.dataset.employeeId);
  if (!employee) return;
  if (button.dataset.employeeAction === 'edit') return openEmployeeForm(employee);
  if (button.dataset.employeeAction === 'toggle') {
    try {
      await updateEmployee(employee.id, { active: !employee.active });
      employees = await getEmployees({ includeInactive: isManager });
      renderEmployees();
    } catch (error) { showToast(readableError(error)); }
  }
}

function navigate(view) {
  $$('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => { const active = section.id === `view-${view}`; section.hidden = !active; section.classList.toggle('active', active); });
  if (view === 'employees') renderEmployees();
}

function initializeDatePickers() {
  if (!window.flatpickr) return;
  $$('.date-picker').forEach((element) => {
    if (element._flatpickr) return;
    const value = element.value;
    window.flatpickr(element, { altInput: true, altFormat: 'd/m/Y', dateFormat: 'Y-m-d', allowInput: false, defaultDate: value || undefined });
  });
}

async function activateSession(user) {
  currentUser = user;
  try {
    const role = await getUserRole(user.id);
    isManager = role === 'manager';
    $('#signedInLabel').textContent = user.email || '';
    $$('.manager-only').forEach((element) => { element.hidden = !isManager; });
    $('#authGate').hidden = true;
    $('#application').hidden = false;
    [employees, toppingTypes] = await Promise.all([getEmployees({ includeInactive: isManager }), getToppingTypes()]);
    renderEmployees();
    await Promise.all([refreshMonthRecords(), refreshDayRecords(), refreshStatistics(), renderToppingStatistics()]);
    document.dispatchEvent(new CustomEvent('topping:session-ready', { detail: { user, role } }));
  } catch (error) {
    console.error(error);
    $('#application').hidden = true;
    $('#authGate').hidden = false;
    $('#authMessage').textContent = readableError(error);
  }
}

async function loadInitialSession() {
  if (!isSupabaseConfigured) { $('#authMessage').textContent = configurationError; return; }
  try {
    const { session } = await getSession();
    if (session?.user) await activateSession(session.user);
  } catch (error) { $('#authMessage').textContent = readableError(error); }
}

function initialize() {
  const month = today.slice(0, 7);
  if ($('#todayLabel')) $('#todayLabel').textContent = formatDate(today);
  if ($('#recordsMonth')) $('#recordsMonth').value = month;
  if ($('#statisticsMonth')) $('#statisticsMonth').value = month;
  if ($('#toppingMonth')) $('#toppingMonth').value = month;
  if ($('#summaryDate')) $('#summaryDate').value = today;
  if ($('#toppingDate')) $('#toppingDate').value = today;
  if ($('#shiftDate')) $('#shiftDate').value = today;
  initializeDatePickers();

  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $('#signInForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#authMessage').textContent = 'Đang đăng nhập…';
    try {
      const { user } = await signIn($('#authEmail').value.trim(), $('#authPassword').value);
      await activateSession(user);
    } catch (error) { $('#authMessage').textContent = readableError(error); }
  });
  $('#signOutButton')?.addEventListener('click', async () => { await signOut(); location.reload(); });

  $('#recordsMonth')?.addEventListener('change', () => refreshMonthRecords().catch(console.error));
  $('#summaryDate')?.addEventListener('change', () => refreshDayRecords().catch(console.error));
  $('#statisticsMonth')?.addEventListener('change', () => refreshStatistics().catch(console.error));
  $('#toppingMonth')?.addEventListener('change', () => renderToppingStatistics());
  $('#toppingDate')?.addEventListener('change', () => renderToppingStatistics());
  $$('[data-topping-period]').forEach((button) => button.addEventListener('click', () => {
    toppingPeriod = button.dataset.toppingPeriod;
    $$('[data-topping-period]').forEach((b) => b.classList.toggle('active', b === button));
    $('#toppingMonth').hidden = toppingPeriod !== 'month';
    $('#toppingDate').hidden = toppingPeriod !== 'day';
    renderToppingStatistics();
  }));

  $('#addShiftButton')?.addEventListener('click', () => setEditor(today));
  $('#closeEditorButton')?.addEventListener('click', closeEditor);
  $('#cancelEditorButton')?.addEventListener('click', closeEditor);
  $('#shiftForm')?.addEventListener('submit', saveBatch);

  const batch = $('#shiftBatchColumns');
  batch?.addEventListener('input', handleBatchInput);
  batch?.addEventListener('focusin', handleBatchFocus);
  batch?.addEventListener('focusout', handleBatchBlur);
  batch?.addEventListener('change', handleBatchEmployeeSelect);
  batch?.addEventListener('click', handleBatchAction);

  $('#recordsBody')?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (action) {
      event.stopPropagation();
      if (action.dataset.action === 'edit') editRecord(action.dataset.recordId);
      if (action.dataset.action === 'delete') deleteRecord(action.dataset.recordId);
      return;
    }
    const row = event.target.closest('[data-record-id]');
    if (row) editRecord(row.dataset.recordId);
  });

  $('#addEmployeeButton')?.addEventListener('click', () => openEmployeeForm());
  $('#cancelEmployeeButton')?.addEventListener('click', closeEmployeeForm);
  $('#employeeForm')?.addEventListener('submit', saveEmployee);
  $('#employeeSearch')?.addEventListener('input', renderEmployees);
  $('#showInactiveEmployees')?.addEventListener('change', renderEmployees);
  $('#employeesBody')?.addEventListener('click', handleEmployeeAction);

  loadInitialSession();
}

initialize();
