import { requireSupabase } from '../supabase.js';
import { $, notify } from './shared.js';

const SHIFT_LABELS = {
  morning: 'Ca Sáng',
  afternoon: 'Ca Chiều',
  evening: 'Ca Tối'
};

const PAGE_SIZE = 500;
const IN_CHUNK_SIZE = 100;

function escXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getLocalMonthValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateVi(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatMonthVi(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : String(value || '');
}

function monthBounds(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return [`${month}-01`, `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`];
}

function resolveExportMonth() {
  const explicit = $('#excelExportMonth')?.value || $('#recordsMonth')?.value || getLocalMonthValue();
  if ($('#excelExportMonth')) $('#excelExportMonth').value = explicit;
  return explicit;
}

function setExportStatus(message, tone = 'info') {
  const status = $('#excelExportStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
}

function chunk(list, size) {
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result;
}

async function fetchPaged(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const result = await makeQuery().range(from, to);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchByChunks(ids, buildQuery) {
  if (!ids.length) return [];
  const all = [];
  for (const idChunk of chunk(ids, IN_CHUNK_SIZE)) {
    const rows = await fetchPaged(() => buildQuery(idChunk));
    all.push(...rows);
  }
  return all;
}

async function loadExcelRows(month) {
  const client = requireSupabase();
  const [start, end] = monthBounds(month);

  const shifts = await fetchPaged(() => client
    .from('shifts')
    .select('id,sales_date,shift,employee_id,note')
    .gte('sales_date', start)
    .lt('sales_date', end)
    .order('sales_date', { ascending: true })
    .order('shift', { ascending: true })
    .order('id', { ascending: true }));

  if (!shifts.length) return [];

  const employeeIds = [...new Set(shifts.map((row) => row.employee_id).filter(Boolean))];
  const shiftIds = shifts.map((row) => row.id).filter(Boolean);

  const employees = await fetchByChunks(
    employeeIds,
    (ids) => client.from('employees').select('id,name').in('id', ids).order('name', { ascending: true })
  );

  const toppings = await fetchByChunks(
    shiftIds,
    (ids) => client.from('shift_toppings').select('shift_id,quantity').in('shift_id', ids).order('shift_id', { ascending: true })
  );

  const employeeMap = new Map(employees.map((row) => [row.id, row.name]));
  const quantityMap = new Map();
  toppings.forEach((row) => {
    const current = quantityMap.get(row.shift_id) || 0;
    quantityMap.set(row.shift_id, current + Math.max(0, Number(row.quantity) || 0));
  });

  return shifts.map((row) => {
    const quantity = quantityMap.get(row.id) || 0;
    return {
      date: row.sales_date,
      shift: SHIFT_LABELS[row.shift] || row.shift || '',
      employee: employeeMap.get(row.employee_id) || '',
      quantity,
      money: quantity * 1000,
      note: row.note || ''
    };
  });
}

function buildExcelXml(rows, month) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMoney = rows.reduce((sum, row) => sum + row.money, 0);
  const exportedAt = formatDateVi(getLocalDateValue());

  const dataRows = rows.map((row) => `
    <Row>
      <Cell ss:StyleID="date"><Data ss:Type="String">${escXml(formatDateVi(row.date))}</Data></Cell>
      <Cell><Data ss:Type="String">${escXml(row.shift)}</Data></Cell>
      <Cell><Data ss:Type="String">${escXml(row.employee)}</Data></Cell>
      <Cell ss:StyleID="number"><Data ss:Type="Number">${Number(row.quantity) || 0}</Data></Cell>
      <Cell ss:StyleID="money"><Data ss:Type="Number">${Number(row.money) || 0}</Data></Cell>
      <Cell><Data ss:Type="String">${escXml(row.note)}</Data></Cell>
    </Row>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="date"><Alignment ss:Horizontal="Center"/></Style>
  <Style ss:ID="number"><NumberFormat ss:Format="0"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="#,##0"/></Style>
  <Style ss:ID="total"><Font ss:Bold="1"/><Interior ss:Color="#E2F0D9" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Topping ${escXml(formatMonthVi(month))}">
  <Table>
   <Column ss:Width="85"/><Column ss:Width="85"/><Column ss:Width="150"/><Column ss:Width="70"/><Column ss:Width="100"/><Column ss:Width="220"/>
   <Row><Cell ss:MergeAcross="5" ss:StyleID="title"><Data ss:Type="String">BÁO CÁO TOPPING THÁNG ${escXml(formatMonthVi(month))}</Data></Cell></Row>
   <Row><Cell ss:MergeAcross="5"><Data ss:Type="String">Ngày xuất: ${escXml(exportedAt)}</Data></Cell></Row>
   <Row>
    <Cell ss:StyleID="header"><Data ss:Type="String">Ngày</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">Ca</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">Nhân viên</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">Topping</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">Tiền</Data></Cell>
    <Cell ss:StyleID="header"><Data ss:Type="String">Ghi chú</Data></Cell>
   </Row>
   ${dataRows}
   <Row>
    <Cell ss:MergeAcross="2" ss:StyleID="total"><Data ss:Type="String">Tổng cộng</Data></Cell>
    <Cell ss:StyleID="total"><Data ss:Type="Number">${totalQuantity}</Data></Cell>
    <Cell ss:StyleID="total"><Data ss:Type="Number">${totalMoney}</Data></Cell>
    <Cell ss:StyleID="total"><Data ss:Type="String"></Data></Cell>
   </Row>
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane></WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

function getResultHost() {
  let host = $('#excelExportResult');
  if (host) return host;
  const panel = $('#excelExportPanel');
  if (!panel) return null;
  host = document.createElement('div');
  host.id = 'excelExportResult';
  host.style.marginTop = '12px';
  panel.appendChild(host);
  return host;
}

function renderDownloadButton(filename, blob) {
  const host = getResultHost();
  if (!host) throw new Error('Không tìm thấy vùng tải file Excel.');

  const previousUrl = host.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;
  host.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'feature-warning feature-ok';
  box.innerHTML = '<strong>File Excel đã tạo xong.</strong><br><span>Bấm nút bên dưới nếu trình duyệt chưa tự tải.</span><br>';

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.className = 'feature-btn primary';
  link.style.display = 'inline-flex';
  link.style.marginTop = '10px';
  link.textContent = `⬇ Tải ${filename}`;
  link.addEventListener('click', () => notify(`Đang tải ${filename}...`));

  box.appendChild(link);
  host.appendChild(box);
  return link;
}

async function exportExcel() {
  const button = $('#featureExcel');
  if (!button) return;

  const month = resolveExportMonth();
  const exportDate = getLocalDateValue();
  const filename = `topping-${exportDate}.xls`;
  const oldText = button.textContent;

  button.disabled = true;
  button.textContent = 'Đang tạo Excel...';
  setExportStatus(`Đang lấy dữ liệu tháng ${formatMonthVi(month)}...`, 'info');

  try {
    console.info('[Excel] Bắt đầu xuất tháng', month);
    const rows = await loadExcelRows(month);
    console.info('[Excel] Số dòng lấy được', rows.length);

    if (!rows.length) {
      const message = `Tháng ${formatMonthVi(month)} chưa có dữ liệu để xuất.`;
      setExportStatus(message, 'warning');
      notify(message);
      return;
    }

    const xml = buildExcelXml(rows, month);
    const blob = new Blob(['\ufeff', xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = renderDownloadButton(filename, blob);

    try {
      link.click();
    } catch (error) {
      console.warn('[Excel] Tải tự động bị chặn. Dùng nút tải thủ công.', error);
    }

    setExportStatus(`Đã tạo Excel ${filename}. Dữ liệu ngày hiển thị theo định dạng dd/mm/yyyy.`, 'success');
    notify(`Đã tạo ${filename}.`);
  } catch (error) {
    console.error('[Excel] Xuất file thất bại.', error);
    const message = error?.message || 'Lỗi không xác định';
    const host = getResultHost();
    if (host) host.innerHTML = `<div class="feature-warning"><strong>Xuất Excel lỗi:</strong> ${escXml(message)}</div>`;
    setExportStatus(`Xuất Excel lỗi: ${message}`, 'error');
    notify(`Xuất Excel lỗi: ${message}`);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function boot() {
  const host = $('#feature-tools-host');
  if (!host || $('#excelExportPanel')) return;

  const panel = document.createElement('section');
  panel.className = 'feature-panel';
  panel.id = 'excelExportPanel';
  panel.innerHTML = `
    <h3>Xuất Excel</h3>
    <p class="muted">Chọn tháng cần xuất. File Excel có cột Ngày theo định dạng dd/mm/yyyy và tên file có ngày-tháng-năm xuất.</p>
    <div class="feature-toolbar">
      <label class="field-label" for="excelExportMonth">Tháng
        <input id="excelExportMonth" type="month" value="${getLocalMonthValue()}">
      </label>
      <button class="feature-btn primary" id="featureExcel" type="button">Xuất Excel</button>
    </div>
    <div id="excelExportStatus" class="feature-status" hidden></div>
  `;
  host.prepend(panel);
  $('#featureExcel').addEventListener('click', () => void exportExcel());
}

boot();
