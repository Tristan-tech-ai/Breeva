import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Leaf, Globe, Shield, Heart, Github, Mail, ExternalLink } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import logoBreeva from '../assets/logo-breeva.svg';

const stats = [
  { label: 'Launch Year', value: '2026' },
  { label: 'Platform', value: 'Web + PWA' },
  { label: 'Version', value: 'v0.1.0 Beta' },
];

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-300 p-1">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">About Breeva</h1>
        <div className="w-6" />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center text-center"
        >
          <div className="w-20 h-20 rounded-2xl bg-white dark:bg-gray-900 shadow-lg flex items-center justify-center mb-4 ring-2 ring-primary-100">
            <img src={logoBreeva} alt="Breeva" className="w-12 h-12 object-contain" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Breeva</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Eco-friendly Navigation for a Greener Future</p>
          <div className="flex gap-3 mt-3">
            {stats.map(s => (
              <div key={s.label} className="px-3 py-1.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-xs font-medium text-primary-600 dark:text-primary-400">
                {s.value}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Mission */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-5"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Leaf className="w-4 h-4 text-primary-500" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Our Mission</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            Breeva was created to make sustainable transportation rewarding and accessible. We believe 
            every step you take toward eco-friendly commuting matters — and should be recognized.
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-3">
            Our goal is to reduce urban carbon emissions by incentivizing walking, cycling, and 
            green transport through EcoPoints, real-time air quality data, and eco-route recommendations.
          </p>
        </motion.div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-5"
        >
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">How Breeva Works</h3>
          <div className="space-y-4">
            {[
              { step: '1', icon: Globe, title: 'Choose Your Route', desc: 'Pick from fastest, balanced, or eco-friendly routes with real AQI data.' },
              { step: '2', icon: Heart, title: 'Walk & Earn', desc: 'Track your walk and earn EcoPoints for every kilometer completed.' },
              { step: '3', icon: Shield, title: 'Redeem Rewards', desc: 'Use your EcoPoints at sustainable merchants for discounts and perks.' },
            ].map((item, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {item.step}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{item.title}</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card p-5"
        >
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Key Features</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: '🗺️', label: 'Smart Routing', desc: '3 route options with AQI' },
              { icon: '🌱', label: 'EcoPoints', desc: 'Earn rewards for walking' },
              { icon: '💨', label: 'Air Quality', desc: 'Real-time AQI overlay' },
              { icon: '🏪', label: 'Eco Merchants', desc: 'Sustainable businesses' },
              { icon: '🚴', label: 'Multi-mode', desc: 'Walk, cycle, e-bike, drive' },
              { icon: '📊', label: 'Eco Impact', desc: 'Track your CO₂ savings' },
            ].map((f) => (
              <div key={f.label} className="flex items-start gap-2.5 p-2">
                <span className="text-lg">{f.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{f.label}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Tech & Credits */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="glass-card p-5"
        >
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Built With</h3>
          <div className="flex flex-wrap gap-2">
            {['React 19', 'TypeScript', 'Vite', 'Tailwind CSS v4', 'MapLibre GL', 'Supabase', 'OpenRouteService', 'Open-Meteo AQI', 'Framer Motion', 'Zustand'].map(tech => (
              <span key={tech} className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-[10px] font-medium text-gray-600 dark:text-gray-400">
                {tech}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Contact */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card p-5"
        >
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Contact Us</h3>
          <div className="space-y-2.5">
            <a
              href="mailto:support@breeva.app"
              className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-500 transition"
            >
              <Mail className="w-4 h-4" />
              support@breeva.app
            </a>
            <a
              href="https://github.com/breeva"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-500 transition"
            >
              <Github className="w-4 h-4" />
              github.com/breeva
              <ExternalLink className="w-3 h-3 ml-auto" />
            </a>
          </div>
        </motion.div>

        {/* Footer */}
        <div className="text-center pt-2">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            © 2026 Breeva. All rights reserved.
          </p>
          <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-1">
            Made with 💚 for a greener planet
          </p>
        </div>
      </div>

      <BottomNavigation />
    </div>
  );
}
