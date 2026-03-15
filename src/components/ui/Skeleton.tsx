import { cn } from '../../lib/utils';

/** Animated shimmer placeholder line/block */
export function SkeletonPulse({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer', className)} />;
}

/** Generic card skeleton */
export function SkeletonCard() {
  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonPulse className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonPulse className="h-4 w-3/4" />
          <SkeletonPulse className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonPulse className="h-20 w-full" />
      <div className="flex gap-2">
        <SkeletonPulse className="h-6 w-16 rounded-full" />
        <SkeletonPulse className="h-6 w-16 rounded-full" />
        <SkeletonPulse className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** List of skeleton rows for leaderboard / walk history */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="glass-card p-3 flex items-center gap-3">
          <SkeletonPulse className="w-9 h-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <SkeletonPulse className="h-4 w-2/3" />
            <SkeletonPulse className="h-3 w-1/3" />
          </div>
          <SkeletonPulse className="h-6 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Grid of skeleton cards for merchant / rewards pages */
export function SkeletonGrid({ cols = 2, count = 6 }: { cols?: number; count?: number }) {
  return (
    <div className={cn('grid gap-3 p-4', cols === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-card p-3 space-y-2">
          <SkeletonPulse className="h-24 w-full rounded-lg" />
          <SkeletonPulse className="h-4 w-3/4" />
          <SkeletonPulse className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Profile header skeleton */
export function SkeletonProfile() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <SkeletonPulse className="w-16 h-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonPulse className="h-5 w-1/2" />
          <SkeletonPulse className="h-3 w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SkeletonPulse className="h-16 rounded-xl" />
        <SkeletonPulse className="h-16 rounded-xl" />
        <SkeletonPulse className="h-16 rounded-xl" />
      </div>
    </div>
  );
}
