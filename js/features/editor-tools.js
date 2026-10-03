import { $, $$, normalize, notify, installStyle } from './shared.js';

const SHIFTS = [
  { id: 'morning', label: 'Ca Sáng' },
  { id: 'afternoon', label: 'Ca Chiều' },
  { id: 'evening', label: 'Ca Tối' }
];

function setAllQuantities(shiftId, blank = false) {
  const column = $(`#batch-column-${shiftId}`);
  if (!column) return;
  $$('[data-batch-quantity]', column).forEach((input) => {
    input.value = blank ? '' : '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  notify(blank ? 'Đã xóa trắng số topping trong ca.' : 'Đã đặt toàn bộ topping trong ca về 0.');
}

function filterSelect(shiftId, keyword) {
  const select = $(`[data-batch-add-select="${shiftId}"]`);
  if (!select) return;
  const needle = normalize(keyword);
  [...select.options].forEach((option, index) => {
    if (index === 0) return;
    option.hidden = !!needle && !normalize(option.textContent).includes(needle);
  });
}

function ensureTools() {
  SHIFTS.forEach(({ id, label }) => {
    const column = $(`#batch-column-${id}`);
    const addControls = column?.querySelector('.batch-add-controls');
    if (!column || !addControls) return;

    if (!column.querySelector('[data-feature-employee-search]')) {
      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'feature-employee-search';
      input.dataset.featureEmployeeSearch = id;
      input.placeholder = `Tìm nhân viên · ${label}`;
      input.addEventListener('input', () => filterSelect(id, input.value));
      addControls.prepend(input);
    }

    if (!column.querySelector('[data-feature-editor-tools]')) {
      const tools = document.createElement('div');
      tools.className = 'feature-editor-tools';
      tools.dataset.featureEditorTools = id;
      tools.innerHTML = `
        <button type="button" data-feature-zero="${id}">Đặt 0 tất cả</button>
        <button type="button" data-feature-clear="${id}">Xóa trắng số</button>
      `;
      addControls.after(tools);
    }
  });
}

function init() {
  if (document.body.dataset.featureEditorTools === '1') return;
  document.body.dataset.featureEditorTools = '1';

  installStyle('feature-editor-tools-style', `
    .feature-employee-search{width:100%;min-height:35px;padding:7px 10px;margin-bottom:6px;border:1px solid #dbe3ef;border-radius:8px;background:#fff;font:600 12px 'DM Sans',sans-serif}
    .feature-editor-tools{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 4px}
    .feature-editor-tools button{min-height:34px;padding:7px 10px;border:1px solid #d6deea;border-radius:8px;background:#fff;color:#475569;font:700 11px 'DM Sans',sans-serif;cursor:pointer}
    .feature-editor-tools button:hover{background:#f8fafc;border-color:#aebbd0}
  `);

  document.addEventListener('click', (event) => {
    const zero = event.target.closest('[data-feature-zero]');
    const clear = event.target.closest('[data-feature-clear]');
    if (zero) setAllQuantities(zero.dataset.featureZero, false);
    if (clear) setAllQuantities(clear.dataset.featureClear, true);
  });

  const columns = $('#shiftBatchColumns');
  if (columns) {
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        ensureTools();
      });
    }).observe(columns, { childList: true, subtree: true });
  }

  $('#addShiftButton')?.addEventListener('click', () => setTimeout(ensureTools, 0));
  ensureTools();
}

init();
