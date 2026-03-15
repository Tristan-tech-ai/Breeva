import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction, children }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center text-center py-16 px-6"
    >
      <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-primary-400 dark:text-primary-500" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 gradient-primary text-white text-sm font-semibold px-6 py-2.5 rounded-xl shadow-lg shadow-primary-500/25 hover:shadow-xl transition-shadow"
        >
          {actionLabel}
        </button>
      )}
      {children}
    </motion.div>
  );
}
