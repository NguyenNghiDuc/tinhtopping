// Giữ form batch gọn: khi mở/ngày thay đổi, chỉ giữ các dòng đã có dữ liệu.
// Các nhân viên còn lại sẽ được thêm bằng dropdown hoặc nút "Thêm tất cả nhân viên".
(() => {
  const container = document.querySelector('#shiftBatchColumns');
  const editor = document.querySelector('#shiftEditor');
  const dateInput = document.querySelector('#shiftDate');
  if (!container || !editor) return;

  let pendingCleanup = false;
  let cleaning = false;

  function requestCleanup() {
    pendingCleanup = true;
  }

  function cleanupPrefilledZeroRows() {
    if (!pendingCleanup || cleaning || editor.hidden) return;
    if (!container.querySelector('.batch-shift-card')) return;

    cleaning = true;
    try {
      ['morning', 'afternoon', 'evening'].forEach((shiftId) => {
        const column = document.querySelector(`#batch-column-${shiftId}`);
        if (!column) return;

        // renderBatchColumn() vẽ lại DOM sau mỗi lần xóa nên luôn query lại dòng kế tiếp.
        for (let guard = 0; guard < 200; guard += 1) {
          const zeroRow = [...column.querySelectorAll('[data-batch-index]')].find((row) => {
            const input = row.querySelector('[data-batch-quantity]');
            return input && Number(input.value || 0) === 0;
          });
          if (!zeroRow) break;
          const removeButton = zeroRow.querySelector('[data-batch-action="remove"]');
          if (!removeButton) break;
          removeButton.click();
        }
      });
    } finally {
      pendingCleanup = false;
      cleaning = false;
    }
  }

  // Mở form nhập mới hoặc mở một ngày để sửa.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#addShiftButton')) {
      requestCleanup();
      return;
    }
    const recordArea = target.closest('#recordsBody');
    if (!recordArea) return;
    if (target.closest('[data-action="delete"]')) return;
    if (target.closest('[data-action="edit"], [data-record-id]')) requestCleanup();
  }, true);

  // Đổi ngày trong lúc editor đang mở cũng sẽ tải batch mới.
  if (dateInput) dateInput.addEventListener('change', requestCleanup, true);

  const observer = new MutationObserver(() => {
    if (!pendingCleanup || cleaning) return;
    queueMicrotask(cleanupPrefilledZeroRows);
  });
  observer.observe(container, { childList: true, subtree: true });
})();
