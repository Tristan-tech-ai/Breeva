import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Store, Gift, User } from 'lucide-react';
import logoBreeva from '../../assets/logo-breeva.svg';

const tabs = [
  { path: '/', label: 'Home', Icon: Home, badgeKey: null },
  { path: '/merchants', label: 'Merchants', Icon: Store, badgeKey: null },
  { path: '/walk', label: 'Breeva', Icon: null as unknown as typeof Home, isCenter: true, badgeKey: null },
  { path: '/rewards', label: 'Rewards', Icon: Gift, badgeKey: 'rewards' as const },
  { path: '/profile', label: 'Profile', Icon: User, badgeKey: 'profile' as const },
];

interface BottomNavigationProps {
  badges?: Partial<Record<'rewards' | 'profile', boolean>>;
}

export default function BottomNavigation({ badges }: BottomNavigationProps) {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom" role="navigation" aria-label="Main navigation">
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-2xl border-t border-white/20 dark:border-white/10">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2" role="tablist">
          {tabs.map((tab) => {
            const isActive =
              location.pathname === tab.path ||
              (tab.path !== '/' && location.pathname.startsWith(tab.path));

            if (tab.isCenter) {
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  role="tab"
                  aria-current={isActive ? 'page' : undefined}
                  aria-label="Breeva Home"
                  className="relative flex flex-col items-center justify-center flex-1 -mt-5"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 hover:scale-105 active:scale-95 transition-all ring-2 ring-primary-200">
                    <img src={logoBreeva} alt="Breeva" className="w-9 h-9 object-contain" />
                  </div>
                </Link>
              );
            }

            return (
              <Link
                key={tab.path}
                to={tab.path}
                role="tab"
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
                className={`flex flex-col items-center justify-center gap-1 flex-1 py-1 relative transition-colors duration-200 ${
                  isActive
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 dark:text-gray-600'
                }`}
              >
                <div className="relative">
                  <tab.Icon
                    className="w-5 h-5"
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  {tab.badgeKey && badges?.[tab.badgeKey] && !isActive && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger-500 ring-2 ring-white dark:ring-gray-900" />
                  )}
                </div>
                <span className={`text-[11px] font-medium ${isActive ? 'font-semibold' : ''}`}>
                  {tab.label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="nav-dot"
                    className="absolute -top-0.5 w-1 h-1 rounded-full bg-primary-500"
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
