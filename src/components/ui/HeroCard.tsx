import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

/** The signature gradient hero used across Leaderboard / SavedPlaces / profile pages:
 *  gradient-primary, decorative blob + Sparkles, media slot, eyebrow/title/subtitle,
 *  optional right-aligned `metric` and a full-width `children` footer. */
export default function HeroCard({
  eyebrow, title, subtitle, media, metric, children, className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  media?: ReactNode;
  metric?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-3xl gradient-primary text-white p-5 shadow-lg ${className ?? ''}`}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 w-40 h-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -right-2 bottom-2 opacity-20"><Sparkles className="w-16 h-16" /></div>

      <div className="relative flex items-center gap-3">
        {media}
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="text-[11px] uppercase tracking-wider text-white/70 font-semibold">{eyebrow}</div>}
          <div className="text-lg font-extrabold truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-white/70 mt-0.5">{subtitle}</div>}
        </div>
        {metric}
      </div>

      {children && <div className="relative mt-4">{children}</div>}
    </motion.div>
  );
}
