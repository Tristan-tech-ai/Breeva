import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Wind, Leaf, Gift, MapPin } from 'lucide-react';

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
    <div className="gradient-mesh-bg min-h-[300vh]">
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
            className="gradient-primary text-white text-sm font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all inline-block"
          >
            Get Started
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

      {/* Scroll stack sections */}
      <div className="px-6 space-y-[50vh] pb-[30vh]">
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
            className="gradient-primary text-white text-sm font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all inline-block"
          >
            Start Your Journey
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
