import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { formatNumber } from '../lib/utils';
import BottomNavigation from '../components/layout/BottomNavigation';

interface Transaction {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  created_at: string;
}

type FilterType = 'all' | 'earned' | 'redeemed';

export default function TransactionsPage() {
  const { user } = useAuthStore();
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
          .limit(50);

        if (filter === 'earned') {
          query = query.gt('amount', 0);
        } else if (filter === 'redeemed') {
          query = query.lt('amount', 0);
        }

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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Group transactions by date
  const grouped = transactions.reduce((acc, t) => {
    const dateKey = formatDate(t.created_at);
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(t);
    return acc;
  }, {} as Record<string, Transaction[]>);

  const getTransactionIcon = (type: string, amount: number) => {
    if (amount < 0) return '🔻';
    switch (type) {
      case 'walk_completed': return '🚶';
      case 'quest_completed': return '📅';
      case 'achievement': return '🏆';
      case 'voucher_redeem': return '🎫';
      case 'bonus': return '🎁';
      case 'streak': return '🔥';
      default: return amount > 0 ? '💰' : '💳';
    }
  };

  const filters: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'earned', label: 'Earned' },
    { value: 'redeemed', label: 'Redeemed' },
  ];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Transactions</h1>
        <div className="w-6" />
      </div>

      {/* Filter Tabs */}
      <div className="px-4 pt-4 pb-2 flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              filter === f.value
                ? 'gradient-primary text-white shadow-md'
                : 'glass-button text-gray-600 dark:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-2 pb-12">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : transactions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-12 text-center"
          >
            <div className="text-5xl mb-4">💰</div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              No transactions yet
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Start walking to earn EcoPoints!
            </p>
          </motion.div>
        ) : (
          Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="mb-4">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">
                {date}
              </h3>
              <div className="glass-card overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((tx, index) => (
                  <motion.div
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="flex items-center justify-between px-4 py-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {getTransactionIcon(tx.transaction_type, tx.amount)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {tx.description || tx.transaction_type.replace(/_/g, ' ')}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {formatTime(tx.created_at)}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`text-sm font-bold ${
                        tx.amount > 0 ? 'text-primary-500' : 'text-red-500'
                      }`}
                    >
                      {tx.amount > 0 ? '+' : ''}{formatNumber(tx.amount)}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
