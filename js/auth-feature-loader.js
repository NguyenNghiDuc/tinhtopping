import { requireSupabase } from './supabase.js';

let loadPromise = null;
let featuresLoaded = false;

// Chỉ load bộ module mới. Mỗi module sở hữu một nhóm chức năng riêng.
// Load tuần tự để tránh nhiều module cùng gắn UI/event trong một thời điểm.
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

async function importFeatureModules() {
  if (featuresLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const failed = [];

    for (const modulePath of FEATURE_MODULES) {
      try {
        await import(modulePath);
      } catch (error) {
        failed.push(modulePath);
        console.error(`Không tải được ${modulePath}.`, error);
      }
    }

    // Chỉ đánh dấu hoàn tất sau khi toàn bộ module đã được thử load.
    // Module lỗi không làm các module còn lại bị chặn.
    featuresLoaded = true;
    document.dispatchEvent(new CustomEvent('topping:features-ready', {
      detail: { failed }
    }));
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

function hasAuthenticatedSession(session) {
  return Boolean(session?.user?.id);
}

async function init() {
  const client = requireSupabase();

  // Dùng session hiện có đúng một lần lúc khởi động.
  // Không gọi getSession() bên trong onAuthStateChange để tránh race/deadlock.
  const { data, error } = await client.auth.getSession();
  if (error) console.warn('Không đọc được phiên đăng nhập để tải tính năng.', error);
  if (hasAuthenticatedSession(data?.session)) await importFeatureModules();

  client.auth.onAuthStateChange((event, session) => {
    if (!hasAuthenticatedSession(session)) return;
    if (!['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event)) return;

    // Thoát khỏi callback auth trước rồi mới import module.
    setTimeout(() => {
      void importFeatureModules();
    }, 0);
  });

  // app.js phát event này sau khi role + dữ liệu lõi đã tải xong.
  // Đây là đường load an toàn nhất khi đăng nhập ngay trong phiên hiện tại.
  document.addEventListener('topping:session-ready', () => {
    void importFeatureModules();
  });
}

init().catch((error) => console.warn('Không thể khởi tạo tính năng mở rộng.', error));
