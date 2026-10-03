import { requireSupabase } from '../supabase.js';
import { $, $$, notify, installStyle } from './shared.js';

let deletingDate = '';

function formatDate(date) {
  const [y, m, d] = String(date || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

function refreshMonth(date) {
  const month = String(date || '').slice(0, 7);
  const input = $('#recordsMonth');
  if (!input || !month) {
    location.reload();
    return;
  }
  input.value = month;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function deleteWholeDay(button) {
  const date = button?.dataset?.deleteWholeDay;
  if (!date || deletingDate) return;

  const label = formatDate(date);
  if (!confirm(`Xóa TẤT CẢ dữ liệu ngày ${label}?\n\nToàn bộ ca sáng, chiều, tối và tất cả nhân viên trong ngày này sẽ bị xóa.`)) return;

  deletingDate = date;
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = 'Đang xóa...';

  try {
    const client = requireSupabase();
    const before = await client.from('shifts').select('id').eq('sales_date', date);
    if (before.error) throw before.error;

    const expected = before.data?.length || 0;
    if (!expected) {
      notify(`Ngày ${label} không còn dữ liệu.`);
      refreshMonth(date);
      return;
    }

    const result = await client.from('shifts').delete().eq('sales_date', date).select('id');
    if (result.error) throw result.error;

    const deleted = result.data?.length || 0;
    if (deleted !== expected) {
      throw new Error(`Chỉ xóa được ${deleted}/${expected} bản ghi. Kiểm tra quyền RLS trong Supabase.`);
    }

    notify(`Đã xóa tất cả ${deleted} bản ghi ngày ${label}.`, 4500);
    refreshMonth(date);
  } catch (error) {
    console.error('[Xóa cả ngày]', error);
    alert(`Không xóa được ngày ${label}: ${error?.message || 'Lỗi không xác định'}`);
    button.disabled = false;
    button.textContent = oldText;
  } finally {
    deletingDate = '';
  }
}

function enhanceDayCards() {
  $$('.day-record-card[data-date]').forEach((card) => {
    const date = card.dataset.date;
    const header = $('.day-record-header', card);
    const summary = $('.day-record-summary', card);
    if (!date || !header || header.querySelector('[data-delete-whole-day]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'delete-whole-day-button manager-only';
    button.dataset.deleteWholeDay = date;
    button.textContent = 'Xóa tất cả ngày';
    button.title = `Xóa toàn bộ dữ liệu ngày ${formatDate(date)}`;

    if (summary) summary.appendChild(button);
    else header.appendChild(button);
  });
}

function boot() {
  installStyle('day-delete-style', `
    .day-record-summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-end}
    .delete-whole-day-button{border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:9px;padding:8px 12px;font:700 13px DM Sans,sans-serif;cursor:pointer;white-space:nowrap}
    .delete-whole-day-button:hover{background:#fee2e2;border-color:#fca5a5}
    .delete-whole-day-button:disabled{opacity:.6;cursor:not-allowed}
    @media(max-width:640px){.delete-whole-day-button{width:100%;margin-top:4px}.day-record-summary{gap:8px}}
  `);

  enhanceDayCards();

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-delete-whole-day]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteWholeDay(button);
  }, true);

  new MutationObserver(enhanceDayCards).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('topping:session-ready', enhanceDayCards);
  document.addEventListener('topping:features-ready', enhanceDayCards);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
