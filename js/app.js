import {
  SHIFTS,
  calculateEmployeeTotals,
  calculateRecordsTotals,
  calculateShiftTotals,
  normalizeQuantity
} from './calculator.js';
import {
  createEmployee,
  createSalesRecord,
  deleteSalesRecord,
  getAllSalesRecords,
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
  updateEmployee,
} from './database.js';
import { configurationError, isSupabaseConfigured } from './config.js';
import { getLegacySalesRecords, markLegacySalesMigrated } from './storage.js';

let records = [];
let dayRecords = [];
let statisticsRecords = [];
let monthShiftNotes = [];
let employees = [];
let toppingTypes = [];
let currentUser = null;
let isManager = false;
let editingEmployeeId = null;
let batchRowsByShift = {};
let batchNotesByShift = {};
let originalNotesByShift = {};
let removedBatchRecordIds = new Set();
let batchDirty = false;
let batchDate = null;
let editorLoadToken = 0;
let toppingPeriod = 'month';
let toastTimer;
const SINGLE_TOPPING_MODE = true;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value);
const shiftLabel = (id) => SHIFTS.find((shift) => shift.id === id)?.label || id;
const toLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));
const isValidIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
const today = toLocalDate(new Date());

function renderOverview(container, records) {
  if (!container) return;
  const totals = calculateRecordsTotals(records, toppingTypes);
  const cards = [
    { label: 'Số ca', value: formatNumber(totals.shiftCount), icon: 'records' },
    { label: 'Tổng topping', value: formatNumber(totals.totalToppings), icon: 'toppings' },
    { label: 'Doanh thu', value: formatMoney(totals.totalMoney), icon: 'money' }
  ];
  container.innerHTML = cards.map((card) => `
    <article class="overview-card">
      <div class="overview-icon">${getOverviewIcon(card.icon)}</div>
      <div>
        <p>${card.label}</p>
        <strong>${card.value}</strong>
      </div>
    </article>
  `).join('');
}

