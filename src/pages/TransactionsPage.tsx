import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Coins, Footprints, Trophy, CalendarCheck, Gift, Flame, Ticket, Wind, ArrowDownRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { formatNumber } from '../lib/utils';
import BottomNavigation from '../components/layout/BottomNavigation';
import { SkeletonList } from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import HeroCard from '../components/ui/HeroCard';
import Segmented from '../components/ui/Segmented';
import AnimatedNumber from '../components/ui/AnimatedNumber';

interface Transaction {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
}
type FilterType = 'all' | 'earned' | 'redeemed';

function txVisual(type: string, amount: number): { Icon: LucideIcon; tint: string } {
  if (amount < 0) return { Icon: ArrowDownRight, tint: 'text-rose-500 bg-rose-50 dark:bg-rose-500/10' };
  const t = type.toLowerCase();
  if (t.includes('walk')) return { Icon: Footprints, tint: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' };
  if (t.includes('achievement')) return { Icon: Trophy, tint: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' };
  if (t.includes('quest')) return { Icon: CalendarCheck, tint: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' };
  if (t.includes('streak')) return { Icon: Flame, tint: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' };
  if (t.includes('calibration') || t.includes('contrib')) return { Icon: Wind, tint: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10' };
  if (t.includes('redeem') || t.includes('voucher') || t.includes('reward')) return { Icon: Ticket, tint: 'text-pink-500 bg-pink-50 dark:bg-pink-500/10' };
  if (t.includes('bonus')) return { Icon: Gift, tint: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' };
  return { Icon: Coins, tint: 'text-primary-500 bg-primary-50 dark:bg-primary-500/10' };
}

export default function TransactionsPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!user) return;
      setIsLoading(true);
      try {
        let query = supabase
          .from('points_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100);
        if (filter === 'earned') query = query.gt('amount', 0);
        else if (filter === 'redeemed') query = query.lt('amount', 0);
        const { data, error } = await query;
        if (error) throw error;
        if (data) setTransactions(data);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTransactions();
  }, [user, filter]);

  const formatDate = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const formatTime = (s: string) => new Date(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const grouped = transactions.reduce((acc, t) => {
    const k = formatDate(t.created_at);
    (acc[k] ??= []).push(t);
    return acc;
  }, {} as Record<string, Transaction[]>);

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-accent-400/15 blur-3xl" />
      <PageHeader title="Transaksi" onBack={() => navigate(-1)} />

      <div className="relative max-w-2xl mx-auto px-4 pt-4 space-y-4">
        <HeroCard
          eyebrow="Saldo EcoPoin"
          title={
            <span className="flex items-baseline gap-1.5">
              <AnimatedNumber value={profile?.ecopoints_balance ?? 0} />
              <span className="text-sm font-semibold text-white/80">poin</span>
            </span>
          }
          subtitle="Saldo = jumlah seluruh transaksimu"
          media={<div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center"><Coins className="w-7 h-7 text-white" /></div>}
        />

        <Segmented<FilterType>
          idBase="tx-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Semua' },
            { value: 'earned', label: 'Masuk' },
            { value: 'redeemed', label: 'Keluar' },
          ]}
        />

        {isLoading ? (
          <SkeletonList rows={5} />
        ) : transactions.length === 0 ? (
          <EmptyState icon={Coins} title="Belum ada transaksi" description="Mulai berjalan untuk mengumpulkan EcoPoin!" />
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">{date}</h3>
              <div className="glass-card overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((tx, index) => {
                  const { Icon, tint } = txVisual(tx.transaction_type, tx.amount);
                  return (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(index * 0.025, 0.3) }}
                      className="flex items-center justify-between px-3.5 py-3 gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white truncate capitalize">
                            {tx.description || tx.transaction_type.replace(/_/g, ' ')}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{formatTime(tx.created_at)}</div>
                        </div>
                      </div>
                      <div className={`text-sm font-extrabold tabular-nums shrink-0 ${tx.amount > 0 ? 'text-primary-500' : 'text-rose-500'}`}>
                        {tx.amount > 0 ? '+' : ''}{formatNumber(tx.amount)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
