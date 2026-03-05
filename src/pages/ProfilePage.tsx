import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BarChart3, Trophy, Coins, Settings, HelpCircle, LogOut, Leaf, Flame, TreePine, Pencil, Info } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { formatNumber } from '../lib/utils';
import BottomNavigation from '../components/layout/BottomNavigation';

export default function ProfilePage() {
  const { profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const co2Saved = ((profile?.total_distance_km || 0) * 0.17).toFixed(1);
  const calories = Math.round((profile?.total_distance_km || 0) * 60);
  const treesEquivalent = ((profile?.total_distance_km || 0) * 0.17 / 22).toFixed(2);

  const menuItems = [
    { icon: <BarChart3 size={18} />, label: 'Walk History', path: '/profile/history', color: 'text-blue-500' },
    { icon: <Trophy size={18} />, label: 'Achievements', path: '/profile/achievements', color: 'text-amber-500' },
    { icon: <Coins size={18} />, label: 'Point Transactions', path: '/profile/transactions', color: 'text-emerald-500' },
    { icon: <Settings size={18} />, label: 'Settings', path: '/profile/settings', color: 'text-gray-500 dark:text-gray-400' },
    { icon: <HelpCircle size={18} />, label: 'Help & Support', path: '/help', color: 'text-violet-500' },
    { icon: <Info size={18} />, label: 'About Breeva', path: '/about', color: 'text-cyan-500' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24">
      {/* Gradient Header */}
      <div className="relative gradient-primary pb-20 pt-12 px-6">
        <div className="absolute inset-0 bg-white/10 dark:bg-gray-900/20 backdrop-blur-sm" />

        <div className="max-w-2xl mx-auto relative z-10">
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate(-1)}
            className="text-white/80 hover:text-white mb-6 p-1 -ml-1"
          >
            <ChevronLeft size={24} />
          </motion.button>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col items-center"
          >
            <div className="w-24 h-24 rounded-full border-4 border-white/30 overflow-hidden bg-white dark:bg-gray-900/20 backdrop-blur-sm shadow-xl">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.name || 'Profile'} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl text-white font-bold">
                  {profile?.name?.[0]?.toUpperCase() || '?'}
                </div>
              )}
            </div>
            <h1 className="mt-3 text-xl font-bold text-white">{profile?.name || 'Eco Walker'}</h1>
            <p className="text-white/70 text-sm">@{profile?.email?.split('@')[0] || 'user'}</p>
            <Link
              to="/profile/edit"
              className="mt-2 flex items-center gap-1 text-xs text-white/60 hover:text-white/90 transition"
            >
              <Pencil size={11} />
              Edit Profile
            </Link>
          </motion.div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Glass Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mx-4 -mt-12 relative z-10"
        >
          <div className="rounded-2xl bg-white dark:bg-gray-900/90 backdrop-blur-2xl border border-gray-200 dark:border-gray-700/30 shadow-lg p-5">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-lg font-bold tabular-nums text-accent-500">{formatNumber(profile?.ecopoints_balance || 0)}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">Points</div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{(profile?.total_distance_km || 0).toFixed(1)}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">km</div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{profile?.total_walks || 0}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">Walks</div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums text-primary-500">{profile?.current_streak || 0}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-1">Streak</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Environmental Impact Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mx-4 mt-4"
        >
          <div className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
              Your Environmental Impact
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 mb-1.5">
                  <Leaf size={18} className="text-emerald-500" />
                </div>
                <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{co2Saved} kg</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">CO₂ Saved</div>
              </div>
              <div>
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-500/10 mb-1.5">
                  <Flame size={18} className="text-orange-500" />
                </div>
                <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{formatNumber(calories)}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Calories</div>
              </div>
              <div>
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 mb-1.5">
                  <TreePine size={18} className="text-green-600" />
                </div>
                <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{treesEquivalent}</div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Trees equiv.</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Menu List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mx-4 mt-4"
        >
          <div className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm overflow-hidden divide-y divide-gray-100 dark:divide-gray-800/50">
            {menuItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:bg-gray-950/50 dark:hover:bg-white dark:bg-gray-900/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={item.color}>{item.icon}</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                </div>
                <ChevronRight size={16} className="text-gray-400 dark:text-gray-500" />
              </Link>
            ))}
          </div>
        </motion.div>

        {/* Sign Out */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mx-4 mt-4"
        >
          <button
            onClick={handleSignOut}
            className="rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm w-full py-4 px-5 flex items-center justify-center gap-2 text-red-500 hover:bg-red-50/50 dark:hover:bg-red-900/10 transition-colors"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </motion.div>
      </div>

      <BottomNavigation />
    </div>
  );
}
