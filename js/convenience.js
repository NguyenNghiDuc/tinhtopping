import { requireSupabase } from './supabase.js';

const SHIFT_LABELS = { morning: 'Ca Sáng', afternoon: 'Ca Chiều', evening: 'Ca Tối' };
const STORAGE = {
  draft: 'topping:offlineDraft',
  favorites: 'topping:shiftFavorites'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notify(message, timeout = 3200) {
  const toast = $('#toast');
  if (!toast) return window.alert(message);
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), timeout);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function installStyles() {
  if ($('#convenience-style')) return;
  const style = document.createElement('style');
  style.id = 'convenience-style';
  style.textContent = `
    .convenience-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
    .convenience-btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;min-height:34px;padding:7px 10px;font:700 11px 'DM Sans',sans-serif;cursor:pointer}
    .convenience-btn:hover{background:#f8fafc;border-color:#94a3b8}.convenience-btn.danger{color:#b91c1c;border-color:#fecaca}.convenience-btn.primary{color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}
    .employee-option-search{width:100%;min-height:34px;border:1px solid #dbe3ef;border-radius:8px;padding:7px 10px;font:600 12px 'DM Sans',sans-serif;background:#fff}
    .network-badge{position:fixed;right:14px;bottom:14px;z-index:9998;padding:7px 10px;border-radius:999px;font:700 11px 'DM Sans',sans-serif;box-shadow:0 4px 18px rgba(15,23,42,.15);background:#ecfdf5;color:#047857;border:1px solid #a7f3d0}.network-badge.offline{background:#fff7ed;color:#c2410c;border-color:#fed7aa}
    .undo-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:10px;background:#0f172a;color:#fff;box-shadow:0 12px 30px rgba(15,23,42,.3);font:600 13px 'DM Sans',sans-serif}.undo-bar button{border:0;border-radius:7px;background:#fff;color:#0f172a;padding:7px 11px;font-weight:800;cursor:pointer}
    .audit-panel{margin-top:18px}.audit-list{display:grid;gap:9px;max-height:420px;overflow:auto}.audit-item{padding:10px 12px;border:1px solid #e2e8f0;border-radius:9px;background:#fff}.audit-item strong{display:block}.audit-item small{color:#64748b}
    .employee-report-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.employee-report-toolbar select{min-height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:7px 10px;background:#fff}
    .employee-report-card{padding:14px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.employee-report-card div{display:grid;gap:3px}.employee-report-card small{color:#64748b}.employee-report-card strong{font-size:18px}
    @media(max-width:760px){
      .toolbar-actions{width:100%;flex-wrap:wrap}.toolbar-actions>button,.toolbar-actions>input{min-height:42px}
      .batch-shift-columns{grid-template-columns:1fr!important}.batch-employee-row{grid-template-columns:minmax(0,1fr) minmax(120px,.8fr) auto!important}
      .batch-add-controls{grid-template-columns:1fr!important}.employee-report-card{grid-template-columns:1fr}.data-table{min-width:720px}.main-content{padding-left:14px!important;padding-right:14px!important}
      .undo-bar{width:calc(100% - 28px);justify-content:space-between}.network-badge{bottom:72px}
    }
  `;
  document.head.appendChild(style);
}

function installNetworkBadge() {
  if ($('#networkBadge')) return;
  const badge = document.createElement('div');
  badge.id = 'networkBadge';
  badge.className = 'network-badge';
  document.body.appendChild(badge);
  const update = () => {
    badge.textContent = navigator.onLine ? '● Đang online' : '● Offline · đang lưu nháp';
    badge.classList.toggle('offline', !navigator.onLine);
  };
  window.addEventListener('online', () => { update(); notify('Đã có mạng trở lại. Kiểm tra nháp rồi bấm LƯU TẤT CẢ.'); });
  window.addEventListener('offline', () => { update(); notify('Mất mạng. Dữ liệu đang nhập sẽ được lưu nháp trên máy.'); });
  update();
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(STORAGE.favorites) || '{}'); } catch { return {}; }
}
function bumpFavorite(shift, employee) {
  if (!shift || !employee) return;
  const data = getFavorites();
  data[shift] ||= {};
  data[shift][employee] = (data[shift][employee] || 0) + 1;
  localStorage.setItem(STORAGE.favorites, JSON.stringify(data));
}

