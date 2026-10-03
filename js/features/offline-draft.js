import { $, $$, notify, installStyle } from './shared.js';

const KEY = 'topping:featureDraft:v2';
let saveTimer = null;

function collectDraft() {
  const editor = $('#shiftEditor');
  const date = $('#shiftDate')?.value;
  if (!editor || editor.hidden || !date) return null;
  const shifts = {};
  ['morning','afternoon','evening'].forEach((shiftId) => {
    const column = $(`#batch-column-${shiftId}`);
    if (!column) return;
    shifts[shiftId] = {
      note: column.querySelector(`[data-batch-note="${shiftId}"]`)?.value || '',
      rows: [...column.querySelectorAll('.batch-employee-row')].map((row) => ({
        employee: row.querySelector('.batch-employee-name')?.textContent?.trim() || '',
        quantity: row.querySelector('[data-batch-quantity]')?.value || '0'
      }))
    };
  });
  return { date, shifts, savedAt: Date.now() };
}

function saveDraft() {
  const draft = collectDraft();
  if (!draft) return;
  try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch {}
  updateRestoreButton();
}

function readDraft() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(KEY); } catch {}
  updateRestoreButton();
}

function updateRestoreButton() {
  const button = $('#featureRestoreDraft');
  if (!button) return;
  const draft = readDraft();
  const date = $('#shiftDate')?.value;
  button.hidden = !draft || !date || draft.date !== date;
}

function restoreDraft() {
  const draft = readDraft();
  const editor = $('#shiftEditor');
  if (!draft || !editor || editor.hidden || $('#shiftDate')?.value !== draft.date) return;
  if (!window.confirm('Khôi phục bản nháp đã lưu trên máy cho ngày này?')) return;

  Object.entries(draft.shifts || {}).forEach(([shiftId, data]) => {
    const column = $(`#batch-column-${shiftId}`);
    if (!column) return;
    const addAll = column.querySelector('[data-batch-action="add-all"]');
    if (addAll && !addAll.disabled) addAll.click();
    requestAnimationFrame(() => {
      [...column.querySelectorAll('.batch-employee-row')].forEach((row) => {
        const name = row.querySelector('.batch-employee-name')?.textContent?.trim() || '';
        const saved = (data.rows || []).find((item) => item.employee === name);
        if (!saved) return;
        const input = row.querySelector('[data-batch-quantity]');
        if (input) {
          input.value = String(saved.quantity ?? '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      const note = column.querySelector(`[data-batch-note="${shiftId}"]`);
      if (note) {
        note.value = data.note || '';
        note.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
  notify('Đã khôi phục bản nháp. Kiểm tra lại rồi bấm LƯU TẤT CẢ.');
}

function init() {
  if (document.body.dataset.featureOfflineDraft === '1') return;
  document.body.dataset.featureOfflineDraft = '1';
  const heading = $('#shiftEditor .editor-heading');
  if (heading && !$('#featureRestoreDraft')) {
    installStyle('feature-draft-style', '.feature-draft-button{margin-left:auto;min-height:34px;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-weight:700;cursor:pointer}.feature-draft-button[hidden]{display:none}');
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'featureRestoreDraft';
    button.className = 'feature-draft-button';
    button.textContent = 'Khôi phục nháp';
    button.hidden = true;
    const close = $('#closeEditorButton');
    heading.insertBefore(button, close || null);
    button.addEventListener('click', restoreDraft);
  }

  const editor = $('#shiftEditor');
  editor?.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 350);
  });
  $('#shiftDate')?.addEventListener('change', updateRestoreButton);
  $('#shiftForm')?.addEventListener('submit', () => setTimeout(clearDraft, 1200));
  $('#cancelEditorButton')?.addEventListener('click', updateRestoreButton);
  $('#closeEditorButton')?.addEventListener('click', updateRestoreButton);
  updateRestoreButton();
}

init();
