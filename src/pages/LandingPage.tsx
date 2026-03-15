import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Wind, Leaf, Gift, MapPin, ArrowRight } from 'lucide-react';

const sections = [
  {
    icon: Wind,
    title: 'Breathe Cleaner Air',
    desc: 'Our VAYU Engine analyzes real-time air quality to find the cleanest walking routes for you.',
    gradient: 'from-sky-500 to-cyan-400',
  },
  {
    icon: MapPin,
    title: 'Smart Route Planning',
    desc: 'Avoid pollution hotspots. Walk through parks, green spaces, and low-traffic streets.',
    gradient: 'from-emerald-500 to-green-400',
  },
  {
    icon: Leaf,
    title: 'Track Your Eco Impact',
    desc: 'See exactly how much CO₂ you save, steps you take, and your contribution to a greener city.',
    gradient: 'from-green-500 to-lime-400',
  },
  {
    icon: Gift,
    title: 'Earn Real Rewards',
    desc: 'Collect EcoPoints with every walk and redeem them at eco-friendly merchants near you.',
    gradient: 'from-amber-500 to-yellow-400',
  },
];

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'How it Works', href: '#how' },
  { label: 'About', href: '/about' },
];

/** Animated silk-like SVG background */
function SilkBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <svg className="absolute w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="silk-blur">
            <feGaussianBlur stdDeviation="60" />
          </filter>
        </defs>
        <g filter="url(#silk-blur)" opacity="0.25">
          <circle cx="300" cy="400" r="250" fill="#10b981">
            <animate attributeName="cx" values="300;500;300" dur="20s" repeatCount="indefinite" />
            <animate attributeName="cy" values="400;300;400" dur="15s" repeatCount="indefinite" />
          </circle>
          <circle cx="700" cy="600" r="200" fill="#0ea5e9">
            <animate attributeName="cx" values="700;500;700" dur="18s" repeatCount="indefinite" />
            <animate attributeName="cy" values="600;700;600" dur="22s" repeatCount="indefinite" />
          </circle>
          <circle cx="500" cy="200" r="180" fill="#f59e0b">
            <animate attributeName="cx" values="500;600;500" dur="16s" repeatCount="indefinite" />
            <animate attributeName="cy" values="200;350;200" dur="19s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
    </div>
  );
}

function StackCard({ index, total }: { index: number; total: number }) {
  const { icon: Icon, title, desc, gradient } = sections[index];
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [index / total, (index + 1) / total], [0, -60]);
  const scale = useTransform(scrollYProgress, [index / total, (index + 1) / total], [1, 0.95]);

  return (
    <motion.div
      style={{ y, scale }}
      className="sticky top-32 mx-auto max-w-lg w-full"
    >
      <div className="glass-card p-6 shadow-xl">
        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-lg`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-[300vh] bg-gray-50 dark:bg-gray-950 relative">
      <SilkBackground />

      {/* Floating nav */}
      <motion.nav
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 glass-nav px-6 py-2.5 rounded-full flex items-center gap-6 shadow-lg"
      >
        <span className="text-sm font-bold text-primary-600 dark:text-primary-400">🍃 Breeva</span>
        {navLinks.map(link => (
          <a
            key={link.label}
            href={link.href}
            className="text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-primary-500 transition-colors hidden sm:block"
          >
            {link.label}
          </a>
        ))}
        <Link
          to="/login"
          className="gradient-primary text-white text-xs font-semibold py-1.5 px-4 rounded-full shadow-sm hover:shadow-md transition-all"
        >
          Sign In
        </Link>
      </motion.nav>

      {/* Hero */}
      <div className="flex flex-col items-center justify-center h-screen px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="text-6xl mb-4">🍃</div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Breeva</h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-2">Walk Green. Earn Rewards.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 max-w-md mx-auto">
            Choose cleaner air routes, track your walks, earn EcoPoints, and redeem rewards at eco-friendly merchants.
          </p>
          <Link
            to="/login"
            className="gradient-primary text-white text-sm font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all inline-flex items-center gap-2"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
          <motion.p
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            className="mt-12 text-xs text-gray-400"
          >
            Scroll to explore ↓
          </motion.p>
        </motion.div>
      </div>

      {/* Stats bar */}
      <div className="flex justify-center gap-8 pb-16 px-6" id="features">
        {[
          { value: '10K+', label: 'Green Walks' },
          { value: '2.5T', label: 'CO₂ Saved' },
          { value: '500+', label: 'Eco Merchants' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="text-center"
          >
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Scroll stack sections */}
      <div className="px-6 space-y-[50vh] pb-[30vh]" id="how">
        {sections.map((_, i) => (
          <StackCard key={i} index={i} total={sections.length} />
        ))}
      </div>

      {/* Bottom CTA */}
      <div className="flex items-center justify-center pb-20 px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="glass-card p-8 max-w-lg w-full text-center"
        >
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Ready to walk green?</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Join thousands making their city cleaner, one step at a time.</p>
          <Link
            to="/login"
            className="gradient-primary text-white text-sm font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all inline-flex items-center gap-2"
          >
            Start Your Journey <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 px-6">
        <div className="max-w-lg mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-400 dark:text-gray-500">
            © {new Date().getFullYear()} Breeva. Walk green, breathe clean.
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Terms</Link>
            <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">Privacy</Link>
            <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
