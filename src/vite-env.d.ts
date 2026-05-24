/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_OPENROUTESERVICE_API_KEY: string;
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_GEOAPIFY_API_KEY?: string;
  // VITE_WAQI_TOKEN removed 2026-05-24 (security: token was bundled publicly).
  // Use /api/vayu/waqi-stations + /api/vayu/waqi-feed proxy endpoints instead.
  readonly VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.css';
