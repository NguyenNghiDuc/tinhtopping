(() => {
  const selector = '[data-batch-quantity]';

  function installSelectionStyle() {
    if (document.querySelector('#quantity-selection-style')) return;
    const style = document.createElement('style');
    style.id = 'quantity-selection-style';
    style.textContent = `
      input[data-batch-quantity]::selection {
        background: #2563eb;
        color: #ffffff;
      }
      input[data-batch-quantity]::-moz-selection {
        background: #2563eb;
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '5') return;
    input.dataset.quantityFixed = '5';

    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.removeAttribute('pattern');
    input.removeAttribute('max');
    input.removeAttribute('maxlength');
    input.removeAttribute('size');

    const clean = (value) => String(value ?? '').replace(/\D+/g, '');

    const selectZero = () => {
      if (input.value !== '0') return;
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(0, 1, 'forward');
      } catch {
        input.select();
      }
    };

    const holdZeroSelection = (event) => {
      if (input.value !== '0') return;
      event.preventDefault();
      selectZero();
      requestAnimationFrame(selectZero);
      setTimeout(selectZero, 0);
    };

    input.addEventListener('pointerdown', holdZeroSelection);
    input.addEventListener('mousedown', holdZeroSelection);
    input.addEventListener('mouseup', (event) => {
      if (input.value !== '0') return;
      event.preventDefault();
      selectZero();
    });
    input.addEventListener('click', (event) => {
      if (input.value !== '0') return;
      event.preventDefault();
      selectZero();
    });
    input.addEventListener('focus', () => {
      if (input.value === '0') {
        selectZero();
        requestAnimationFrame(selectZero);
      }
    });

    input.addEventListener('input', () => {
      input.removeAttribute('max');
      input.removeAttribute('maxlength');
      input.removeAttribute('pattern');

      const start = input.selectionStart ?? input.value.length;
      const before = input.value;
      const cleanedBeforeCaret = before.slice(0, start).replace(/\D+/g, '');
      const after = clean(before);

      if (before !== after) {
        input.value = after;
        const caret = Math.min(cleanedBeforeCaret.length, after.length);
        try { input.setSelectionRange(caret, caret); } catch {}
      }
    }, true);

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
    if (!toast) return;
    const hideIfDraftToast = () => {
      if (/Đã khôi phục bản nháp chưa lưu trên máy/i.test(toast.textContent || '')) {
        toast.classList.remove('show');
        toast.textContent = '';
      }
    };
    hideIfDraftToast();
    new MutationObserver(hideIfDraftToast).observe(toast, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  installSelectionStyle();
  document.addEventListener('DOMContentLoaded', () => {
    installSelectionStyle();
    scan();
    suppressDraftRestoreToast();
  }, { once: true });
  scan();
  suppressDraftRestoreToast();

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement && mutation.target.matches(selector)) {
        mutation.target.removeAttribute('max');
        mutation.target.removeAttribute('maxlength');
        mutation.target.removeAttribute('pattern');
      }
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element) scan(node);
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['max', 'maxlength', 'pattern']
  });
})();
