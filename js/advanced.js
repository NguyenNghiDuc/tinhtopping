import { requireSupabase } from './supabase.js';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const SHIFT_LABELS = { morning:'Ca Sáng', afternoon:'Ca Chiều', evening:'Ca Tối' };
const todayIso = () => {
  const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const money = n => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
const num = n => new Intl.NumberFormat('vi-VN').format(n);
let role='staff';
let closedDays=new Set();
let deferredInstall=null;

function toast(message){
  const el=$('#toast'); if(!el) return alert(message); el.textContent=message; el.classList.add('show');
  clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),3000);
}

function css(){
  if($('#advanced-style')) return;
  const s=document.createElement('style'); s.id='advanced-style'; s.textContent=`
  .today-dashboard{margin:0 0 22px;padding:18px;border:1px solid #dbe3ef;border-radius:16px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.05)}
  .today-dashboard h2{margin:0 0 4px}.today-dashboard-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.today-card{padding:14px;border-radius:12px;background:#f8fafc}.today-card small{display:block;color:#64748b;margin-bottom:6px}.today-card strong{font-size:20px}.missing-shifts{margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-weight:700}.missing-shifts.ok{background:#ecfdf5;color:#166534}
  .advanced-actions{display:flex;gap:8px;flex-wrap:wrap}.advanced-button{min-height:36px;padding:7px 11px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:700;cursor:pointer}.advanced-button:hover{background:#f8fafc}.advanced-button.danger{color:#b91c1c;border-color:#fecaca}.advanced-button.primary{background:#2563eb;color:white;border-color:#2563eb}.day-lock-button{margin-left:8px}.day-lock-badge{padding:5px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:800}.month-insights{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0}.insight-panel{padding:16px;border:1px solid #dbe3ef;border-radius:14px;background:#fff}.insight-panel h3{margin:0 0 12px}.insight-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #eef2f7}.insight-row:last-child{border-bottom:0}
  .account-dialog{border:0;border-radius:16px;max-width:520px;width:min(92vw,520px);padding:0;box-shadow:0 24px 70px rgba(15,23,42,.24)}.account-dialog::backdrop{background:rgba(15,23,42,.45)}.account-panel{padding:22px}.account-panel h2{margin-top:0}.account-panel label{display:block;margin:12px 0}.account-panel input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px}.login-log-list{max-height:240px;overflow:auto;margin-top:12px}.login-log-item{padding:9px 0;border-bottom:1px solid #e5e7eb;font-size:13px}
  html.dark,html.dark body{background:#0f172a;color:#e5e7eb}html.dark .app-shell,html.dark .main-content{background:#0f172a}html.dark .panel,html.dark .today-dashboard,html.dark .today-card,html.dark .insight-panel,html.dark .day-record-card,html.dark .daily-summary-panel{background:#111827!important;color:#e5e7eb!important;border-color:#334155!important}html.dark input,html.dark select,html.dark textarea,html.dark .advanced-button{background:#1f2937!important;color:#f8fafc!important;border-color:#475569!important}html.dark .muted,html.dark small{color:#94a3b8!important}
  @media(max-width:760px){.today-dashboard-grid{grid-template-columns:1fr 1fr}.month-insights{grid-template-columns:1fr}}
  `; document.head.appendChild(s);
}

async function getRole(){
  try{const c=requireSupabase(); const ses=await c.auth.getSession(); const u=ses.data?.session?.user; if(!u) return;
    const r=await c.from('user_profiles').select('role').eq('user_id',u.id).maybeSingle(); if(!r.error) role=r.data?.role||'staff';
  }catch{}
}

