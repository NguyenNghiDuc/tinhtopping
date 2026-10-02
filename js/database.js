import { requireSupabase } from './supabase.js';

const SHIFT_FIELDS = 'id,sales_date,shift,employee_id,note,created_by,created_at,updated_at,employees(name),shift_toppings(topping_type_id,quantity)';

function throwIfError(result) {
  if (result.error) throw result.error;
  return result.data;
}

function mapShift(row, toppingTypes) {
  const quantitiesByType = new Map((row.shift_toppings || []).map((item) => [item.topping_type_id, item.quantity]));
  return {
    id: row.id,
    date: row.sales_date,
    shift: row.shift,
    employeeId: row.employee_id,
    employee: row.employees?.name || '',
    quantities: toppingTypes.map((type) => quantitiesByType.get(type.id) || 0),
    note: row.note || '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return { start: `${month}-01`, end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01` };
}

async function fetchAllShiftRows(buildQuery) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = throwIfError(await buildQuery().range(offset, offset + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function signIn(email, password) {
  const client = requireSupabase();
  return throwIfError(await client.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  const client = requireSupabase();
  return throwIfError(await client.auth.signOut());
}

export async function getSession() {
  const client = requireSupabase();
  return throwIfError(await client.auth.getSession());
}

export async function getUserRole(userId) {
  const client = requireSupabase();
  const result = await client.from('user_profiles').select('role').eq('user_id', userId).single();
  return throwIfError(result).role;
}

export async function getEmployees({ includeInactive = false } = {}) {
  const client = requireSupabase();
  const employees = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('employees').select('id,name,active,created_at,updated_at').order('name').range(offset, offset + pageSize - 1);
    if (!includeInactive) query = query.eq('active', true);
    const page = throwIfError(await query);
    employees.push(...page);
    if (page.length < pageSize) return employees;
  }
}

export async function getToppingTypes({ includeInactive = false } = {}) {
  const client = requireSupabase();
  const types = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('topping_types').select('id,name,unit_price,sort_order,active').order('sort_order').range(offset, offset + pageSize - 1);
    if (!includeInactive) query = query.eq('active', true);
    const page = throwIfError(await query);
    types.push(...page);
    if (page.length < pageSize) return types;
  }
}

export async function createEmployee(name) {
  const result = await requireSupabase().from('employees').insert({ name: name.trim() }).select('id,name,active,created_at,updated_at').single();
  return throwIfError(result);
}

export async function updateEmployee(id, changes) {
  const result = await requireSupabase().from('employees').update(changes).eq('id', id).select('id,name,active,created_at,updated_at').single();
  return throwIfError(result);
}

export async function getSalesForMonth(month) {
  const { start, end } = monthRange(month);
  const client = requireSupabase();
  const [rows, toppingTypes] = await Promise.all([
    fetchAllShiftRows(() => client.from('shifts').select(SHIFT_FIELDS)
      .gte('sales_date', start).lt('sales_date', end)
      .order('sales_date', { ascending: false }).order('shift').order('created_at')),
    getToppingTypes()
  ]);
  return rows.map((row) => mapShift(row, toppingTypes));
}

export async function getAllSalesRecords() {
  const client = requireSupabase();
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = throwIfError(await client.from('shifts').select(SHIFT_FIELDS).order('sales_date', { ascending: true }).range(offset, offset + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) {
      const toppingTypes = await getToppingTypes();
      return rows.map((row) => mapShift(row, toppingTypes));
    }
  }
}

export async function getSalesForDate(date) {
  const client = requireSupabase();
  const [rows, toppingTypes] = await Promise.all([
    fetchAllShiftRows(() => client.from('shifts').select(SHIFT_FIELDS)
      .eq('sales_date', date).order('shift').order('created_at')),
    getToppingTypes()
  ]);
  return rows.map((row) => mapShift(row, toppingTypes));
}

async function saveSalesRecord(record) {
  const client = requireSupabase();
  const toppingTypes = await getToppingTypes();
  const toppingRows = toppingTypes.map((type, index) => ({
    topping_type_id: type.id,
    quantity: Math.max(0, Math.floor(Number(record.quantities[index]) || 0))
  }));
  const shiftId = throwIfError(await client.rpc('save_shift', {
    p_shift_id: record.id || null,
    p_sales_date: record.date,
    p_shift: record.shift,
    p_employee_id: record.employeeId,
    p_note: record.note || '',
    p_toppings: toppingRows
  }));
  const result = await client.from('shifts').select(SHIFT_FIELDS).eq('id', shiftId).single();
  return mapShift(throwIfError(result), toppingTypes);
}

export async function createSalesRecord(record) {
  return saveSalesRecord(record);
}

export async function updateSalesRecord(id, record) {
  return saveSalesRecord({ ...record, id });
}

export async function deleteSalesRecord(id) {
  return throwIfError(await requireSupabase().from('shifts').delete().eq('id', id));
}