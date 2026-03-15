import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, CheckCircle2, Copy, QrCode } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';

interface RewardForRedeem {
  id: string;
  title: string;
  points_required: number;
  merchant: { name: string } | null;
}

interface Props {
  reward: RewardForRedeem;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RewardRedemptionModal({ reward, onClose, onSuccess }: Props) {
  const { user } = useAuthStore();
  const [step, setStep] = useState<'confirm' | 'loading' | 'success' | 'error'>('confirm');
  const [qrCode, setQrCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleRedeem = async () => {
    if (!user) return;
    setStep('loading');

    try {
      const { data, error } = await supabase.rpc('redeem_reward', {
        p_user_id: user.id,
        p_reward_id: reward.id,
      });

      if (error) throw error;

      const result = data?.[0];
      if (result?.success) {
        setQrCode(result.qr_code || '');
        setStep('success');
        useAuthStore.getState().fetchProfile();
        onSuccess();
      } else {
        setErrorMsg(result?.message || 'Redemption failed');
        setStep('error');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStep('error');
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(qrCode);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-6 mx-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {step === 'success' ? 'Redeemed!' : 'Redeem Reward'}
            </h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>

          {step === 'confirm' && (
            <div>
              <div className="glass-card p-4 mb-4">
                <h4 className="font-semibold text-gray-900 dark:text-white text-sm">{reward.title}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {(reward.merchant as { name: string } | null)?.name || 'Breeva'}
                </p>
                <div className="mt-3 flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <span className="text-lg font-bold">{reward.points_required}</span>
                  <span className="text-xs">EcoPoints</span>
                </div>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 mb-4">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This action cannot be undone. {reward.points_required} EcoPoints will be deducted from your balance.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRedeem}
                  className="flex-1 gradient-primary text-white py-3 rounded-xl text-sm font-semibold"
                >
                  Confirm Redeem
                </button>
              </div>
            </div>
          )}

          {step === 'loading' && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Processing redemption...</p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.1 }}
              >
                <CheckCircle2 className="w-16 h-16 text-primary-500 mx-auto mb-3" />
              </motion.div>
              <h4 className="text-base font-bold text-gray-900 dark:text-white mb-1">{reward.title}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                Show this code to the merchant to claim your reward
              </p>
              <div className="glass-card p-4 mb-4">
                <QrCode size={20} className="text-gray-400 mx-auto mb-2" />
                <p className="text-lg font-mono font-bold text-gray-900 dark:text-white tracking-wider">{qrCode}</p>
                <button onClick={copyCode} className="mt-2 flex items-center gap-1 mx-auto text-xs text-primary-500">
                  <Copy size={12} /> Copy code
                </button>
              </div>
              <button
                onClick={onClose}
                className="w-full gradient-primary text-white py-3 rounded-xl text-sm font-semibold"
              >
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-4">
              <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <p className="text-sm text-red-600 dark:text-red-400 mb-4">{errorMsg}</p>
              <button
                onClick={() => setStep('confirm')}
                className="w-full py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-300"
              >
                Try Again
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
