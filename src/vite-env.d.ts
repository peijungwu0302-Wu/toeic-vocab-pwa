/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_ENABLE_CLOUD_SYNC?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DATASET_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
