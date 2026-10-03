import { requireSupabase } from '../supabase.js';
import { $, notify, fetchMonthRows, rowQuantity } from './shared.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function isIOSLike(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function shiftName(value){
  return ({ morning:'Ca Sáng', afternoon:'Ca Chiều', evening:'Ca Tối' })[value] || value || '';
}

function excelHtml(rows, month){
  const totalToppings = rows.reduce((sum,row)=>sum+rowQuantity(row),0);
  const totalMoney = totalToppings * 1000;
  const body = rows.map(r=>`<tr><td>${esc(r.sales_date)}</td><td>${esc(shiftName(r.shift))}</td><td>${esc(r.employees?.name||'')}</td><td>${rowQuantity(r)}</td><td>${rowQuantity(r)*1000}</td><td>${esc(r.note||'')}</td></tr>`).join('');
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:6px}th{font-weight:700;background:#eef2ff}</style></head><body><table><tr><th colspan="6">BÁO CÁO TOPPING THÁNG ${esc(month)}</th></tr><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th><th>Ghi chú</th></tr>${body}<tr><th colspan="3">Tổng cộng</th><th>${totalToppings}</th><th>${totalMoney}</th><th></th></tr></table></body></html>`;
}

function getDownloadHost(){
  let host=$('#featureExportResult');
  if(host)return host;
  const section=$('#featureExcel')?.closest('.feature-panel');
  if(!section)return null;
  host=document.createElement('div');
  host.id='featureExportResult';
  host.style.marginTop='12px';
  section.appendChild(host);
  return host;
}

function clearOldDownload(){
  const host=getDownloadHost();
  if(!host)return;
  const old=host.dataset.objectUrl;
  if(old)URL.revokeObjectURL(old);
  host.dataset.objectUrl='';
  host.innerHTML='';
}

function renderDownloadLink(name,blob){
  const host=getDownloadHost();
  if(!host)return null;
  const old=host.dataset.objectUrl;
  if(old)URL.revokeObjectURL(old);
  const url=URL.createObjectURL(blob);
  host.dataset.objectUrl=url;
  host.innerHTML='';

  const box=document.createElement('div');
  box.className='feature-warning feature-ok';
  box.innerHTML='<strong>File Excel đã tạo xong.</strong><br><span>Bấm nút dưới đây để tải file.</span><br>';

  const link=document.createElement('a');
  link.href=url;
  link.download=name;
  link.className='feature-btn primary';
  link.style.display='inline-flex';
  link.style.marginTop='10px';
  link.textContent=`⬇ Tải ${name}`;
  link.addEventListener('click',()=>{
    notify(`Đang tải ${name}...`);
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  },{once:true});

  box.appendChild(link);
  host.appendChild(box);
  return link;
}

async function tryShareFile(name,blob){
  if(!isIOSLike() || typeof File==='undefined' || !navigator.share || !navigator.canShare)return false;
  try{
    const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
    if(!navigator.canShare({files:[file]}))return false;
    await navigator.share({files:[file],title:name});
    return true;
  }catch(error){
    if(error?.name==='AbortError')return true;
    console.warn('Share Sheet không dùng được.',error);
    return false;
  }
}

async function exportExcel(){
  const button=$('#featureExcel');
  const oldText=button?.textContent||'Xuất Excel';
  const month=$('#recordsMonth')?.value||new Date().toISOString().slice(0,7);
  const name=`topping-${month}.xls`;

  clearOldDownload();
  if(button){button.disabled=true;button.textContent='Đang tạo file...';}

  try{
    const rows=await fetchMonthRows(month);
    if(!rows.length){
      notify(`Tháng ${month} chưa có dữ liệu để xuất.`);
      return;
    }

    const blob=new Blob(['\ufeff',excelHtml(rows,month)],{type:'application/vnd.ms-excel;charset=utf-8'});

    // Luôn tạo nút tải thật trên giao diện. Đây là cách ổn định nhất trên Chrome,
    // Codespaces, Vercel, Safari và WebView vì lần bấm tải thứ hai là user gesture thật.
    const link=renderDownloadLink(name,blob);
    if(!link)throw new Error('Không tạo được nút tải file.');

    // iPhone/iPad: nếu Share Sheet hoạt động thì mở luôn. Nếu không, nút tải vẫn còn bên dưới.
    const shared=await tryShareFile(name,blob);
    if(shared){
      notify('File Excel đã tạo. Nếu cần tải lại, dùng nút Tải Excel bên dưới.');
      return;
    }

    // Desktop: thử click tự động. Nếu trình duyệt chặn, người dùng chỉ cần bấm nút tải hiện ra.
    try{link.click();}catch(error){console.warn('Tải tự động bị chặn.',error);}
    notify('File Excel đã tạo. Nếu chưa tải xuống, bấm nút “Tải topping...” vừa hiện.');
  }catch(error){
    console.error('Xuất Excel thất bại.',error);
    notify(error?.message?`Xuất Excel lỗi: ${error.message}`:'Không thể xuất Excel.');
  }finally{
    if(button){button.disabled=false;button.textContent=oldText;}
  }
}

