export const SUPABASE_URL = 'https://cmgzcbjcnxjqjjmbxsze.supabase.co';
// Use a publishable key (sb_publishable_...) or the legacy anon public key.
// Never place sb_secret_... or a service_role JWT in frontend code.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_HxHZpA6amEev7GaND0xbVg_rWjJ-FnR';
// Optional compatibility field for projects that only expose the legacy anon key.
export const SUPABASE_ANON_KEY = '';
export const SUPABASE_PUBLIC_KEY = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

function getJwtRole(key) {
	const payload = key.split('.')[1];
	if (!payload) return '';
	try {
		const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
		const decoded = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
		return JSON.parse(decoded).role || '';
	} catch {
		return '';
	}
}

export function isServiceRoleKey(key) {
	if (key.startsWith('sb_secret_')) return true;
	return getJwtRole(key) === 'service_role';
}

const hasValidUrl = (() => {
	try {
		const url = new URL(SUPABASE_URL);
		return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash;
	} catch {
		return false;
	}
})();
const hasPublicKey = Boolean(SUPABASE_PUBLIC_KEY);
export const hasServiceRoleKey = hasPublicKey && isServiceRoleKey(SUPABASE_PUBLIC_KEY);
const hasSupportedPublicKey = SUPABASE_PUBLIC_KEY.startsWith('sb_publishable_') || getJwtRole(SUPABASE_PUBLIC_KEY) === 'anon';
export const configurationError = hasServiceRoleKey
	? 'Không sử dụng service_role hoặc secret key trong frontend. Hãy dùng publishable key hoặc anon public key.'
	: !hasValidUrl
		? 'Supabase Project URL không hợp lệ. Dùng URL HTTPS trong Supabase Dashboard.'
		: !hasPublicKey
			? 'Cần điền Supabase publishable key hoặc anon public key trong js/config.js.'
			: !hasSupportedPublicKey
				? 'Key không đúng định dạng public. Dùng sb_publishable_... hoặc legacy anon JWT; không dùng service_role.'
				: '';
export const isSupabaseConfigured = !configurationError;