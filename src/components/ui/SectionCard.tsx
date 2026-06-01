import type { ReactNode } from 'react';

/** Glass card with an optional uppercase section header + action slot. Replaces the
 *  ad-hoc `glass-card` + `<h3>` wrapper repeated across the profile-cluster pages. */
export default function SectionCard({ title, icon, action, className, bodyClassName, children }: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={`glass-card p-4 ${className ?? ''}`}>
      {(title || action || icon) && (
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            {title && (
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
                {title}
              </h3>
            )}
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
