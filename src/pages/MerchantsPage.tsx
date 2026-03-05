import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, BadgeCheck, Star, MapPin } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { supabase } from '../lib/supabase';

interface MerchantRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  address: string | null;
  lat: number;
  lng: number;
  logo_url: string | null;
  is_verified: boolean;
  is_active: boolean;
  rating: number;
  review_count: number;
}

const categoryEmoji: Record<string, string> = {
  'Refill Station': '🫧',
  'Thrift Store': '👕',
  'Vegan': '🥬',
  'Repair Shop': '🔧',
  'Eco Products': '🎋',
  'Café': '☕',
  'Market': '🌾',
  'Books': '📚',
};

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  useEffect(() => {
    const fetchMerchants = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('merchants')
          .select('*')
          .eq('is_active', true)
          .order('rating', { ascending: false });

        if (error) throw error;
        setMerchants(data || []);
      } catch (err) {
        console.error('Failed to fetch merchants:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMerchants();
  }, []);

  const categories = ['All', ...new Set(merchants.map(m => m.category).filter(Boolean) as string[])];

  const filtered = merchants.filter(m => {
    const matchesSearch = !searchQuery || m.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || m.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="gradient-mesh-bg min-h-screen pb-20">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="safe-area-top px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Eco-Merchants</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Discover sustainable businesses near you</p>
        </div>

        {/* Search */}
        <div className="px-4 mb-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/30 dark:border-gray-700/20 shadow-sm">
            <Search size={18} className="text-gray-400" />
            <input
              type="text"
              placeholder="Search merchants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="px-4 flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-medium transition ${
                cat === selectedCategory
                  ? 'gradient-primary text-white shadow-sm shadow-primary-500/25'
                  : 'bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-gray-200/30 dark:border-gray-700/20 text-gray-600 dark:text-gray-300 hover:bg-white/80 dark:hover:bg-gray-800/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4 flex flex-col gap-3">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-gray-400">Loading merchants...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <MapPin size={40} className="text-gray-300 dark:text-gray-600" />
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                {merchants.length === 0 ? 'No Merchants Yet' : 'No Matches'}
              </h3>
              <p className="text-xs text-gray-400 max-w-xs">
                {merchants.length === 0
                  ? 'Eco-merchants will appear here once partners are onboarded. You can suggest a merchant from the Contribute page!'
                  : 'Try a different search or category.'}
              </p>
            </div>
          ) : (
            filtered.map((merchant, i) => (
              <motion.div
                key={merchant.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/30 dark:border-gray-700/20 shadow-sm p-4 flex gap-3 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-100 to-secondary-100 dark:from-primary-900/30 dark:to-secondary-900/30 flex items-center justify-center text-2xl flex-shrink-0">
                  {merchant.logo_url ? (
                    <img src={merchant.logo_url} className="w-10 h-10 rounded-lg object-cover" alt="" />
                  ) : (
                    categoryEmoji[merchant.category || ''] || '🏪'
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{merchant.name}</h3>
                    {merchant.is_verified && (
                      <BadgeCheck size={14} className="text-primary-500 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{merchant.category || 'General'} · {merchant.address || 'No address'}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex items-center gap-0.5">
                      <Star size={11} className="text-amber-400" fill="currentColor" />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{merchant.rating?.toFixed(1) || '—'}</span>
                    </div>
                    <span className="text-[10px] text-gray-400">({merchant.review_count || 0})</span>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
