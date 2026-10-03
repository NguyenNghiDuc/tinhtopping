import { $, installStyle } from './shared.js';

const NAV_ITEMS = [
  ['dashboard','Tổng quan'],
  ['tools','Công cụ'],
  ['settings','Cài đặt']
];

function ensureShell(){
  if (document.body.dataset.featureShell === '1') return;
  document.body.dataset.featureShell = '1';
  installStyle('feature-shell-style', `
    .feature-view{display:none}.feature-view.active{display:block}
    .feature-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .feature-card{background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:16px;box-shadow:0 6px 20px rgba(15,23,42,.04)}
    .feature-card h3{margin:0 0 10px}.feature-card small{color:#64748b}.feature-card strong{display:block;margin-top:5px;font-size:22px}
    .feature-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.feature-toolbar label{display:grid;gap:5px;font-size:12px;font-weight:700;color:#64748b}
    .feature-toolbar input,.feature-toolbar select,.feature-toolbar textarea{min-height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#fff}
    .feature-btn{min-height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;background:#fff;font-weight:700;cursor:pointer}.feature-btn.primary{background:#2563eb;color:#fff;border-color:#2563eb}.feature-btn.danger{color:#b91c1c;border-color:#fecaca}
    .feature-panel{margin-top:14px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:16px}.feature-panel h2,.feature-panel h3{margin-top:0}
    .feature-table{width:100%;border-collapse:collapse}.feature-table th,.feature-table td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left}.feature-table .num{text-align:right}
    .feature-warning{padding:10px;border-radius:9px;background:#fff7ed;color:#9a3412;margin:7px 0}.feature-ok{background:#ecfdf5;color:#166534}
    @media(max-width:800px){.feature-grid{grid-template-columns:1fr 1fr}.feature-toolbar>*{flex:1 1 140px}.feature-btn{min-height:44px}.feature-card{padding:13px}}
    @media(max-width:520px){.feature-grid{grid-template-columns:1fr}.main-content{padding-left:12px!important;padding-right:12px!important}.feature-toolbar>*{flex:1 1 100%}}
  `);
  const nav = $('.main-nav');
  const main = $('.main-content');
  if (!nav || !main) return;
  NAV_ITEMS.forEach(([id,label]) => {
    if (!nav.querySelector(`[data-view="${id}"]`)) {
      const b=document.createElement('button'); b.type='button'; b.className='nav-link manager-only'; b.dataset.view=id; b.hidden=false; b.textContent=label; nav.appendChild(b);
    }
    if (!document.getElementById(`view-${id}`)) {
      const s=document.createElement('section'); s.id=`view-${id}`; s.className='view feature-view'; s.hidden=true; s.innerHTML=`<div class="toolbar section-gap"><div><h2>${label}</h2><p class="muted">Các chức năng được tách module riêng để tránh xung đột.</p></div></div><div id="feature-${id}-host"></div>`; main.appendChild(s);
    }
  });
  nav.addEventListener('click', (e)=>{
    const btn=e.target.closest('.nav-link[data-view]'); if(!btn) return;
    const id=btn.dataset.view;
    document.querySelectorAll('.nav-link[data-view]').forEach(x=>x.classList.toggle('active',x===btn));
    document.querySelectorAll('.view').forEach(v=>{const active=v.id===`view-${id}`;v.hidden=!active;v.classList.toggle('active',active);});
    const title=$('#pageTitle'); if(title) title.textContent=btn.textContent.trim();
  });
}

ensureShell();