async function exportPdf(){
  try{
    const month=$('#recordsMonth')?.value||new Date().toISOString().slice(0,7),rows=await fetchMonthRows(month),w=window.open('','_blank','width=950,height=720');
    if(!w)return alert('Trình duyệt đang chặn cửa sổ in.');
    w.document.write(`<html><head><meta charset="utf-8"><title>Báo cáo ${month}</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:7px}</style></head><body><h1>Báo cáo topping ${month}</h1><table><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th></tr>${rows.map(r=>`<tr><td>${r.sales_date}</td><td>${esc(shiftName(r.shift))}</td><td>${esc(r.employees?.name||'')}</td><td>${rowQuantity(r)}</td><td>${rowQuantity(r)*1000}</td></tr>`).join('')}</table><script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }catch(error){
    console.error('Xuất PDF thất bại.',error);
    notify(error?.message?`Xuất PDF lỗi: ${error.message}`:'Không thể xuất PDF.');
  }
}

async function backupJson(){
  try{
    const month=$('#recordsMonth')?.value||new Date().toISOString().slice(0,7),rows=await fetchMonthRows(month);
    const blob=new Blob([JSON.stringify({version:1,month,created_at:new Date().toISOString(),rows},null,2)],{type:'application/json'});
    const name=`backup-topping-${month}.json`;
    const link=renderDownloadLink(name,blob);
    if(link)link.click();
    notify('Đã tạo backup JSON. Nếu chưa tự tải, bấm nút tải vừa hiện.');
  }catch(error){
    console.error('Backup JSON thất bại.',error);
    notify(error?.message?`Backup lỗi: ${error.message}`:'Không thể backup JSON.');
  }
}

async function restoreJson(file){if(!file)return;let data;try{data=JSON.parse(await file.text())}catch{return alert('File JSON không hợp lệ.')}if(!Array.isArray(data.rows))return alert('Backup không có dữ liệu rows.');if(!confirm(`Khôi phục ${data.rows.length} dòng? Dữ liệu trùng có thể bị Supabase từ chối.`))return;const c=requireSupabase();for(const row of data.rows){const x=await c.rpc('save_shift',{p_shift_id:null,p_sales_date:row.sales_date,p_shift:row.shift,p_employee_id:row.employee_id,p_note:row.note||'',p_toppings:(row.shift_toppings||[]).map(t=>({topping_type_id:t.topping_type_id,quantity:t.quantity}))});if(x.error&&!/duplicate|unique/i.test(x.error.message||'')){console.error(x.error)}}notify('Đã chạy khôi phục backup.');setTimeout(()=>location.reload(),600)}

function boot(){
  const host=$('#feature-tools-host');
  if(!host||host.dataset.exportReady==='1')return;
  host.dataset.exportReady='1';
  const s=document.createElement('section');
  s.className='feature-panel';
  s.innerHTML=`<h3>Xuất & Backup</h3><div class="feature-toolbar"><button class="feature-btn" id="featureExcel" type="button">Xuất Excel</button><button class="feature-btn" id="featurePdf" type="button">In / PDF</button><button class="feature-btn" id="featureBackupJson" type="button">Backup JSON</button><label>Restore JSON<input id="featureRestoreJson" type="file" accept="application/json,.json"></label></div>`;
  host.appendChild(s);
  $('#featureExcel').addEventListener('click',exportExcel);
  $('#featurePdf').addEventListener('click',exportPdf);
  $('#featureBackupJson').addEventListener('click',backupJson);
  $('#featureRestoreJson').addEventListener('change',e=>restoreJson(e.target.files?.[0]));
}

boot();
