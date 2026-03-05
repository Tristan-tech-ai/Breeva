import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  CornerUpLeft,
  CornerUpRight,
  Milestone,
  Flag,
  Navigation,
} from 'lucide-react';
import type { RouteInstruction, Coordinate } from '../../types';

interface TurnByTurnProps {
  instructions: RouteInstruction[];
  currentPosition: Coordinate | null;
  routeWaypoints: Coordinate[];
  className?: string;
}

// Map ORS instruction type codes to icons and labels
function getInstructionIcon(type: number) {
  switch (type) {
    case 0: return <ArrowLeft className="w-5 h-5" />;          // Left
    case 1: return <ArrowRight className="w-5 h-5" />;         // Right
    case 2: return <CornerUpLeft className="w-5 h-5" />;       // Sharp left
    case 3: return <CornerUpRight className="w-5 h-5" />;      // Sharp right
    case 4: return <ArrowLeft className="w-5 h-5" />;          // Slight left
    case 5: return <ArrowRight className="w-5 h-5" />;         // Slight right
    case 6: return <ArrowUp className="w-5 h-5" />;            // Straight
    case 10: return <Milestone className="w-5 h-5" />;         // Waypoint
    case 11: return <Flag className="w-5 h-5" />;              // Finish
    default: return <Navigation className="w-5 h-5" />;        // Default
  }
}

function formatInstructionDistance(meters: number): string {
  if (meters < 50) return 'now';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export default function TurnByTurn({
  instructions,
  currentPosition,
  routeWaypoints,
  className = '',
}: TurnByTurnProps) {
  // Find the current instruction based on user position
  const currentStepIndex = useMemo(() => {
    if (!currentPosition || !routeWaypoints.length || !instructions.length) return 0;

    let closestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < routeWaypoints.length; i++) {
      const wp = routeWaypoints[i];
      const d = Math.sqrt(
        (wp.lat - currentPosition.lat) ** 2 + (wp.lng - currentPosition.lng) ** 2
      );
      if (d < minDist) {
        minDist = d;
        closestIdx = i;
      }
    }

    // Find which instruction this waypoint index belongs to
    for (let i = instructions.length - 1; i >= 0; i--) {
      if (closestIdx >= instructions[i].waypoint_index) return i;
    }
    return 0;
  }, [currentPosition, routeWaypoints, instructions]);

  if (!instructions.length) return null;

  const current = instructions[currentStepIndex];
  const next = instructions[currentStepIndex + 1];

  return (
    <div className={className}>
      {/* Current instruction - large card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStepIndex}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="glass-card p-4 flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-primary-500/10 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 flex-shrink-0">
            {getInstructionIcon(current.type)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug truncate">
              {current.text}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {formatInstructionDistance(current.distance)}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Next instruction preview */}
      {next && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-2 flex items-center gap-3 px-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-950/80"
        >
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Then</span>
          <span className="text-gray-500 dark:text-gray-400">
            {getInstructionIcon(next.type)}
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate">
            {next.text}
          </p>
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
            {formatInstructionDistance(next.distance)}
          </span>
        </motion.div>
      )}
    </div>
  );
}
