(() => {
  const selector = '[data-batch-quantity]';

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
    if (input.dataset.quantityFixed === '6') return;
    input.dataset.quantityFixed = '6';

    // Keep this as a completely normal text field. Previous pointer/mouse
    // interception made some keystrokes feel ignored on Chrome/Codespaces.
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.removeAttribute('pattern');
    input.removeAttribute('max');
    input.removeAttribute('maxlength');
    input.removeAttribute('size');

    input.addEventListener('focus', () => {
      if (input.value === '0') {
        // Select only on focus; do not cancel pointer/mouse events.
        setTimeout(() => {
          if (document.activeElement === input && input.value === '0') input.select();
        }, 0);
      }
    });

    input.addEventListener('input', () => {
      const caret = input.selectionStart ?? input.value.length;
      const before = input.value;
      const left = before.slice(0, caret);
      const after = before.replace(/\D/g, '');

      if (before !== after) {
        const newCaret = left.replace(/\D/g, '').length;
        input.value = after;
        try { input.setSelectionRange(newCaret, newCaret); } catch {}
      }
    });

    input.addEventListener('blur', () => {
      if (input.value === '') {
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(selector)) normalizeField(root);
    root.querySelectorAll?.(selector).forEach(normalizeField);
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
    new MutationObserver(hide).observe(toast, { childList:true, characterData:true, subtree:true, attributes:true, attributeFilter:['class'] });
    hide();
  }

  installSelectionStyle();
  scan();
  suppressDraftRestoreToast();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installSelectionStyle();
      scan();
      suppressDraftRestoreToast();
    }, { once:true });
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element) scan(node);
      }
    }
  }).observe(document.documentElement, { childList:true, subtree:true });
})();
