import { requireSupabase } from '../supabase.js';

const $ = (selector, root = document) => root.querySelector(selector);

function toast(message) {
  const el = $('#toast');
  if (!el) return window.alert(message);
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function ensureStyles() {
  if ($('#account-security-style')) return;
  const style = document.createElement('style');
  style.id = 'account-security-style';
  style.textContent = `
    .account-security-dialog{width:min(460px,92vw);border:0;border-radius:16px;padding:0;box-shadow:0 24px 70px rgba(15,23,42,.25)}
    .account-security-dialog::backdrop{background:rgba(15,23,42,.45)}
    .account-security-panel{padding:20px}.account-security-panel h2{margin:0 0 6px}.account-security-panel p{margin:0 0 16px}
    .account-security-panel label{display:grid;gap:6px;margin:12px 0;font-weight:700;color:#475569}.account-security-panel input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font:inherit}
    .account-security-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.account-security-trigger{white-space:nowrap}
  `;
  document.head.appendChild(style);
}

function ensureDialog() {
  if ($('#accountSecurityDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'accountSecurityDialog';
  dialog.className = 'account-security-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="account-security-panel" id="accountSecurityForm">
      <h2>Đổi mật khẩu</h2>
      <p class="muted" id="accountSecurityEmail"></p>
      <label>Mật khẩu mới
        <input id="accountSecurityPassword" type="password" minlength="6" autocomplete="new-password" placeholder="Ít nhất 6 ký tự" required>
      </label>
      <label>Nhập lại mật khẩu mới
        <input id="accountSecurityPasswordConfirm" type="password" minlength="6" autocomplete="new-password" required>
      </label>
      <p class="form-error" id="accountSecurityError" hidden></p>
      <div class="account-security-actions">
        <button type="button" class="button button-quiet" id="accountSecurityCancel">Hủy</button>
        <button type="submit" class="button button-primary" id="accountSecuritySave">Đổi mật khẩu</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  $('#accountSecurityCancel').addEventListener('click', () => dialog.close());
  $('#accountSecurityForm').addEventListener('submit', handleSubmit);
}

async function openDialog() {
  ensureDialog();
  const client = requireSupabase();
  const { data } = await client.auth.getSession();
  $('#accountSecurityEmail').textContent = data?.session?.user?.email || '';
  $('#accountSecurityPassword').value = '';
  $('#accountSecurityPasswordConfirm').value = '';
  $('#accountSecurityError').hidden = true;
  $('#accountSecurityDialog').showModal();
  setTimeout(() => $('#accountSecurityPassword')?.focus(), 0);
}

async function handleSubmit(event) {
  event.preventDefault();
  const password = $('#accountSecurityPassword').value;
  const confirmPassword = $('#accountSecurityPasswordConfirm').value;
  const errorEl = $('#accountSecurityError');
  const saveButton = $('#accountSecuritySave');

  errorEl.hidden = true;
  if (password.length < 6) {
    errorEl.textContent = 'Mật khẩu phải có ít nhất 6 ký tự.';
    errorEl.hidden = false;
    return;
  }
  if (password !== confirmPassword) {
    errorEl.textContent = 'Hai mật khẩu không khớp.';
    errorEl.hidden = false;
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = 'Đang đổi...';
  try {
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) throw error;
    $('#accountSecurityDialog').close();
    toast('Đã đổi mật khẩu thành công.');
  } catch (error) {
    errorEl.textContent = error?.message || 'Không đổi được mật khẩu.';
    errorEl.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Đổi mật khẩu';
  }
}

function ensureTrigger() {
  if ($('#accountSecurityButton')) return;
  const signOutButton = $('#signOutButton');
  const host = signOutButton?.parentElement;
  if (!host) return;

  const button = document.createElement('button');
  button.id = 'accountSecurityButton';
  button.type = 'button';
  button.className = 'button button-quiet account-security-trigger';
  button.textContent = 'Đổi mật khẩu';
  button.addEventListener('click', openDialog);
  host.insertBefore(button, signOutButton);
}

function init() {
  ensureStyles();
  ensureTrigger();
  ensureDialog();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
