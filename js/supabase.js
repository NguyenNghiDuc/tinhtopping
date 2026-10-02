import { configurationError, SUPABASE_PUBLIC_KEY, SUPABASE_URL, isSupabaseConfigured } from './config.js';

let supabase = null;
let clientError = null;

if (isSupabaseConfigured) {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch (error) {
    clientError = error;
  }
}

export function requireSupabase() {
  if (clientError) throw new Error(`Không tải được thư viện Supabase: ${clientError.message}`);
  if (!supabase) throw new Error(configurationError || 'Chưa cấu hình kết nối Supabase.');
  return supabase;
}