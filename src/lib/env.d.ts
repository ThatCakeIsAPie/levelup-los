/// <reference types="vite/client" />

// Build-time settings read by src/lib/config.ts (see .env.local / CI env).
interface ImportMetaEnv {
  /** "local" (browser storage + demo picker) or "supabase" (real accounts). */
  readonly VITE_DATA_SOURCE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Browser-storage namespace; defaults to "levelup" (see storageKey). */
  readonly VITE_STORAGE_NAMESPACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
