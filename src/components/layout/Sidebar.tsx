import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  X,
  Bookmark,
  Clock,
  Leaf,
  Share2,
  MapPinPlus,
  Globe,
  Settings,
  Lightbulb,
  HelpCircle,
  Info,
  ChevronRight,
  LogOut,
  Gift,
  Trophy,
  Swords,
  BarChart3,
  Store,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useI18nStore } from '../../stores/i18nStore';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const menuSections = [
  {
    items: [
      { icon: Bookmark, label: 'Saved Places', path: '/saved', color: 'text-amber-500' },
      { icon: Clock, label: 'Walk History', path: '/profile/history', color: 'text-blue-500' },
      { icon: Leaf, label: 'Eco Impact', path: '/eco-impact', color: 'text-primary-500' },
      { icon: Gift, label: 'Rewards', path: '/rewards', color: 'text-pink-500' },
      { icon: Trophy, label: 'Achievements', path: '/profile/achievements', color: 'text-yellow-500' },
      { icon: Swords, label: 'Quests', path: '/quests', color: 'text-indigo-500' },
      { icon: BarChart3, label: 'Leaderboard', path: '/leaderboard', color: 'text-emerald-500' },
      { icon: Store, label: 'Merchants', path: '/merchants', color: 'text-orange-500' },
      { icon: Share2, label: 'Share Location', path: '#share', color: 'text-violet-500' },
    ],
  },
  {
    title: 'Contribute',
    items: [
      { icon: MapPinPlus, label: 'Add Missing Place', path: '/contribute', color: 'text-rose-500' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { icon: Globe, label: 'Language', path: '#lang', color: 'text-cyan-500', badge: 'LANG' },
      { icon: Settings, label: 'Settings', path: '/profile/settings', color: 'text-gray-500 dark:text-gray-400' },
    ],
  },
  {
    title: 'Help',
    items: [
      { icon: Lightbulb, label: 'Eco Tips & Tricks', path: '/eco-tips', color: 'text-amber-500' },
      { icon: HelpCircle, label: 'Help & Feedback', path: '/help', color: 'text-blue-500' },
      { icon: Info, label: 'About Breeva', path: '/about', color: 'text-gray-500 dark:text-gray-400' },
    ],
  },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { profile, signOut } = useAuthStore();
  const { locale, setLocale } = useI18nStore();

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleItemClick = (path: string) => {
    if (path.startsWith('#')) {
      if (path === '#share') {
        handleShareLocation();
      }
      if (path === '#lang') {
        setLocale(locale === 'en' ? 'id' : 'en');
      }
      return;
    }
    onClose();
  };

  const handleShareLocation = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'My Location - Breeva',
          text: 'Check out my location on Breeva!',
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        alert('Location link copied to clipboard!');
      }
    } catch {
      // User cancelled share
    }
    onClose();
  };

  const handleSignOut = async () => {
    await signOut();
    onClose();
    window.location.href = '/login';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
          />

          {/* Sidebar Panel */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed top-0 left-0 bottom-0 z-[61] w-[300px] max-w-[85vw] bg-white dark:bg-gray-900/95 backdrop-blur-2xl shadow-2xl flex flex-col"
          >
            {/* User Header */}
            <div className="gradient-primary p-5 pt-12">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white dark:bg-gray-900/10 transition"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 mb-3">
                <div className="w-14 h-14 rounded-full border-2 border-white/30 overflow-hidden bg-white dark:bg-gray-900/20 shadow-lg flex-shrink-0">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl text-white font-bold">
                      {profile?.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{profile?.full_name || 'Eco Walker'}</h3>
                  <p className="text-white/60 text-xs truncate">{profile?.email || ''}</p>
                </div>
              </div>

              {/* Quick stats */}
              <div className="flex items-center gap-4 text-white/80">
                <div className="flex items-center gap-1">
                  <Leaf className="w-3 h-3" />
                  <span className="text-xs font-medium">{profile?.ecopoints_balance || 0} pts</span>
                </div>
                <div className="text-xs">·</div>
                <div className="text-xs">
                  {(profile?.total_distance_km || 0).toFixed(1)} km walked
                </div>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
              {menuSections.map((section, sIdx) => (
                <div key={sIdx}>
                  {section.title && (
                    <p className="px-5 pt-4 pb-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      {section.title}
                    </p>
                  )}
                  {section.items.map((item) => {
                    const isLink = !item.path.startsWith('#');
                    const content = (
                      <div className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer">
                        <item.icon className={`w-5 h-5 ${item.color}`} strokeWidth={1.5} />
                        <span className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                          {item.label}
                        </span>
                        {(item as { badge?: string }).badge && (
                          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                            {(item as { badge?: string }).badge === 'LANG' ? locale.toUpperCase() : (item as { badge?: string }).badge}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                      </div>
                    );

                    if (isLink) {
                      return (
                        <Link key={item.label} to={item.path} onClick={() => handleItemClick(item.path)}>
                          {content}
                        </Link>
                      );
                    }
                    return (
                      <div key={item.label} onClick={() => handleItemClick(item.path)}>
                        {content}
                      </div>
                    );
                  })}
                  {sIdx < menuSections.length - 1 && (
                    <div className="mx-5 my-1 border-t border-gray-100 dark:border-gray-800/50" />
                  )}
                </div>
              ))}
            </div>

            {/* Sign Out */}
            <div className="border-t border-gray-100 dark:border-gray-800/50 p-3 px-5">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 w-full py-2.5 text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
              >
                <LogOut className="w-5 h-5" strokeWidth={1.5} />
                Sign Out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
