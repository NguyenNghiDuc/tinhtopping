import { $, installStyle, notify } from './shared.js';

function boot(){
  if(document.body.dataset.uiShortcuts==='1') return; document.body.dataset.uiShortcuts='1';
  installStyle('ui-shortcuts-style',`
    @media(max-width:760px){
      .button,.nav-link,.icon-button,.feature-btn{min-height:44px}
      input,select,textarea{font-size:16px!important}
      .batch-shift-columns{grid-template-columns:1fr!important}
      .batch-employee-row{gap:8px!important}
      .page-header{gap:10px;align-items:flex-start}.header-actions{flex-wrap:wrap}
      .sidebar{min-width:0}.main-content{overflow-x:hidden}.table-scroll{overflow-x:auto}
    }
  `);
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){
      const editor=$('#shiftEditor'),btn=$('#saveShiftButton');
      if(editor&&!editor.hidden&&btn){e.preventDefault();btn.click();notify('Đã gửi lệnh lưu.');}
    }
    if(e.key==='Enter'&&e.target?.matches?.('[data-batch-quantity]')){
      const xs=[...document.querySelectorAll('[data-batch-quantity]')],i=xs.indexOf(e.target);if(i>=0&&xs[i+1]){e.preventDefault();xs[i+1].focus();xs[i+1].select?.();}
    }
  });
}
boot();
