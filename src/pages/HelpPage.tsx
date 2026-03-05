import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  MessageCircle,
  Mail,
  FileText,
  ChevronRight,
  ExternalLink,
  Search,
  Leaf,
  Map,
  Wallet,
  Shield,
  Smartphone,
} from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQItem[] = [
  {
    category: 'Getting Started',
    question: 'How do I start a walk?',
    answer: 'Open the map (Home tab), search for a destination or tap on the map, then tap "Start Walk" on the route card. Breeva will track your walk and award EcoPoints when you finish.',
  },
  {
    category: 'Getting Started',
    question: 'What are EcoPoints?',
    answer: 'EcoPoints are rewards you earn for walking and choosing eco-friendly routes. You can redeem them at sustainable merchants for discounts and perks.',
  },
  {
    category: 'Getting Started',
    question: 'How is the eco-route different from the fast route?',
    answer: 'The eco-route avoids areas with poor air quality and prioritizes greener paths. It may be slightly longer but keeps you breathing cleaner air and earns more EcoPoints.',
  },
  {
    category: 'Routes & Maps',
    question: 'Why do I see different route colors on the map?',
    answer: 'Green = Eco Route (cleanest air), Blue = Balanced Route, Orange = Fast Route. Each route has different distance, duration, and air quality characteristics.',
  },
  {
    category: 'Routes & Maps',
    question: 'What is AQI and how is it measured?',
    answer: 'AQI (Air Quality Index) indicates how clean or polluted the air is. We use real-time data from Open-Meteo\'s air quality sensors. Lower AQI = better air.',
  },
  {
    category: 'Routes & Maps',
    question: 'Can I use different transport modes?',
    answer: 'Yes! Breeva supports Walking, Cycling, E-Bike, Motorcycle, and Car modes. Walking and cycling earn the most EcoPoints since they produce zero emissions.',
  },
  {
    category: 'EcoPoints & Rewards',
    question: 'How are EcoPoints calculated?',
    answer: 'EcoPoints are based on distance traveled and transport mode. Walking earns 1.5x, cycling 1.2x, e-bike 1.0x. Motorized transport earns fewer or zero points.',
  },
  {
    category: 'EcoPoints & Rewards',
    question: 'Where can I redeem my EcoPoints?',
    answer: 'Visit the Rewards tab to browse available vouchers from eco-merchants. Tap a voucher to redeem it with your EcoPoints balance.',
  },
  {
    category: 'Account & Privacy',
    question: 'Is my location data private?',
    answer: 'Yes. Your location is only used locally for navigation and is never shared with third parties. Walk data is stored securely in your personal account.',
  },
  {
    category: 'Account & Privacy',
    question: 'How do I delete my account?',
    answer: 'Go to Profile → Settings → Privacy → "Delete My Data". This will permanently remove all your data from our servers.',
  },
];

const categories = ['All', 'Getting Started', 'Routes & Maps', 'EcoPoints & Rewards', 'Account & Privacy'];

const categoryIcons: Record<string, React.ReactNode> = {
  'Getting Started': <Leaf className="w-4 h-4" />,
  'Routes & Maps': <Map className="w-4 h-4" />,
  'EcoPoints & Rewards': <Wallet className="w-4 h-4" />,
  'Account & Privacy': <Shield className="w-4 h-4" />,
};

export default function HelpPage() {
  const navigate = useNavigate();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const filtered = faqs.filter(faq => {
    const matchesSearch = !searchQuery ||
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Help & Support</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-gray-700/30 shadow-sm">
          <Search size={18} className="text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search for help..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex-shrink-0 px-3.5 py-2 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                cat === selectedCategory
                  ? 'gradient-primary text-white shadow-sm shadow-primary-500/25'
                  : 'bg-white dark:bg-gray-900/60 backdrop-blur-sm border border-gray-200 dark:border-gray-700/30 text-gray-600 dark:text-gray-300'
              }`}
            >
              {cat !== 'All' && categoryIcons[cat]}
              {cat}
            </button>
          ))}
        </div>

        {/* FAQ List */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No matching questions found</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Try different keywords or contact us below</p>
            </div>
          ) : (
            filtered.map((faq, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass-card overflow-hidden"
              >
                <button
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-primary-500 mt-0.5 flex-shrink-0">
                      {categoryIcons[faq.category] || <Smartphone className="w-4 h-4" />}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{faq.question}</span>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform ${
                      openIdx === i ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                {openIdx === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="px-4 pb-4 pl-11"
                  >
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                      {faq.answer}
                    </p>
                  </motion.div>
                )}
              </motion.div>
            ))
          )}
        </div>

        {/* Contact Options */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
            Still need help?
          </h3>
          <div className="space-y-2">
            <a
              href="mailto:support@breeva.app?subject=Breeva%20Support%20Request"
              className="glass-card flex items-center gap-3 px-4 py-3.5 hover:bg-white dark:bg-gray-900/60 dark:hover:bg-gray-800/60 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Mail className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Email Support</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">support@breeva.app</p>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </a>
            <button
              onClick={() => navigate('/contribute')}
              className="glass-card flex items-center gap-3 px-4 py-3.5 hover:bg-white dark:bg-gray-900/60 dark:hover:bg-gray-800/60 transition-colors w-full text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-primary-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Report an Issue</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Help improve Breeva for everyone</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </button>
            <button
              onClick={() => navigate('/about')}
              className="glass-card flex items-center gap-3 px-4 py-3.5 hover:bg-white dark:bg-gray-900/60 dark:hover:bg-gray-800/60 transition-colors w-full text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">About Breeva</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Learn more about our mission</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
            </button>
          </div>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
