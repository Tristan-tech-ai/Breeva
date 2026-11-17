import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a new SW does NOT auto-reload the open app.
      // It waits; onNeedRefresh fires a gentle toast; it applies silently on the
      // next full close+reopen (or immediately if the user taps "Refresh sekarang").
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