function renderRecords() {
  const grouped = new Map();
  records.forEach((record) => {
    const day = record.date;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(record);
  });

  const days = [...grouped.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([date, dayRecords]) => ({
    date,
    records: dayRecords.sort((left, right) => left.shift.localeCompare(right.shift))
  }));

  $('#recordsEmpty').hidden = days.length > 0;
  $('#recordsBody').innerHTML = days.map(({ date, records: dayRecords }) => {
    const totals = calculateRecordsTotals(dayRecords, toppingTypes);
    const shiftCards = SHIFTS.map((shift) => {
      const shiftRecords = dayRecords.filter((record) => record.shift === shift.id);
      const shiftTotals = calculateRecordsTotals(shiftRecords, toppingTypes);
      const employeeRows = shiftRecords.map((record) => {
        const quantities = record.quantities.reduce((sum, quantity) => sum + normalizeQuantity(quantity), 0);
        const money = calculateShiftTotals(record.quantities, toppingTypes).totalMoney;
        return `
          <div class="history-employee-row" data-record-id="${record.id}" tabindex="0" role="button" aria-label="Sửa ca của ${escapeHtml(record.employee)}">
            <div class="history-employee-main">
              <span class="history-employee-name">${escapeHtml(record.employee)}</span>
              <small>${formatNumber(quantities)} topping</small>
            </div>
            <strong class="history-employee-money">${formatMoney(money)}</strong>
            <div class="history-record-actions">
              <button class="history-action-button edit" type="button" data-action="edit" data-record-id="${record.id}">Sửa</button>
              <button class="history-action-button delete" type="button" data-action="delete" data-record-id="${record.id}">Xóa</button>
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="history-shift-card ${shift.id}">
          <div class="history-shift-header"><span>${escapeHtml(shift.label)}</span><strong>${formatNumber(shiftTotals.totalToppings)} topping · ${formatMoney(shiftTotals.totalMoney)}</strong></div>
          <div class="history-shift-body">${employeeRows || '<div class="history-empty">Chưa có dữ liệu</div>'}</div>
        </div>
      `;
    }).join('');

    return `
      <article class="day-record-card" data-date="${date}">
        <header class="day-record-header">
          <div class="day-record-date">
            <span class="eyebrow">Ngày</span>
            <h3>${formatDate(date)}</h3>
          </div>
          <div class="day-record-summary">
            <span>${formatNumber(totals.totalToppings)} topping</span>
            <strong>${formatMoney(totals.totalMoney)}</strong>
          </div>
        </header>
        <div class="day-record-grid">${shiftCards}</div>
      </article>
    `;
  }).join('');
}

function renderDailySummary() {
  const date = $('#summaryDate').value;
  const selectedRecords = dayRecords.filter((record) => record.date === date);
  const totals = calculateRecordsTotals(selectedRecords, toppingTypes);
  const shiftRows = SHIFTS.map((shift) => {
    const shiftRecords = selectedRecords.filter((record) => record.shift === shift.id);
    const shiftTotals = calculateRecordsTotals(shiftRecords, toppingTypes);
    return `<div class="daily-summary-row"><span>${escapeHtml(shift.label)}</span><strong>${formatMoney(shiftTotals.totalMoney)} · ${formatNumber(shiftTotals.totalToppings)} topping</strong></div>`;
  }).join('');
  $('#dailySummary').innerHTML = `${shiftRows}<div class="daily-summary-row day-total"><span>Tổng cả ngày</span><strong>${formatMoney(totals.totalMoney)} · ${formatNumber(totals.totalToppings)} topping</strong></div>`;
}

function getOverviewIcon(type) {
  const icons = {
    records: '<svg class="overview-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4 8h16"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 12h8M8 16h5"/></svg>',
    toppings: '<svg class="overview-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"/><circle cx="10" cy="7" r="3"/><path d="M20 19v-1a4 4 0 0 0-3-3.87"/><path d="M16 4.13a4 4 0 0 1 0 7.75"/></svg>',
    money: '<svg class="overview-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v10M15.5 9.5c0-1.1-.9-2-2.5-2H11c-1.4 0-2.5 1-2.5 2.5S9.6 12 11 12h2c1.4 0 2.5 1 2.5 2.5S14.4 17 13 17h-2c-1.6 0-2.5-.9-2.5-2"/></svg>'
  };
  return icons[type] || icons.records;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(`${date}T12:00:00`));
}

function renderEmployeeStatistics() {
  const employeeTotals = calculateEmployeeTotals(statisticsRecords, toppingTypes);
  const totals = calculateRecordsTotals(statisticsRecords, toppingTypes);
  renderOverview($('#statisticsOverview'), statisticsRecords);
  $('#employeeStatsEmpty').hidden = employeeTotals.length > 0;
  $('#employeeStatsBody').innerHTML = `${employeeTotals.map((employee) => `<tr><td>${escapeHtml(employee.name)}</td><td class="numeric">${formatNumber(employee.shiftCount)}</td><td class="numeric">${formatNumber(employee.totalToppings)}</td><td class="numeric row-total">${formatMoney(employee.totalMoney)}</td></tr>`).join('')}${employeeTotals.length ? `<tr><td><strong>Tổng toàn quán</strong></td><td class="numeric"><strong>${formatNumber(totals.shiftCount)}</strong></td><td class="numeric"><strong>${formatNumber(totals.totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(totals.totalMoney)}</strong></td></tr>` : ''}`;
}

async function renderToppingStatistics({ throwOnError = false } = {}) {
  try {
    const periodRecords = toppingPeriod === 'month'
      ? await getSalesForMonth($('#toppingMonth').value)
      : await getSalesForDate($('#toppingDate').value);
    const totals = calculateRecordsTotals(periodRecords, toppingTypes);
    $('#toppingStatsBody').innerHTML = `<tr><td>Topping</td><td class="numeric">${formatNumber(totals.totalToppings)}</td><td class="numeric">${formatMoney(totals.totalMoney)}</td></tr><tr><td><strong>Tổng cộng</strong></td><td class="numeric"><strong>${formatNumber(totals.totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(totals.totalMoney)}</strong></td></tr>`;
  } catch (error) {
    console.error('Không tải được thống kê topping từ Supabase.', error);
    showToast(readableError(error));
    if (throwOnError) throw error;
  }
}

function renderAll() {
  renderRecords();
  renderDailySummary();
  renderEmployeeStatistics();
}

function renderEmployees() {
  const query = $('#employeeSearch').value.trim().toLocaleLowerCase('vi');
  const includeInactive = $('#showInactiveEmployees').checked;
  const filtered = employees.filter((employee) => (includeInactive || employee.active) && employee.name.toLocaleLowerCase('vi').includes(query));
  $('#employeesEmpty').hidden = filtered.length > 0;
  $('#employeesBody').innerHTML = filtered.map((employee) => `<tr>
    <td class="employee-name">${escapeHtml(employee.name)}</td>
    <td><span class="status-badge ${employee.active ? 'active' : 'inactive'}">${employee.active ? 'Đang làm' : 'Đã nghỉ'}</span></td>
    <td>${formatDate(employee.created_at.slice(0, 10))}</td>
    <td><div class="row-actions"><button class="table-action" type="button" data-employee-action="edit" data-employee-id="${escapeHtml(employee.id)}">Sửa tên</button><button class="table-action ${employee.active ? 'delete' : ''}" type="button" data-employee-action="toggle" data-active="${employee.active}" data-employee-id="${escapeHtml(employee.id)}">${employee.active ? 'Ẩn' : 'Khôi phục'}</button></div></td>
  </tr>`).join('');
}

function setDatePickerValue(element, value) {
  if (element._flatpickr) element._flatpickr.setDate(value, false);
  else element.value = value;
}

const SHIFT_EDITOR_STYLES = {
  morning: { className: 'morning', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>' },
  afternoon: { className: 'afternoon', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 3v3M5.64 6.64l2.12 2.12m8.48 0 2.12-2.12"/></svg>' },
  evening: { className: 'evening', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/><path d="M16 4v4m-2-2h4"/></svg>' }
};

function rowQuantity(row) {
  const quantity = Number(row.quantity);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}

function renderBatchColumn(shiftId) {
  const shift = SHIFTS.find((item) => item.id === shiftId);
  const style = SHIFT_EDITOR_STYLES[shiftId];
  const rows = batchRowsByShift[shiftId] || [];
  const existingEmployeeIds = new Set(rows.map((row) => row.employeeId));
  const availableEmployees = employees.filter((employee) => employee.active && !existingEmployeeIds.has(employee.id));
  const employeeRows = rows.map((row, index) => `
    <div class="batch-employee-row" data-batch-shift="${shiftId}" data-batch-index="${index}">
      <span class="batch-employee-name" title="${escapeHtml(row.employee)}">${escapeHtml(row.employee)}</span>
      <div class="batch-quantity-field"><input type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(String(row.quantity))}" aria-label="Số topping của ${escapeHtml(row.employee)} trong ${escapeHtml(shift.label)}" data-batch-shift="${shiftId}" data-batch-quantity><span data-batch-money>${formatMoney(rowQuantity(row) * 1000)}</span></div>
      <button class="batch-remove-button" type="button" data-batch-action="remove" data-shift="${shiftId}" data-index="${index}" aria-label="Xóa ${escapeHtml(row.employee)} khỏi ${escapeHtml(shift.label)}" title="Bỏ nhân viên khỏi ca"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button>
    </div>`).join('');
  const totals = calculateShiftTotals(rows.map(rowQuantity), toppingTypes);

  const column = $(`#batch-column-${shiftId}`);
  if (!column) return;
  column.innerHTML = `<article class="batch-shift-card ${style.className}">
    <header class="batch-shift-heading">${style.icon}<h3>CA ${escapeHtml(shift.label.replace('Ca ', '')).toLocaleUpperCase('vi')}</h3></header>
    <div class="batch-roster-heading"><span>Nhân viên</span><span>Số topping / tiền</span><span class="visually-hidden">Thao tác</span></div>
    <div class="batch-employee-list">${employeeRows || '<p class="batch-no-employees">Chưa có nhân viên đang hoạt động.</p>'}</div>
    <div class="batch-add-controls">
      <select aria-label="Chọn nhân viên thêm vào ${escapeHtml(shift.label)}" data-batch-add-select="${shiftId}" ${availableEmployees.length ? '' : 'disabled'}><option value="">+ Thêm nhân viên</option>${availableEmployees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}</option>`).join('')}</select>
      <button class="batch-add-all" type="button" data-batch-action="add-all" data-shift="${shiftId}" ${availableEmployees.length ? '' : 'disabled'}>+ Thêm tất cả nhân viên</button>
    </div>
    <label class="batch-note-field">Ghi chú ${escapeHtml(shift.label.toLocaleLowerCase('vi'))}<textarea rows="2" maxlength="500" placeholder="Ghi chú riêng cho ca này" data-batch-note="${shiftId}">${escapeHtml(batchNotesByShift[shiftId] || '')}</textarea></label>
    <footer class="batch-shift-total"><span>Tổng ${escapeHtml(shift.label.toLocaleLowerCase('vi'))}</span><strong><span data-batch-total-toppings>${formatNumber(totals.totalToppings)}</span> topping</strong><strong data-batch-total-money>${formatMoney(totals.totalMoney)}</strong></footer>
  </article>`;
}

function updateBatchTotals() {
  let dayToppings = 0;
  let dayMoney = 0;
  SHIFTS.forEach((shift) => {
    const column = $(`#batch-column-${shift.id}`);
    if (!column) return;
    const rows = batchRowsByShift[shift.id] || [];
    let shiftToppings = 0;
    rows.forEach((row, index) => {
      const quantity = rowQuantity(row);
      const rowMoney = calculateShiftTotals([quantity], toppingTypes).totalMoney;
      shiftToppings += quantity;
      const moneyOutput = column.querySelector(`[data-batch-index="${index}"] [data-batch-money]`);
      if (moneyOutput) moneyOutput.textContent = formatMoney(rowMoney);
    });
    const shiftMoney = calculateShiftTotals([shiftToppings], toppingTypes).totalMoney;
    const totalToppingsOutput = column.querySelector('[data-batch-total-toppings]');
    const totalMoneyOutput = column.querySelector('[data-batch-total-money]');
    if (totalToppingsOutput) totalToppingsOutput.textContent = formatNumber(shiftToppings);
    if (totalMoneyOutput) totalMoneyOutput.textContent = formatMoney(shiftMoney);
    dayToppings += shiftToppings;
    dayMoney += shiftMoney;
  });
  const dayToppingsOutput = $('#batchDayToppings');
  const dayMoneyOutput = $('#batchDayMoney');
  if (dayToppingsOutput) dayToppingsOutput.textContent = formatNumber(dayToppings);
  if (dayMoneyOutput) dayMoneyOutput.textContent = formatMoney(dayMoney);
}

function renderBatchColumns() {
  SHIFTS.forEach((shift) => renderBatchColumn(shift.id));
  updateBatchTotals();
}

function initializeBatchRows(dayRecords) {
  batchRowsByShift = Object.fromEntries(SHIFTS.map((shift) => {
    const rows = dayRecords.filter((record) => record.shift === shift.id).map((record) => ({
      id: record.id,
      employeeId: record.employeeId,
      employee: record.employee,
      quantity: record.quantities.reduce((total, quantity) => total + normalizeQuantity(quantity), 0),
      originalQuantities: [...record.quantities],
      originalQuantity: record.quantities.reduce((total, quantity) => total + normalizeQuantity(quantity), 0)
    }));
    const existingEmployeeIds = new Set(rows.map((row) => row.employeeId));
    employees.filter((employee) => employee.active && !existingEmployeeIds.has(employee.id)).forEach((employee) => {
      rows.push({ id: null, employeeId: employee.id, employee: employee.name, quantity: 0, originalQuantities: [], originalQuantity: 0 });
    });
    return [shift.id, rows];
  }));
}

async function setEditor(dateOrRecord = today) {
  const selectedDate = (dateOrRecord && typeof dateOrRecord === 'object' && 'date' in dateOrRecord) ? dateOrRecord.date : dateOrRecord;
  const requestToken = ++editorLoadToken;
  batchDate = selectedDate;
  batchDirty = false;
  removedBatchRecordIds = new Set();
  $('#editorHeading').textContent = 'Nhập topping';
  $('#saveShiftButton').textContent = 'LƯU TẤT CẢ';
  $('#saveShiftButton').disabled = true;
  setDatePickerValue($('#shiftDate'), selectedDate);
  $('#formError').hidden = true;
  $('#formError').textContent = '';
  const batchColumns = $('#shiftBatchColumns');
  if (batchColumns) {
    batchColumns.innerHTML = SHIFTS.map((shift) => `<div id="batch-column-${shift.id}"><p class="muted">Đang tải dữ liệu từ Supabase…</p></div>`).join('');
  }
  $('#shiftEditor').hidden = false;
  $('#shiftEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const [loadedRecords, loadedNotes, loadedEmployees] = await Promise.all([
      getSalesForDate(selectedDate),
      getShiftNotesForDate(selectedDate),
      getEmployees({ includeInactive: isManager })
    ]);
    if (requestToken !== editorLoadToken) return;
    employees = loadedEmployees;
    originalNotesByShift = Object.fromEntries(SHIFTS.map((shift) => [shift.id, loadedNotes.find((note) => note.shift === shift.id)?.note || '']));
    batchNotesByShift = { ...originalNotesByShift };
    initializeBatchRows(loadedRecords);
    $('#editorHeading').textContent = loadedRecords.length ? `Sửa dữ liệu ngày ${formatDate(selectedDate)}` : 'Nhập topping';
    $('#saveShiftButton').textContent = loadedRecords.length ? 'LƯU THAY ĐỔI' : 'LƯU TẤT CẢ';
    renderBatchColumns();
  } catch (error) {
    logSupabaseError('Không tải được dữ liệu ngày để nhập topping.', error, { date: selectedDate });
    showFormError(readableError(error));
  } finally {
    if (requestToken === editorLoadToken) $('#saveShiftButton').disabled = false;
  }
}

