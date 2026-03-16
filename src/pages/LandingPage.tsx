import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Wind, Shield, Cpu, MapPin, Radio, Flame,
  Satellite, Microscope, MapPinned, TreePine, Store, Trophy,
  Radar, BrainCircuit, BarChart3, Leaf, Heart, Github, Twitter, Mail,
  type LucideIcon,
} from 'lucide-react';

// ── Constants ───────────────────────────────────────────────────────────────

const COUNT = 10000;
const LERP = 0.06;
const BOUNDS = [0, 0.143, 0.286, 0.429, 0.571, 0.714, 0.857, 1.0];
const CAM: [number, number, number][] = [
  [0, 0, 55],     // Leaf
  [18, 12, 55],   // Storm
  [0, 8, 65],     // Earth
  [35, 0, 65],    // Neural
  [0, 30, 50],    // Terrain
  [15, 8, 42],    // Satellite
  [0, 6, 55],     // Fire
];

// ── Particle Shapes ─────────────────────────────────────────────────────────

type ShapeFn = (
  i: number, n: number, t: number,
  pos: THREE.Vector3, col: THREE.Color
) => void;

/* 0 – Leaf / Logo (Hero) */
const shapeLeaf: ShapeFn = (i, n, t, pos, col) => {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = Math.sqrt(i / n) * 22;
  const theta = i * golden;
  let x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const yN = y / 22;
  x *= Math.max(0, 1 - yN * yN) * (1 + 0.3 * yN);
  const b = 1 + Math.sin(t * 0.8) * 0.015;
  pos.set(x * b, y * b, Math.sin(i * 0.37) * 1.5);
  const d = Math.sqrt(x * x + y * y) / 22;
  col.setHSL(0.40 - d * 0.06, 0.85, 0.32 + d * 0.15);
};

/* 1 – Storm (Problem) */
const shapeStorm: ShapeFn = (i, n, t, pos, col) => {
  if (i < n * 0.30) {
    const s = Math.ceil(Math.sqrt(n * 0.30));
    const gx = ((i % s) / s - 0.5) * 80;
    const gz = (Math.floor(i / s) / s - 0.5) * 80;
    const d = Math.sqrt(gx * gx + gz * gz) / 40;
    if (d > 1) { pos.set(0, -200, 0); col.setHSL(0, 0, 0); return; }
    const w = Math.sin(gx * 0.15 + t * 2) * 1.5 + Math.cos(gz * 0.12 + t * 1.5);
    pos.set(gx, -18 + w, gz);
    col.setHSL(0.58, 0.7, 0.22 + w * 0.03);
  } else if (i < n * 0.44) {
    const ri = i - n * 0.30;
    const norm = ri / (n * 0.14);
    const x = Math.sin(ri * 137.508) * 35;
    const z = Math.cos(ri * 73.267) * 35;
    const fall = (norm * 100 + t * 18) % 36;
    pos.set(x, 18 - fall, z);
    col.setHSL(0.6, 0.4, 0.4 + (fall / 36) * 0.25);
  } else if (i < n * 0.49) {
    const bi = i - n * 0.44;
    const total = n * 0.05;
    const bolt = Math.floor((bi / total) * 4);
    const p = (bi / total) * 4 - bolt;
    const bx = [-12, 8, 22, -5][bolt];
    const bz = [8, -12, 3, -18][bolt];
    const jitter = Math.sin(p * 15 + t * 12) * 3.5 * p;
    const flash = Math.sin(t * 5 + bolt * 1.5) > 0.85 ? 1 : 0;
    pos.set(bx + jitter, 16 - p * 34, bz + jitter * 0.4);
    col.setHSL(0.15, 1, 0.35 + flash * 0.55);
  } else {
    const ci = i - n * 0.49;
    const norm = ci / (n * 0.51);
    const ly = 12 + norm * 18;
    let cx = Math.sin(ci * 2.618) * 40 + Math.sin(ci * 0.01) * 12 + t * 0.3;
    const cz = Math.cos(ci * 1.618) * 40 + Math.cos(ci * 0.013) * 12;
    cx = ((cx + 50) % 100) - 50;
    pos.set(cx, ly + Math.sin(cx * 0.08 + t * 0.5) * 1.2, cz);
    col.setHSL(0, 0, 0.55 + norm * 0.2);
  }
};

