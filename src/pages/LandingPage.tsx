import { useRef, useEffect, useState, lazy, Suspense, type ReactNode, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Wind, Shield, Cpu, MapPin, Radio, Flame,
  Satellite, Radar, BrainCircuit, Leaf, Heart, Github,
  Route, CloudSun, MapPinned, School, Landmark, Footprints, Timer, Map as MapIcon,
  type LucideIcon,
} from 'lucide-react';

import { Seo } from '../components/Seo';
import { FIELD_REGIONS, fieldBase } from '../lib/field/source';
import { berandaAngka, type BerandaAngka } from '../lib/beranda';

// Lazy three.js particle canvas — kept off the landing critical path (vendor-three chunk; skipped under reduced-motion).
const ParticleHero = lazy(() => import('./landing/ParticleHero'));

function BreevaLogo({ className = 'h-6' }: { className?: string }) {
  return <img src="/favicon.svg" alt="Breeva" className={className} />;
}

// ── Shared reveal-on-scroll ──────────────────────────────────────────────────
const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.7 },
  viewport: { once: true, margin: '-80px' },
};

// ── Scroll-spy: which section is at the viewport center ───────────────────────
const NAV = [
  { id: 'masalah', label: 'Masalah' },
  { id: 'solusi', label: 'Solusi' },
  { id: 'rute', label: 'Rute' },
  { id: 'untuk', label: 'Untuk siapa' },
  { id: 'sains', label: 'Sains' },
];
const NAV_IDS = NAV.map((n) => n.id);

function useActiveSection(): string {
  const [active, setActive] = useState('');
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    NAV_IDS.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  return active;
}