async function fetchRowsForRange(start,end){
  const r=await requireSupabase().from('shifts').select('sales_date,shift,employee_id,employees(name),shift_toppings(quantity)').gte('sales_date',start).lt('sales_date',end).order('sales_date');
  if(r.error) throw r.error; return r.data||[];
}
function qty(row){return (row.shift_toppings||[]).reduce((a,x)=>a+Math.max(0,Number(x.quantity)||0),0)}
function monthBounds(month){const [y,m]=month.split('-').map(Number); const ny=m===12?y+1:y, nm=m===12?1:m+1; return [`${month}-01`,`${ny}-${String(nm).padStart(2,'0')}-01`];}
function prevMonth(month){const [y,m]=month.split('-').map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`;}

async function renderTodayDashboard(){
  const host=$('#view-records .overview-grid')?.parentElement; if(!host) return;
  let panel=$('#todayDashboard'); if(!panel){ panel=document.createElement('section'); panel.id='todayDashboard'; panel.className='today-dashboard'; host.insertBefore(panel,$('#view-records .overview-grid')); }
  try{
    const d=todayIso(); const end=new Date(`${d}T12:00:00`); end.setDate(end.getDate()+1); const endIso=`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
    const rows=await fetchRowsForRange(d,endIso); const total=rows.reduce((a,r)=>a+qty(r),0); const shifts=new Set(rows.map(r=>r.shift)); const missing=Object.keys(SHIFT_LABELS).filter(s=>!shifts.has(s));
    panel.innerHTML=`<div class="advanced-actions" style="justify-content:space-between"><div><h2>Hôm nay</h2><p class="muted">${new Date(`${d}T12:00:00`).toLocaleDateString('vi-VN')}</p></div><div class="advanced-actions"><button class="advanced-button" id="accountButton">Tài khoản</button><button class="advanced-button" id="darkModeButton">🌙 Giao diện</button><button class="advanced-button" id="installAppButton" ${deferredInstall?'':'hidden'}>Cài app</button></div></div><div class="today-dashboard-grid"><div class="today-card"><small>Topping</small><strong>${num(total)}</strong></div><div class="today-card"><small>Doanh thu</small><strong>${money(total*1000)}</strong></div><div class="today-card"><small>Ca đã nhập</small><strong>${shifts.size}/3</strong></div><div class="today-card"><small>Trạng thái ngày</small><strong>${closedDays.has(d)?'Đã chốt':'Đang mở'}</strong></div></div><div class="missing-shifts ${missing.length?'':'ok'}">${missing.length?`Chưa nhập: ${missing.map(x=>SHIFT_LABELS[x]).join(', ')}`:'Đã nhập đủ 3 ca hôm nay.'}</div>`;
    $('#accountButton')?.addEventListener('click',openAccount);
    $('#darkModeButton')?.addEventListener('click',toggleDark);
    $('#installAppButton')?.addEventListener('click',installApp);
  }catch(e){panel.innerHTML='<h2>Hôm nay</h2><p class="muted">Chưa tải được dashboard.</p>'; console.error(e);}
}

async function loadClosedDays(month=$('#recordsMonth')?.value){
  if(!month) return; const [start,end]=monthBounds(month); const r=await requireSupabase().from('closed_days').select('sales_date').gte('sales_date',start).lt('sales_date',end); if(r.error){console.warn('closed_days chưa sẵn sàng',r.error); return;} closedDays=new Set((r.data||[]).map(x=>x.sales_date)); enhanceDayLocks(); renderTodayDashboard();
}
function enhanceDayLocks(){
  $$('.day-record-card[data-date]').forEach(card=>{const date=card.dataset.date; const header=$('.day-record-header',card); if(!header)return; header.querySelectorAll('.day-lock-button,.day-lock-badge').forEach(x=>x.remove());
    if(closedDays.has(date)){const b=document.createElement('span');b.className='day-lock-badge';b.textContent='Đã chốt';header.appendChild(b);}
    if(role==='manager'){const btn=document.createElement('button');btn.type='button';btn.className='advanced-button day-lock-button';btn.dataset.lockDate=date;btn.textContent=closedDays.has(date)?'Mở khóa':'Chốt ngày';header.appendChild(btn);}
    if(role!=='manager'&&closedDays.has(date)){card.querySelectorAll('[data-action="edit"],[data-action="delete"],[data-record-id]').forEach(el=>{el.style.pointerEvents='none'; if(el.matches('button'))el.disabled=true;});}
  });
}
async function toggleDayLock(date){
  const c=requireSupabase(); if(role!=='manager')return; const locked=closedDays.has(date); if(!confirm(locked?'Mở khóa ngày này để cho phép chỉnh sửa?':'Chốt ngày này? Nhân viên sẽ không thể sửa/xóa dữ liệu của ngày đã chốt.'))return;
  const r=locked?await c.from('closed_days').delete().eq('sales_date',date):await c.from('closed_days').insert({sales_date:date}); if(r.error)return alert(r.error.message);
  if(locked)closedDays.delete(date); else closedDays.add(date); enhanceDayLocks(); renderTodayDashboard(); toast(locked?'Đã mở khóa ngày.':'Đã chốt ngày.');
}

