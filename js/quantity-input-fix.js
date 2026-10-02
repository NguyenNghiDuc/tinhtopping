(() => {
  const selector = '[data-batch-quantity]';

  function normalizeField(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.quantityFixed === '1') return;
    input.dataset.quantityFixed = '1';

    // Text + numeric keyboard avoids browser quirks with number inputs such as
    // leading-zero normalization while still allowing fast multi-digit entry.
    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.autocomplete = 'off';

    const clean = (value) => {
      const digits = String(value ?? '').replace(/\D+/g, '');
      if (!digits) return '';
      const normalized = digits.replace(/^0+(?=\d)/, '');
      return normalized || '0';
    };

    input.addEventListener('focus', () => {
      // Keep 0 visible, but select it so the first typed digit replaces it.
      if (input.value === '0') requestAnimationFrame(() => input.select());
    });

    input.addEventListener('click', () => {
      if (input.value === '0') requestAnimationFrame(() => input.select());
    });

    input.addEventListener('input', () => {
      const before = input.value;
      const after = clean(before);
      if (before !== after) input.value = after;
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
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