// ── Consistent type-scale + card helpers (limits font-size variety) ──────────
function Overline({ icon: Icon, color, children }: { icon: LucideIcon; color: string; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] mb-3 ${color}`}>
      <Icon className="w-3.5 h-3.5" /> {children}
    </div>
  );
}

function Panel({ children, className = '', center = false }: { children: ReactNode; className?: string; center?: boolean }) {
  return (
    <motion.div {...fadeUp} className={`bg-white/80 backdrop-blur-xl rounded-3xl p-7 sm:p-10 shadow-xl border border-white/60 ring-1 ring-black/5 ${center ? 'text-center' : ''} ${className}`}>
      {children}
    </motion.div>
  );
}

function FeatureCard({ icon: Icon, title, desc, tint, i = 0 }: { icon: LucideIcon; title: string; desc: string; tint: string; i?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      transition={{ duration: 0.45, delay: i * 0.08 }}
      className="rounded-2xl bg-white/70 border border-slate-100 p-4 hover:-translate-y-0.5 hover:shadow-md transition-all"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 ${tint}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-sm font-bold text-slate-800">{title}</div>
      <div className="text-xs text-slate-500 leading-relaxed mt-1">{desc}</div>
    </motion.div>
  );
}

const H2 = 'text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mb-3';
const LEAD = 'text-[15px] text-slate-500 leading-relaxed mb-7';

// ── Main ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const scrollRef = useRef(0);
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const active = useActiveSection();
  const [angka, setAngka] = useState<BerandaAngka>({ sensor: null, titikApi: null, jamTerbit: null });
  useEffect(() => {
    let alive = true;
    const b = fieldBase();
    const get = (path: string) => fetch(`${b}${path}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([
      Promise.all(FIELD_REGIONS.map((r) => get(`/v/${r.name}/manifest.json`))),
      Promise.all(FIELD_REGIONS.map((r) => get(`/v/${r.name}/runs_recent.json`))),
      get('/v/nasional/titik_api.json'),
    ]).then(([m, runs, fire]) => alive && setAngka(berandaAngka(m, runs, fire, new Date())));
    return () => { alive = false; };
  }, []);
  const num = (v: number | null) => (v == null ? '…' : v.toLocaleString('id-ID'));

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollRef.current = max > 0 ? window.scrollY / max : 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (id: string) => (e: MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-white min-h-screen text-slate-900">
      <Seo
        title="Breeva — Navigasi Udara Bersih & Rute Sehat"
        description="Asap kendaraan per ruas jalan dihitung ulang tiap jam (Badung–Denpasar dan Kota Bogor), rute jalan kaki dengan asap paling sedikit, dan kalkulator paparan PM2.5. Tanpa akun."
        path="/"
      />
      {!reducedMotion && (
        <Suspense fallback={null}>
          <ParticleHero scrollRef={scrollRef} />
        </Suspense>
      )}

      {/* Navigation — with active-section indicator */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-1rem)] sm:w-auto max-w-max bg-white/75 backdrop-blur-xl px-3 sm:px-5 py-2 sm:py-2.5 rounded-full flex items-center justify-between sm:justify-center gap-2 sm:gap-1 shadow-lg border border-white/60">
        <a href="#" onClick={goTo('top')} className="flex min-h-6 items-center gap-1.5 min-w-0 sm:mr-3" aria-label="Breeva">
          <BreevaLogo className="h-5 w-5" />
          <span className="text-xs sm:text-sm font-extrabold text-emerald-700 whitespace-nowrap">Breeva</span>
        </a>
        {NAV.map((n) => {
          const on = active === n.id;
          return (
            <a key={n.id} href={`#${n.id}`} onClick={goTo(n.id)}
              className={`relative hidden sm:block px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${on ? 'text-emerald-700' : 'text-slate-500 hover:text-emerald-700'}`}>
              {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-emerald-50" transition={{ type: 'spring', damping: 28, stiffness: 320 }} />}
              <span className="relative">{n.label}</span>
            </a>
          );
        })}
        <Link to="/login" className="ml-1 sm:ml-2 bg-emerald-700 text-white text-[11px] sm:text-xs font-bold py-1.5 px-3.5 sm:px-4 rounded-full hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0">
          Masuk
        </Link>
      </nav>

      <div id="top" className="relative" style={{ zIndex: 1 }}>

        {/* ── HERO ── */}
        <section className="min-h-screen flex items-center justify-center px-6 pt-20">
          <div className="max-w-5xl mx-auto flex flex-col lg:flex-row items-center gap-10">
            <motion.div {...fadeUp} className="bg-white/80 backdrop-blur-xl rounded-3xl p-8 md:p-12 shadow-xl border border-white/60 ring-1 ring-black/5 max-w-xl flex-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 bg-emerald-50 rounded-full px-3 py-1 mb-5">
                <Leaf className="w-3.5 h-3.5" /> Asap kendaraan per ruas jalan
              </div>
              <h1 className="text-[2.5rem] sm:text-5xl md:text-6xl font-extrabold leading-[1.05] tracking-tight mb-4">
                Rute Bersih,<br />
                <span className="text-emerald-700">Napas Jernih.</span>
              </h1>
              <p className="text-[15px] sm:text-base text-slate-500 mb-8 leading-relaxed">
                Breeva menghitung asap kendaraan di setiap ruas jalan tiap jam, mencarikan rute dengan asap paling sedikit,
                dan menunjukkan sekolah yang paling terpapar. Tanpa akun.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to="/peta" className="inline-flex items-center justify-center gap-2 bg-emerald-700 text-white font-bold py-3 px-7 rounded-xl hover:bg-emerald-800 shadow-lg shadow-emerald-600/20 transition-all">
                  <MapIcon className="w-4 h-4" /> Buka Peta <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/pantau" className="inline-flex items-center justify-center gap-2 bg-slate-100 text-slate-700 font-semibold py-3 px-7 rounded-xl hover:bg-slate-200 transition-all">
                  <Landmark className="w-4 h-4" /> Pemantauan
                </Link>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-2" aria-live="polite">
                {([
                  [Radio, num(angka.sensor), 'sensor warga aktif'],
                  [Flame, num(angka.titikApi), 'titik api, 24 jam'],
                  [Timer, angka.jamTerbit == null ? '…' : `${angka.jamTerbit}/24`, 'jam peta terbit'],
                ] as [LucideIcon, string, string][]).map(([Icon, v, label]) => (
                  <div key={label} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center">
                    <Icon className="w-4 h-4 mx-auto text-emerald-700" />
                    <div className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{v}</div>
                    <div className="text-[10px] leading-tight text-slate-500">{label}</div>
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }} viewport={{ once: true }}
              className="flex-shrink-0 hidden lg:block"
            >
              <img src="/hero.webp" alt="Aplikasi Breeva" className="w-64 rounded-3xl shadow-2xl border-4 border-white/60" />
            </motion.div>
          </div>
        </section>

        {/* ── MASALAH ── */}
        <section id="masalah" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel className="max-w-2xl">
            <Overline icon={Wind} color="text-slate-400">Masalah</Overline>
            <h2 className={H2}>Udara Buruk Hampir <span className="text-red-500">Setiap Hari</span></h2>
            <p className={LEAD}>
              Paling buruk saat jam berangkat sekolah. Tapi satu kota hanya punya satu atau dua stasiun, jadi tidak ada yang tahu
              jalan dan sekolah mana yang paling berasap.
            </p>
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {[
                ['90,7%', 'hari di atas pedoman WHO'],
                ['59,2', 'µg/m³ PM2,5 di Bali pukul 08.00'],
                ['3', 'stasiun untuk 60.961 ruas jalan'],
              ].map(([val, label]) => (
                <div key={label} className="text-center p-4 rounded-2xl bg-slate-50 border border-slate-100">
                  <div className="text-2xl sm:text-3xl font-extrabold text-slate-800">{val}</div>
                  <div className="text-[11px] text-slate-400 mt-1 leading-snug">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-4">Sumber: 32 stasiun per jam (analisis proposal Breeva), pedoman harian WHO 15 µg/m³, OpenStreetMap.</p>
          </Panel>
        </section>

        {/* ── SOLUSI ── */}
        <section id="solusi" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel className="max-w-2xl">
            <Overline icon={Shield} color="text-emerald-700">Solusi</Overline>
            <h2 className={H2}>Asap Kendaraan, <span className="text-emerald-700">Per Ruas Jalan</span></h2>
            <p className={LEAD}>
              Asap kendaraan tiap ruas jalan dihitung dari lalu lintas, angin, dan rumus sebaran panduan EPA, di atas udara latar
              dari sensor warga dan CAMS.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {([
                [MapPinned, 'Per ruas jalan', 'Dihitung ulang tiap jam; akurasinya diuji terbuka di halaman Validasi.', 'bg-emerald-100 text-emerald-700'],
                [Route, 'Rute di ponsel', 'Rute tercepat dan rute paling sedikit asap, dengan menit tambahan dan persen asap yang berkurang.', 'bg-sky-100 text-sky-600'],
                [CloudSun, 'Jam berangkat', 'Prakiraan beberapa jam ke depan untuk memilih jam berangkat dengan asap lebih sedikit.', 'bg-amber-100 text-amber-600'],
              ] as [LucideIcon, string, string, string][]).map(([Icon, title, desc, tint], i) => (
                <FeatureCard key={title} icon={Icon} title={title} desc={desc} tint={tint} i={i} />
              ))}
            </div>
          </Panel>
        </section>

        {/* ── RUTE ── */}
        <section id="rute" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel className="max-w-2xl">
            <Overline icon={Cpu} color="text-indigo-500">Navigasi Cerdas</Overline>
            <h2 className={H2}>Rute yang <span className="text-indigo-500">Berpikir</span> untuk Napasmu</h2>
            <p className={LEAD}>
              Setiap rute membawa dua angka: asap yang kamu hirup, dan asap yang kamu timbulkan untuk orang di sekitar jalan.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 p-5 rounded-2xl bg-orange-50 border border-orange-100">
                <div className="text-sm font-bold text-orange-700 mb-2">Rute tercepat</div>
                <div className="text-3xl font-extrabold text-slate-800 tabular-nums">36 <span className="text-sm font-semibold text-slate-500">menit</span></div>
                <div className="mt-2 h-2.5 rounded-full bg-orange-500" aria-hidden="true" />
                <div className="text-xs text-slate-500 mt-1">asap kendaraan dihirup (patokan)</div>
              </div>
              <div className="flex-1 p-5 rounded-2xl bg-emerald-50 border border-emerald-200 ring-2 ring-emerald-300">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-emerald-700">Paling sedikit asap</span>
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-extrabold text-white">−66% asap</span>
                </div>
                <div className="text-3xl font-extrabold text-slate-800 tabular-nums">37 <span className="text-sm font-semibold text-slate-500">menit · +1</span></div>
                <div className="mt-2 h-2.5 w-1/3 rounded-full bg-emerald-600" aria-hidden="true" />
                <div className="text-xs text-slate-500 mt-1">asap kendaraan dihirup</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Contoh nyata: jalan kaki di Denpasar, breeva.site 25 Nov 2026 pukul 14.00 WITA.</p>
            <div className="mt-3 rounded-2xl p-4 flex items-start gap-3 text-white shadow-md" style={{ background: 'linear-gradient(135deg,#10b981,#0d9488,#06b6d4)' }}>
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <School className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold">Motor dan zona sekolah</div>
                <div className="text-xs text-white/90 mt-1 leading-relaxed">
                  Pada jam masuk sekolah, rute motor tidak lewat jalan kecil di depan sekolah, dan kartunya jujur menyebut harganya:
                  di Kota Bogor pukul 06.45, tambah 5 menit.
                </div>
              </div>
            </div>
          </Panel>
        </section>

        {/* ── UNTUK SIAPA ── */}
        <section id="untuk" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel className="max-w-2xl">
            <Overline icon={MapPin} color="text-green-600">Untuk siapa</Overline>
            <h2 className={H2}>Satu Peta, <span className="text-green-600">Tiga Pengguna</span></h2>
            <p className={LEAD}>Warga memilih jalan, sekolah melindungi muridnya, pemerintah daerah tahu harus mulai dari mana.</p>
            <div className="grid sm:grid-cols-3 gap-3">
              {([
                [Footprints, 'Warga', 'Rute jalan kaki dan motor dengan asap paling sedikit, juga tanpa internet.', 'bg-emerald-100 text-emerald-700', '/peta'],
                [School, 'Sekolah dan orang tua', 'Sekolah dan puskesmas yang paling terpapar asap kendaraan pada jam kegiatannya.', 'bg-violet-100 text-violet-600', '/prioritas'],
                [Landmark, 'Pemerintah daerah', 'Titik api, arah angin, laporan warga, grafik, dan unduhan data per wilayah.', 'bg-sky-100 text-sky-600', '/pantau'],
              ] as [LucideIcon, string, string, string, string][]).map(([Icon, title, desc, tint, to], i) => (
                <Link key={title} to={to} className="block"><FeatureCard icon={Icon} title={title} desc={desc} tint={tint} i={i} /></Link>
              ))}
            </div>
          </Panel>
        </section>

        {/* ── SAINS ── */}
        <section id="sains" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel className="max-w-2xl">
            <Overline icon={Radio} color="text-cyan-600">Sains</Overline>
            <h2 className={H2}>Dibangun di Atas <span className="text-cyan-600">Sains Nyata</span></h2>
            <p className={LEAD}>
              Udara latar dari sensor warga dan jarak pandang bandara, asap kendaraan dari rumus sebaran panduan EPA. Setiap
              sumber baru hanya dipakai bila lolos uji di lokasi yang disembunyikan; kota tanpa titik ukur diberi label indikatif.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                [Radar, 'Sensor warga'],
                [Satellite, 'Titik api NASA'],
                [BrainCircuit, 'Sebaran EPA'],
                [Shield, 'Uji lokasi tersembunyi'],
              ] as [LucideIcon, string][]).map(([Icon, label]) => (
                <div key={label} className="text-center p-4 rounded-2xl bg-cyan-50 border border-cyan-100">
                  <div className="w-9 h-9 rounded-xl bg-cyan-100 flex items-center justify-center mx-auto mb-2">
                    <Icon className="w-4 h-4 text-cyan-600" />
                  </div>
                  <div className="text-xs font-bold text-slate-600">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-2.5">Cakupan</div>
              <div className="flex flex-wrap gap-2">
                {([['/pantau/badung-denpasar', 'Badung–Denpasar · per ruas'], ['/pantau/kota-bogor', 'Kota Bogor · per ruas'], ['/pantau', 'Indonesia · titik api dan angin'], ['/validasi', 'Seberapa akurat?']] as [string, string][]).map(([to, label]) => (
                  <Link key={to} to={to}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-slate-50 text-slate-600 border border-slate-100 hover:border-cyan-300 hover:text-cyan-700 hover:bg-cyan-50 transition-colors">
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </Panel>
        </section>

        {/* ── CTA (mulai) ── */}
        <section id="mulai" className="min-h-screen flex items-center justify-center px-6 scroll-mt-20">
          <Panel center className="max-w-lg">
            <div className="flex items-center justify-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-orange-500 mb-3">
              <Flame className="w-3.5 h-3.5" /> Gabung
            </div>
            <h2 className={H2}>Gabung Gerakan <span className="text-orange-500">Udara Bersih</span></h2>
            <p className={LEAD + ' mx-auto'}>
              Tiap langkah berarti. Tiap napas berharga. Mulai perjalananmu menuju udara yang lebih bersih hari ini.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/login" className="inline-flex items-center justify-center gap-2 bg-emerald-700 text-white font-bold py-3.5 px-9 rounded-xl hover:bg-emerald-800 shadow-lg shadow-emerald-600/20 transition-all">
                Masuk <ArrowRight className="w-5 h-5" />
              </Link>
              <Link to="/peta" className="inline-flex items-center justify-center gap-2 bg-slate-100 text-slate-700 font-semibold py-3.5 px-7 rounded-xl hover:bg-slate-200 transition-all">
                <MapIcon className="w-4 h-4" /> Coba Peta Udara
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-400">Peta, rute, dan pemantauan bisa dipakai tanpa akun.</p>
          </Panel>
        </section>

        {/* ── Footer ── */}
        <footer className="relative px-6 pt-14 pb-10 bg-slate-50 border-t border-slate-100">
          <div aria-hidden className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-emerald-300/60 to-transparent" />
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-x-6 gap-y-9 mb-12">
              {/* Brand */}
              <div className="col-span-2">
                <div className="flex items-center gap-2 mb-3">
                  <BreevaLogo className="h-6 w-6" />
                  <span className="text-base font-extrabold text-emerald-700">Breeva</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-xs">
                  Rute lebih bersih, jalan lebih sehat. Kami memetakan kualitas udara setingkat jalan agar
                  kamu bisa bernapas lebih lega setiap hari.
                </p>
                <div className="flex gap-2.5">
                  <a href="https://github.com/Tristan-tech-ai/Breeva" target="_blank" rel="noopener noreferrer" aria-label="GitHub" className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-colors">
                    <Github className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Produk */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Produk</h4>
                <ul className="space-y-2.5">
                  <li><Link to="/peta" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Peta asap</Link></li>
                  <li><Link to="/prioritas" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Prioritas sekolah</Link></li>
                  <li><Link to="/uji-coba" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Uji coba siswa</Link></li>
                  <li><Link to="/status" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Status data</Link></li>
                </ul>
              </div>

              {/* Pemantauan */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Pemantauan</h4>
                <ul className="space-y-2.5">
                  <li><Link to="/pantau" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Indonesia</Link></li>
                  <li><Link to="/pantau/badung-denpasar" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Badung–Denpasar</Link></li>
                  <li><Link to="/pantau/kota-bogor" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Kota Bogor</Link></li>
                  <li><Link to="/validasi" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Akurasi</Link></li>
                </ul>
              </div>

              {/* Perusahaan */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Perusahaan</h4>
                <ul className="space-y-2.5">
                  <li><Link to="/about" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Tentang</Link></li>
                  <li><Link to="/help" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Bantuan</Link></li>
                  <li><Link to="/eco-tips" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Tips Eco</Link></li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Legal</h4>
                <ul className="space-y-2.5">
                  <li><Link to="/terms" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Ketentuan</Link></li>
                  <li><Link to="/privacy" className="inline-flex min-h-6 min-w-6 items-center text-xs text-slate-600 hover:text-emerald-700 transition-colors">Privasi</Link></li>
                </ul>
              </div>
            </div>

            <div className="pt-7 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                Dibuat dengan <Heart className="w-3 h-3 text-red-400 fill-red-400" /> untuk kota yang lebih bersih
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Leaf className="w-3 h-3 text-emerald-500" />
                © {new Date().getFullYear()} Breeva. Semua hak dilindungi.
              </div>
            </div>
          </div>
        </footer>

      </div>
    </div>
  );
}
