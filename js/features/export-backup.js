import { requireSupabase } from '../supabase.js';
import { $, notify, fetchMonthRows, rowQuantity } from './shared.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function isIOSLike(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function ensureDownloadFallbackHost(){
  let host = $('#featureDownloadFallback');
  if (host) return host;
  const tools = $('#feature-tools-host');
  if (!tools) return null;
  host = document.createElement('div');
  host.id = 'featureDownloadFallback';
  host.style.marginTop = '10px';
  tools.prepend(host);
  return host;
}

function showManualDownload(name, blob){
  const host = ensureDownloadFallbackHost();
  if (!host) return;
  const oldUrl = host.dataset.objectUrl;
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  const url = URL.createObjectURL(blob);
  host.dataset.objectUrl = url;
  host.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'feature-warning feature-ok';
  box.innerHTML = '<strong>File đã tạo xong.</strong> Nếu trình duyệt không tự tải, bấm nút bên dưới.';
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.className = 'feature-btn primary';
  link.style.display = 'inline-flex';
  link.style.marginTop = '8px';
  link.textContent = `Tải ${name}`;
  box.appendChild(document.createElement('br'));
  box.appendChild(link);
  host.appendChild(box);
}

async function saveBlob(name, blob){
  if (isIOSLike() && typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return { method: 'share' };
      }
    } catch (error) {
      if (error?.name === 'AbortError') return { method: 'cancelled' };
      console.warn('Không thể chia sẻ file, chuyển sang tải truyền thống.', error);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Luôn hiện link tải dự phòng vì Codespaces/WebView/Safari có thể chặn click tự động.
  showManualDownload(name, blob);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { method: 'anchor' };
}

function shiftName(value){
  return ({ morning:'Ca Sáng', afternoon:'Ca Chiều', evening:'Ca Tối' })[value] || value || '';
}

function excelHtml(rows, month){
  const totalToppings = rows.reduce((sum,row)=>sum+rowQuantity(row),0);
  const totalMoney = totalToppings * 1000;
  const body = rows.map(r=>`<tr><td>${esc(r.sales_date)}</td><td>${esc(shiftName(r.shift))}</td><td>${esc(r.employees?.name||'')}</td><td style="mso-number-format:'0'">${rowQuantity(r)}</td><td style="mso-number-format:'#,##0'">${rowQuantity(r)*1000}</td><td>${esc(r.note||'')}</td></tr>`).join('');
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{font-weight:700;background:#eef2ff}</style></head><body><table><tr><th colspan="6">BÁO CÁO TOPPING THÁNG ${esc(month)}</th></tr><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th><th>Ghi chú</th></tr>${body}<tr><th colspan="3">Tổng cộng</th><th>${totalToppings}</th><th>${totalMoney}</th><th></th></tr></table></body></html>`;
}

async function exportExcel(){
  const button = $('#featureExcel');
  const oldText = button?.textContent || 'Xuất Excel';
  const month = $('#recordsMonth')?.value || new Date().toISOString().slice(0,7);
  const name = `topping-${month}.xls`;

  // Chrome/Edge desktop: gọi Save Picker ngay trong click để không mất user activation.
  let fileHandlePromise = null;
  if (window.isSecureContext && typeof window.showSaveFilePicker === 'function') {
    try {
      fileHandlePromise = window.showSaveFilePicker({
        suggestedName: name,
        types: [{
          description: 'Excel 97-2003',
          accept: { 'application/vnd.ms-excel': ['.xls'] }
        }]
      });
    } catch (error) {
      console.warn('Không mở được hộp thoại lưu file.', error);
    }
  }

  if (button) { button.disabled = true; button.textContent = 'Đang xuất...'; }
  try {
    const rows = await fetchMonthRows(month);
    if (!rows.length) {
      notify(`Tháng ${month} chưa có dữ liệu để xuất.`);
      return;
    }

    const html = excelHtml(rows, month);
    const blob = new Blob(['\ufeff', html], { type:'application/vnd.ms-excel;charset=utf-8' });

    if (fileHandlePromise) {
      try {
        const handle = await fileHandlePromise;
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        notify(`Đã lưu ${name}.`);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          notify('Bạn đã hủy lưu file Excel.');
          return;
        }
        console.warn('Save Picker thất bại, chuyển sang tải dự phòng.', error);
      }
    }

    const result = await saveBlob(name, blob);
    if (result.method !== 'cancelled') notify('Đã tạo file Excel. Nếu chưa tự tải, bấm nút “Tải topping...” vừa hiện.');
  } catch (error) {
    console.error('Xuất Excel thất bại.', error);
    notify(error?.message ? `Xuất Excel lỗi: ${error.message}` : 'Không thể xuất Excel.');
  } finally {
    if (button) { button.disabled = false; button.textContent = oldText; }
  }
}