async function renderMonthInsights(){
  const stats=$('#view-statistics'); if(!stats)return; let wrap=$('#monthInsights'); if(!wrap){wrap=document.createElement('div');wrap.id='monthInsights';wrap.className='month-insights'; const ov=$('#statisticsOverview'); ov?.after(wrap);} const month=$('#statisticsMonth')?.value; if(!month)return;
  try{const [s,e]=monthBounds(month), pm=prevMonth(month), [ps,pe]=monthBounds(pm); const [cur,prev]=await Promise.all([fetchRowsForRange(s,e),fetchRowsForRange(ps,pe)]); const cq=cur.reduce((a,r)=>a+qty(r),0), pq=prev.reduce((a,r)=>a+qty(r),0); const pct=pq?((cq-pq)/pq*100):null;
    const by={}; cur.forEach(r=>{const name=r.employees?.name||'Không rõ'; by[name]=(by[name]||0)+qty(r)}); const top=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,5);
    wrap.innerHTML=`<section class="insight-panel"><h3>So với tháng trước</h3><div class="insight-row"><span>Topping tháng này</span><strong>${num(cq)}</strong></div><div class="insight-row"><span>Tháng trước</span><strong>${num(pq)}</strong></div><div class="insight-row"><span>Chênh lệch</span><strong>${pct===null?'Chưa có dữ liệu':`${pct>=0?'+':''}${pct.toFixed(1)}%`}</strong></div><div class="insight-row"><span>Doanh thu tháng này</span><strong>${money(cq*1000)}</strong></div><button class="advanced-button primary" id="printMonthReport">In / PDF báo cáo</button></section><section class="insight-panel"><h3>Top nhân viên tháng</h3>${top.length?top.map(([n,q],i)=>`<div class="insight-row"><span>${i+1}. ${n}</span><strong>${num(q)} topping</strong></div>`).join(''):'<p class="muted">Chưa có dữ liệu.</p>'}</section>`;
    $('#printMonthReport')?.addEventListener('click',()=>printMonthReport(month,cur,cq,top));
  }catch(e){console.error(e); wrap.innerHTML='<section class="insight-panel"><p class="muted">Chưa tải được so sánh tháng.</p></section>';}
}
function printMonthReport(month,rows,total,top){
  const w=window.open('','_blank','width=900,height=700'); if(!w)return alert('Trình duyệt đang chặn cửa sổ in.'); const trs=rows.map(r=>`<tr><td>${r.sales_date.split('-').reverse().join('/')}</td><td>${SHIFT_LABELS[r.shift]||r.shift}</td><td>${r.employees?.name||''}</td><td>${qty(r)}</td><td>${money(qty(r)*1000)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Báo cáo ${month}</title><style>body{font-family:Arial;padding:28px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ccc;text-align:left}h1{margin-bottom:4px}</style></head><body><h1>Báo cáo topping tháng ${month}</h1><p>Tổng: <b>${num(total)} topping · ${money(total*1000)}</b></p><h3>Top nhân viên</h3><p>${top.map(([n,q])=>`${n}: ${q}`).join(' · ')||'Chưa có dữ liệu'}</p><table><thead><tr><th>Ngày</th><th>Ca</th><th>Nhân viên</th><th>Topping</th><th>Tiền</th></tr></thead><tbody>${trs}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`); w.document.close();
}

