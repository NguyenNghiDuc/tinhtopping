import { $, fetchMonthRows, rowQuantity, notify } from './shared.js';

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function backupCurrentMonthCsv(button) {
  const month = $('#recordsMonth')?.value;
  if (!month) return window.alert('Chọn tháng cần backup.');
  button.disabled = true;
  try {
    const rows = await fetchMonthRows(month);
    const lines = [['id','ngay','ca','nhan_vien','employee_id','topping','tien','ghi_chu'].map(csvCell).join(',')];
    rows.forEach((row) => {
      const quantity = rowQuantity(row);
      lines.push([row.id,row.sales_date,row.shift,row.employees?.name || '',row.employee_id,quantity,quantity * 1000,row.note || ''].map(csvCell).join(','));
    });
    const blob = new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-topping-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Đã backup ${rows.length} dòng dữ liệu tháng ${month}.`);
  } catch (error) {
    window.alert(error?.message || 'Không backup được dữ liệu.');
  } finally {
    button.disabled = false;
  }
}

function init() {
  if (document.body.dataset.featureBackupCsv === '1') return;
  document.body.dataset.featureBackupCsv = '1';
  const toolbar = $('#view-records .toolbar-actions');
  if (!toolbar || $('#backupCsvButton')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'backupCsvButton';
  button.className = 'advanced-toolbar-button manager-only';
  button.textContent = 'Backup CSV';
  button.addEventListener('click', () => void backupCurrentMonthCsv(button));
  toolbar.insertBefore(button, $('#addShiftButton'));
}

init();
