import { requireSupabase } from './supabase.js';

let loaded = false;
let loading = false;

async function loadAuthenticatedFeatures() {
  if (loaded || loading) return;
  loading = true;
  try {
    const client = requireSupabase();
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.user) return;

    loaded = true;
    const results = await Promise.allSettled([
      import('./advanced.js'),
      import('./advanced-tools.js'),
      import('./stats-all-employees.js'),
      import('./pro-tools.js')
    ]);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const names = ['advanced.js', 'advanced-tools.js', 'stats-all-employees.js', 'pro-tools.js'];
        console.error(`Không tải được ${names[index]}.`, result.reason);
      }
    });
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
