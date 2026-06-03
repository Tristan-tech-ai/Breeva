import { useRef, useEffect, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Wind, Shield, Cpu, MapPin, Radio, Flame,
  Satellite, Microscope, MapPinned, TreePine, Store, Trophy,
  Radar, BrainCircuit, BarChart3, Leaf, Heart, Github, Twitter, Mail,
  type LucideIcon,
} from 'lucide-react';

import { Seo } from '../components/Seo';

// Lazy three.js particle canvas — kept off the landing critical path (vendor-three chunk; skipped under reduced-motion).
const ParticleHero = lazy(() => import('./landing/ParticleHero'));

// ── Breeva Logo ─────────────────────────────────────────────────────────────

function BreevaLogo({ className = 'h-6' }: { className?: string }) {
  return (
    <img src="/favicon.svg" alt="Breeva" className={className} />
  );
}

// ── Shared Animation ────────────────────────────────────────────────────────

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.7 },
  viewport: { once: true, margin: '-80px' },
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function LandingPage() {
  const scrollRef = useRef(0);
  // Skip the heavy three.js canvas for users who prefer reduced motion (a11y + perf).
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollRef.current = max > 0 ? window.scrollY / max : 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="bg-white min-h-screen text-slate-900">
      <Seo
        title="Breeva — Navigasi Udara Bersih & Rute Sehat"
        description="Temukan rute jalan kaki paling bersih dengan AQI per-jalan real-time, prakiraan 24 jam, dan kalkulator paparan PM2.5. Kumpulkan EcoPoints di setiap langkah."
        path="/"
      />
      {/* Decorative particle canvas — lazy three.js (off critical path); skipped under reduced-motion */}
      {!reducedMotion && (
        <Suspense fallback={null}>
          <ParticleHero scrollRef={scrollRef} />
        </Suspense>
      )}

      {/* Navigation */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1rem)] sm:w-auto max-w-max bg-white/70 backdrop-blur-xl px-3 sm:px-6 py-2 sm:py-2.5 rounded-full flex items-center justify-between sm:justify-center gap-3 sm:gap-6 shadow-lg border border-white/50">
        <a href="#" className="flex items-center gap-1.5 min-w-0">
          <BreevaLogo className="h-5 w-5" />
          <span className="text-xs sm:text-sm font-bold text-emerald-600 whitespace-nowrap">Breeva</span>
        </a>
        <a href="#problem" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">Why</a>
        <a href="#solution" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">How</a>
        <a href="#science" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">Science</a>
        <Link to="/login" className="bg-emerald-600 text-white text-[11px] sm:text-xs font-semibold py-1.5 px-3 sm:px-4 rounded-full hover:bg-emerald-700 transition-colors whitespace-nowrap shrink-0">
          Sign In
        </Link>
      </nav>

      {/* Sections */}
      <div className="relative" style={{ zIndex: 1 }}>

        {/* ── HERO ── */}
        <section className="min-h-screen flex items-center justify-center px-6 pt-20">
          <div className="max-w-5xl mx-auto flex flex-col lg:flex-row items-center gap-10">
            <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-xl flex-1">
              <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4">
                Walk Cleaner.<br />
                <span className="text-emerald-600">Breathe Easier.</span>
              </h1>
              <p className="text-lg text-slate-500 mb-8 leading-relaxed">
                Breeva maps air quality across every street to find the freshest routes in your city.
                Walk healthier, earn rewards, make a real impact.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to="/login" className="inline-flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold py-3 px-8 rounded-xl hover:bg-emerald-700 shadow-lg transition-all">
                  Start Walking <ArrowRight className="w-4 h-4" />
                </Link>
                <a href="#problem" className="inline-flex items-center justify-center gap-2 bg-slate-100 text-slate-700 font-semibold py-3 px-8 rounded-xl hover:bg-slate-200 transition-all">
                  Learn More
                </a>
              </div>
              <motion.p
                animate={{ y: [0, 8, 0] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="mt-10 text-xs text-slate-400"
              >
                Scroll to explore ↓
              </motion.p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              viewport={{ once: true }}
              className="flex-shrink-0 hidden lg:block"
            >
              <img
                src="/hero.webp"
                alt="Breeva app screenshot"
                className="w-64 rounded-3xl shadow-2xl border-4 border-white/60"
              />
            </motion.div>
          </div>
        </section>

        {/* ── PROBLEM (Storm) ── */}
        <section id="problem" className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              <Wind className="w-4 h-4" /> The Problem
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Your Daily Route Could Be <span className="text-red-500">Toxic</span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Air pollution kills 7 million people every year. Every navigation app ignores air quality
              — routing you through traffic jams, construction zones and industrial corridors.
            </p>
            <div className="grid grid-cols-3 gap-4">
              {[
                ['7M', 'deaths per year'],
                ['99%', 'breathe unsafe air'],
                ['3×', 'more on main roads'],
              ].map(([val, label]) => (
                <div key={label as string} className="text-center p-4 rounded-2xl bg-slate-50">
                  <div className="text-2xl font-bold text-slate-800">{val}</div>
                  <div className="text-xs text-slate-400 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── SOLUTION (Earth) ── */}
        <section id="solution" className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 uppercase tracking-widest mb-4">
              <Shield className="w-4 h-4" /> The Solution
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Meet <span className="text-emerald-600">VAYU</span> — Your Air Quality Brain
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Our VAYU Engine fuses satellite imagery, ground sensors, weather data and traffic patterns
              to map air quality at street-level resolution in real-time.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              {([
                [Satellite, 'Real-time AQI', 'Continuous air quality scoring across every street segment.'],
                [Microscope, 'Multi-source Fusion', 'Satellite, ground stations, traffic and weather combined.'],
                [MapPinned, 'Street-level', 'Resolution accurate to individual road sections.'],
              ] as [LucideIcon, string, string][]).map(([Icon, title, desc]) => (
                <div key={title} className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center mb-2">
                    <Icon className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="font-semibold text-sm text-slate-800">{title}</div>
                  <div className="text-xs text-slate-500 mt-1">{desc}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── ROUTE INTELLIGENCE (Neural Network) ── */}
        <section className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-indigo-500 uppercase tracking-widest mb-4">
              <Cpu className="w-4 h-4" /> Route Intelligence
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Routes That <span className="text-indigo-500">Think</span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Breeva's neural scoring evaluates thousands of path segments to find the cleanest route
              between any two points — typically adding less than 3 minutes to your journey.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 p-5 rounded-2xl bg-red-50 border border-red-100">
                <div className="text-sm font-semibold text-red-600 mb-2">Standard Route</div>
                <div className="text-xs text-slate-500">AQI 142 · Unhealthy</div>
                <div className="text-xs text-slate-500">Via highway + industrial zone</div>
                <div className="text-xs text-slate-500 mt-1 font-medium">18 min</div>
              </div>
              <div className="flex-1 p-5 rounded-2xl bg-emerald-50 border border-emerald-200 ring-2 ring-emerald-300">
                <div className="text-sm font-semibold text-emerald-600 mb-2">Breeva Route ✓</div>
                <div className="text-xs text-slate-500">AQI 38 · Good</div>
                <div className="text-xs text-slate-500">Via park + residential streets</div>
                <div className="text-xs text-slate-500 mt-1 font-medium">21 min (+3 min)</div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ── EXPLORATION (Terrain) ── */}
        <section className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-600 uppercase tracking-widest mb-4">
              <MapPin className="w-4 h-4" /> Exploration
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Discover Your City's <span className="text-green-600">Green Side</span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Find parks, trails and tree-lined streets with the cleanest air.
              Support eco-friendly merchants and earn EcoPoints for every step.
            </p>
            <div className="space-y-3">
              {([
                [TreePine, 'Green Spaces', 'Parks, nature trails and low-traffic streets mapped by air quality.'],
                [Store, 'Eco Merchants', 'Support sustainable businesses and earn bonus rewards.'],
                [Trophy, 'Leaderboard', 'Compete with your community for the cleanest walking streak.'],
              ] as [LucideIcon, string, string][]).map(([Icon, title, desc]) => (
                <div key={title} className="flex items-start gap-3 p-4 rounded-xl bg-green-50 border border-green-100">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-slate-800">{title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── SCIENCE (Satellite) ── */}
        <section id="science" className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-600 uppercase tracking-widest mb-4">
              <Radio className="w-4 h-4" /> Science
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Built on <span className="text-cyan-600">Real Science</span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Our data pipeline ingests GEOS-CF atmospheric models, Sentinel-5P satellite data,
              OpenAQ ground stations and proprietary sensor networks — calibrated with machine learning.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                [Satellite, 'Satellite Data'],
                [Radar, 'Ground Truth'],
                [BrainCircuit, 'ML Calibration'],
                [BarChart3, 'Open Data'],
              ] as [LucideIcon, string][]).map(([Icon, label]) => (
                <div key={label} className="text-center p-4 rounded-2xl bg-cyan-50 border border-cyan-100">
                  <div className="w-9 h-9 rounded-xl bg-cyan-100 flex items-center justify-center mx-auto mb-2">
                    <Icon className="w-4 h-4 text-cyan-600" />
                  </div>
                  <div className="text-xs font-semibold text-slate-600">{label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* ── CTA (Fire) ── */}
        <section className="min-h-screen flex items-center justify-center px-6">
          <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/50 max-w-lg text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-orange-500 uppercase tracking-widest mb-4">
              <Flame className="w-4 h-4" /> Join
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Join the Clean Air <span className="text-orange-500">Movement</span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              Every walk counts. Every breath matters. Start your journey to cleaner air today.
            </p>
            <Link to="/login" className="inline-flex items-center gap-2 bg-emerald-600 text-white font-semibold py-3.5 px-10 rounded-xl hover:bg-emerald-700 shadow-lg transition-all text-lg">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Link>
            <p className="mt-4 text-xs text-slate-400">Free forever · No account fees</p>
          </motion.div>
        </section>

        {/* ── Footer ── */}
        <footer className="py-16 px-6 bg-slate-50 border-t border-slate-100">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
              {/* Brand */}
              <div className="col-span-2 md:col-span-1">
                <div className="flex items-center gap-2 mb-3">
                  <BreevaLogo className="h-6 w-6" />
                  <span className="text-base font-bold text-emerald-600">Breeva</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Cleaner routes, healthier walks. We map air quality at street-level so you can breathe easier every day.
                </p>
                <div className="flex gap-3">
                  <a href="https://github.com/Tristan-tech-ai/Breeva" target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                    <Github className="w-3.5 h-3.5" />
                  </a>
                  <a href="#" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                    <Twitter className="w-3.5 h-3.5" />
                  </a>
                  <a href="#" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                    <Mail className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Product */}
              <div>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">Product</h4>
                <ul className="space-y-2">
                  <li><a href="#solution" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">VAYU Engine</a></li>
                  <li><a href="#science" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Science</a></li>
                  <li><Link to="/peta" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Peta Udara Langsung</Link></li>
                  <li><Link to="/paparan" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Kalkulator Paparan</Link></li>
                  <li><Link to="/developers" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Developer API</Link></li>
                  <li><Link to="/login" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Get Started</Link></li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">Company</h4>
                <ul className="space-y-2">
                  <li><Link to="/about" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">About</Link></li>
                  <li><Link to="/help" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Help & Support</Link></li>
                  <li><Link to="/eco-tips" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Eco Tips</Link></li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <h4 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-3">Legal</h4>
                <ul className="space-y-2">
                  <li><Link to="/terms" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Terms of Service</Link></li>
                  <li><Link to="/privacy" className="text-xs text-slate-400 hover:text-emerald-600 transition-colors">Privacy Policy</Link></li>
                </ul>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                Made with <Heart className="w-3 h-3 text-red-400 fill-red-400" /> for cleaner cities
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Leaf className="w-3 h-3 text-emerald-500" />
                © {new Date().getFullYear()} Breeva. All rights reserved.
              </div>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}
