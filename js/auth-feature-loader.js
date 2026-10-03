import { requireSupabase } from './supabase.js';

let loadPromise = null;
let featuresLoaded = false;
let shellLoaded = false;
let retryTimer = null;
let retryCount = 0;

const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 500;

const SHELL_MODULE = './features/feature-shell.js';

const AUTH_FEATURE_MODULES = [
  './features/account-security.js',
  './features/editor-tools.js',
  './features/offline-draft.js',
  './features/employee-report.js',
  './features/employee-delete.js',
  './features/settings-page.js',
  './features/dashboard-insights.js',
  './features/history-operations.js',
  './features/export-excel.js',
  './features/excel-employee-live-refresh.js',
  './features/export-backup.js',
  './features/audit-login.js',
  './features/trash-recovery.js',
  './features/system-health.js',
  './features/ui-shortcuts.js'
];

async function ensureFeatureShell() {
  if (shellLoaded) return true;
  try {
    await import(SHELL_MODULE);
    shellLoaded = true;
    document.documentElement.dataset.featureShellLoaded = '1';
    return true;
  } catch (error) {
    console.error(`Không tải được ${SHELL_MODULE}.`, error);
    document.documentElement.dataset.featureShellLoaded = '0';
    return false;
  }
}

async function importFeatureModules() {
  if (featuresLoaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    await ensureFeatureShell();

    const failed = [];
    for (const modulePath of AUTH_FEATURE_MODULES) {
      try {
        await import(modulePath);
      } catch (error) {
        failed.push(modulePath);
        console.error(`Không tải được ${modulePath}.`, error);
      }
    }

    featuresLoaded = true;
    document.documentElement.dataset.featuresLoaded = '1';
    document.documentElement.dataset.featureFailures = String(failed.length);
    document.dispatchEvent(new CustomEvent('topping:features-ready', {
      detail: { failed }
    }));

    if (failed.length) {
      console.warn('Một số tính năng mở rộng không tải được:', failed);
    }
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

function hasAuthenticatedSession(session) {
  return Boolean(session?.user?.id);
}

function clearRetryTimer() {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

async function tryLoadFromCurrentSession(client) {
  if (featuresLoaded) return true;

  try {
    const { data, error } = await client.auth.getSession();
    if (error) console.warn('Không đọc được phiên đăng nhập để tải tính năng.', error);

    if (hasAuthenticatedSession(data?.session)) {
      clearRetryTimer();
      retryCount = 0;
      await importFeatureModules();
      return true;
    }
  } catch (error) {
    console.warn('Không kiểm tra được phiên đăng nhập.', error);
  }

  return false;
}

function scheduleSessionRetry(client) {
  if (featuresLoaded || retryTimer || retryCount >= MAX_RETRIES) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    retryCount += 1;
    const loaded = await tryLoadFromCurrentSession(client);
    if (!loaded) scheduleSessionRetry(client);
  }, RETRY_DELAY_MS);
}

async function init() {
  await ensureFeatureShell();

  const client = requireSupabase();
  const loadedInitially = await tryLoadFromCurrentSession(client);
  if (!loadedInitially) scheduleSessionRetry(client);

  client.auth.onAuthStateChange((event, session) => {
    if (!hasAuthenticatedSession(session)) {
      if (event === 'SIGNED_OUT') {
        clearRetryTimer();
        retryCount = 0;
      }
      return;
    }

    if (!['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION', 'USER_UPDATED'].includes(event)) return;

    setTimeout(() => {
      void importFeatureModules();
    }, 0);
  });

  document.addEventListener('topping:session-ready', () => {
    clearRetryTimer();
    void importFeatureModules();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !featuresLoaded) {
      void tryLoadFromCurrentSession(client).then((loaded) => {
        if (!loaded) scheduleSessionRetry(client);
      });
    }
  });

  window.addEventListener('pageshow', () => {
    if (!featuresLoaded) {
      void tryLoadFromCurrentSession(client).then((loaded) => {
        if (!loaded) scheduleSessionRetry(client);
      });
    }
  });
}

init().catch((error) => {
  console.error('Không thể khởi tạo tính năng mở rộng.', error);
  void ensureFeatureShell();
});
