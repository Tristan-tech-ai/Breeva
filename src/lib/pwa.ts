import { registerSW } from 'virtual:pwa-register'
import { dispatchPwaStatus } from './pwa-events'
import { adaYangMenahan, bolehMuatUlang } from './penjaga-muat'

const INSTALL_COUNT_KEY = 'breeva:pwa-install-count'
const INSTALLED_AT_KEY = 'breeva:pwa-installed-at'
const RELOAD_KEY = 'breeva:sw-reload-at'
const CEK_TIAP_MS = 15 * 60 * 1000

type UpdateSwFn = (reloadPage?: boolean) => Promise<void>

function bacaAngka(key: string): number {
  try { return Number(sessionStorage.getItem(key) || '0') } catch { return 0 }
}

function muatUlangOtomatis(): void {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage refused: the 30 s guard is skipped */ }
  window.location.reload()
}

// A new build took control of this page (sw.ts skips waiting, M-U00). Reload right away when nothing is in progress;
// during a walk or a route computation, wait until the page is hidden and the hold is released, and offer a button.
function terapkanVersiBaru(): void {
  if (bolehMuatUlang({ menahan: adaYangMenahan(), terakhirMuatUlang: bacaAngka(RELOAD_KEY), sekarang: Date.now() })) {
    muatUlangOtomatis()
    return
  }
  const saatTersembunyi = () => {
    if (document.visibilityState === 'hidden' && !adaYangMenahan()) {
      document.removeEventListener('visibilitychange', saatTersembunyi)
      muatUlangOtomatis()
    }
  }
  document.addEventListener('visibilitychange', saatTersembunyi)
  dispatchPwaStatus({
    kind: 'update-available',
    title: 'Versi baru Breeva aktif',
    message: 'Dimuat sendiri sesudah jalan atau rute selesai, atau muat ulang sekarang.',
    actionLabel: 'Muat ulang sekarang',
    action: () => window.location.reload(),
  })
}

export function initPwaLifecycle() {
  const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
  let punyaPengendali = !!sw?.controller

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      dispatchPwaStatus({
        kind: 'offline-ready',
        title: 'Siap dibuka tanpa internet',
        message: 'Aplikasi tetap terbuka saat koneksi putus. Untuk peta dan rute tanpa internet, simpan wilayahnya.',
        autoHideMs: 3200,
      })
    },
    onNeedRefresh() {
      // Only reached when a waiting worker from an older build (which did not skip waiting) is found:
      // activate it now; the controllerchange handler below decides when to reload.
      void (updateSW as UpdateSwFn)(false)
    },
    onRegisteredSW(_url, r) {
      if (!r) return
      const cek = () => { if (navigator.onLine !== false) r.update().catch(() => { /* offline or server busy: next check */ }) }
      window.setInterval(cek, CEK_TIAP_MS)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cek() })
    },
  })

  sw?.addEventListener('controllerchange', () => {
    if (!punyaPengendali) { punyaPengendali = true; return } // first install: the page already runs this build
    terapkanVersiBaru()
  })

  window.addEventListener('appinstalled', () => {
    const installCount = Number(localStorage.getItem(INSTALL_COUNT_KEY) || '0') + 1
    const installedAt = new Date().toISOString()

    localStorage.setItem(INSTALL_COUNT_KEY, String(installCount))
    localStorage.setItem(INSTALLED_AT_KEY, installedAt)

    dispatchPwaStatus({
      kind: 'installed',
      title: 'Breeva terpasang',
      message: 'Aplikasi sudah ditambahkan ke perangkat ini dan bisa dibuka seperti aplikasi lain.',
      autoHideMs: 3200,
    })
  })
}