/* 2 – Earth (Solution) */
const shapeEarth: ShapeFn = (i, n, t, pos, col) => {
  const R = 25;
  const phi = Math.acos(1 - 2 * (i / n));
  const theta = Math.sqrt(n * Math.PI) * phi + t * 0.15;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const ct = Math.cos(theta), st = Math.sin(theta);
  const elev =
    Math.sin(phi * 3) * Math.cos(theta * 2) * 0.5 +
    Math.sin(phi * 7 + 1) * Math.cos(theta * 5 - 2) * 0.25 +
    Math.sin(phi * 13 + 3) * Math.cos(theta * 11 + 1) * 0.125;
  const polar = Math.abs(cp) > 0.85;
  const ocean = elev < 0;
  let r = R, h: number, s: number, l: number;
  if (polar) { h = 0; s = 0; l = 0.8; r = R + 0.3; }
  else if (ocean) { h = 0.58; s = 0.8; l = 0.25 + elev * 0.1; }
  else { h = 0.28 - elev * 0.1; s = 0.65; l = 0.22 + elev * 0.2; r = R + elev * 3; }
  if (i > n * 0.92) { r = R + 3; h = 0.55; s = 0.5; l = 0.45; }
  pos.set(sp * ct * r, cp * r, sp * st * r);
  col.setHSL(h, s, l);
};

/* 3 – Neural Network (Route Intelligence) */
const shapeNeural: ShapeFn = (i, n, t, pos, col) => {
  const D = 60, W = 30, spd = 2, syn = 0.2, layers = 5;
  const tt = t * spd;
  if (i < n * 0.4) {
    const li = Math.floor((i / (n * 0.4)) * layers);
    const pi = i % Math.floor((n * 0.4) / layers);
    const gs = Math.ceil(Math.sqrt((n * 0.4) / layers));
    const gx = (pi % gs) - gs * 0.5;
    const gy = Math.floor(pi / gs) - gs * 0.5;
    const pulse = Math.sin(tt + li - Math.sqrt(gx * gx + gy * gy) * 0.5);
    const x = (li - (layers - 1) * 0.5) * (D / layers);
    let y = gx * (W / gs), z = gy * (W / gs);
    const exc = Math.max(0, pulse);
    y += (Math.sin(i * 0.1) - 0.5) * syn * exc;
    z += (Math.cos(i * 0.1) - 0.5) * syn * exc;
    pos.set(x, y, z);
    col.setHSL(0.6 - li * 0.05, 0.8, 0.2 + pulse * 0.15 + 0.15);
  } else {
    const seg = (i - n * 0.4) % (layers - 1);
    const pf = i - n * 0.4;
    const prog = ((pf + tt * 50) % 1000) / 1000;
    const sl = seg;
    const xs = (sl - (layers - 1) * 0.5) * (D / layers);
    const xe = (sl + 1 - (layers - 1) * 0.5) * (D / layers);
    const seed = pf % 100;
    pos.set(
      xs + (xe - xs) * prog,
      Math.sin(seed) * W * 0.4 + (Math.sin(i * 0.03) - 0.5) * syn,
      Math.cos(seed) * W * 0.4 + (Math.cos(i * 0.03) - 0.5) * syn,
    );
    col.setHSL(0.1, 1, Math.pow(1 - Math.abs(prog - 0.5) * 2, 2) * 0.7);
  }
};

/* 4 – Terrain (Exploration) */
const shapeTerrain: ShapeFn = (i, n, t, pos, col) => {
  const sz = 80, hs = 5, rug = 11;
  const tt = t * 0.7;
  const cols = Math.ceil(Math.sqrt(n));
  const u = (i % cols) / (cols - 1) - 0.5;
  const v = Math.floor(i / cols) / (cols - 1) - 0.5;
  let e =
    Math.sin(u * rug + tt * 0.3) * Math.cos(v * rug * 0.7 + tt * 0.2) +
    Math.sin(u * rug * 2.1 + 1 + tt * 0.15) * Math.cos(v * rug * 1.7 + 2) * 0.5 +
    Math.sin(u * rug * 4.3 + 3) * Math.cos(v * rug * 3.1 + tt * 0.1) * 0.25;
  const d = Math.sqrt(u * u + v * v);
  e *= 1 + Math.max(0, 1 - d * 2.5) * 2;
  pos.set(u * sz, e * hs, v * sz);
  col.setHSL(0.33, 1, 0.15 + ((e + 2) / 4) * 0.3);
};

