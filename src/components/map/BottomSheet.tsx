import { useRef, useEffect, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, useAnimate, type PanInfo } from 'framer-motion';
import { useMapStore } from '../../stores/mapStore';

interface BottomSheetProps {
  children: ReactNode;
}

const SHEET_HEIGHTS = {
  hidden: 0,
  peek: 28,
  half: 50,
  full: 88,
};

export default function BottomSheet({ children }: BottomSheetProps) {
  const { bottomSheetState, setBottomSheetState } = useMapStore();
  const [scope, animate] = useAnimate();
  const sheetRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);

  const targetHeight = SHEET_HEIGHTS[bottomSheetState];
  const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.88 : 600;

  const sheetHeightPx =
    typeof window !== 'undefined'
      ? (window.innerHeight * targetHeight) / 100
      : (600 * targetHeight) / 100;

  useEffect(() => {
    if (scope.current) {
      animate(scope.current, { height: sheetHeightPx }, { type: 'spring', damping: 32, stiffness: 320 });
    }
  }, [sheetHeightPx, animate, scope]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const velocityY = info.velocity.y;
    const offsetY = info.offset.y;

    if (velocityY > 500 || offsetY > 100) {
      if (bottomSheetState === 'full') setBottomSheetState('half');
      else if (bottomSheetState === 'half') setBottomSheetState('peek');
      else setBottomSheetState('peek');
    } else if (velocityY < -500 || offsetY < -100) {
      if (bottomSheetState === 'peek') setBottomSheetState('half');
      else if (bottomSheetState === 'half') setBottomSheetState('full');
      else setBottomSheetState('full');
    }
  };

  const borderRadius = useTransform(y, [-maxHeight, 0], [0, 28]);

  if (bottomSheetState === 'hidden') return null;

  return (
    <motion.div
      ref={scope}
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{ height: sheetHeightPx }}
      initial={{ height: 0 }}
    >
      <motion.div
        ref={sheetRef}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
        style={{ y, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }}
        className="h-full flex flex-col overflow-hidden shadow-[0_-8px_40px_rgba(0,0,0,0.08)] bg-white/90 dark:bg-gray-900/90 backdrop-blur-2xl border-t border-gray-200/30 dark:border-gray-700/20"
      >
        {/* Drag handle */}
        <div className="flex justify-center py-3 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1.5 rounded-full bg-gray-300/80 dark:bg-gray-600/80" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-20 max-w-2xl mx-auto w-full scrollbar-hide">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
