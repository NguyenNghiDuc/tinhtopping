import { requireSupabase } from './supabase.js';

// Các hành vi nhập topping giờ do app.js xử lý trực tiếp.
// File này chỉ giữ các tiện ích độc lập: xóa cả ngày và lọc trạng thái nhân viên.
// Tuyệt đối không quan sát / tự xóa / render lại các dòng trong batch editor,
// vì việc đó sẽ làm input mất focus trong lúc người dùng đang gõ.
(() => {
  const recordsBody = document.querySelector('#recordsBody');
  let deletingDay = false;
  let employeeStatusMode = 'active';

  function formatDateVi(date) {
    const [year, month, day] = String(date).split('-');
    return year && month && day ? `${day}/${month}/${year}` : date;
  }

  function installDeleteDayStyles() {
    if (document.querySelector('#delete-day-style')) return;
    const style = document.createElement('style');
    style.id = 'delete-day-style';
    style.textContent = `
      .day-record-header { gap: 14px; }
      .delete-day-button {
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        min-height: 36px; padding: 7px 12px; margin-left: 8px;
        border: 1px solid #fecaca; border-radius: 8px; background: #fff; color: #dc2626;
        font: 700 12px 'DM Sans', sans-serif; cursor: pointer; white-space: nowrap;
        transition: background .15s ease, border-color .15s ease, transform .15s ease;
      }
      .delete-day-button:hover { border-color: #fca5a5; background: #fef2f2; }
      .delete-day-button:active { transform: translateY(1px); }
      .delete-day-button:disabled { cursor: wait; opacity: .55; }
      .delete-day-button svg {
        width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8;
        stroke-linecap: round; stroke-linejoin: round;
      }
      @media (max-width: 620px) {
        .day-record-header { flex-wrap: wrap; }
        .delete-day-button { width: 100%; margin-left: 0; }
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

  function refreshUiAfterDelete(date) {
    recordsBody?.querySelector(`.day-record-card[data-date="${CSS.escape(date)}"]`)?.remove();

    const recordsMonth = document.querySelector('#recordsMonth');
    if (recordsMonth) recordsMonth.dispatchEvent(new Event('change', { bubbles: true }));

    const summaryDate = document.querySelector('#summaryDate');
    if (summaryDate?.value === date) summaryDate.dispatchEvent(new Event('change', { bubbles: true }));

    const statisticsMonth = document.querySelector('#statisticsMonth');
    if (statisticsMonth?.value === date.slice(0, 7)) {
      statisticsMonth.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const toppingMonth = document.querySelector('#toppingMonth');
    if (toppingMonth?.value === date.slice(0, 7)) {
      toppingMonth.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const toppingDate = document.querySelector('#toppingDate');
    if (toppingDate?.value === date) toppingDate.dispatchEvent(new Event('change', { bubbles: true }));
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
        refreshUiAfterDelete(date);
        return;
      }

      const deleted = await client.from('shifts').delete().eq('sales_date', date).select('id');
      if (deleted.error) throw deleted.error;
      const deletedIds = deleted.data || [];

      if (deletedIds.length !== expectedIds.length) {
        window.alert(`Chỉ xóa được ${deletedIds.length}/${expectedIds.length} bản ghi. Có thể RLS đang giới hạn quyền xóa.`);
        refreshUiAfterDelete(date);
        return;
      }

      refreshUiAfterDelete(date);
      window.alert(`Đã xóa toàn bộ dữ liệu ngày ${formatDateVi(date)}.`);
    } catch (error) {
      console.error('Không thể xóa toàn bộ dữ liệu ngày.', { date, error });
      window.alert(error?.message || 'Không thể xóa toàn bộ dữ liệu ngày này.');
      button.disabled = false;
      button.innerHTML = originalText;
    } finally {
      deletingDay = false;
    }
  }

  function installEmployeeStatusStyles() {
    if (document.querySelector('#employee-status-filter-style')) return;
    const style = document.createElement('style');
    style.id = 'employee-status-filter-style';
    style.textContent = `
      .employee-status-filter {
        display: inline-flex; align-items: center; gap: 4px; padding: 4px;
        border: 1px solid #dbe3ef; border-radius: 10px; background: #f8fafc;
      }
      .employee-status-filter button {
        min-height: 34px; padding: 7px 13px; border: 0; border-radius: 7px;
        background: transparent; color: #64748b; font: 700 12px 'DM Sans', sans-serif;
        cursor: pointer; white-space: nowrap;
      }
      .employee-status-filter button:hover { color: #1d4ed8; background: #eff6ff; }
      .employee-status-filter button.active {
        color: #fff; background: #2563eb; box-shadow: 0 2px 6px rgba(37,99,235,.22);
      }
      .employee-status-filter button[data-employee-status="inactive"].active {
        background: #64748b; box-shadow: 0 2px 6px rgba(100,116,139,.22);
      }
      .employee-original-inactive-toggle { display: none !important; }
      @media (max-width: 680px) {
        .employee-toolbar { gap: 12px; flex-wrap: wrap; }
        .employee-status-filter { width: 100%; }
        .employee-status-filter button { flex: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function renameEmployeeStatusButtons() {
    const body = document.querySelector('#employeesBody');
    if (!body) return;
    body.querySelectorAll('[data-employee-action="toggle"]').forEach((button) => {
      const isActive = button.dataset.active === 'true';
      const nextText = isActive ? 'Nghỉ làm' : 'Đi làm lại';
      const nextTitle = isActive
        ? 'Chuyển nhân viên sang trạng thái nghỉ làm'
        : 'Cho nhân viên đi làm lại';
      if (button.textContent !== nextText) button.textContent = nextText;
      if (button.title !== nextTitle) button.title = nextTitle;
      if (button.getAttribute('aria-label') !== nextTitle) button.setAttribute('aria-label', nextTitle);
    });
  }

  function applyEmployeeStatusFilter() {
    const body = document.querySelector('#employeesBody');
    if (!body) return;
    renameEmployeeStatusButtons();
    const rows = [...body.querySelectorAll('tr')];
    rows.forEach((row) => {
      row.hidden = employeeStatusMode === 'inactive' ? !row.querySelector('.status-badge.inactive') : false;
    });

    const emptyState = document.querySelector('#employeesEmpty');
    if (!emptyState) return;
    const hasVisibleRows = rows.some((row) => !row.hidden);
    emptyState.hidden = hasVisibleRows;
    if (!hasVisibleRows && employeeStatusMode === 'inactive') {
      emptyState.textContent = 'Không có nhân viên nghỉ làm phù hợp.';
    } else if (!hasVisibleRows) {
      emptyState.textContent = 'Không tìm thấy nhân viên.';
    }
  }

  function setEmployeeStatusMode(mode) {
    employeeStatusMode = mode;
    const checkbox = document.querySelector('#showInactiveEmployees');
    if (!checkbox) return;
    checkbox.checked = mode !== 'active';
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelectorAll('[data-employee-status]').forEach((button) => {
      button.classList.toggle('active', button.dataset.employeeStatus === mode);
    });
    queueMicrotask(applyEmployeeStatusFilter);
  }

  function installEmployeeStatusFilter() {
    const checkbox = document.querySelector('#showInactiveEmployees');
    if (!checkbox || document.querySelector('.employee-status-filter')) return;
    const oldLabel = checkbox.closest('label');
    const toolbar = checkbox.closest('.employee-toolbar');
    if (!oldLabel || !toolbar) return;

    installEmployeeStatusStyles();
    oldLabel.classList.add('employee-original-inactive-toggle');

    const filter = document.createElement('div');
    filter.className = 'employee-status-filter';
    filter.setAttribute('role', 'group');
    filter.setAttribute('aria-label', 'Lọc trạng thái nhân viên');
    filter.innerHTML = `
      <button type="button" data-employee-status="all">Tất cả</button>
      <button type="button" data-employee-status="active" class="active">Đang làm</button>
      <button type="button" data-employee-status="inactive">Nghỉ làm</button>
    `;
    toolbar.appendChild(filter);

    filter.addEventListener('click', (event) => {
      const button = event.target.closest('[data-employee-status]');
      if (button) setEmployeeStatusMode(button.dataset.employeeStatus);
    });

    const body = document.querySelector('#employeesBody');
    if (body) {
      new MutationObserver(() => queueMicrotask(applyEmployeeStatusFilter))
        .observe(body, { childList: true });
    }

    document.querySelector('#employeeSearch')?.addEventListener('input', () => queueMicrotask(applyEmployeeStatusFilter));
    renameEmployeeStatusButtons();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const deleteDayButton = target.closest('[data-delete-day]');
    if (!deleteDayButton) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteWholeDay(deleteDayButton);
  }, true);

  if (recordsBody) {
    new MutationObserver(() => queueMicrotask(ensureDeleteDayButtons))
      .observe(recordsBody, { childList: true, subtree: true });
    ensureDeleteDayButtons();
  }

  installEmployeeStatusFilter();
})();