async function exportPdf(){
  try {
    const month=$('#recordsMonth')?.value||new Date().toISOString().slice(0,7),rows=await fetchMonthRows(month),w=window.open('','_blank','width=950,height=720');
    if(!w)return alert('Trình duyệt đang chặn cửa sổ in.');
    w.document.write(`<html><head><meta charset="utf-8"><title>Báo cáo ${month}</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:7px}</style></head><body><h1>Báo cáo topping ${month}</h1><table><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th></tr>${rows.map(r=>`<tr><td>${r.sales_date}</td><td>${esc(shiftName(r.shift))}</td><td>${esc(r.employees?.name||'')}</td><td>${rowQuantity(r)}</td><td>${rowQuantity(r)*1000}</td></tr>`).join('')}</table><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  } catch (error) {
    console.error('Xuất PDF thất bại.', error);
    notify(error?.message ? `Xuất PDF lỗi: ${error.message}` : 'Không thể xuất PDF.');
  }
}

async function backupJson(){
  try {
    const month=$('#recordsMonth')?.value||new Date().toISOString().slice(0,7),rows=await fetchMonthRows(month);
    const blob=new Blob([JSON.stringify({version:1,month,created_at:new Date().toISOString(),rows},null,2)],{type:'application/json'});
    await saveBlob(`backup-topping-${month}.json`,blob);
    notify('Đã tạo backup JSON.');
  } catch (error) {
    console.error('Backup JSON thất bại.', error);
    notify(error?.message ? `Backup lỗi: ${error.message}` : 'Không thể backup JSON.');
  }
}

async function restoreJson(file){if(!file)return;let data;try{data=JSON.parse(await file.text())}catch{return alert('File JSON không hợp lệ.')}if(!Array.isArray(data.rows))return alert('Backup không có dữ liệu rows.');if(!confirm(`Khôi phục ${data.rows.length} dòng? Dữ liệu trùng có thể bị Supabase từ chối.`))return;const c=requireSupabase();for(const row of data.rows){const x=await c.rpc('save_shift',{p_shift_id:null,p_sales_date:row.sales_date,p_shift:row.shift,p_employee_id:row.employee_id,p_note:row.note||'',p_toppings:(row.shift_toppings||[]).map(t=>({topping_type_id:t.topping_type_id,quantity:t.quantity}))});if(x.error&&!/duplicate|unique/i.test(x.error.message||'')){console.error(x.error)}}notify('Đã chạy khôi phục backup.');setTimeout(()=>location.reload(),600)}

function boot(){const host=$('#feature-tools-host');if(!host||host.dataset.exportReady==='1')return;host.dataset.exportReady='1';const s=document.createElement('section');s.className='feature-panel';s.innerHTML=`<h3>Xuất & Backup</h3><div class="feature-toolbar"><button class="feature-btn" id="featureExcel" type="button">Xuất Excel</button><button class="feature-btn" id="featurePdf" type="button">In / PDF</button><button class="feature-btn" id="featureBackupJson" type="button">Backup JSON</button><label>Restore JSON<input id="featureRestoreJson" type="file" accept="application/json,.json"></label></div>`;host.appendChild(s);$('#featureExcel').onclick=exportExcel;$('#featurePdf').onclick=exportPdf;$('#featureBackupJson').onclick=backupJson;$('#featureRestoreJson').onchange=e=>restoreJson(e.target.files?.[0])}
boot();
