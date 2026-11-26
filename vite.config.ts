import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Build stamp (src/lib/versi.ts): Vercel gives the commit; a local build reads git.
function buildCommit(): string {
  const v = process.env.BUILD_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA
  if (v) return v.slice(0, 7)
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'lokal' }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' keeps the plugin from reloading on its own; sw.ts skips waiting and pwa.ts decides when a
      // reload is safe (no walk, no route being computed), M-U00.
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'hero.webp'],
      manifest: {
        id: '/',
        name: 'Breeva — Asap Kendaraan per Ruas Jalan',
        short_name: 'Breeva',
        description: 'Peta asap kendaraan per ruas jalan (Badung–Denpasar dan Kota Bogor), rute dengan asap paling sedikit di ponsel, tanpa akun.',
        lang: 'id',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#10b981',
        orientation: 'portrait-primary',
        scope: '/',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Mulai Jalan', short_name: 'Jalan', url: '/walk', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Rewards', short_name: 'Rewards', url: '/rewards', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      injectManifest: {
        // NOTE: 'svg' intentionally dropped — the brand logo (logo-breeva.svg, ~386 KB) is emitted to
        // dist/assets and was bloating the precache. SVGs load on demand + are browser-cached; no need
        // to precache them offline. Keeps the SW install payload lean.
        globPatterns: ['**/*.{js,css,html,png,webp,woff2}'],
        // Don't precache the heavy three.js chunk (~875 KB): it's only the landing page's
        // decorative particle hero (lazy + skipped under reduced-motion). Precaching it taxed
        // every first visit's bandwidth (competing with API calls on mobile) for code most
        // logged-in users never hit. It still loads on demand when the landing page needs it.
        globIgnores: ['**/vendor-three-*.js'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    // .vite/manifest.json: prerender-routes.mjs reads it to preload a route's lazy chunks (F1-51), then removes it
    manifest: true,
    rollupOptions: {
      output: {
        // rolldown advancedChunks (rolldown 1.0.0-beta.50 types): a group also takes its modules' dependencies
        // (includeDependenciesRecursively, default true), and the group with the higher priority is cut first, its
        // modules removed from the other groups. With one manualChunks function every group had the same priority, so
        // vendor-leaflet swallowed React through react-leaflet and the entry imported React from it. React goes first.
        advancedChunks: {
          groups: [
            { name: 'vendor-react', priority: 30,
              test: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(react|react-dom|scheduler|use-sync-external-store|zustand)[\\/]/ },
            // ~230KB gz, lazy-loaded by ParticleHero only
            { name: 'vendor-three', priority: 20,
              test: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(three|@react-three[\\/][^\\/]+)[\\/]/ },
            { name: 'vendor-leaflet', priority: 10, test: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(leaflet|react-leaflet|@react-leaflet[\\/][^\\/]+)[\\/]/ },
            { name: 'vendor-motion', priority: 10, test: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: 'vendor-ui', priority: 10, test: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?lucide-react[\\/]/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
