import OfflineBanner from './ui/OfflineBanner';
import PWAStatusToast from './ui/PWAStatusToast';
import PWAInstallBanner from './features/PWAInstallBanner';
import DesktopNudge from './features/DesktopNudge';
import CommandPalette from './features/CommandPalette';

/**
 * Banners, toasts and the command palette that float over every page. Loaded on demand from App.tsx so their
 * animation library (framer-motion) stays out of the first download; none of them is needed to paint the map.
 */
export default function AppOverlays() {
  return (
    <>
      <OfflineBanner />
      <PWAStatusToast />
      <PWAInstallBanner />
      <DesktopNudge />
      <CommandPalette />
    </>
  );
}
