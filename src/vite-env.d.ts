/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  // VITE_OPENROUTESERVICE_API_KEY and VITE_GEMINI_API_KEY removed 2026-11-16 (ORS goes through /api/searchapi?provider=ors).
  // VITE_GEOAPIFY_API_KEY removed 2026-06-02 (security: key was bundled publicly).
  // POIs now fetch via the /api/searchapi?provider=geoapify proxy (server-side key).
  // VITE_WAQI_TOKEN removed 2026-05-24 (security: token was bundled publicly).
  // Use /api/vayu/waqi-stations + /api/vayu/waqi-feed proxy endpoints instead.
  readonly VITE_APP_URL?: string;
  /** 'true' = road colors from the static field (PMTiles + value cells) instead of /api/tiles. */
  readonly VITE_FIELD_STATIC?: string;
  /** Base URL of the static field files; default /field (dev: public/field, staged by scripts/field/stage-dev.mjs). */
  readonly VITE_FIELD_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.css';
