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
        title: 'Offline mode ready',
        message: 'App shell dan cache inti Breeva sudah siap dipakai saat koneksi putus.',
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
        message: 'Akan aktif otomatis saat kamu membuka ulang aplikasi — atau refresh sekarang.',
        actionLabel: 'Refresh sekarang',
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
      message: 'Aplikasi sudah ditambahkan ke perangkat ini dan siap dipakai seperti app native.',
      autoHideMs: 3200,
    })
  })
}