function enhanceShiftColumn(column) {
  const card = $('.batch-shift-card', column);
  if (!card) return;
  const select = $('[data-batch-add-select]', card);
  const controls = $('.batch-add-controls', card);
  if (select && controls && !controls.querySelector('.employee-option-search')) {
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'employee-option-search';
    search.placeholder = 'Tìm nhân viên...';
    search.setAttribute('aria-label', 'Tìm nhân viên trong danh sách');
    controls.insertBefore(search, select);
    const filter = () => {
      const q = search.value.trim().toLocaleLowerCase('vi');
      [...select.options].forEach((option, index) => {
        if (index === 0) return;
        option.hidden = !!q && !option.textContent.toLocaleLowerCase('vi').includes(q);
      });
    };
    search.addEventListener('input', filter);

    const shift = select.dataset.batchAddSelect;
    const fav = getFavorites()[shift] || {};
    [...select.options].slice(1).sort((a,b) => (fav[b.textContent] || 0) - (fav[a.textContent] || 0)).forEach((opt) => select.appendChild(opt));
  }

  if (card.querySelector('.convenience-row')) return;
  const shift = column.id.replace('batch-column-', '');
  const row = document.createElement('div');
  row.className = 'convenience-row';
  row.innerHTML = `
    <button type="button" class="convenience-btn" data-quick-zero="${shift}">Điền 0 tất cả</button>
    <button type="button" class="convenience-btn" data-quick-clear="${shift}">Xóa trắng số</button>
  `;
  const note = $('.batch-note-field', card);
  if (note) card.insertBefore(row, note); else card.appendChild(row);
}

function enhanceBatchEditor() {
  ['morning','afternoon','evening'].forEach((shift) => {
    const column = $(`#batch-column-${shift}`);
    if (column) enhanceShiftColumn(column);
  });
}