function closeEditor() {
  editorLoadToken += 1;
  batchRowsByShift = {};
  batchNotesByShift = {};
  originalNotesByShift = {};
  removedBatchRecordIds = new Set();
  batchDirty = false;
  $('#shiftEditor').hidden = true;
  $('#shiftForm').reset();
}

function handleBatchColumnAction(event) {
  const button = event.target.closest('[data-batch-action]');
  if (!button) return;
  const shiftId = button.dataset.shift;
  const rows = batchRowsByShift[shiftId] || [];

  if (button.dataset.batchAction === 'remove') {
    const [removedRow] = rows.splice(Number(button.dataset.index), 1);
    if (removedRow?.id) removedBatchRecordIds.add(removedRow.id);
    batchDirty = true;
    renderBatchColumn(shiftId);
    updateBatchTotals();
    return;
  }

  const presentIds = new Set(rows.map((row) => row.employeeId));
  const activeEmployees = employees.filter((employee) => employee.active);
  if (button.dataset.batchAction === 'add-all') {
    const additions = activeEmployees.filter((employee) => !presentIds.has(employee.id));
    additions.forEach((employee) => rows.push({ id: null, employeeId: employee.id, employee: employee.name, quantity: 0, originalQuantities: [], originalQuantity: 0 }));
    if (additions.length) batchDirty = true;
    renderBatchColumn(shiftId);
    updateBatchTotals();
  }
}

