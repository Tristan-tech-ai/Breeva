import { useRef, type ReactNode, type MouseEvent } from 'react';
import { cn } from '../../lib/utils';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Spotlight glow color (default: primary green) */
  spotlightColor?: string;
}

/** Card wrapper that tracks mouse/touch and shows a radial spotlight glow. */
export default function SpotlightCard({ children, className, spotlightColor = 'rgba(16, 185, 129, 0.15)' }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty('--spotlight-x', `${x}px`);
    el.style.setProperty('--spotlight-y', `${y}px`);
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty('--spotlight-x');
    el.style.removeProperty('--spotlight-y');
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={cn('relative overflow-hidden', className)}
      style={{
        background: `radial-gradient(300px circle at var(--spotlight-x, 50%) var(--spotlight-y, 50%), ${spotlightColor}, transparent 60%)`,
      }}
    >
      {children}
    </div>
  );
}
