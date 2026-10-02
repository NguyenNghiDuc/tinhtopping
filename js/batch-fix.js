import { requireSupabase } from './supabase.js';

// Giữ form batch gọn: khi mở/ngày thay đổi, chỉ giữ các dòng đã có dữ liệu.
// Đồng thời thêm nút xóa toàn bộ dữ liệu của một ngày ở đầu mỗi card ngày.
(() => {
  const container = document.querySelector('#shiftBatchColumns');
  const editor = document.querySelector('#shiftEditor');
  const dateInput = document.querySelector('#shiftDate');
  const recordsBody = document.querySelector('#recordsBody');

  let pendingCleanup = false;
  let cleaning = false;
  let deletingDay = false;

  function requestCleanup() {
    pendingCleanup = true;
  }

  function cleanupPrefilledZeroRows() {
    if (!container || !editor) return;
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

  function formatDateVi(date) {
    const [year, month, day] = String(date).split('-');
    return year && month && day ? `${day}/${month}/${year}` : date;
  }

  function installDeleteDayStyles() {
    if (document.querySelector('#delete-day-style')) return;
    const style = document.createElement('style');
    style.id = 'delete-day-style';
    style.textContent = `
      .day-record-header {
        gap: 14px;
      }
      .delete-day-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 36px;
        padding: 7px 12px;
        margin-left: 8px;
        border: 1px solid #fecaca;
        border-radius: 8px;
        background: #fff;
        color: #dc2626;
        font: 700 12px 'DM Sans', sans-serif;
        cursor: pointer;
        white-space: nowrap;
        transition: background .15s ease, border-color .15s ease, transform .15s ease;
      }
      .delete-day-button:hover {
        border-color: #fca5a5;
        background: #fef2f2;
      }
      .delete-day-button:active {
        transform: translateY(1px);
      }
      .delete-day-button:disabled {
        cursor: wait;
        opacity: .55;
      }
      .delete-day-button svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      @media (max-width: 620px) {
        .day-record-header {
          flex-wrap: wrap;
        }
        .delete-day-button {
          width: 100%;
          margin-left: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureDeleteDayButtons() {
    if (!recordsBody) return;
    installDeleteDayStyles();
    recordsBody.querySelectorAll('.day-record-card[data-date]').forEach((card) => {
      if (card.querySelector('[data-delete-day]')) return;
      const header = card.querySelector('.day-record-header');
      if (!header) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'delete-day-button';
      button.dataset.deleteDay = card.dataset.date || '';
      button.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/>
        </svg>
        Xóa hết ngày
      `;
      header.appendChild(button);
    });
  }

  async function deleteWholeDay(button) {
    if (deletingDay) return;
    const date = button.dataset.deleteDay;
    if (!date) return;

    const accepted = window.confirm(
      `Xóa toàn bộ dữ liệu ngày ${formatDateVi(date)}?\n\n` +
      'Tất cả Ca Sáng, Ca Chiều, Ca Tối và toàn bộ nhân viên trong ngày này sẽ bị xóa. Hành động này không thể hoàn tác.'
    );
    if (!accepted) return;

    deletingDay = true;
    const originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Đang xóa...';

    try {
      const client = requireSupabase();

      const before = await client.from('shifts').select('id').eq('sales_date', date);
      if (before.error) throw before.error;
      const expectedIds = before.data || [];

      if (!expectedIds.length) {
        window.alert('Ngày này không còn dữ liệu để xóa.');
        window.location.reload();
        return;
      }

      const deleted = await client
        .from('shifts')
        .delete()
        .eq('sales_date', date)
        .select('id');

      if (deleted.error) throw deleted.error;

      const deletedIds = deleted.data || [];
      if (deletedIds.length !== expectedIds.length) {
        window.alert(
          `Chỉ xóa được ${deletedIds.length}/${expectedIds.length} bản ghi. ` +
          'Có thể RLS đang giới hạn quyền xóa. Trang sẽ tải lại để hiển thị dữ liệu thực tế.'
        );
        window.location.reload();
        return;
      }

      window.alert(`Đã xóa toàn bộ dữ liệu ngày ${formatDateVi(date)}.`);
      window.location.reload();
    } catch (error) {
      console.error('Không thể xóa toàn bộ dữ liệu ngày.', { date, error });
      window.alert(error?.message || 'Không thể xóa toàn bộ dữ liệu ngày này.');
      button.disabled = false;
      button.innerHTML = originalText;
    } finally {
      deletingDay = false;
    }
  }

  // Mở form nhập mới/sửa và xử lý nút xóa cả ngày.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const deleteDayButton = target.closest('[data-delete-day]');
    if (deleteDayButton) {
      event.preventDefault();
      event.stopPropagation();
      void deleteWholeDay(deleteDayButton);
      return;
    }

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

  if (container && editor) {
    const editorObserver = new MutationObserver(() => {
      if (!pendingCleanup || cleaning) return;
      queueMicrotask(cleanupPrefilledZeroRows);
    });
    editorObserver.observe(container, { childList: true, subtree: true });
  }

  if (recordsBody) {
    const recordsObserver = new MutationObserver(() => {
      queueMicrotask(ensureDeleteDayButtons);
    });
    recordsObserver.observe(recordsBody, { childList: true, subtree: true });
    ensureDeleteDayButtons();
  }
})();