function handleBatchEmployeeSelect(event) {
  const select = event.target.closest('[data-batch-add-select]');
  if (!select || !select.value) return;
  const shiftId = select.dataset.batchAddSelect;
  const rows = batchRowsByShift[shiftId] || [];
  const employee = employees.find((item) => item.active && item.id === select.value);
  if (!employee || rows.some((row) => row.employeeId === employee.id)) {
    select.value = '';
    return;
  }
  rows.push({ id: null, employeeId: employee.id, employee: employee.name, quantity: 0, originalQuantities: [], originalQuantity: 0 });
  batchDirty = true;
  renderBatchColumn(shiftId);
  updateBatchTotals();
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
  const rowElement = input.closest('[data-batch-index]');
  const shiftId = input.dataset.batchShift || rowElement?.dataset.batchShift;
  const rowIndex = Number(rowElement?.dataset.batchIndex ?? -1);
  const row = shiftId && batchRowsByShift[shiftId]?.[rowIndex];
  if (!row) return;
  row.quantity = input.value;
  batchDirty = true;
  updateBatchTotals();
}

function buildDayBatchPayload(date) {
  const entries = [];
  for (const shift of SHIFTS) {
    const seen = new Set();
    for (const row of batchRowsByShift[shift.id] || []) {
      const quantity = Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error(`Số topping của ${row.employee} trong ${shift.label} phải là số nguyên từ 0 trở lên.`);
      }
      if (seen.has(row.employeeId)) {
        throw new Error(`${row.employee} đang xuất hiện nhiều lần trong ${shift.label}. Mỗi nhân viên chỉ được có một dòng trong cùng ca.`);
      }
      seen.add(row.employeeId);
      if (row.id && quantity === row.originalQuantity) continue;
      if (!row.id && quantity === 0) continue;
      if (quantity > 0 && !toppingTypes.length) throw new Error('Database chưa có loại topping đang hoạt động để lưu số lượng.');

      entries.push({
        id: row.id,
        shift: shift.id,
        employee_id: row.employeeId,
        note: batchNotesByShift[shift.id] || '',
        toppings: toppingTypes.map((type, index) => ({ topping_type_id: type.id, quantity: index === 0 ? quantity : 0 }))
      });
    }
  }

  const notes = SHIFTS
    .filter((shift) => (batchNotesByShift[shift.id] || '') !== (originalNotesByShift[shift.id] || ''))
    .map((shift) => ({ shift: shift.id, note: batchNotesByShift[shift.id] || '' }));
  return { date, entries, notes, deleteIds: [...removedBatchRecordIds] };
}

async function handleBatchDateChange() {
  const nextDate = $('#shiftDate').value;
  if (!isValidIsoDate(nextDate)) return showFormError('Vui lòng chọn ngày hợp lệ.');
  if (nextDate === batchDate) return;
  if (batchDirty && !window.confirm('Bạn có thay đổi chưa lưu. Hủy các thay đổi này để mở ngày khác?')) {
    setDatePickerValue($('#shiftDate'), batchDate);
    return;
  }
  await setEditor(nextDate);
}

