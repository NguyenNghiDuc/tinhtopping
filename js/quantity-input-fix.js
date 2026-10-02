(() => {
  const selector = '[data-batch-quantity]';

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '4') return;
    input.dataset.quantityFixed = '4';

    // Use a plain text field with numeric keyboard. Do not set maxlength/max.
    // This lets the user place the caret anywhere and type as many digits as needed.
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
      try { input.setSelectionRange(0, 1); }
      catch { input.select(); }
    };

    // Only special-case the default value 0. Existing values such as 10, 100,
    // 1000... behave like a normal text field so the caret can be placed anywhere.
    input.addEventListener('pointerdown', (event) => {
      if (input.value !== '0') return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      requestAnimationFrame(selectZero);
    });

    input.addEventListener('focus', () => {
      if (input.value === '0') requestAnimationFrame(selectZero);
    });

    input.addEventListener('input', () => {
      input.removeAttribute('max');
      input.removeAttribute('maxlength');

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

  document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
  scan();

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
