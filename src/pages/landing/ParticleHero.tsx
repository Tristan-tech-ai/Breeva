// Lazy-loaded three.js particle hero for the landing page. Extracted from LandingPage.tsx so the
// ~320KB+ three.js + @react-three/fiber bundle (vendor-three chunk) stays OFF the landing critical
// path — LandingPage renders instantly (white bg + content), this decorative canvas streams in after.
// Skipped entirely under prefers-reduced-motion by the caller.
import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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
  const D = 100, W = 55, spd = 2, syn = 0.2, layers = 5;
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

export default function ParticleHero({ scrollRef }: { scrollRef: { current: number } }) {
  return (
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
  );
}