async function refreshMonthRecords(month = $('#recordsMonth').value) {
  try {
    const [loadedRecords, loadedNotes] = await Promise.all([getSalesForMonth(month), getShiftNotesForMonth(month)]);
    records = loadedRecords;
    monthShiftNotes = loadedNotes;
    renderRecords();
  } catch (error) {
    console.error('Không tải được danh sách ca từ Supabase.', { month, error });
    showToast(readableError(error));
  }
}

async function refreshDayRecords(date = $('#summaryDate').value) {
  try {
    dayRecords = await getSalesForDate(date);
    renderDailySummary();
  } catch (error) {
    console.error('Không tải được tổng kết ngày từ Supabase.', { date, error });
    showToast(readableError(error));
  }
}

async function refreshStatisticsRecords(month = $('#statisticsMonth').value) {
  try {
    statisticsRecords = await getSalesForMonth(month);
    renderEmployeeStatistics();
  } catch (error) {
    console.error('Không tải được thống kê tháng từ Supabase.', { month, error });
    showToast(readableError(error));
  }
}

async function refreshEmployees() {
  employees = await getEmployees({ includeInactive: isManager });
  if (isManager) renderEmployees();
}

async function migrateLegacySales() {
  const legacyRecords = getLegacySalesRecords();
  if (!isManager || !legacyRecords.length) return;
  const remoteRecords = await getAllSalesRecords();
  const existingShifts = new Set(remoteRecords.map((record) => `${record.date}|${record.shift}`));
  const employeeByName = new Map(employees.map((employee) => [employee.name.trim().toLocaleLowerCase('vi'), employee]));
  let importedCount = 0;

  for (const legacyRecord of legacyRecords) {
    const key = `${legacyRecord.date}|${legacyRecord.shift}`;
    if (existingShifts.has(key)) continue;
    const normalizedName = legacyRecord.employee.toLocaleLowerCase('vi');
    let employee = employeeByName.get(normalizedName);
    if (!employee) {
      employee = await createEmployee(legacyRecord.employee);
      employeeByName.set(normalizedName, employee);
    }
    await createSalesRecord({
      date: legacyRecord.date,
      shift: legacyRecord.shift,
      employeeId: employee.id,
      quantities: legacyRecord.quantities,
      note: legacyRecord.note
    });
    existingShifts.add(key);
    importedCount += 1;
  }

  markLegacySalesMigrated();
  await refreshEmployees();
  if (importedCount) showToast(`Đã chuyển ${formatNumber(importedCount)} ca cũ lên database.`);
}

async function refreshAfterSalesChange(date) {
  const month = date.slice(0, 7);
  $('#recordsMonth').value = month;
  setDatePickerValue($('#summaryDate'), date);
  const [updatedRecords, updatedDayRecords, updatedNotes] = await Promise.all([
    getSalesForMonth(month),
    getSalesForDate(date),
    getShiftNotesForMonth(month)
  ]);
  records = updatedRecords;
  dayRecords = updatedDayRecords;
  monthShiftNotes = updatedNotes;
  renderRecords();
  renderDailySummary();
  if ($('#statisticsMonth').value === month) {
    statisticsRecords = updatedRecords;
    renderEmployeeStatistics();
  }
  await renderToppingStatistics({ throwOnError: true });
}

async function saveDayBatch(event) {
  event.preventDefault();
  const saveButton = $('#saveShiftButton');
  const date = $('#shiftDate').value;

  if (!isValidIsoDate(date)) {
    saveButton.disabled = false;
    saveButton.textContent = 'LƯU TẤT CẢ';
    return showFormError('Vui lòng chọn ngày hợp lệ.');
  }

  let payload;
  try {
    payload = buildDayBatchPayload(date);
  } catch (error) {
    logSupabaseError('Dữ liệu batch nhập topping không hợp lệ.', error, { date });
    return showFormError(readableError(error));
  }

  if (!payload.entries.length && !payload.notes.length && !payload.deleteIds.length) {
    showToast('Chưa có thay đổi nào để lưu.');
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = 'Đang lưu...';

  try {
    await saveDayToppings(payload);
    closeEditor();
    await refreshAfterSalesChange(date);
    showToast('Đã lưu dữ liệu topping cho ngày này.');
  } catch (error) {
    logSupabaseError('Lỗi khi lưu dữ liệu topping theo ngày.', error, { date, payload });
    showFormError(readableError(error));
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'LƯU TẤT CẢ';
  }
}

function showFormError(message) {
  $('#formError').textContent = message;
  $('#formError').hidden = false;
}

function editRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  if (!isManager && record.createdBy !== currentUser?.id) return showToast('Bạn chỉ có thể sửa ca do mình ghi nhận.');
  setEditor(record);
}

function confirmDeleteRecord() {
  const dialog = $('#deleteRecordDialog');
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), { once: true });
    dialog.showModal();
  });
}

async function deleteRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record) return;
  if (!isManager && record.createdBy !== currentUser?.id) return showToast('Bạn chỉ có thể xóa ca do mình ghi nhận.');
  if (!await confirmDeleteRecord()) return;
  try {
    await deleteSalesRecord(id);
  } catch (error) {
    logSupabaseError('Lỗi khi xóa bản ghi ca bán trên Supabase.', error, { recordId: id });
    showToast(readableError(error));
    return;
  }
  try {
    await refreshAfterSalesChange(record.date);
  } catch (error) {
    logSupabaseError('Đã xóa bản ghi trên Supabase nhưng không thể tải lại dữ liệu hiển thị.', error, { recordId: id });
    showToast(`Đã xóa bản ghi nhưng chưa tải lại được dữ liệu: ${readableError(error)}`);
    return;
  }
  showToast('Đã xóa ca bán.');
}

