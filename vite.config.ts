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
        name: 'Breeva — Eco Walking Rewards',
        short_name: 'Breeva',
        description: 'Jalan kaki, kumpulkan EcoPoints, dan pantau kualitas udara real-time.',
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
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet'))
            return 'vendor-leaflet';
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three'))
            return 'vendor-three';   // ~320KB+ — kept out of the main entry; lazy-loaded by ParticleHero
          if (id.includes('node_modules/framer-motion'))
            return 'vendor-motion';
          if (id.includes('node_modules/lucide-react'))
            return 'vendor-ui';
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
