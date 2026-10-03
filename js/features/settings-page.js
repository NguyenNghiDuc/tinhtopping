import { requireSupabase } from '../supabase.js';
import { $, notify } from './shared.js';

const VERSION_FALLBACK='dev';
async function readVersion(){try{const r=await fetch('./version.json',{cache:'no-store'});const j=await r.json();return j.version||j.commit||VERSION_FALLBACK}catch{return VERSION_FALLBACK}}
async function loadSettings(){
  const host=$('#feature-settings-host'); if(!host||host.dataset.ready==='1') return; host.dataset.ready='1';
  host.innerHTML=`<section class="feature-panel"><h3>Cài đặt hệ thống</h3><div class="feature-toolbar">
    <label>Tên cửa hàng<input id="settingStoreName" placeholder="Sổ topping"></label>
    <label>Giá 1 topping<input id="settingPrice" type="number" min="1" step="100"></label>
    <label>Ngưỡng cảnh báo<input id="settingThreshold" type="number" min="1"></label>
    <button class="feature-btn primary" id="saveSettingsBtn">Lưu cài đặt</button>
  </div><p class="muted" id="settingVersion"></p></section>`;
  $('#settingVersion').textContent=`Phiên bản: ${await readVersion()}`;
  const c=requireSupabase(); const r=await c.from('app_settings').select('store_name,topping_price,anomaly_threshold').eq('id',true).maybeSingle();
  if(!r.error&&r.data){$('#settingStoreName').value=r.data.store_name||'Sổ topping';$('#settingPrice').value=r.data.topping_price||1000;$('#settingThreshold').value=r.data.anomaly_threshold||100}
  $('#saveSettingsBtn').onclick=async()=>{const payload={id:true,store_name:$('#settingStoreName').value.trim()||'Sổ topping',topping_price:Math.max(1,Number($('#settingPrice').value)||1000),anomaly_threshold:Math.max(1,Number($('#settingThreshold').value)||100),updated_at:new Date().toISOString()};const x=await c.from('app_settings').upsert(payload,{onConflict:'id'});if(x.error)return alert(x.error.message);notify('Đã lưu cài đặt.');document.dispatchEvent(new CustomEvent('topping:settings-changed',{detail:payload}))};
}
loadSettings();