function openEmployeeForm(employee = null) {
  editingEmployeeId = employee?.id || null;
  $('#employeeFormLabel').textContent = editingEmployeeId ? 'Tên nhân viên' : 'Tên nhân viên mới';
  $('#employeeFormName').value = employee?.name || '';
  $('#employeeFormError').hidden = true;
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
  if (!name) return showEmployeeError('Vui lòng nhập tên nhân viên.');
  const wasEditing = Boolean(editingEmployeeId);
  try {
    if (editingEmployeeId) await updateEmployee(editingEmployeeId, { name });
    else await createEmployee(name);
    closeEmployeeForm();
    await refreshEmployees();
    showToast(wasEditing ? 'Đã cập nhật tên nhân viên.' : 'Đã thêm nhân viên.');
  } catch (error) {
    showEmployeeError(readableError(error));
  }
}

function showEmployeeError(message) {
  $('#employeeFormError').textContent = message;
  $('#employeeFormError').hidden = false;
}

async function saveQuickEmployee() {
  const quickEmployeeName = $('#quickEmployeeName');
  const quickEmployeeForm = $('#quickEmployeeForm');
  const quickEmployeeError = $('#quickEmployeeError');
  if (!quickEmployeeName || !quickEmployeeForm || !quickEmployeeError) return;

  const name = quickEmployeeName.value.trim();
  if (!name) {
    quickEmployeeError.textContent = 'Vui lòng nhập tên nhân viên.';
    quickEmployeeError.hidden = false;
    return;
  }
  try {
    const employee = await createEmployee(name);
    await refreshEmployees();
    quickEmployeeName.value = '';
    quickEmployeeForm.hidden = true;
    showToast(`Đã thêm nhân viên ${employee.name}.`);
  } catch (error) {
    quickEmployeeError.textContent = readableError(error);
    quickEmployeeError.hidden = false;
  }
}

async function toggleEmployeeActive(id, active) {
  const employee = employees.find((item) => item.id === id);
  if (!employee) return;
  const action = active ? 'ẩn' : 'khôi phục';
  if (!window.confirm(`Bạn muốn ${action} nhân viên ${employee.name}?`)) return;
  try {
    await updateEmployee(id, { active: !active });
    await refreshEmployees();
    showToast(active ? 'Đã ẩn nhân viên khỏi danh sách ca mới.' : 'Đã khôi phục nhân viên.');
  } catch (error) {
    showToast(readableError(error));
  }
}

async function handleEmployeeAction(event) {
  const button = event.target.closest('[data-employee-action]');
  if (!button) return;
  const employee = employees.find((item) => item.id === button.dataset.employeeId);
  if (!employee) return;
  if (button.dataset.employeeAction === 'edit') openEmployeeForm(employee);
  if (button.dataset.employeeAction === 'toggle') await toggleEmployeeActive(employee.id, button.dataset.active === 'true');
}

