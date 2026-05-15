export const PWA_STATUS_EVENT = 'breeva:pwa-status'

export type PwaStatusKind =
  | 'offline-ready'
  | 'update-available'
  | 'installed'
  | 'sync-queued'
  | 'sync-complete'
  | 'sync-error'

export interface PwaStatusEventDetail {
  kind: PwaStatusKind
  title: string
  message: string
  actionLabel?: string
  action?: () => void | Promise<void>
  autoHideMs?: number
}

export function dispatchPwaStatus(detail: PwaStatusEventDetail) {
  window.dispatchEvent(new CustomEvent<PwaStatusEventDetail>(PWA_STATUS_EVENT, { detail }))
}