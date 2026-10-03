import { requireSupabase } from '../supabase.js';
import { $, notify, fetchMonthRows, rowQuantity } from './shared.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function shiftName(value){
  return ({ morning:'Ca Sáng', afternoon:'Ca Chiều', evening:'Ca Tối' })[value] || value || '';
}

function getDownloadHost(){
  let host=$('#featureBackupResult');
  if(host)return host;
  const section=$('#featureBackupPanel');
  if(!section)return null;
  host=document.createElement('div');
  host.id='featureBackupResult';
  host.style.marginTop='12px';
  section.appendChild(host);
  return host;
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
  box.innerHTML='<strong>File backup đã tạo xong.</strong><br>';

  const link=document.createElement('a');
  link.href=url;
  link.download=name;
  link.className='feature-btn primary';
  link.style.display='inline-flex';
  link.style.marginTop='10px';
  link.textContent=`⬇ Tải ${name}`;
  box.appendChild(link);
  host.appendChild(box);
  return link;
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

async function restoreJson(file){
  if(!file)return;
  let data;
  try{data=JSON.parse(await file.text())}catch{return alert('File JSON không hợp lệ.')}
  if(!Array.isArray(data.rows))return alert('Backup không có dữ liệu rows.');
  if(!confirm(`Khôi phục ${data.rows.length} dòng? Dữ liệu trùng có thể bị Supabase từ chối.`))return;
  const c=requireSupabase();
  for(const row of data.rows){
    const x=await c.rpc('save_shift',{
      p_shift_id:null,
      p_sales_date:row.sales_date,
      p_shift:row.shift,
      p_employee_id:row.employee_id,
      p_note:row.note||'',
      p_toppings:(row.shift_toppings||[]).map(t=>({topping_type_id:t.topping_type_id,quantity:t.quantity}))
    });
    if(x.error&&!/duplicate|unique/i.test(x.error.message||''))console.error(x.error);
  }
  notify('Đã chạy khôi phục backup.');
  setTimeout(()=>location.reload(),600);
}

function boot(){
  const host=$('#feature-tools-host');
  if(!host||$('#featureBackupPanel'))return;

  const s=document.createElement('section');
  s.className='feature-panel';
  s.id='featureBackupPanel';
  s.innerHTML=`<h3>PDF & Backup</h3><div class="feature-toolbar"><button class="feature-btn" id="featurePdf" type="button">In / PDF</button><button class="feature-btn" id="featureBackupJson" type="button">Backup JSON</button><label>Restore JSON<input id="featureRestoreJson" type="file" accept="application/json,.json"></label></div>`;
  host.appendChild(s);

  $('#featurePdf').addEventListener('click',exportPdf);
  $('#featureBackupJson').addEventListener('click',backupJson);
  $('#featureRestoreJson').addEventListener('change',e=>restoreJson(e.target.files?.[0]));
}

boot();