function readableError(error) {
  if (error?.code === '23505') return 'Supabase đang từ chối bản ghi do UNIQUE constraint. Hãy chạy migration bỏ ràng buộc ngày + ca trong Supabase.';
  if (error?.code === '23503') return 'Nhân viên hoặc loại topping được chọn không còn tồn tại trong Supabase.';
  if (error?.code === '23502') return 'Thiếu trường bắt buộc khi lưu bản ghi ca.';
  if (error?.code === 'PGRST205' || error?.code === '42P01') return 'Database chưa có bảng cần thiết. Hãy chạy supabase/schema.sql trong Supabase SQL Editor.';
  if (error?.code === 'PGRST202') return 'Database chưa có hàm lưu ca. Hãy chạy lại supabase/schema.sql trong Supabase SQL Editor.';
  if (error?.code === 'PGRST116') return 'Không tìm thấy đúng bản ghi Supabase để cập nhật hoặc tài khoản không có quyền xem bản ghi đó.';
  if (error?.code === 'RECORD_NOT_DELETED') return 'Không tìm thấy bản ghi để xóa hoặc RLS policy không cho phép tài khoản này xóa.';
  if (error?.code === '42501') return 'Tài khoản không có quyền thao tác này. Kiểm tra role và RLS policies.';
  if (error?.message?.includes('Invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (error?.message?.toLowerCase().includes('email not confirmed')) return 'Email tài khoản chưa được xác nhận. Hãy xác nhận email trong Supabase Authentication hoặc tắt yêu cầu xác nhận email nếu phù hợp.';
  if (error?.message?.toLowerCase().includes('too many requests')) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.';
  if (error?.message?.includes('Invalid API key')) return 'Supabase public key không hợp lệ hoặc không thuộc project URL đã cấu hình.';
  if (error?.message?.includes('Failed to fetch')) return 'Không kết nối được Supabase. Kiểm tra URL và kết nối mạng.';
  const details = [error?.message, error?.details, error?.hint, error?.code ? `Mã: ${error.code}` : '']
    .filter(Boolean)
    .join(' · ');
  return details || 'Có lỗi khi lưu dữ liệu. Vui lòng thử lại.';
}

function logSupabaseError(context, error, metadata = {}) {
  console.error(context, {
    code: error?.code || null,
    message: error?.message || null,
    details: error?.details || null,
    hint: error?.hint || null,
    error,
    ...metadata
  });
}

function readableSignInError(error) {
  const message = error?.message?.toLowerCase() || '';
  if (message.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng. Hãy kiểm tra lại thông tin đăng nhập.';
  if (message.includes('email not confirmed')) return 'Email tài khoản chưa được xác nhận. Hãy xác nhận email trong Supabase Authentication hoặc tắt yêu cầu xác nhận email nếu phù hợp.';
  if (message.includes('too many requests')) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.';
  if (message.includes('invalid api key')) return 'Supabase từ chối public key. Hãy kiểm tra lại URL và publishable key trong js/config.js.';
  if (message.includes('failed to fetch')) return 'Không kết nối được Supabase. Hãy kiểm tra mạng và thử lại.';
  const errorCode = error?.code || error?.status;
  return `Không thể đăng nhập vào Supabase${errorCode ? ` (mã ${errorCode})` : ''}. Hãy kiểm tra thông tin đăng nhập; chi tiết kỹ thuật đã được ghi trong Console.`;
}

function showAuthMessage(message) {
  $('#authMessage').textContent = message;
}

async function activateSession(user) {
  currentUser = user;
  try {
    const role = await getUserRole(user.id);
    if (!['manager', 'staff'].includes(role)) throw new Error('Tài khoản chưa được gán vai trò quản lý hoặc nhân viên.');
    isManager = role === 'manager';
    $('#signedInLabel').textContent = user.email;
    $$('.manager-only').forEach((element) => { element.hidden = !isManager; });
    $('#authGate').hidden = true;
    $('#application').hidden = false;
    [employees, toppingTypes] = await Promise.all([
      getEmployees({ includeInactive: isManager }),
      getToppingTypes()
    ]);
    if (isManager) await migrateLegacySales();
    if (isManager) renderEmployees();
    await Promise.all([
      refreshMonthRecords(),
      refreshDayRecords(),
      refreshStatisticsRecords(),
      renderToppingStatistics()
    ]);
  } catch (error) {
    console.error('Supabase đã xác thực người dùng nhưng không thể khởi tạo ứng dụng.', error);
    currentUser = null;
    $('#application').hidden = true;
    $('#authGate').hidden = false;
    showAuthMessage(readableError(error));
  }
}

async function handleSignIn(event) {
  event.preventDefault();
  $('#signInButton').disabled = true;
  showAuthMessage('Đang đăng nhập…');
  try {
    const { user } = await signIn($('#authEmail').value.trim(), $('#authPassword').value);
    await activateSession(user);
  } catch (error) {
    console.error('Supabase signInWithPassword thất bại.', error);
    showAuthMessage(readableSignInError(error));
  } finally {
    $('#signInButton').disabled = false;
  }
}

async function loadInitialSession() {
  if (!isSupabaseConfigured) {
    showAuthMessage(configurationError);
    return;
  }
  try {
    const { session } = await getSession();
    if (session) await activateSession(session.user);
  } catch (error) {
    console.error('Không thể khôi phục phiên Supabase.', error);
    showAuthMessage(readableError(error));
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function navigate(view) {
  $$('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle('active', active);
    section.hidden = !active;
  });
  const headings = {
    records: ['SỔ BÁN HÀNG · THEO DÕI TỪNG CA', 'Bảng ca bán'],
    statistics: ['TỔNG HỢP · HIỆU QUẢ THEO NHÂN VIÊN', 'Thống kê tháng'],
    employees: ['DANH SÁCH · NHÂN SỰ QUÁN', 'Quản lý nhân viên']
  };
  $('#pageEyebrow').textContent = headings[view][0];
  $('#pageTitle').textContent = headings[view][1];
  if (view === 'employees') renderEmployees();
}

function setToppingPeriod(period) {
  toppingPeriod = period;
  $$('[data-topping-period]').forEach((button) => button.classList.toggle('active', button.dataset.toppingPeriod === period));
  $('#toppingMonth').hidden = period !== 'month';
  $('#toppingDate').hidden = period !== 'day';
  $('#toppingDate').previousElementSibling.hidden = period !== 'day';
  $('#toppingMonth').previousElementSibling.hidden = period !== 'month';
  renderToppingStatistics();
}

function initialize() {
  const month = today.slice(0, 7);
  const todayLabel = $('#todayLabel');
  if (todayLabel) {
    todayLabel.textContent = new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date());
  }
  const recordsMonth = $('#recordsMonth');
  const summaryDate = $('#summaryDate');
  const statisticsMonth = $('#statisticsMonth');
  const toppingMonth = $('#toppingMonth');
  const toppingDate = $('#toppingDate');
  if (recordsMonth) recordsMonth.value = month;
  if (summaryDate) summaryDate.value = today;
  if (statisticsMonth) statisticsMonth.value = month;
  if (toppingMonth) toppingMonth.value = month;
  if (toppingDate) toppingDate.value = today;
  initializeDatePickers();
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  const signInForm = $('#signInForm');
  if (signInForm) signInForm.addEventListener('submit', handleSignIn);
  const signOutButton = $('#signOutButton');
  if (signOutButton) signOutButton.addEventListener('click', async () => {
    try {
      await signOut();
      currentUser = null;
      $('#application').hidden = true;
      $('#authGate').hidden = false;
      showAuthMessage('Đã đăng xuất.');
    } catch (error) {
      showToast(readableError(error));
    }
  });
  if (recordsMonth) recordsMonth.addEventListener('change', () => refreshMonthRecords());
  if (summaryDate) summaryDate.addEventListener('change', () => refreshDayRecords());
  if (statisticsMonth) statisticsMonth.addEventListener('change', () => refreshStatisticsRecords());
  const addShiftButton = $('#addShiftButton');
  if (addShiftButton) addShiftButton.addEventListener('click', () => setEditor());
  const closeEditorButton = $('#closeEditorButton');
  if (closeEditorButton) closeEditorButton.addEventListener('click', closeEditor);
  const cancelEditorButton = $('#cancelEditorButton');
  if (cancelEditorButton) cancelEditorButton.addEventListener('click', closeEditor);
  const shiftForm = $('#shiftForm');
  if (shiftForm) shiftForm.addEventListener('submit', saveDayBatch);
  const shiftBatchColumns = $('#shiftBatchColumns');
  if (shiftBatchColumns) {
    shiftBatchColumns.addEventListener('click', handleBatchColumnAction);
    shiftBatchColumns.addEventListener('input', handleBatchInput);
    shiftBatchColumns.addEventListener('change', handleBatchEmployeeSelect);
  }
  const quickAddEmployeeButton = $('#quickAddEmployeeButton');
  if (quickAddEmployeeButton) quickAddEmployeeButton.addEventListener('click', () => {
    const quickEmployeeError = $('#quickEmployeeError');
    const quickEmployeeForm = $('#quickEmployeeForm');
    const quickEmployeeName = $('#quickEmployeeName');
    if (quickEmployeeError) quickEmployeeError.hidden = true;
    if (quickEmployeeForm) quickEmployeeForm.hidden = false;
    if (quickEmployeeName) quickEmployeeName.focus();
  });
  const saveQuickEmployeeButton = $('#saveQuickEmployeeButton');
  if (saveQuickEmployeeButton) saveQuickEmployeeButton.addEventListener('click', saveQuickEmployee);
  const cancelQuickEmployeeButton = $('#cancelQuickEmployeeButton');
  if (cancelQuickEmployeeButton) cancelQuickEmployeeButton.addEventListener('click', () => {
    const quickEmployeeForm = $('#quickEmployeeForm');
    if (quickEmployeeForm) quickEmployeeForm.hidden = true;
  });
  const recordsBody = $('#recordsBody');
  if (recordsBody) {
    recordsBody.addEventListener('click', (event) => {
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
    recordsBody.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-record-id]')) {
        event.preventDefault();
        editRecord(event.target.dataset.recordId);
      }
    });
  }
  const addEmployeeButton = $('#addEmployeeButton');
  if (addEmployeeButton) addEmployeeButton.addEventListener('click', () => openEmployeeForm());
  const cancelEmployeeButton = $('#cancelEmployeeButton');
  if (cancelEmployeeButton) cancelEmployeeButton.addEventListener('click', closeEmployeeForm);
  const employeeForm = $('#employeeForm');
  if (employeeForm) employeeForm.addEventListener('submit', saveEmployee);
  const employeeSearch = $('#employeeSearch');
  if (employeeSearch) employeeSearch.addEventListener('input', renderEmployees);
  const showInactiveEmployees = $('#showInactiveEmployees');
  if (showInactiveEmployees) showInactiveEmployees.addEventListener('change', renderEmployees);
  const employeesBody = $('#employeesBody');
  if (employeesBody) employeesBody.addEventListener('click', handleEmployeeAction);
  $$('.segment').forEach((button) => button.addEventListener('click', () => setToppingPeriod(button.dataset.toppingPeriod)));
  const toppingMonthInput = $('#toppingMonth');
  if (toppingMonthInput) toppingMonthInput.addEventListener('change', renderToppingStatistics);
  const toppingDateInput = $('#toppingDate');
  if (toppingDateInput) toppingDateInput.addEventListener('change', renderToppingStatistics);
  const shiftDateInput = $('#shiftDate');
  if (shiftDateInput) shiftDateInput.addEventListener('change', handleBatchDateChange);
  void loadInitialSession();
}

function initializeDatePickers() {
  if (!window.flatpickr) return;

  const vietnameseLocale = window.flatpickr.l10ns?.vn || {
    weekdays: {
      shorthand: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
      longhand: ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']
    },
    months: {
      shorthand: ['Thg 1', 'Thg 2', 'Thg 3', 'Thg 4', 'Thg 5', 'Thg 6', 'Thg 7', 'Thg 8', 'Thg 9', 'Thg 10', 'Thg 11', 'Thg 12'],
      longhand: ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']
    },
    firstDayOfWeek: 1,
    rangeSeparator: ' đến ',
    scrollTitle: 'Cuộn để chọn tháng',
    toggleTitle: 'Bật/tắt lịch'
  };

  $$('.date-picker').forEach((element) => {
    const existingValue = element.value;
    const pickerResult = window.flatpickr(element, {
      locale: vietnameseLocale,
      altInput: true,
      altFormat: 'd/m/Y',
      dateFormat: 'Y-m-d',
      weekStart: 1,
      allowInput: false,
      defaultDate: existingValue || undefined,
      monthSelectorType: 'static',
      onReady: (_selectedDates, _dateString, picker) => {
        const calendar = picker.calendarContainer;
        if (calendar && !calendar.querySelector('.flatpickr-actions')) {
          const actions = document.createElement('div');
          actions.className = 'flatpickr-actions';

          const todayButton = document.createElement('button');
          todayButton.type = 'button';
          todayButton.className = 'flatpickr-action-btn';
          todayButton.textContent = 'Hôm nay';
          todayButton.addEventListener('click', () => {
            picker.setDate(new Date(), false);
            picker.close();
          });

          const clearButton = document.createElement('button');
          clearButton.type = 'button';
          clearButton.className = 'flatpickr-action-btn flatpickr-action-btn-muted';
          clearButton.textContent = 'Xóa';
          clearButton.addEventListener('click', () => {
            picker.clear();
            picker.close();
          });

          actions.appendChild(todayButton);
          actions.appendChild(clearButton);
          calendar.appendChild(actions);
        }

        const altInput = element.parentElement?.querySelector('.flatpickr-input') || element;
        if (altInput && altInput !== element) {
          altInput.setAttribute('aria-label', 'Chọn ngày');
        }
      }
    });
    const instance = Array.isArray(pickerResult) ? pickerResult[0] : pickerResult;

    if (typeof instance?.setDate === 'function' && existingValue) {
      instance.setDate(existingValue, false);
    }
  });
}

initialize();