function installQuickEntry() {
  document.addEventListener('click', (event) => {
    const zero = event.target.closest('[data-quick-zero]');
    const clear = event.target.closest('[data-quick-clear]');
    if (!zero && !clear) return;
    const shift = (zero || clear).dataset.quickZero || (zero || clear).dataset.quickClear;
    const column = $(`#batch-column-${shift}`);
    if (!column) return;
    $$('[data-batch-quantity]', column).forEach((input) => {
      input.value = zero ? '0' : '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  document.addEventListener('input', (event) => {
    const input = event.target.closest('[data-batch-quantity]');
    if (!input || Number(input.value || 0) <= 0) return;
    const row = input.closest('.batch-employee-row');
    const name = $('.batch-employee-name', row)?.textContent?.trim();
    const shift = input.dataset.batchShift || row?.dataset.batchShift;
    if (name && shift) bumpFavorite(shift, name);
  }, true);
}

function collectDraft() {
  const editor = $('#shiftEditor');
  const date = $('#shiftDate')?.value;
  if (!editor || editor.hidden || !date) return null;
  const shifts = {};
  ['morning','afternoon','evening'].forEach((shift) => {
    shifts[shift] = {
      rows: $$('.batch-employee-row', $(`#batch-column-${shift}`) || document).map((row) => ({
        name: $('.batch-employee-name', row)?.textContent?.trim() || '',
        quantity: $('[data-batch-quantity]', row)?.value ?? ''
      })),
      note: $(`[data-batch-note="${shift}"]`)?.value || ''
    };
  });
  return { date, shifts, savedAt: Date.now() };
}

function saveDraft() {
  const draft = collectDraft();
  if (draft) localStorage.setItem(STORAGE.draft, JSON.stringify(draft));
}

async function restoreDraftIfUseful() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(STORAGE.draft) || 'null'); } catch { draft = null; }
  if (!draft || !draft.date || Date.now() - Number(draft.savedAt || 0) > 1000 * 60 * 60 * 24 * 7) return;
  const editor = $('#shiftEditor');
  if (!editor || editor.hidden || $('#shiftDate')?.value !== draft.date) return;
  if (editor.dataset.draftRestored === draft.savedAt?.toString()) return;

  await sleep(60);
  for (const shift of ['morning','afternoon','evening']) {
    const source = draft.shifts?.[shift];
    if (!source) continue;
    const addAll = $(`#batch-column-${shift} [data-batch-action="add-all"]`);
    if (addAll && !addAll.disabled) addAll.click();
    await sleep(10);
    source.rows?.forEach((saved) => {
      const row = $$('.batch-employee-row', $(`#batch-column-${shift}`) || document).find((r) => $('.batch-employee-name', r)?.textContent?.trim() === saved.name);
      const input = row && $('[data-batch-quantity]', row);
      if (input) { input.value = saved.quantity; input.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    const note = $(`[data-batch-note="${shift}"]`);
    if (note && source.note) { note.value = source.note; note.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  editor.dataset.draftRestored = String(draft.savedAt);
  notify('Đã khôi phục bản nháp chưa lưu trên máy.');
}

function installOfflineDraft() {
  document.addEventListener('input', (event) => {
    if (event.target.closest('#shiftEditor')) {
      clearTimeout(saveDraft.timer);
      saveDraft.timer = setTimeout(saveDraft, 250);
    }
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target.closest('#shiftEditor')) saveDraft();
  }, true);
  const editor = $('#shiftEditor');
  if (editor) new MutationObserver(() => { if (!editor.hidden) setTimeout(restoreDraftIfUseful, 120); }).observe(editor, { attributes:true, attributeFilter:['hidden'] });
  const toast = $('#toast');
  if (toast) new MutationObserver(() => {
    if (/Đã lưu dữ liệu topping/i.test(toast.textContent)) localStorage.removeItem(STORAGE.draft);
  }).observe(toast, { childList:true, characterData:true, subtree:true });
}

function csvEscape(value) {
  const s = String(value ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}
function downloadText(filename, content, type='text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff', content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function exportBackupCsv() {
  const month = $('#recordsMonth')?.value;
  if (!month) return alert('Chọn tháng trước khi backup.');
  const [y,m] = month.split('-').map(Number); const ny = m === 12 ? y + 1 : y; const nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2,'0')}-01`;
  const client = requireSupabase();
  const result = await client.from('shifts').select('id,sales_date,shift,note,created_at,updated_at,employees(name),shift_toppings(quantity)').gte('sales_date',`${month}-01`).lt('sales_date',end).order('sales_date');
  if (result.error) return alert(result.error.message);
  const header = ['id','ngay','ca','nhan_vien','topping','tien','ghi_chu','tao_luc','sua_luc'];
  const lines = [header.map(csvEscape).join(',')];
  (result.data || []).forEach((r) => {
    const qty = (r.shift_toppings || []).reduce((s,x) => s + (Number(x.quantity)||0),0);
    lines.push([r.id,r.sales_date,SHIFT_LABELS[r.shift]||r.shift,r.employees?.name||'',qty,qty*1000,r.note||'',r.created_at,r.updated_at].map(csvEscape).join(','));
  });
  downloadText(`backup-topping-${month}.csv`, lines.join('\n'));
  notify(`Đã backup ${(result.data || []).length} dòng ra CSV.`);
}

function ensureBackupButton() {
  const toolbar = $('#view-records .toolbar-actions');
  if (!toolbar || $('#backupCsvButton')) return;
  const b = document.createElement('button');
  b.id = 'backupCsvButton'; b.type = 'button'; b.className = 'convenience-btn'; b.textContent = 'Backup CSV';
  b.addEventListener('click', () => void exportBackupCsv());
  toolbar.insertBefore(b, $('#addShiftButton'));
}

function enhanceEmployeeReport() {
  const panel = $('#view-statistics .stats-panel');
  const body = $('#employeeStatsBody');
  if (!panel || !body || $('#employeeReportSelect')) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'employee-report-toolbar';
  toolbar.innerHTML = '<strong>Xem nhanh nhân viên:</strong><select id="employeeReportSelect"><option value="">Tất cả nhân viên</option></select><div id="employeeReportCard"></div>';
  panel.insertBefore(toolbar, panel.querySelector('.table-scroll'));
  const select = $('#employeeReportSelect');
  const refreshOptions = () => {
    const current = select.value;
    const names = [...new Set($$('#employeeStatsBody tr').map((tr) => tr.cells?.[0]?.textContent?.trim()).filter((x) => x && x !== 'Tổng toàn quán'))];
    select.innerHTML = '<option value="">Tất cả nhân viên</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (names.includes(current)) select.value = current;
  };
  const render = () => {
    const name = select.value;
    $$('#employeeStatsBody tr').forEach((tr) => { tr.hidden = !!name && tr.cells?.[0]?.textContent?.trim() !== name; });
    const row = $$('#employeeStatsBody tr').find((tr) => tr.cells?.[0]?.textContent?.trim() === name);
    const card = $('#employeeReportCard');
    if (!name || !row) { card.innerHTML = ''; return; }
    card.innerHTML = `<div class="employee-report-card"><div><small>Số ca</small><strong>${esc(row.cells[1]?.textContent)}</strong></div><div><small>Topping</small><strong>${esc(row.cells[2]?.textContent)}</strong></div><div><small>Doanh thu</small><strong>${esc(row.cells[3]?.textContent)}</strong></div></div>`;
  };
  select.addEventListener('change', render);
  new MutationObserver(() => { refreshOptions(); render(); }).observe(body,{childList:true});
  refreshOptions();
}

async function getShiftSnapshotById(id) {
  const client = requireSupabase();
  const result = await client.from('shifts').select('id,sales_date,shift,employee_id,note,shift_toppings(topping_type_id,quantity)').eq('id',id).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

function refreshSalesViews(date) {
  const month = date?.slice(0,7);
  const monthInput = $('#recordsMonth');
  if (monthInput && month) { monthInput.value = month; monthInput.dispatchEvent(new Event('change',{bubbles:true})); }
  const summary = $('#summaryDate');
  if (summary && summary.value === date) summary.dispatchEvent(new Event('change',{bubbles:true}));
  const stats = $('#statisticsMonth');
  if (stats && stats.value === month) stats.dispatchEvent(new Event('change',{bubbles:true}));
}

function showUndo(message, onUndo) {
  $('.undo-bar')?.remove();
  const bar = document.createElement('div');
  bar.className = 'undo-bar';
  bar.innerHTML = `<span>${esc(message)}</span><button type="button">Hoàn tác</button>`;
  document.body.appendChild(bar);
  let active = true;
  const timer = setTimeout(() => { active = false; bar.remove(); }, 7000);
  $('button', bar).addEventListener('click', async () => {
    if (!active) return; active = false; clearTimeout(timer); $('button',bar).disabled = true;
    try { await onUndo(); notify('Đã hoàn tác xóa.'); } catch (e) { alert(e?.message || 'Không hoàn tác được.'); }
    bar.remove();
  });
}

function installSafeSingleDelete() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('#recordsBody [data-action="delete"][data-record-id]');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const id = button.dataset.recordId;
    if (!confirm('Xóa bản ghi này? Bạn có 7 giây để hoàn tác.')) return;
    try {
      const snapshot = await getShiftSnapshotById(id);
      if (!snapshot) return notify('Bản ghi không còn tồn tại.');
      const client = requireSupabase();
      const del = await client.from('shifts').delete().eq('id',id).select('id').maybeSingle();
      if (del.error) throw del.error;
      refreshSalesViews(snapshot.sales_date);
      showUndo('Đã xóa 1 bản ghi.', async () => {
        const rpc = await client.rpc('save_shift', {
          p_shift_id: null,
          p_sales_date: snapshot.sales_date,
          p_shift: snapshot.shift,
          p_employee_id: snapshot.employee_id,
          p_note: snapshot.note || '',
          p_toppings: snapshot.shift_toppings || []
        });
        if (rpc.error) throw rpc.error;
        refreshSalesViews(snapshot.sales_date);
      });
    } catch (e) { console.error(e); alert(e?.message || 'Không xóa được bản ghi.'); }
  }, true);
}

function installSaveSummary() {
  const form = $('#shiftForm');
  const editor = $('#shiftEditor');
  if (!form || !editor) return;
  let pending = null;
  form.addEventListener('submit', () => {
    const positives = $$('[data-batch-quantity]', editor).filter((i) => Number(i.value || 0) > 0).length;
    const shifts = ['morning','afternoon','evening'].filter((s) => $$(`[data-batch-shift="${s}"]`,editor).some((el) => el.matches('[data-batch-quantity]') && Number(el.value||0)>0)).length;
    pending = { positives, shifts, at: Date.now() };
  }, true);
  new MutationObserver(() => {
    if (!editor.hidden || !pending || Date.now() - pending.at > 8000) return;
    if (pending.positives) notify(`Đã lưu ${pending.positives} dòng của ${pending.shifts} ca.`);
    localStorage.removeItem(STORAGE.draft);
    pending = null;
  }).observe(editor,{attributes:true,attributeFilter:['hidden']});
}

async function loadAuditLog() {
  const list = $('#auditList');
  if (!list) return;
  list.innerHTML = '<p class="muted">Đang tải lịch sử...</p>';
  try {
    const client = requireSupabase();
    const result = await client.from('audit_logs').select('id,table_name,action,record_id,changed_at,changed_by,old_data,new_data').order('changed_at',{ascending:false}).limit(100);
    if (result.error) throw result.error;
    const rows = result.data || [];
    list.innerHTML = rows.length ? rows.map((r) => {
      const action = ({INSERT:'Thêm',UPDATE:'Sửa',DELETE:'Xóa'})[r.action] || r.action;
      const who = r.changed_by ? String(r.changed_by).slice(0,8) : 'hệ thống';
      return `<div class="audit-item"><strong>${esc(action)} · ${esc(r.table_name)}</strong><small>${new Date(r.changed_at).toLocaleString('vi-VN')} · user ${esc(who)} · ${esc(r.record_id || '')}</small></div>`;
    }).join('') : '<p class="muted">Chưa có lịch sử thay đổi.</p>';
  } catch (e) {
    list.innerHTML = '<p class="muted">Chưa bật bảng audit_logs. Hãy chạy migration 20261003_audit_logs.sql trong Supabase SQL Editor.</p>';
  }
}

function ensureAuditPanel() {
  const view = $('#view-employees');
  if (!view || $('#auditPanel')) return;
  const panel = document.createElement('section');
  panel.id = 'auditPanel'; panel.className = 'panel audit-panel manager-only';
  panel.innerHTML = '<div class="panel-title"><div><h3>Lịch sử thay đổi</h3><p class="muted">100 thao tác gần nhất trên ca bán và nhân viên</p></div><button type="button" class="convenience-btn" id="refreshAuditButton">Làm mới</button></div><div class="audit-list" id="auditList"><p class="muted">Mở mục Nhân viên để xem lịch sử.</p></div>';
  view.appendChild(panel);
  $('#refreshAuditButton').addEventListener('click', () => void loadAuditLog());
  document.querySelector('[data-view="employees"]')?.addEventListener('click', () => setTimeout(loadAuditLog,120));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Không đăng ký được offline cache',e)));
}

function boot() {
  installStyles(); installNetworkBadge(); installQuickEntry(); installOfflineDraft(); ensureBackupButton(); enhanceEmployeeReport(); installSafeSingleDelete(); installSaveSummary(); ensureAuditPanel(); registerServiceWorker();
  enhanceBatchEditor();
  const observer = new MutationObserver(() => {
    enhanceBatchEditor(); ensureBackupButton(); enhanceEmployeeReport(); ensureAuditPanel();
    if (!$('#shiftEditor')?.hidden) setTimeout(restoreDraftIfUseful,80);
  });
  observer.observe(document.body,{childList:true,subtree:true});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
