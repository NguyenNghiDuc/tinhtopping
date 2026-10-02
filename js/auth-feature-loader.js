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
    await Promise.allSettled([
      import('./advanced.js'),
      import('./stats-all-employees.js'),
      import('./pro-tools.js')
    ]);
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
