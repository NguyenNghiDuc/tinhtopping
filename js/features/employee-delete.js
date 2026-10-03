import { requireSupabase } from '../supabase.js';
import { $, installStyle, notify } from './shared.js';

let deletingEmployeeId = null;

function enhanceEmployeeRows() {
  const body = $('#employeesBody');
  if (!body) return;

  body.querySelectorAll('tr').forEach((row) => {
    const actions = row.querySelector('.row-actions');
    const sourceButton = row.querySelector('[data-employee-id]');
    if (!actions || !sourceButton) return;

    const employeeId = sourceButton.dataset.employeeId;
    if (!employeeId || actions.querySelector(`[data-delete-employee="${CSS.escape(employeeId)}"]`)) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-action employee-delete-action';
    button.dataset.deleteEmployee = employeeId;
    button.textContent = 'Xóa';
    button.title = 'Xóa vĩnh viễn nhân viên';
    actions.appendChild(button);
  });
}

function scheduleEnhance() {
  requestAnimationFrame(() => {
    enhanceEmployeeRows();
    setTimeout(enhanceEmployeeRows, 60);
  });
}

async function deleteEmployee(button) {
  const employeeId = button.dataset.deleteEmployee;
  if (!employeeId || deletingEmployeeId) return;

  const row = button.closest('tr');
  const name = row?.querySelector('.employee-name')?.textContent?.trim() || 'nhân viên này';
  const confirmed = window.confirm(
    `Xóa vĩnh viễn ${name}?\n\nNếu nhân viên đã có dữ liệu ca bán thì hệ thống sẽ không cho xóa để giữ lịch sử. Khi đó hãy dùng “Nghỉ làm”.`
  );
  if (!confirmed) return;

  deletingEmployeeId = employeeId;
  const previousText = button.textContent;
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
    if (!result.data) throw new Error('Không xóa được nhân viên. Tài khoản có thể không có quyền xóa.');

    row?.remove();
    notify(`Đã xóa ${name}.`);
    document.dispatchEvent(new CustomEvent('topping:employee-deleted', {
      detail: { employeeId, name }
    }));
  } catch (error) {
    console.error('Không thể xóa nhân viên.', error);
    const foreignKey = error?.code === '23503' || /foreign key|constraint/i.test(error?.message || '');
    if (foreignKey) {
      window.alert(`${name} đã có dữ liệu ca bán nên không thể xóa vĩnh viễn. Hãy dùng “Nghỉ làm” để vẫn giữ lịch sử.`);
    } else {
      window.alert(error?.message || 'Không thể xóa nhân viên. Kiểm tra quyền Manager/RLS trong Supabase.');
    }
    button.disabled = false;
    button.textContent = previousText;
  } finally {
    deletingEmployeeId = null;
  }
}

function init() {
  if (document.body.dataset.featureEmployeeDelete === '1') return;
  document.body.dataset.featureEmployeeDelete = '1';

  installStyle('feature-employee-delete-style', `
    .employee-delete-action{color:#b91c1c!important;border-color:#fecaca!important}
    .employee-delete-action:hover{background:#fef2f2!important;border-color:#fca5a5!important}
    .employee-delete-action:disabled{opacity:.55;cursor:wait}
  `);

  document.addEventListener('click', (event) => {
    const deleteButton = event.target.closest?.('[data-delete-employee]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      void deleteEmployee(deleteButton);
      return;
    }

    if (event.target.closest?.('[data-view="employees"]')) scheduleEnhance();
  }, true);

  $('#employeeSearch')?.addEventListener('input', scheduleEnhance);
  $('#showInactiveEmployees')?.addEventListener('change', scheduleEnhance);
  document.addEventListener('topping:session-ready', scheduleEnhance);
  document.addEventListener('topping:features-ready', scheduleEnhance);

  scheduleEnhance();
}

init();
