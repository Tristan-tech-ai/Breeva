/** One small line naming where the numbers above come from. */
export default function SourceLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] leading-snug text-gray-400 dark:text-gray-500 ${className ?? ''}`} data-viz="source">Sumber: {children}</p>;
}
