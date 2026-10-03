import { requireSupabase } from '../supabase.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)}đ`;
export const normalize = (value) => String(value || '').trim().toLocaleLowerCase('vi');

export function notify(message, duration = 3000) {
  const toast = $('#toast');
  if (!toast) return window.alert(message);
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), duration);
}

export function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

export async function fetchMonthRows(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return [];
  const [start, end] = monthBounds(month);
  const result = await requireSupabase()
    .from('shifts')
    .select('id,sales_date,shift,note,employee_id,employees(name),shift_toppings(topping_type_id,quantity)')
    .gte('sales_date', start)
    .lt('sales_date', end)
    .order('sales_date', { ascending: true })
    .order('shift');
  if (result.error) throw result.error;
  return result.data || [];
}

export function rowQuantity(row) {
  return (row?.shift_toppings || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
}

export function installStyle(id, cssText) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}
