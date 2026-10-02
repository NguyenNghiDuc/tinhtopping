(() => {
  const selector = '[data-batch-quantity]';
  const DRAFT_KEY = 'topping:offlineDraft';

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

  function setValue(input, value, caret = null) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (caret !== null) {
      requestAnimationFrame(() => {
        try { input.setSelectionRange(caret, caret); } catch {}
      });
    }
  }

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '7') return;
    input.dataset.quantityFixed = '7';

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

    input.addEventListener('keydown', (event) => {
      if (!/^\d$/.test(event.key)) return;
      event.preventDefault();

      const value = input.value || '';
      const start = input.selectionStart ?? value.length;
      const end = input.selectionEnd ?? start;
      let next;
      let caret;

      if (value === '0' && start === end) {
        next = event.key;
        caret = 1;
      } else {
        next = value.slice(0, start) + event.key + value.slice(end);
        next = next.replace(/\D/g, '');
        caret = start + 1;
      }

      setValue(input, next, caret);
    });

    input.addEventListener('input', () => {
      const before = input.value;
      const after = before.replace(/\D/g, '');
      if (before !== after) {
        const caret = Math.min(input.selectionStart ?? after.length, after.length);
        input.value = after;
        try { input.setSelectionRange(caret, caret); } catch {}
      }
    });

    input.addEventListener('blur', () => {
      if (input.value === '') setValue(input, '0');
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
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
