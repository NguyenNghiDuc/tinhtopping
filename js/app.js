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
  getToppingTypes,
  getSession,
  getUserRole,
  signIn,
  signOut,
  updateEmployee,
  updateSalesRecord
} from './database.js';
import { configurationError, isSupabaseConfigured } from './config.js';
import { getLegacySalesRecords, markLegacySalesMigrated } from './storage.js';

let records = [];
let dayRecords = [];
let statisticsRecords = [];
let employees = [];
let toppingTypes = [];
let currentUser = null;
let isManager = false;
const today = toLocalDate(new Date());
let editingId = null;
let editingEmployeeId = null;
let toppingPeriod = 'month';
let toastTimer;
const SINGLE_TOPPING_MODE = true;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value);
const shiftLabel = (id) => SHIFTS.find((shift) => shift.id === id)?.label || id;

function toLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function getMonthRecords(month) {
  return records.filter((record) => record.date.startsWith(month));
}

function renderOverview(container, selectedRecords) {
  const totals = calculateRecordsTotals(selectedRecords, toppingTypes);
  container.innerHTML = `
    <article class="overview-card"><div class="overview-card-head"><span class="overview-icon" aria-hidden="true">${getOverviewIcon('records')}</span></div><div class="overview-label">Số ca đã ghi nhận</div><div class="overview-value">${formatNumber(totals.shiftCount)}</div><div class="overview-note">Trong kỳ đang xem</div></article>
    <article class="overview-card"><div class="overview-card-head"><span class="overview-icon green" aria-hidden="true">${getOverviewIcon('toppings')}</span></div><div class="overview-label">Tổng topping toàn quán</div><div class="overview-value">${formatNumber(totals.totalToppings)}</div><div class="overview-note">Tất cả nhân viên</div></article>
    <article class="overview-card total-card"><div class="overview-card-head"><span class="overview-icon white" aria-hidden="true">${getOverviewIcon('money')}</span></div><div class="overview-label">Tổng tiền topping</div><div class="overview-value">${formatMoney(totals.totalMoney)}</div><div class="overview-note">${formatNumber(totals.shiftCount)} ca trong kỳ</div></article>`;
}

