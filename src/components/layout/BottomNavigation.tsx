import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Wind, Megaphone, Gift, User } from 'lucide-react';
import logoBreeva from '../../assets/logo-breeva.svg';
import { haptic } from '../../lib/haptic';
import { useMapStore } from '../../stores/mapStore';

// AQI band → color (mirrors --color-aqi-* tokens / LeafletMap getAQIColor) so the
// center beacon's halo doubles as a live air-quality indicator.
function aqiToColor(aqi: number | null | undefined): string {
  if (aqi == null) return '#10b981'; // brand emerald (no reading yet)
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#eab308';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#7f1d1d';
}

type BadgeKey = 'rewards' | 'profile';
interface Tab {
  path: string;
  label: string;
  Icon: typeof Wind;
  badgeKey: BadgeKey | null;
}

const TABS: Tab[] = [
  { path: '/paparan', label: 'Paparan', Icon: Wind, badgeKey: null },
  { path: '/contribute', label: 'Kontribusi', Icon: Megaphone, badgeKey: null },
  { path: '/rewards', label: 'Hadiah', Icon: Gift, badgeKey: 'rewards' },
  { path: '/profile', label: 'Profil', Icon: User, badgeKey: 'profile' },
];

interface BottomNavigationProps {
  badges?: Partial<Record<BadgeKey, boolean>>;
}

export default function BottomNavigation({ badges }: BottomNavigationProps) {
  const location = useLocation();
  const reduce = useReducedMotion();
  const currentAQI = useMapStore((s) => s.currentAQI);
  const aqi = currentAQI?.aqi ?? null;
  const aqiColor = aqiToColor(aqi);
  const homeActive = location.pathname === '/home';

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const renderTab = (tab: Tab) => {
    const active = isActive(tab.path);
    return (
      <Link
        key={tab.path}
        to={tab.path}
        role="tab"
        aria-current={active ? 'page' : undefined}
        aria-label={tab.label}
        onClick={() => haptic('light')}
        className="group relative flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px]"
      >
        <span className="relative flex h-7 w-11 items-center justify-center">
          {active && (
            <motion.span
              layoutId="nav-lozenge"
              className="absolute inset-0 rounded-full bg-primary-500/15 dark:bg-primary-400/20"
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            />
          )}
          <tab.Icon
            className={`relative h-[22px] w-[22px] transition-colors duration-200 ${
              active
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200'
            }`}
            strokeWidth={active ? 2.4 : 1.8}
          />
          {tab.badgeKey && badges?.[tab.badgeKey] && !active && (
            <span className="absolute right-1.5 top-0.5 h-2 w-2 rounded-full bg-danger-500 ring-2 ring-white dark:ring-gray-900" />
          )}
        </span>
        <span
          className={`text-[10.5px] leading-none transition-colors duration-200 ${
            active
              ? 'font-bold text-primary-600 dark:text-primary-400'
              : 'font-medium text-gray-500 dark:text-gray-400'
          }`}
        >
          {tab.label}
        </span>
      </Link>
    );
  };

  return (
    // pointer-events-none on the wrapper so the map stays draggable in the margins
    // beside the floating dock; the dock itself re-enables pointer events.
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.55rem,env(safe-area-inset-bottom))]"
      role="navigation"
      aria-label="Navigasi utama"
    >
      <div
        className="pointer-events-auto relative mx-auto flex h-[60px] max-w-md items-center justify-around rounded-[26px] border border-white/50 bg-white/60 px-1.5 shadow-[0_10px_34px_-8px_rgba(0,0,0,0.28)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-gray-900/65"
        role="tablist"
      >
        {renderTab(TABS[0])}
        {renderTab(TABS[1])}

        {/* Center — Beranda air-beacon (Home/map + live-AQI breathing halo) */}
        <Link
          to="/home"
          role="tab"
          aria-current={homeActive ? 'page' : undefined}
          aria-label={`Beranda${aqi != null ? ` — kualitas udara AQI ${Math.round(aqi)}` : ''}`}
          onClick={() => haptic('medium')}
          className="relative flex flex-1 flex-col items-center justify-end gap-1 self-stretch pb-1.5"
        >
          <div className="relative -mt-7 flex items-center justify-center">
            {/* breathing AQI halo (decorative) */}
            <motion.span
              aria-hidden
              className="absolute rounded-full"
              style={{ width: 60, height: 60, background: aqiColor, filter: 'blur(11px)' }}
              initial={false}
              animate={
                reduce
                  ? { opacity: 0.4, scale: 1 }
                  : { opacity: [0.35, 0.6, 0.35], scale: [1, 1.16, 1] }
              }
              transition={reduce ? undefined : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* glass core with brand mark + AQI ring */}
            <div
              className="relative flex h-[56px] w-[56px] items-center justify-center rounded-full bg-white transition-transform duration-200 active:scale-95 dark:bg-gray-900"
              style={{ boxShadow: `0 6px 18px -4px ${aqiColor}80, 0 0 0 3px ${aqiColor}` }}
            >
              <img src={logoBreeva} alt="" className="h-9 w-9 object-contain" />
            </div>
          </div>
          <span
            className={`text-[10.5px] leading-none ${
              homeActive
                ? 'font-bold text-primary-600 dark:text-primary-400'
                : 'font-semibold text-gray-600 dark:text-gray-300'
            }`}
          >
            Beranda
          </span>
        </Link>

        {renderTab(TABS[2])}
        {renderTab(TABS[3])}
      </div>
    </nav>
  );
}
