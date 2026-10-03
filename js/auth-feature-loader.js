import { requireSupabase } from './supabase.js';

let loaded = false;
let loading = false;

// Chỉ load bộ module mới. Các file legacy (advanced/pro/productivity/batch-fix...)
// vẫn được giữ trong repo để tham khảo nhưng không chạy, tránh trùng chức năng/observer.
const FEATURE_MODULES = [
  './features/feature-shell.js',
  './features/account-security.js',
  './features/editor-tools.js',
  './features/offline-draft.js',
  './features/employee-report.js',
  './features/settings-page.js',
  './features/dashboard-insights.js',
  './features/history-operations.js',
  './features/export-backup.js',
  './features/audit-login.js',
  './features/trash-recovery.js',
  './features/system-health.js',
  './features/ui-shortcuts.js'
];

async function loadAuthenticatedFeatures() {
  if (loaded || loading) return;
  loading = true;
  try {
    const client = requireSupabase();
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.user) return;

    for (const modulePath of FEATURE_MODULES) {
      try {
        await import(modulePath);
      } catch (error) {
        console.error(`Không tải được ${modulePath}.`, error);
      }
    }
    loaded = true;
    document.dispatchEvent(new CustomEvent('topping:features-ready'));
  } finally {
    loading = false;
  }
}

async function init() {
  const client = requireSupabase();
  await loadAuthenticatedFeatures();
  client.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session?.user) {
      queueMicrotask(loadAuthenticatedFeatures);
    }
  });
}

init().catch((error) => console.warn('Không thể khởi tạo tính năng mở rộng.', error));
