// Legacy convenience layer intentionally disabled.
// app.js is the single owner of the batch editor/input lifecycle.
// Keeping this file minimal prevents old MutationObservers, draft restore,
// quick-entry handlers, and DOM rewrites from freezing or re-rendering inputs.

(() => {
  try {
    localStorage.removeItem('topping:offlineDraft');
  } catch {}

  // Service worker registration stays lightweight and isolated from the editor.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.warn('Không đăng ký được offline cache', error);
      });
    }, { once: true });
  }
})();
