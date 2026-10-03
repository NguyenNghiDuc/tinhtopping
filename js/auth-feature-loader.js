import { requireSupabase } from './supabase.js';

let loaded = false;
let loading = false;

// Thứ tự cố định để mỗi nhóm tính năng hoàn tất trước khi nhóm kế tiếp gắn UI.
// Tránh Promise.all khiến nhiều file cùng sửa DOM trong một thời điểm.
const FEATURE_MODULES = [
  './batch-fix.js',
  './employee-delete.js',
  './productivity.js',
  './advanced.js',
  './stats-all-employees.js',
  './pro-tools.js',
  './features/account-security.js',
  './advanced-tools.js'
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
