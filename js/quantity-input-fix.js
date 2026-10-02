(() => {
  const quantitySelector = '[data-batch-quantity]';
  const DRAFT_KEY = 'topping:offlineDraft';
  let cleanedDate = null;
  let cleanupTimer = null;

  // Old drafts were the source of rows being re-added unexpectedly.
  try { localStorage.removeItem(DRAFT_KEY); } catch {}

  function installSelectionStyle() {
    if (document.querySelector('#quantity-selection-style')) return;
    const style = document.createElement('style');
    style.id = 'quantity-selection-style';
    style.textContent = `
      input[data-batch-quantity]::selection { background:#2563eb; color:#fff; }
      input[data-batch-quantity]::-moz-selection { background:#2563eb; color:#fff; }
    `;
    document.head.appendChild(style);
  }

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '8') return;
    input.dataset.quantityFixed = '8';

    // Native text input: no keydown interception, no max/maxlength.
    // This avoids dropped keystrokes and permits any number of digits.
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.removeAttribute('pattern');
    input.removeAttribute('max');
    input.removeAttribute('maxlength');
    input.removeAttribute('size');

    input.addEventListener('focus', () => {
      if (input.value !== '0') return;
      requestAnimationFrame(() => {
        if (document.activeElement === input && input.value === '0') input.select();
      });
    });

    input.addEventListener('input', () => {
      const before = input.value;
      const caretBefore = input.selectionStart ?? before.length;
      const after = before.replace(/\D/g, '');
      if (after === before) return;
      const leftDigits = before.slice(0, caretBefore).replace(/\D/g, '').length;
      input.value = after;
      try { input.setSelectionRange(leftDigits, leftDigits); } catch {}
    });

    input.addEventListener('blur', () => {
      if (input.value !== '') return;
      input.value = '0';
      input.dispatchEvent(new Event('input', { bubbles:true }));
    });
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(quantitySelector)) normalizeField(root);
    root.querySelectorAll?.(quantitySelector).forEach(normalizeField);
  }

  // app.js currently pre-fills every active employee with quantity 0 when the
  // editor opens. Remove only those initial zero placeholders once per date.
  // Existing saved rows with a positive quantity stay. After this one-time
  // cleanup, the normal "+ Thêm nhân viên" action adds exactly one person.
  function cleanInitialZeroRows() {
    const editor = document.querySelector('#shiftEditor');
    const dateInput = document.querySelector('#shiftDate');
    if (!editor || editor.hidden || !dateInput?.value) return;
    const date = dateInput.value;
    if (cleanedDate === date) return;

    const columns = [...editor.querySelectorAll('[id^="batch-column-"]')];
    if (columns.length < 3 || columns.some((column) => column.textContent.includes('Đang tải dữ liệu'))) return;

    cleanedDate = date;
    for (const column of columns) {
      // Work backwards because each remove re-renders this column.
      let safety = 100;
      while (safety-- > 0) {
        const zeroRow = [...column.querySelectorAll('.batch-employee-row')].find((row) => {
          const input = row.querySelector(quantitySelector);
          return input && Number(input.value || 0) === 0;
        });
        if (!zeroRow) break;
        const remove = zeroRow.querySelector('[data-batch-action="remove"]');
        if (!remove) break;
        remove.click();
      }
    }
    scan(editor);
  }

  function scheduleInitialCleanup() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(cleanInitialZeroRows, 80);
  }

  function suppressDraftRestoreToast() {
    const toast = document.querySelector('#toast');
    if (!toast || toast.dataset.draftToastGuard === '1') return;
    toast.dataset.draftToastGuard = '1';
    const hide = () => {
      if (/Đã khôi phục bản nháp chưa lưu trên máy/i.test(toast.textContent || '')) {
        toast.classList.remove('show');
        toast.textContent = '';
      }
    };
    new MutationObserver(hide).observe(toast, {
      childList:true,
      characterData:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class']
    });
    hide();
  }

  installSelectionStyle();
  scan();
  suppressDraftRestoreToast();
  scheduleInitialCleanup();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      installSelectionStyle();
      scan();
      suppressDraftRestoreToast();
      scheduleInitialCleanup();
    }, { once:true });
  }

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'shiftDate') {
      cleanedDate = null;
      scheduleInitialCleanup();
    }
  }, true);

  new MutationObserver((mutations) => {
    let editorChanged = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element) {
          scan(node);
          if (node.closest?.('#shiftEditor') || node.querySelector?.('#shiftEditor')) editorChanged = true;
        }
      }
      if (mutation.target instanceof Element && mutation.target.closest?.('#shiftEditor')) editorChanged = true;
    }
    if (editorChanged) scheduleInitialCleanup();
  }).observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden'] });
})();
