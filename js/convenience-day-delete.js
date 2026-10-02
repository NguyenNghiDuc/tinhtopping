import { requireSupabase } from './supabase.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function notify(message) {
  const toast = $('#toast');
  if (!toast) return alert(message);
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function refreshViews(date) {
  const month = date.slice(0,7);
  const m = $('#recordsMonth');
  if (m) { m.value = month; m.dispatchEvent(new Event('change',{bubbles:true})); }
  const d = $('#summaryDate');
  if (d && d.value === date) d.dispatchEvent(new Event('change',{bubbles:true}));
  const s = $('#statisticsMonth');
  if (s && s.value === month) s.dispatchEvent(new Event('change',{bubbles:true}));
}

function showUndo(message, undo) {
  $('.undo-day-bar')?.remove();
  const bar = document.createElement('div');
  bar.className = 'undo-day-bar';
  bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10001;background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;display:flex;gap:14px;align-items:center;box-shadow:0 12px 30px rgba(15,23,42,.3);font:600 13px DM Sans,sans-serif';
  bar.innerHTML = `<span>${message}</span><button type="button" style="border:0;border-radius:7px;padding:7px 11px;font-weight:800;cursor:pointer">Hoàn tác</button>`;
  document.body.appendChild(bar);
  let active = true;
  const timer = setTimeout(() => { active = false; bar.remove(); }, 7000);
  $('button',bar).addEventListener('click', async () => {
    if (!active) return;
    active = false; clearTimeout(timer); $('button',bar).disabled = true;
    try { await undo(); notify('Đã hoàn tác xóa cả ngày.'); } catch (e) { alert(e?.message || 'Không hoàn tác được.'); }
    bar.remove();
  });
}

async function safeDeleteDay(button) {
  const date = button.dataset.safeDeleteDay;
  if (!date) return;
  if (!confirm(`Xóa toàn bộ dữ liệu ngày ${date.split('-').reverse().join('/')}? Bạn có 7 giây để hoàn tác.`)) return;
  const client = requireSupabase();
  button.disabled = true;
  try {
    const before = await client.from('shifts').select('id,sales_date,shift,employee_id,note,shift_toppings(topping_type_id,quantity)').eq('sales_date',date).order('created_at');
    if (before.error) throw before.error;
    const snapshot = before.data || [];
    if (!snapshot.length) return notify('Ngày này không còn dữ liệu.');
    const del = await client.from('shifts').delete().eq('sales_date',date).select('id');
    if (del.error) throw del.error;
    refreshViews(date);
    showUndo(`Đã xóa ${snapshot.length} bản ghi của ngày ${date.split('-').reverse().join('/')}.`, async () => {
      for (const row of snapshot) {
        const result = await client.rpc('save_shift', {
          p_shift_id: null,
          p_sales_date: row.sales_date,
          p_shift: row.shift,
          p_employee_id: row.employee_id,
          p_note: row.note || '',
          p_toppings: row.shift_toppings || []
        });
        if (result.error) throw result.error;
      }
      refreshViews(date);
    });
  } catch (e) {
    console.error(e);
    alert(e?.message || 'Không xóa được dữ liệu ngày này.');
    button.disabled = false;
  }
}

function convertDeleteDayButtons() {
  $$('[data-delete-day]').forEach((button) => {
    if (button.dataset.safeDeleteDay) return;
    button.dataset.safeDeleteDay = button.dataset.deleteDay;
    delete button.dataset.deleteDay;
  });
}

function restoreLastWorkingDate() {
  const remembered = localStorage.getItem('topping:lastDate');
  if (!remembered || !/^\d{4}-\d{2}-\d{2}$/.test(remembered)) return;
  const input = $('#summaryDate');
  if (!input || input.dataset.lastDateRestored === '1') return;
  input.dataset.lastDateRestored = '1';
  setTimeout(() => {
    if (input._flatpickr) input._flatpickr.setDate(remembered, false);
    else input.value = remembered;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }, 200);
}

function boot() {
  convertDeleteDayButtons();
  restoreLastWorkingDate();
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-safe-delete-day]');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void safeDeleteDay(button);
  }, true);
  new MutationObserver(() => { convertDeleteDayButtons(); restoreLastWorkingDate(); }).observe(document.body,{childList:true,subtree:true});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