/* 5 – Satellite (Science) */
const shapeSatellite: ShapeFn = (i, n, t, pos, col) => {
  const sc = 4, rY = t * 0.5, tilt = 0.35;
  let x = 0, y = 0, z = 0, h = 0.6, s = 0.7, l = 0.4;
  if (i < n * 0.30) {
    const nm = i / (n * 0.30);
    const a = nm * Math.PI * 40;
    x = Math.cos(a) * 1.8 * sc; y = (nm * 2 - 1) * 5 * sc; z = Math.sin(a) * 1.8 * sc;
    h = 0.6; s = 0.5; l = 0.4;
  } else if (i < n * 0.70) {
    const pi = i - n * 0.30;
    const nm = pi / (n * 0.40);
    const side = nm < 0.5 ? -1 : 1;
    const ln = (nm % 0.5) * 2;
    const c = Math.floor(ln * 7);
    const r = ln * 7 - c;
    x = side * (2 + c) * sc; y = (r - 0.5) * 6 * sc; z = 0;
    h = 0.6; s = 0.9; l = 0.22 + ln * 0.15;
  } else if (i < n * 0.90) {
    const di = i - n * 0.70;
    const nm = di / (n * 0.20);
    const a = nm * Math.PI * 20;
    const r = nm * 4 * sc;
    x = Math.cos(a) * r; z = Math.sin(a) * r; y = -6 * sc + r * r * 0.02;
    h = 0; s = 0; l = 0.55;
  } else {
    const ai = i - n * 0.90;
    const nm = ai / (n * 0.10);
    x = (Math.sin(ai * 3) - 0.5) * sc; y = 5 * sc + nm * 4 * sc; z = (Math.cos(ai * 3) - 0.5) * sc;
    h = 0; s = 0; l = 0.45;
  }
  const cr = Math.cos(rY), sr = Math.sin(rY);
  const rx = x * cr - z * sr, rz = x * sr + z * cr;
  const cT = Math.cos(tilt), sT = Math.sin(tilt);
  pos.set(rx, y * cT - rz * sT, y * sT + rz * cT);
  col.setHSL(h, s, l);
};

/* 6 – Fire (CTA) */
const shapeFire: ShapeFn = (i, n, t, pos, col) => {
  const H = 50, W = 12, turb = 4.5, flk = 8;
  const nm = i / n;
  const vp = Math.pow(nm, 1.4);
  const y = vp * H - H * 0.3;
  const prof = (1 - vp) * Math.min(1, vp * 8);
  const mR = W * prof;
  const a = i * 2.618;
  const r = Math.sqrt((i % 100) / 100) * mR;
  const t1 = Math.sin(vp * 10 + t * flk) * turb * prof;
  const t2 = Math.cos(vp * 8 + t * flk * 0.7 + 1) * turb * prof;
  pos.set(Math.cos(a) * r + t1, y, Math.sin(a) * r + t2);
  const heat = 1 - vp;
  col.setHSL(heat * heat * 0.16, Math.min(1, heat * 2), heat * 0.35 + Math.pow(heat, 4) * 0.35);
};

const SHAPES: ShapeFn[] = [
  shapeLeaf, shapeStorm, shapeEarth, shapeNeural,
  shapeTerrain, shapeSatellite, shapeFire,
];

// ── R3F Components ──────────────────────────────────────────────────────────

function ParticleField({ scrollRef }: { scrollRef: { current: number } }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pColor = useMemo(() => new THREE.Color(), []);
  const geometry = useMemo(() => new THREE.TetrahedronGeometry(0.25), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial(), []);

  const positions = useMemo(() => {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < COUNT; i++) {
      arr.push(new THREE.Vector3(
        Math.sin(i * 137.508) * 60,
        Math.cos(i * 73.267) * 60,
        Math.sin(i * 52.193) * 60,
      ));
    }
    return arr;
  }, []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const time = state.clock.getElapsedTime();
    const progress = scrollRef.current;

    let section = 6;
    for (let s = 0; s < 7; s++) {
      if (progress < BOUNDS[s + 1]) { section = s; break; }
    }

    const fn = SHAPES[section];
    for (let i = 0; i < COUNT; i++) {
      fn(i, COUNT, time, target, pColor);
      positions[i].lerp(target, LERP);
      dummy.position.copy(positions[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, pColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} />;
}

function CameraRig({ scrollRef }: { scrollRef: { current: number } }) {
  const tp = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame(({ camera }) => {
    let section = 6;
    for (let s = 0; s < 7; s++) {
      if (scrollRef.current < BOUNDS[s + 1]) { section = s; break; }
    }
    tp.set(...CAM[section]);
    camera.position.lerp(tp, 0.02);
    camera.lookAt(lookTarget);
  });

  return null;
}

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
      {/* Fixed particle canvas */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 55], fov: 60 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
        >
          <ParticleField scrollRef={scrollRef} />
          <CameraRig scrollRef={scrollRef} />
        </Canvas>
      </div>

      {/* Navigation */}
      <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-white/70 backdrop-blur-xl px-6 py-2.5 rounded-full flex items-center gap-6 shadow-lg border border-white/50">
        <a href="#" className="flex items-center gap-1.5">
          <BreevaLogo className="h-5 w-5" />
          <span className="text-sm font-bold text-emerald-600">Breeva</span>
        </a>
        <a href="#problem" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">Why</a>
        <a href="#solution" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">How</a>
        <a href="#science" className="text-xs font-medium text-slate-500 hover:text-emerald-600 transition-colors hidden sm:block">Science</a>
        <Link to="/login" className="bg-emerald-600 text-white text-xs font-semibold py-1.5 px-4 rounded-full hover:bg-emerald-700 transition-colors">
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
            <p className="mt-4 text-xs text-slate-400">No credit card required</p>
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
