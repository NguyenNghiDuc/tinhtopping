import { requireSupabase } from '../supabase.js';
import { $, notify, fetchMonthRows, rowQuantity } from './shared.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function isIOSLike(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function download(name,blob){
  // iPhone/iPad và một số trình duyệt trong app không xử lý tốt thẻ a[download].
  // Nếu hỗ trợ chia sẻ file, mở Share Sheet để người dùng chọn "Lưu vào Tệp".
  if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('Không thể chia sẻ file, chuyển sang cách tải truyền thống.', error);
    }
  }

  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Safari cần giữ Blob URL sống lâu hơn một nhịp để bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(u), 3000);

  // WebView iOS có thể bỏ qua thuộc tính download. Khi đó mở file ở tab mới để vẫn lấy được file.
  if (isIOSLike()) {
    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        const previewUrl = URL.createObjectURL(blob);
        const opened = window.open(previewUrl, '_blank');
        if (opened) setTimeout(() => URL.revokeObjectURL(previewUrl), 15000);
      }
    }, 500);
  }
}

function shiftName(value){
  return ({ morning:'Ca Sáng', afternoon:'Ca Chiều', evening:'Ca Tối' })[value] || value || '';
}

function excelHtml(rows, month){
  const totalToppings = rows.reduce((sum,row)=>sum+rowQuantity(row),0);
  const totalMoney = totalToppings * 1000;
  const body = rows.map(r=>`<tr><td>${esc(r.sales_date)}</td><td>${esc(shiftName(r.shift))}</td><td>${esc(r.employees?.name||'')}</td><td style="mso-number-format:'0'">${rowQuantity(r)}</td><td style="mso-number-format:'#,##0'">${rowQuantity(r)*1000}</td><td>${esc(r.note||'')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{font-weight:700;background:#eef2ff}</style></head><body><table><tr><th colspan="6">BÁO CÁO TOPPING THÁNG ${esc(month)}</th></tr><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th><th>Ghi chú</th></tr>${body}<tr><th colspan="3">Tổng cộng</th><th>${totalToppings}</th><th>${totalMoney}</th><th></th></tr></table></body></html>`;
}

async function exportExcel(){
  const button = $('#featureExcel');
  const oldText = button?.textContent || 'Xuất Excel';
  if (button) { button.disabled = true; button.textContent = 'Đang xuất...'; }
  try {
    const month = $('#recordsMonth')?.value || new Date().toISOString().slice(0,7);
    const rows = await fetchMonthRows(month);
    if (!rows.length) {
      notify(`Tháng ${month} chưa có dữ liệu để xuất.`);
      return;
    }
    const html = excelHtml(rows, month);
    const blob = new Blob(['\ufeff', html], { type:'application/vnd.ms-excel;charset=utf-8' });
    await download(`topping-${month}.xls`, blob);
    notify('Đã tạo file Excel. Trên iPhone hãy chọn “Lưu vào Tệp” nếu Share Sheet hiện ra.');
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
    await download(`backup-topping-${month}.json`,new Blob([JSON.stringify({version:1,month,created_at:new Date().toISOString(),rows},null,2)],{type:'application/json'}));
    notify('Đã backup JSON.');
  } catch (error) {
    console.error('Backup JSON thất bại.', error);
    notify(error?.message ? `Backup lỗi: ${error.message}` : 'Không thể backup JSON.');
  }
}

async function restoreJson(file){if(!file)return;let data;try{data=JSON.parse(await file.text())}catch{return alert('File JSON không hợp lệ.')}if(!Array.isArray(data.rows))return alert('Backup không có dữ liệu rows.');if(!confirm(`Khôi phục ${data.rows.length} dòng? Dữ liệu trùng có thể bị Supabase từ chối.`))return;const c=requireSupabase();for(const row of data.rows){const x=await c.rpc('save_shift',{p_shift_id:null,p_sales_date:row.sales_date,p_shift:row.shift,p_employee_id:row.employee_id,p_note:row.note||'',p_toppings:(row.shift_toppings||[]).map(t=>({topping_type_id:t.topping_type_id,quantity:t.quantity}))});if(x.error&&!/duplicate|unique/i.test(x.error.message||'')){console.error(x.error)}}notify('Đã chạy khôi phục backup.');setTimeout(()=>location.reload(),600)}

function boot(){const host=$('#feature-tools-host');if(!host||host.dataset.exportReady==='1')return;host.dataset.exportReady='1';const s=document.createElement('section');s.className='feature-panel';s.innerHTML=`<h3>Xuất & Backup</h3><div class="feature-toolbar"><button class="feature-btn" id="featureExcel" type="button">Xuất Excel</button><button class="feature-btn" id="featurePdf" type="button">In / PDF</button><button class="feature-btn" id="featureBackupJson" type="button">Backup JSON</button><label>Restore JSON<input id="featureRestoreJson" type="file" accept="application/json,.json"></label></div>`;host.appendChild(s);$('#featureExcel').onclick=exportExcel;$('#featurePdf').onclick=exportPdf;$('#featureBackupJson').onclick=backupJson;$('#featureRestoreJson').onchange=e=>restoreJson(e.target.files?.[0])}
boot();
