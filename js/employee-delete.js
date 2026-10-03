import { requireSupabase } from './supabase.js';

(() => {
  const deletedEmployeeIds = new Set();
  let deletingEmployeeId = null;

  function installStyles() {
    if (document.querySelector('#employee-delete-style')) return;
    const style = document.createElement('style');
    style.id = 'employee-delete-style';
    style.textContent = `
      .employee-delete-button {
        min-height: 30px;
        padding: 5px 9px;
        border: 1px solid #fecaca;
        border-radius: 6px;
        background: #fff;
        color: #dc2626;
        font: 700 12px 'DM Sans', sans-serif;
        cursor: pointer;
        white-space: nowrap;
      }
      .employee-delete-button:hover { background: #fef2f2; border-color: #fca5a5; }
      .employee-delete-button:disabled { opacity: .55; cursor: wait; }
    `;
    document.head.appendChild(style);
  }

  function enhanceRows() {
    const body = document.querySelector('#employeesBody');
    if (!body) return;
    installStyles();

    body.querySelectorAll('tr').forEach((row) => {
      const actions = row.querySelector('.row-actions');
      const sourceButton = row.querySelector('[data-employee-id]');
      if (!actions || !sourceButton) return;
      const employeeId = sourceButton.dataset.employeeId;
      if (!employeeId || deletedEmployeeIds.has(employeeId)) return;
      if (actions.querySelector(`[data-delete-employee="${CSS.escape(employeeId)}"]`)) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'employee-delete-button';
      button.dataset.deleteEmployee = employeeId;
      button.textContent = 'Xóa';
      button.title = 'Xóa vĩnh viễn nhân viên';
      actions.appendChild(button);
    });
  }

  function stripDeletedEmployeesFromBatch() {
    if (!deletedEmployeeIds.size) return;
    document.querySelectorAll('[data-batch-add-select]').forEach((select) => {
      deletedEmployeeIds.forEach((employeeId) => {
        const option = [...select.options].find((item) => item.value === employeeId);
        if (option) option.remove();
      });
    });
  }

  async function deleteEmployee(button) {
    const employeeId = button.dataset.deleteEmployee;
    if (!employeeId || deletingEmployeeId) return;

    const row = button.closest('tr');
    const name = row?.querySelector('.employee-name')?.textContent?.trim() || 'nhân viên này';
    if (!window.confirm(`Xóa vĩnh viễn ${name}?\n\nNếu nhân viên đã có dữ liệu ca bán, Supabase có thể không cho xóa để bảo toàn lịch sử.`)) return;

    deletingEmployeeId = employeeId;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Đang xóa...';

    try {
      const result = await requireSupabase()
        .from('employees')
        .delete()
        .eq('id', employeeId)
        .select('id')
        .maybeSingle();

      if (result.error) throw result.error;
      if (!result.data) throw Object.assign(new Error('Không xóa được nhân viên. Có thể RLS không cho phép thao tác này.'), { code: 'EMPLOYEE_NOT_DELETED' });

      deletedEmployeeIds.add(employeeId);
      row?.remove();
      stripDeletedEmployeesFromBatch();

      const empty = document.querySelector('#employeesEmpty');
      const body = document.querySelector('#employeesBody');
      if (empty && body) empty.hidden = body.querySelectorAll('tr:not([hidden])').length > 0;

      window.alert(`Đã xóa ${name}.`);
    } catch (error) {
      console.error('Không thể xóa nhân viên.', { employeeId, error });
      const foreignKeyError = error?.code === '23503' || /foreign key|violates.*constraint/i.test(error?.message || '');
      if (foreignKeyError) {
        window.alert(`${name} đã có dữ liệu ca bán nên không thể xóa vĩnh viễn. Hãy dùng “Nghỉ làm” để giữ lịch sử doanh thu.`);
      } else {
        window.alert(error?.message || 'Không thể xóa nhân viên. Kiểm tra RLS/quyền quản lý trong Supabase.');
      }
      button.disabled = false;
      button.textContent = originalText;
    } finally {
      deletingEmployeeId = null;
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-delete-employee]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteEmployee(button);
  }, true);

  const employeeBody = document.querySelector('#employeesBody');
  if (employeeBody) {
    const observer = new MutationObserver(() => queueMicrotask(enhanceRows));
    observer.observe(employeeBody, { childList: true });
    enhanceRows();
  }

  const batchColumns = document.querySelector('#shiftBatchColumns');
  if (batchColumns) {
    const observer = new MutationObserver(() => queueMicrotask(stripDeletedEmployeesFromBatch));
    observer.observe(batchColumns, { childList: true, subtree: true });
  }
})();
