import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Home, User, Settings, Trophy, Gift, MapPin, Leaf,
  HelpCircle, BarChart3, History, Coins, BookOpen,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
  keywords: string[];
}

const commands: Command[] = [
  { id: 'home', label: 'Go to Home', icon: Home, path: '/', keywords: ['map', 'dashboard'] },
  { id: 'profile', label: 'My Profile', icon: User, path: '/profile', keywords: ['account', 'me'] },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings', keywords: ['preferences', 'config'] },
  { id: 'rewards', label: 'Rewards', icon: Gift, path: '/rewards', keywords: ['vouchers', 'redeem', 'points'] },
  { id: 'merchants', label: 'Merchants', icon: MapPin, path: '/merchants', keywords: ['stores', 'shops'] },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, path: '/leaderboard', keywords: ['ranking', 'top'] },
  { id: 'eco-impact', label: 'Eco Impact', icon: Leaf, path: '/eco-impact', keywords: ['co2', 'environment', 'carbon'] },
  { id: 'walks', label: 'Walk History', icon: History, path: '/walks', keywords: ['history', 'routes'] },
  { id: 'achievements', label: 'Achievements', icon: BarChart3, path: '/achievements', keywords: ['badges', 'quests'] },
  { id: 'transactions', label: 'Transactions', icon: Coins, path: '/transactions', keywords: ['spending', 'points'] },
  { id: 'eco-tips', label: 'Eco Tips', icon: BookOpen, path: '/eco-tips', keywords: ['tips', 'advice'] },
  { id: 'help', label: 'Help & Support', icon: HelpCircle, path: '/help', keywords: ['support', 'faq'] },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onFocusSearch = () => setOpen(true);
    window.addEventListener('breeva:focus-search', onFocusSearch);
    return () => window.removeEventListener('breeva:focus-search', onFocusSearch);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.keywords.some(k => k.includes(q))
    );
  }, [query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const runCommand = (cmd: Command) => {
    setOpen(false);
    navigate(cmd.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      runCommand(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[101] w-[90%] max-w-md"
          >
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <Search size={18} className="text-gray-400 flex-shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search commands..."
                  className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none"
                />
                <kbd className="hidden sm:inline-flex text-[10px] text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">Esc</kbd>
              </div>
              <div className="max-h-[300px] overflow-y-auto py-2">
                {filtered.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No results found</p>
                ) : (
                  filtered.map((cmd, i) => {
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        onClick={() => runCommand(cmd)}
                        onMouseEnter={() => setSelectedIdx(i)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          i === selectedIdx
                            ? 'bg-primary-50 dark:bg-primary-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <Icon size={16} className={i === selectedIdx ? 'text-primary-500' : 'text-gray-400'} />
                        <span className={`text-sm ${i === selectedIdx ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {cmd.label}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
