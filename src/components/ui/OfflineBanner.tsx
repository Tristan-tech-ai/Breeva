import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

export default function OfflineBanner() {
  const isOnline = useNetworkStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -48 }}
          animate={{ y: 0 }}
          exit={{ y: -48 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed top-0 inset-x-0 z-[100] bg-red-700 text-white text-center py-2 text-xs font-semibold safe-area-top flex items-center justify-center gap-1.5"
          role="alert"
        >
          <WifiOff className="w-3.5 h-3.5" aria-hidden />
          Tanpa internet: wilayah yang sudah disimpan tetap berwarna dan rutenya tetap dihitung.
        </motion.div>
      )}
    </AnimatePresence>
  );
}
