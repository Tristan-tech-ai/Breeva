import { registerSW } from 'virtual:pwa-register'
import { dispatchPwaStatus } from './pwa-events'

const INSTALL_COUNT_KEY = 'breeva:pwa-install-count'
const INSTALLED_AT_KEY = 'breeva:pwa-installed-at'

type UpdateSwFn = (reloadPage?: boolean) => Promise<void>

export function initPwaLifecycle() {
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
      // PROMPT model: the new version is staged but NOT forced. It applies silently
      // the next time Breeva is fully closed + reopened. This toast just informs the
      // user, with an optional "Refresh sekarang" to apply it immediately.
      dispatchPwaStatus({
        kind: 'update-available',
        title: 'Versi baru Breeva siap',
        message: 'Aktif sendiri saat aplikasi dibuka lagi, atau muat ulang sekarang.',
        actionLabel: 'Muat ulang sekarang',
        action: () => (updateSW as UpdateSwFn)(true),
      })
    },
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