function ensureAccountDialog(){if($('#accountDialog'))return; const d=document.createElement('dialog');d.id='accountDialog';d.className='account-dialog';d.innerHTML=`<div class="account-panel"><div class="advanced-actions" style="justify-content:space-between"><h2>Tài khoản của tôi</h2><button class="advanced-button" id="closeAccount">Đóng</button></div><p id="accountEmail" class="muted"></p><label>Mật khẩu mới<input id="newPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Ít nhất 6 ký tự"></label><button class="advanced-button primary" id="changePassword">Đổi mật khẩu</button><div id="managerLoginLogs" hidden><h3>Nhật ký đăng nhập gần đây</h3><div class="login-log-list" id="loginLogList"></div></div></div>`;document.body.appendChild(d);$('#closeAccount').onclick=()=>d.close();$('#changePassword').onclick=changePassword;}
async function openAccount(){ensureAccountDialog();const c=requireSupabase();const s=await c.auth.getSession();$('#accountEmail').textContent=s.data?.session?.user?.email||'';$('#accountDialog').showModal();if(role==='manager')loadLoginLogs();}
async function changePassword(){const p=$('#newPassword').value;if(p.length<6)return alert('Mật khẩu phải có ít nhất 6 ký tự.');const r=await requireSupabase().auth.updateUser({password:p});if(r.error)return alert(r.error.message);$('#newPassword').value='';toast('Đã đổi mật khẩu.');}
async function logLogin(){try{const c=requireSupabase();const s=await c.auth.getSession();const u=s.data?.session?.user;if(!u)return;const key=`topping:loginLogged:${u.id}:${s.data.session.access_token?.slice(-8)}`;if(sessionStorage.getItem(key))return;await c.from('login_logs').insert({user_id:u.id,user_email:u.email||'',user_agent:navigator.userAgent});sessionStorage.setItem(key,'1');}catch{}}
async function loadLoginLogs(){const box=$('#managerLoginLogs'),list=$('#loginLogList');box.hidden=false;const r=await requireSupabase().from('login_logs').select('user_email,user_agent,created_at').order('created_at',{ascending:false}).limit(30);if(r.error){list.textContent='Chưa dùng được nhật ký đăng nhập. Hãy chạy migration mới.';return;}list.innerHTML=(r.data||[]).map(x=>`<div class="login-log-item"><b>${x.user_email||'Tài khoản'}</b><br>${new Date(x.created_at).toLocaleString('vi-VN')}<br><span class="muted">${(x.user_agent||'').slice(0,120)}</span></div>`).join('')||'Chưa có nhật ký.';}

async function autoBackup(){try{if(role!=='manager')return;const last=Number(localStorage.getItem('topping:lastAutoBackup')||0);if(Date.now()-last<24*3600e3)return;const c=requireSupabase();const [sh,em]=await Promise.all([c.from('shifts').select('*,employees(name),shift_toppings(*)').order('sales_date'),c.from('employees').select('*').order('name')]);if(sh.error||em.error)return;localStorage.setItem('topping:autoBackup',JSON.stringify({created_at:new Date().toISOString(),shifts:sh.data||[],employees:em.data||[]}));localStorage.setItem('topping:lastAutoBackup',String(Date.now()));toast('Đã tạo backup tự động trên thiết bị.');}catch(e){console.warn(e)}}

function toggleDark(){const on=!document.documentElement.classList.contains('dark');document.documentElement.classList.toggle('dark',on);localStorage.setItem('topping:dark',on?'1':'0');}
function restoreDark(){document.documentElement.classList.toggle('dark',localStorage.getItem('topping:dark')==='1');}
function installApp(){if(!deferredInstall)return;deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;renderTodayDashboard();});}
function shortcuts(){document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){const btn=$('#saveShiftButton');if(btn&&!$('#shiftEditor')?.hidden){e.preventDefault();btn.click();}} if(e.key==='Enter'&&e.target.matches?.('[data-batch-quantity]')){e.preventDefault();const xs=$$('[data-batch-quantity]');const i=xs.indexOf(e.target);xs[i+1]?.focus();xs[i+1]?.select();}});}

function observers(){
  const rec=$('#recordsBody'); if(rec)new MutationObserver(()=>enhanceDayLocks()).observe(rec,{childList:true,subtree:true});
  $('#recordsMonth')?.addEventListener('change',()=>loadClosedDays()); $('#statisticsMonth')?.addEventListener('change',()=>renderMonthInsights());
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-lock-date]');if(b){e.preventDefault();e.stopPropagation();toggleDayLock(b.dataset.lockDate);}},true);
  const app=$('#application');if(app)new MutationObserver(()=>{if(!app.hidden){setTimeout(()=>{getRole().then(()=>{loadClosedDays();renderTodayDashboard();renderMonthInsights();logLogin();autoBackup();});},250)}}).observe(app,{attributes:true,attributeFilter:['hidden']});
}

async function boot(){css();restoreDark();shortcuts();observers();ensureAccountDialog();await getRole();await loadClosedDays();await renderTodayDashboard();await renderMonthInsights();await logLogin();await autoBackup(); if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;renderTodayDashboard();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
