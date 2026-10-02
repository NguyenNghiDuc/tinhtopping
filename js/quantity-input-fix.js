(() => {
  const DRAFT_KEY = 'topping:offlineDraft';

  // app.js là nguồn duy nhất quản lý ô số và danh sách nhân viên.
  // Tắt hẳn cơ chế draft cũ của convenience.js vì nó tự restore bằng cách
  // bấm "Thêm tất cả nhân viên", làm render lại form và cướp focus khi đang gõ.
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItemWithoutLegacyDraft(key, value) {
    if (this === localStorage && key === DRAFT_KEY) return;
    return nativeSetItem.call(this, key, value);
  };

  const clearLegacyDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  };

  clearLegacyDraft();

  // Xóa draft trước mọi thao tác trong editor để restoreDraftIfUseful()
  // luôn nhận null, kể cả khi module convenience.js vẫn đang được load.
  document.addEventListener('input', (event) => {
    if (event.target instanceof Element && event.target.closest('#shiftEditor')) {
      clearLegacyDraft();
    }
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.closest('#shiftEditor')) {
      clearLegacyDraft();
    }
  }, true);

  const editor = document.querySelector('#shiftEditor');
  if (editor) {
    new MutationObserver(() => {
      if (!editor.hidden) clearLegacyDraft();
    }).observe(editor, { attributes: true, attributeFilter: ['hidden'] });
  }

  // Chặn toast của cơ chế restore cũ nếu một callback cũ còn đang chờ chạy.
  const toast = document.querySelector('#toast');
  if (toast) {
    const hideLegacyDraftToast = () => {
      if (/Đã khôi phục bản nháp chưa lưu trên máy/i.test(toast.textContent || '')) {
        toast.classList.remove('show');
        toast.textContent = '';
        clearLegacyDraft();
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
