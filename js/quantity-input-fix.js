(() => {
  const selector = '[data-batch-quantity]';

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '2') return;
    input.dataset.quantityFixed = '2';

    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.autocomplete = 'off';
    input.removeAttribute('max');
    input.removeAttribute('maxlength');
    input.removeAttribute('size');

    const clean = (value) => {
      const digits = String(value ?? '').replace(/\D+/g, '');
      if (!digits) return '';
      return digits.replace(/^0+(?=\d)/, '') || '0';
    };

    input.addEventListener('focus', () => {
      if (input.value === '0') requestAnimationFrame(() => input.select());
    });

    input.addEventListener('click', () => {
      if (input.value === '0') requestAnimationFrame(() => input.select());
    });

    input.addEventListener('beforeinput', (event) => {
      if (event.inputType?.startsWith('delete') || event.inputType === 'insertFromPaste') return;
      if (event.data && /\D/.test(event.data)) event.preventDefault();
    });

    input.addEventListener('input', () => {
      input.removeAttribute('max');
      input.removeAttribute('maxlength');
      const before = input.value;
      const after = clean(before);
      if (before !== after) input.value = after;
    }, true);

    input.addEventListener('paste', () => {
      requestAnimationFrame(() => {
        const after = clean(input.value);
        if (input.value !== after) input.value = after;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
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

  document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
  scan();

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement && mutation.target.matches(selector)) {
        mutation.target.removeAttribute('max');
        mutation.target.removeAttribute('maxlength');
      }
      for (const node of mutation.addedNodes || []) {
        if (node instanceof Element) scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['max', 'maxlength'] });
})();
