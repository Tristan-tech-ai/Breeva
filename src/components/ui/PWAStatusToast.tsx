import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, CloudUpload, Download, RefreshCw, Wifi } from 'lucide-react'
import { PWA_STATUS_EVENT, type PwaStatusEventDetail } from '../../lib/pwa-events'

function getIcon(kind: PwaStatusEventDetail['kind']) {
  switch (kind) {
    case 'update-available':
      return <RefreshCw className="w-4 h-4" />
    case 'sync-queued':
    case 'sync-complete':
      return <CloudUpload className="w-4 h-4" />
    case 'installed':
      return <Download className="w-4 h-4" />
    case 'offline-ready':
    default:
      return <Wifi className="w-4 h-4" />
  }
}

export default function PWAStatusToast() {
  const [notice, setNotice] = useState<PwaStatusEventDetail | null>(null)

  useEffect(() => {
    const onStatus = (event: Event) => {
      const next = (event as CustomEvent<PwaStatusEventDetail>).detail
      setNotice(next)
    }

    window.addEventListener(PWA_STATUS_EVENT, onStatus)
    return () => window.removeEventListener(PWA_STATUS_EVENT, onStatus)
  }, [])

  useEffect(() => {
    if (!notice?.autoHideMs) return

    const timer = window.setTimeout(() => setNotice(null), notice.autoHideMs)
    return () => window.clearTimeout(timer)
  }, [notice])

  const icon = useMemo(() => (notice ? getIcon(notice.kind) : null), [notice])

  const handleAction = async () => {
    if (!notice?.action) return
    await notice.action()
    setNotice(null)
  }

  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2 }}
          className="fixed left-4 right-4 bottom-36 z-[120] mx-auto max-w-md"
        >
          <div className="glass-card border border-primary-200/70 dark:border-primary-800/80 p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl gradient-primary text-white">
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{notice.title}</p>
                <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">{notice.message}</p>
              </div>
              <button
                onClick={() => setNotice(null)}
                className="text-xs font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
              >
                Tutup
              </button>
            </div>

            {notice.actionLabel && notice.action && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleAction}
                  className="inline-flex items-center gap-2 rounded-xl gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-lg"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {notice.actionLabel}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}