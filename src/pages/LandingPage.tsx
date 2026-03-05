import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function LandingPage() {
  return (
    <div className="gradient-mesh-bg min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-8 max-w-lg w-full text-center"
      >
        <div className="text-5xl mb-4">🍃</div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Breeva</h1>
        <p className="text-base text-gray-600 dark:text-gray-300 mb-2">Walk Green. Earn Rewards.</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Choose cleaner air routes, track your walks, earn EcoPoints, and redeem rewards at eco-friendly merchants.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/login"
            className="gradient-primary text-white text-sm font-semibold py-3 px-8 rounded-xl shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Get Started
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
