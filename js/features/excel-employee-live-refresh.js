import { requireSupabase } from '../supabase.js';

let refreshTimer = null;
let refreshing = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function refreshEmployeeSelect() {
  const select = document.querySelector('#excelEmployee');
  if (!select || refreshing) return;

  refreshing = true;
  const previousValue = select.value;

  try {
    const { data, error } = await requireSupabase()
      .from('employees')
      .select('id,name,active')
      .order('name', { ascending: true });

    if (error) throw error;

    const employees = (data || []).filter((employee) => employee?.id && employee?.name);
    select.innerHTML = '<option value="">-- Chọn nhân viên --</option>' + employees
      .map((employee) => `<option value="${esc(employee.id)}">${esc(employee.name)}${employee.active === false ? ' (đã nghỉ)' : ''}</option>`)
      .join('');

    if (previousValue && employees.some((employee) => String(employee.id) === String(previousValue))) {
      select.value = previousValue;
    }

    select.dataset.loaded = '1';
    select.dataset.lastRefresh = String(Date.now());
  } catch (error) {
    console.error('[Excel] Không làm mới được danh sách nhân viên.', error);
    if (!select.options.length || select.options[0]?.textContent?.includes('Không tải')) {
      select.innerHTML = '<option value="">Không tải được nhân viên</option>';
    }
  } finally {
    refreshing = false;
  }
}

function scheduleRefresh(delay = 200) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshEmployeeSelect();
  }, delay);
}

function installListeners() {
  if (document.documentElement.dataset.excelEmployeeLiveRefresh === '1') return;
  document.documentElement.dataset.excelEmployeeLiveRefresh = '1';

  document.addEventListener('focusin', (event) => {
    if (event.target?.matches?.('#excelEmployee')) {
      void refreshEmployeeSelect();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.target?.matches?.('#excelEmployee')) {
      void refreshEmployeeSelect();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('#saveEmployeeButton')) {
      scheduleRefresh(700);
      scheduleRefresh(1600);
    }

    if (event.target?.closest?.('.nav-link[data-view="tools"]')) {
      scheduleRefresh(150);
    }
  }, true);

  const observer = new MutationObserver((mutations) => {
    if (!document.querySelector('#excelEmployee')) return;
    const employeeTableChanged = mutations.some((mutation) => {
      const target = mutation.target;
      return target?.id === 'employeesBody' || target?.closest?.('#employeesBody');
    });
    if (employeeTableChanged) scheduleRefresh(250);
  });

  const startObserver = () => {
    const body = document.body;
    if (!body) return;
    observer.observe(body, { childList: true, subtree: true });
    scheduleRefresh(100);
  };

  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

  document.addEventListener('topping:features-ready', () => scheduleRefresh(100));
  document.addEventListener('topping:session-ready', () => scheduleRefresh(100));
  window.addEventListener('pageshow', () => scheduleRefresh(100));
}

installListeners();
