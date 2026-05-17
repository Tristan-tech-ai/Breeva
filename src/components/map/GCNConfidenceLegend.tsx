import { motion } from 'framer-motion';

interface Props {
  gcnCount: number;
  totalCount: number;
}

export function GCNConfidenceLegend({ gcnCount, totalCount }: Props) {
  const pct = totalCount > 0 ? Math.round((gcnCount / totalCount) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="pointer-events-none absolute bottom-32 right-4 z-[600] rounded-lg border border-gray-200 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/90"
    >
      <div className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
        Spatial AI Reasoning
      </div>
      <div className="text-gray-600 dark:text-gray-300">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500" />
          <span>GCN propagated · {pct}%</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span>CALINE3 + XGBoost only</span>
        </div>
        <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
          GraphSAGE 3-layer · per-road residual
        </div>
      </div>
    </motion.div>
  );
}
