import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/** Standard sticky glass header for inner pages (back chevron + centered title + right slot). */
export default function PageHeader({ title, onBack, right, live }: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  /** Show a small pulsing "live" dot before the right slot. */
  live?: boolean;
}) {
  return (
    <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
      {onBack ? (
        <button onClick={onBack} className="text-gray-600 dark:text-gray-300 p-1 -ml-1 flex-shrink-0" aria-label="Kembali">
          <ChevronLeft className="w-6 h-6" />
        </button>
      ) : (
        <span className="w-6 flex-shrink-0" />
      )}
      <h1 className="flex-1 min-w-0 text-base font-bold text-gray-900 dark:text-white truncate text-center">{title}</h1>
      <div className="flex items-center gap-1.5 justify-end flex-shrink-0 min-w-[1.75rem]">
        {live && (
          <span className="relative flex w-2 h-2" aria-hidden>
            <span className="absolute inline-flex w-full h-full rounded-full bg-primary-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-primary-500" />
          </span>
        )}
        {right}
      </div>
    </div>
  );
}