function renderRecords() {
  const monthRecords = getMonthRecords($('#recordsMonth').value).sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date);
    const shiftOrder = SHIFTS.findIndex((shift) => shift.id === left.shift) - SHIFTS.findIndex((shift) => shift.id === right.shift);
    return dateOrder || shiftOrder || (left.createdAt || '').localeCompare(right.createdAt || '');
  });
  renderOverview($('#monthOverview'), monthRecords);
  $('#recordsEmpty').hidden = monthRecords.length > 0;
  const recordsByDate = new Map();
  monthRecords.forEach((record) => {
    const dayRecords = recordsByDate.get(record.date) || [];
    dayRecords.push(record);
    recordsByDate.set(record.date, dayRecords);
  });

  $('#recordsBody').innerHTML = [...recordsByDate.entries()].map(([date, dayRecords]) => {
    const dayTotals = calculateRecordsTotals(dayRecords, toppingTypes);
    const shiftCards = SHIFTS.map((shift) => {
      const shiftRecords = dayRecords.filter((record) => record.shift === shift.id);
      const styles = {
        morning: {
          className: 'morning',
          icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
        },
        afternoon: {
          className: 'afternoon',
          icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 3v3M5.64 6.64l2.12 2.12m8.48 0 2.12-2.12"/></svg>'
        },
        evening: {
          className: 'evening',
          icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/><path d="M16 4v4m-2-2h4"/></svg>'
        }
      }[shift.id];

      if (!shiftRecords.length) {
        return `<article class="shift-history-card ${styles.className}">
          <header class="shift-history-heading">${styles.icon}<h3>${escapeHtml(shift.label).toLocaleUpperCase('vi')}</h3></header>
          <p class="shift-empty">Chưa có dữ liệu</p>
        </article>`;
      }

      const shiftTotals = calculateRecordsTotals(shiftRecords, toppingTypes);
      const recordRows = shiftRecords.map((record) => {
        const totals = calculateShiftTotals(record.quantities, toppingTypes);
        const canEdit = isManager || record.createdBy === currentUser?.id;
        const noteText = record.note ? escapeHtml(record.note) : '—';
        const recordId = escapeHtml(record.id);
        return `<tr class="shift-row" data-record-id="${recordId}" tabindex="0" aria-label="${escapeHtml(date)} ${escapeHtml(shift.label)}, ${escapeHtml(record.employee)}, bấm để sửa topping">
          <td class="employee-name" data-label="Nhân viên">${escapeHtml(record.employee)}</td>
          <td class="numeric" data-label="Số topping">${formatNumber(totals.totalToppings)} topping</td>
          <td class="numeric row-total" data-label="Tổng tiền">${formatMoney(totals.totalMoney)}</td>
          <td data-label="Ghi chú">${noteText}</td>
          <td data-label="Thao tác"><div class="row-actions">${canEdit ? `<button class="table-action" type="button" data-action="edit" data-record-id="${recordId}"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>Sửa</button><button class="table-action delete" type="button" data-action="delete" data-record-id="${recordId}"><svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>Xóa</button>` : ''}</div></td>
        </tr>`;
      }).join('');

      return `<article class="shift-history-card ${styles.className}">
        <header class="shift-history-heading">${styles.icon}<h3>${escapeHtml(shift.label).toLocaleUpperCase('vi')}</h3></header>
        <div class="shift-table-scroll"><table class="data-table shift-history-table">
          <thead><tr><th>Nhân viên</th><th class="numeric">Số topping</th><th class="numeric">Tổng tiền</th><th>Ghi chú</th><th><span class="visually-hidden">Thao tác</span></th></tr></thead>
          <tbody>${recordRows}</tbody>
          <tfoot><tr><td>TỔNG CA</td><td class="numeric">${formatNumber(shiftTotals.totalToppings)} topping</td><td class="numeric row-total">${formatMoney(shiftTotals.totalMoney)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
      </article>`;
    }).join('');

    return `<section class="history-day" aria-labelledby="history-day-${date}">
      <h3 class="history-day-heading" id="history-day-${date}">${formatDate(date)}</h3>
      <div class="history-shift-list">${shiftCards}</div>
      <div class="history-day-total"><strong>TỔNG NGÀY</strong><strong>${formatNumber(dayTotals.totalToppings)} topping <span aria-hidden="true">|</span> ${formatMoney(dayTotals.totalMoney)}</strong></div>
    </section>`;
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

async function renderToppingStatistics() {
  try {
    const periodRecords = toppingPeriod === 'month'
      ? await getSalesForMonth($('#toppingMonth').value)
      : await getSalesForDate($('#toppingDate').value);
    const totals = calculateRecordsTotals(periodRecords, toppingTypes);
    $('#toppingStatsBody').innerHTML = `<tr><td>Topping</td><td class="numeric">${formatNumber(totals.totalToppings)}</td><td class="numeric">${formatMoney(totals.totalMoney)}</td></tr><tr><td><strong>Tổng cộng</strong></td><td class="numeric"><strong>${formatNumber(totals.totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(totals.totalMoney)}</strong></td></tr>`;
  } catch (error) {
    console.error('Không tải được thống kê topping từ Supabase.', error);
    showToast(readableError(error));
  }
}

function renderEmployeeOptions(selectedId = $('#employeeId').value) {
  const activeEmployees = employees.filter((employee) => employee.active);
  const selectedInactive = employees.find((employee) => employee.id === selectedId && !employee.active);
  const options = [...activeEmployees, ...(selectedInactive ? [selectedInactive] : [])];
  $('#employeeId').innerHTML = `<option value="" disabled ${selectedId ? '' : 'selected'}>Chọn nhân viên</option>${options.map((employee) => `<option value="${escapeHtml(employee.id)}" ${employee.id === selectedId ? 'selected' : ''}>${escapeHtml(employee.name)}${employee.active ? '' : ' · Đã nghỉ'}</option>`).join('')}`;
}

function renderAll() {
  renderRecords();
  renderDailySummary();
  renderEmployeeStatistics();
  renderEmployeeOptions();
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
  renderEmployeeOptions();
}
function buildToppingInputs(quantities = []) {
  const singleValue = normalizeQuantity(quantities[0] ?? quantities.find((quantity) => normalizeQuantity(quantity) > 0) ?? 0);
  $('#toppingInputs').innerHTML = `
    <div class="topping-input-row">
      <label for="quantity-0">Topping</label>
      <input id="quantity-0" type="number" min="0" step="1" inputmode="numeric" value="${singleValue}" data-quantity-index="0" aria-label="Số lượng topping">
    </div>
  `;
  updateFormTotals();
}

function readQuantities() {
  const quantityList = new Array(toppingTypes.length).fill(0);
  const firstInput = $('#toppingInputs [data-quantity-index="0"]');
  if (firstInput) {
    quantityList[0] = normalizeQuantity(firstInput.value);
  }
  return quantityList;
}

function updateFormTotals() {
  const totals = calculateShiftTotals(readQuantities(), toppingTypes);
  $('#totalToppings').textContent = formatNumber(totals.totalToppings);
  $('#totalMoney').textContent = formatMoney(totals.totalMoney);
}

function syncShiftButtons() {
  const selectedShift = $('#shiftName').value;
  $$('.shift-option').forEach((button) => {
    const active = button.dataset.shift === selectedShift;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setEditor(record = null) {
  editingId = record?.id || null;
  $('#editorHeading').textContent = record ? 'Sửa ca bán' : 'Nhập topping';
  $('#saveShiftButton').textContent = record ? 'Lưu thay đổi' : 'Lưu ca';
  $('#shiftDate').value = record?.date || today;
  $('#shiftName').value = record?.shift || getDefaultShift(today);
  syncShiftButtons();
  renderEmployeeOptions(record?.employeeId || '');
  $('#employeeId').value = record?.employeeId || '';
  $('#shiftNote').value = record?.note || '';
  $('#formError').hidden = true;
  $('#formError').textContent = '';
  $('#quickEmployeeForm').hidden = true;
  buildToppingInputs(record?.quantities);
  $('#shiftEditor').hidden = false;
  $('#shiftEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#employeeId').focus({ preventScroll: true });
}

function getDefaultShift(date) {
  return SHIFTS.find((shift) => !records.some((record) => record.date === date && record.shift === shift.id))?.id || SHIFTS[0].id;
}

function closeEditor() {
  editingId = null;
  $('#shiftEditor').hidden = true;
  $('#shiftForm').reset();
  $('#quickEmployeeForm').hidden = true;
}

async function refreshMonthRecords(month = $('#recordsMonth').value) {
  try {
    records = await getSalesForMonth(month);
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
  renderEmployeeOptions();
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
  $('#summaryDate').value = date;
  await Promise.all([refreshMonthRecords(month), refreshDayRecords(date)]);
  if ($('#statisticsMonth').value === month) {
    statisticsRecords = records;
    renderEmployeeStatistics();
  }
  await renderToppingStatistics();
}

async function saveShift(event) {
  event.preventDefault();
  const wasEditing = Boolean(editingId);
  const saveButton = $('#saveShiftButton');
  saveButton.disabled = true;
  saveButton.textContent = 'Đang lưu...';
  const date = $('#shiftDate').value;
  const shift = $('#shiftName').value;
  const employeeId = $('#employeeId').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    saveButton.disabled = false;
    saveButton.textContent = wasEditing ? 'Lưu thay đổi' : 'Lưu ca';
    return showFormError('Vui lòng chọn ngày hợp lệ.');
  }
  if (!SHIFTS.some((item) => item.id === shift)) {
    saveButton.disabled = false;
    saveButton.textContent = wasEditing ? 'Lưu thay đổi' : 'Lưu ca';
    return showFormError('Vui lòng chọn ca Sáng, Chiều hoặc Tối.');
  }
  if (!employeeId) {
    saveButton.disabled = false;
    saveButton.textContent = wasEditing ? 'Lưu thay đổi' : 'Lưu ca';
    return showFormError('Vui lòng chọn nhân viên đứng ca.');
  }
  const record = { date, shift, employeeId, quantities: readQuantities(), note: $('#shiftNote').value.trim() };
  try {
    if (wasEditing) await updateSalesRecord(editingId, record);
    else await createSalesRecord(record);
  } catch (error) {
    console.error('Lỗi khi lưu ca bán lên Supabase.', {
      error,
      date,
      shift,
      employeeId,
      quantities: record.quantities,
      note: record.note
    });
    showFormError(readableError(error));
    saveButton.disabled = false;
    saveButton.textContent = wasEditing ? 'Lưu thay đổi' : 'Lưu ca';
    return;
  }

  closeEditor();
  showToast(wasEditing ? 'Đã cập nhật ca bán.' : 'Đã lưu ca bán.');
  try {
    await refreshAfterSalesChange(date);
  } catch (error) {
    console.error('Đã lưu ca nhưng không thể làm mới dữ liệu hiển thị.', error);
    showToast(`Đã lưu ca nhưng chưa tải lại được dữ liệu: ${readableError(error)}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = wasEditing ? 'Lưu thay đổi' : 'Lưu ca';
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

async function deleteRecord(id) {
  const record = records.find((item) => item.id === id);
  if (!record || !window.confirm(`Xóa ${shiftLabel(record.shift)} ngày ${formatDate(record.date)}?`)) return;
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
  const name = $('#quickEmployeeName').value.trim();
  if (!name) {
    $('#quickEmployeeError').textContent = 'Vui lòng nhập tên nhân viên.';
    $('#quickEmployeeError').hidden = false;
    return;
  }
  try {
    const employee = await createEmployee(name);
    await refreshEmployees();
    $('#employeeId').value = employee.id;
    $('#quickEmployeeName').value = '';
    $('#quickEmployeeForm').hidden = true;
    showToast('Đã thêm và chọn nhân viên.');
  } catch (error) {
    $('#quickEmployeeError').textContent = readableError(error);
    $('#quickEmployeeError').hidden = false;
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
  if (error?.code === '23505') return 'Tên nhân viên hoặc ngày/ca này đã tồn tại.';
  if (error?.code === 'PGRST205' || error?.code === '42P01') return 'Database chưa có bảng cần thiết. Hãy chạy supabase/schema.sql trong Supabase SQL Editor.';
  if (error?.code === 'PGRST202') return 'Database chưa có hàm lưu ca. Hãy chạy lại supabase/schema.sql trong Supabase SQL Editor.';
  if (error?.code === 'PGRST116') return 'Đăng nhập Supabase thành công nhưng tài khoản chưa có hồ sơ vai trò trong public.user_profiles. Không cần tạo lại tài khoản; quản lý cần thêm hồ sơ staff hoặc manager cho user này.';
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
    renderEmployeeOptions('');
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
  $('#todayLabel').textContent = new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());
  $('#recordsMonth').value = month;
  $('#summaryDate').value = today;
  $('#statisticsMonth').value = month;
  $('#toppingMonth').value = month;
  $('#toppingDate').value = today;
  initializeDatePickers();
  $$('.shift-option').forEach((button) => button.addEventListener('click', () => {
    $('#shiftName').value = button.dataset.shift;
    syncShiftButtons();
  }));
  $$('.nav-link').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $('#signInForm').addEventListener('submit', handleSignIn);
  $('#signOutButton').addEventListener('click', async () => {
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
  $('#recordsMonth').addEventListener('change', () => refreshMonthRecords());
  $('#summaryDate').addEventListener('change', () => refreshDayRecords());
  $('#statisticsMonth').addEventListener('change', () => refreshStatisticsRecords());
  $('#addShiftButton').addEventListener('click', () => setEditor());
  $('#closeEditorButton').addEventListener('click', closeEditor);
  $('#cancelEditorButton').addEventListener('click', closeEditor);
  $('#shiftForm').addEventListener('submit', saveShift);
  $('#toppingInputs').addEventListener('input', updateFormTotals);
  $('#quickAddEmployeeButton').addEventListener('click', () => {
    $('#quickEmployeeError').hidden = true;
    $('#quickEmployeeForm').hidden = false;
    $('#quickEmployeeName').focus();
  });
  $('#saveQuickEmployeeButton').addEventListener('click', saveQuickEmployee);
  $('#cancelQuickEmployeeButton').addEventListener('click', () => { $('#quickEmployeeForm').hidden = true; });
  $('#recordsBody').addEventListener('click', (event) => {
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
  $('#recordsBody').addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-record-id]')) {
      event.preventDefault();
      editRecord(event.target.dataset.recordId);
    }
  });
  $('#addEmployeeButton').addEventListener('click', () => openEmployeeForm());
  $('#cancelEmployeeButton').addEventListener('click', closeEmployeeForm);
  $('#employeeForm').addEventListener('submit', saveEmployee);
  $('#employeeSearch').addEventListener('input', renderEmployees);
  $('#showInactiveEmployees').addEventListener('change', renderEmployees);
  $('#employeesBody').addEventListener('click', handleEmployeeAction);
  $$('[data-topping-period]').forEach((button) => button.addEventListener('click', () => setToppingPeriod(button.dataset.toppingPeriod)));
  $('#toppingMonth').addEventListener('change', renderToppingStatistics);
  $('#toppingDate').addEventListener('change', renderToppingStatistics);
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