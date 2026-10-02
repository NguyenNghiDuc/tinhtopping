import {
  SHIFTS,
  calculateEmployeeTotals,
  calculateRecordsTotals,
  calculateShiftTotals,
  calculateToppingSummary,
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
    <article class="overview-card"><div class="overview-label">Số ca đã ghi nhận</div><div class="overview-value">${formatNumber(totals.shiftCount)}</div><div class="overview-note">Trong kỳ đang xem</div></article>
    <article class="overview-card"><div class="overview-label">Tổng topping toàn quán</div><div class="overview-value">${formatNumber(totals.totalToppings)}</div><div class="overview-note">Tất cả nhân viên</div></article>
    <article class="overview-card total-card"><div class="overview-label">Tổng tiền topping</div><div class="overview-value">${formatMoney(totals.totalMoney)}</div><div class="overview-note">${formatNumber(totals.shiftCount)} ca trong kỳ</div></article>`;
}

function renderRecords() {
  const monthRecords = getMonthRecords($('#recordsMonth').value).sort((left, right) => {
    const dateOrder = right.date.localeCompare(left.date);
    return dateOrder || SHIFTS.findIndex((shift) => shift.id === left.shift) - SHIFTS.findIndex((shift) => shift.id === right.shift);
  });
  renderOverview($('#monthOverview'), monthRecords);
  $('#recordsEmpty').hidden = monthRecords.length > 0;
  $('#recordsBody').innerHTML = monthRecords.map((record) => {
    const totals = calculateShiftTotals(record.quantities, toppingTypes);
    const shiftClass = record.shift === 'afternoon' ? 'afternoon' : record.shift === 'evening' ? 'evening' : '';
    const canEdit = isManager || record.createdBy === currentUser?.id;
    return `<tr data-record-id="${escapeHtml(record.id)}" tabindex="0" aria-label="${escapeHtml(record.date)} ${escapeHtml(shiftLabel(record.shift))}, bấm để sửa topping">
      <td data-label="Ngày">${formatDate(record.date)}</td>
      <td data-label="Ca"><span class="shift-label ${shiftClass}">${escapeHtml(shiftLabel(record.shift))}</span></td>
      <td class="employee-name" data-label="Nhân viên đứng ca">${escapeHtml(record.employee)}</td>
      <td class="numeric" data-label="Tổng topping">${formatNumber(totals.totalToppings)}</td>
      <td class="numeric row-total" data-label="Tổng tiền topping">${formatMoney(totals.totalMoney)}</td>
      <td data-label="Thao tác"><div class="row-actions">${canEdit ? `<button class="table-action" type="button" data-action="edit" data-record-id="${escapeHtml(record.id)}">Sửa</button><button class="table-action delete" type="button" data-action="delete" data-record-id="${escapeHtml(record.id)}">Xóa</button>` : ''}</div></td>
    </tr>`;
  }).join('');
}

function renderDailySummary() {
  const date = $('#summaryDate').value;
  const selectedRecords = dayRecords.filter((record) => record.date === date);
  const totals = calculateRecordsTotals(selectedRecords, toppingTypes);
  const shiftRows = SHIFTS.map((shift) => {
    const record = selectedRecords.find((item) => item.shift === shift.id);
    const shiftTotals = calculateShiftTotals(record?.quantities || [], toppingTypes);
    return `<div class="daily-summary-row"><span>${escapeHtml(shift.label)}</span><strong>${formatMoney(shiftTotals.totalMoney)} · ${formatNumber(shiftTotals.totalToppings)} topping</strong></div>`;
  }).join('');
  $('#dailySummary').innerHTML = `${shiftRows}<div class="daily-summary-row day-total"><span>Tổng cả ngày</span><strong>${formatMoney(totals.totalMoney)} · ${formatNumber(totals.totalToppings)} topping</strong></div>`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
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
    const { toppings: toppingTotals, totalToppings, totalMoney } = calculateToppingSummary(periodRecords, toppingTypes);
    const ranked = [...toppingTotals].sort((left, right) => right.quantity - left.quantity);
    const bestSeller = totalToppings ? ranked[0] : null;
    $('#bestSellerName').textContent = bestSeller?.name || 'Chưa có dữ liệu';
    $('#bestSellerCount').textContent = `${formatNumber(bestSeller?.quantity || 0)} topping`;
    $('#toppingStatsBody').innerHTML = `${toppingTotals.map((topping) => `<tr><td>${escapeHtml(topping.name)}</td><td class="numeric">${formatNumber(topping.quantity)}</td><td class="numeric">${formatMoney(topping.revenue)}</td></tr>`).join('')}<tr><td><strong>Tổng cộng</strong></td><td class="numeric"><strong>${formatNumber(totalToppings)}</strong></td><td class="numeric row-total"><strong>${formatMoney(totalMoney)}</strong></td></tr>`;
  } catch (error) {
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

function setEditor(record = null) {
  editingId = record?.id || null;
  $('#editorHeading').textContent = record ? 'Sửa ca bán' : 'Nhập topping';
  $('#saveShiftButton').textContent = record ? 'Lưu thay đổi' : 'Lưu ca';
  $('#shiftDate').value = record?.date || today;
  $('#shiftName').value = record?.shift || getDefaultShift(today);
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
    showToast(readableError(error));
  }
}

async function refreshDayRecords(date = $('#summaryDate').value) {
  try {
    dayRecords = await getSalesForDate(date);
    renderDailySummary();
  } catch (error) {
    showToast(readableError(error));
  }
}

async function refreshStatisticsRecords(month = $('#statisticsMonth').value) {
  try {
    statisticsRecords = await getSalesForMonth(month);
    renderEmployeeStatistics();
  } catch (error) {
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
  const date = $('#shiftDate').value;
  const shift = $('#shiftName').value;
  const duplicate = records.find((record) => record.date === date && record.shift === shift && record.id !== editingId);
  const employeeId = $('#employeeId').value;
  if (!date) return showFormError('Vui lòng chọn ngày bán.');
  if (!employeeId) return showFormError('Vui lòng chọn nhân viên đứng ca.');
  if (duplicate) return showFormError(`Ngày này đã có ${shiftLabel(shift)}. Hãy sửa ca đã ghi nhận trong bảng.`);

  const record = { date, shift, employeeId, quantities: readQuantities(), note: $('#shiftNote').value.trim() };
  try {
    if (editingId) await updateSalesRecord(editingId, record);
    else await createSalesRecord(record);
    closeEditor();
    await refreshAfterSalesChange(date);
    showToast(editingId ? 'Đã cập nhật ca bán.' : 'Đã lưu ca bán.');
  } catch (error) {
    showFormError(readableError(error));
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
  if (error?.code === 'PGRST116') return 'Chưa tìm thấy hồ sơ vai trò cho tài khoản. Chạy schema SQL rồi tạo lại tài khoản sau khi trigger đã được cài.';
  if (error?.code === '42501') return 'Tài khoản không có quyền thao tác này. Kiểm tra role và RLS policies.';
  if (error?.message?.includes('Invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (error?.message?.includes('Invalid API key')) return 'Supabase public key không hợp lệ hoặc không thuộc project URL đã cấu hình.';
  if (error?.message?.includes('Failed to fetch')) return 'Không kết nối được Supabase. Kiểm tra URL và kết nối mạng.';
  return error?.message || 'Có lỗi khi lưu dữ liệu. Vui lòng thử lại.';
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
    showAuthMessage(readableError(error));
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
  $('#todayLabel').textContent = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  $('#recordsMonth').value = month;
  $('#summaryDate').value = today;
  $('#statisticsMonth').value = month;
  $('#toppingMonth').value = month;
  $('#toppingDate').value = today;
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

initialize();