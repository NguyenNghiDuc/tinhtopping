(() => {
  const DRAFT_KEY = 'topping:offlineDraft';

  // app.js now owns quantity input behavior and employee-row creation.
  // Keep this legacy file intentionally minimal so old workarounds cannot
  // interfere with typing, focus, or the add-one-employee flow.
  try { localStorage.removeItem(DRAFT_KEY); } catch {}

  const clearOldDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  };

  const editor = document.querySelector('#shiftEditor');
  if (editor) {
    new MutationObserver(() => {
      if (!editor.hidden) clearOldDraft();
    }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
  }

  const toast = document.querySelector('#toast');
  if (toast) {
    const hideLegacyDraftToast = () => {
      if (/Đã khôi phục bản nháp chưa lưu trên máy/i.test(toast.textContent || '')) {
        toast.classList.remove('show');
        toast.textContent = '';
      }
    };
    new MutationObserver(hideLegacyDraftToast).observe(toast, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    hideLegacyDraftToast();
  }
})();
