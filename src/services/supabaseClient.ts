import { createClient, SupabaseClient } from '@supabase/supabase-js';

const isCloudSyncEnabled = import.meta.env.VITE_ENABLE_CLOUD_SYNC === 'true';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;

if (isCloudSyncEnabled && supabaseUrl && supabaseAnonKey) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
  } catch (err) {
    console.warn('[Supabase] Initialization failed:', err);
    supabaseInstance = null;
  }
}

export const isCloudConfigured = (): boolean => {
  return Boolean(isCloudSyncEnabled && supabaseInstance);
};

export const getSupabaseClient = (): SupabaseClient | null => {
  return supabaseInstance;
};
