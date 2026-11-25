import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Folded details: the long explanation stays one tap away instead of on the page. Native <details>, so it works without JS. */
export default function Rincian({
  summary = 'Rincian', children, open, className,
}: {
  summary?: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details className={`group rounded-xl border border-gray-100 dark:border-gray-800 bg-white/60 dark:bg-gray-900/50 ${className ?? ''}`} open={open} data-viz="rincian">
      <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
        <span>{summary}</span>
        <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-3 pb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300 space-y-2">{children}</div>
    </details>
  );
}
