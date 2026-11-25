// Post-build static prerender for GEO / non-JS AI crawlers.
//
// WHY: Breeva is a client-rendered SPA. Most LLM crawlers (GPTBot, ClaudeBot, CCBot,
// PerplexityBot) do NOT execute JavaScript, so for every route they previously received the
// SAME homepage shell (identical <title>/<meta>/JSON-LD + a generic #root fallback). The rich
// per-page content (set client-side by <Seo/>) was invisible to them.
//
// WHAT: read the built dist/index.html as a template and emit one static HTML file per public
// content route with that route's real <title>, <meta description>, canonical, OG/Twitter tags,
// optional route-specific JSON-LD, and a substantive #root fallback (<main> with the page's H1,
// key copy and links). It does NOT run React/leaflet/three — pure string templating — so it can
// never crash on browser globals. The emitted files still load the hashed module scripts from the
// template, so a real browser hydrates into the full SPA exactly as before.
//
// Titles/descriptions are kept identical to each page's <Seo/> call so the client and the static
// HTML agree. Vercel serves these static files (with cleanUrls) before the SPA catch-all rewrite.
//
// Lives at the repo ROOT (not scripts/, which .vercelignore excludes from the Vercel build).
// Runs from the build CWD (repo root) on both local and Vercel, so dist/ resolves via process.cwd().

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appPreloadScript, preloadFiles, preloadTags, referencedAssets } from './preload-links.mjs';
import { atHeadStart, earlyFieldScript, parseRegions } from './early-field.mjs';

const DIST = join(process.cwd(), 'dist');
const TEMPLATE_PATH = join(DIST, 'index.html');

if (!existsSync(TEMPLATE_PATH)) {
  console.error(`[prerender] dist/index.html not found at ${TEMPLATE_PATH} — run "vite build" first.`);
  process.exit(1);
}
const template = readFileSync(TEMPLATE_PATH, 'utf8');
// Vite build manifest (build.manifest in vite.config.ts): which chunks a lazily loaded page needs (F1-51)
const MANIFEST_PATH = join(DIST, '.vite', 'manifest.json');
if (!existsSync(MANIFEST_PATH)) {
  console.error(`[prerender] ${MANIFEST_PATH} not found: build.manifest must stay on in vite.config.ts`);
  process.exit(1);
}
const buildManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const SITE = 'https://breeva.site';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline-styled fallback that mirrors index.html's first-paint look (system fonts, green accents).
const page = (h1, paras, links) => `
      <main style="max-width:680px;margin:0 auto;padding:56px 20px;font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
        <h1 style="font-size:26px;font-weight:800;color:#059669;margin:0 0 14px">${h1}</h1>
        ${paras.map((p) => `<p style="margin:0 0 12px;line-height:1.6;color:#475569">${p}</p>`).join('\n        ')}
        <nav style="margin-top:20px;display:flex;gap:16px;flex-wrap:wrap;font-weight:600">
          ${links.map((l) => `<a href="${l.href}" style="color:#059669">${l.label}</a>`).join('\n          ')}
        </nav>
      </main>`;

const NAV = [
  { href: '/', label: 'Beranda' },
  { href: '/peta', label: 'Peta Udara' },
  { href: '/paparan', label: 'Kalkulator Paparan' },
  { href: '/about', label: 'Tentang Breeva' },
  { href: '/eco-tips', label: 'Tips Udara Bersih' },
  { href: '/developers', label: 'Developer API' },
];

// Public crawlable city pages (/udara/:slug). MUST mirror src/lib/cities.ts.
const CITIES = [
  { slug: 'jakarta',    name: 'Jakarta',    region: 'DKI Jakarta',             blurb: 'Ibu kota dengan lalu lintas padat.' },
  { slug: 'bandung',    name: 'Bandung',    region: 'Jawa Barat',              blurb: 'Cekungan Bandung membuat polusi mudah terperangkap.' },
  { slug: 'surabaya',   name: 'Surabaya',   region: 'Jawa Timur',              blurb: 'Kota industri dan pelabuhan di pesisir utara Jawa Timur.' },
  { slug: 'bali',       name: 'Bali',       region: 'Bali (Denpasar–Badung)',  blurb: 'Dari Denpasar hingga Canggu — udara relatif bersih, tapi jalan ramai tetap punya hotspot polusi.', perRoad: true },
  { slug: 'semarang',   name: 'Semarang',   region: 'Jawa Tengah',             blurb: 'Kota pesisir utara Jawa Tengah.' },
  { slug: 'yogyakarta', name: 'Yogyakarta', region: 'DI Yogyakarta',           blurb: 'Kota pelajar dan wisata.' },
  { slug: 'solo',       name: 'Solo',       region: 'Jawa Tengah (Surakarta)', blurb: 'Surakarta, Jawa Tengah.' },
  { slug: 'malang',     name: 'Malang',     region: 'Jawa Timur',              blurb: 'Kota sejuk di kaki gunung.' },
];

const placeJsonLd = (c) => `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Place',
  name: `Kualitas Udara ${c.name}`,
  address: { '@type': 'PostalAddress', addressLocality: c.name, addressRegion: c.region, addressCountry: 'ID' },
  url: `${SITE}/udara/${c.slug}`,
})}</script>`;

// 10 FAQ items (verbatim from src/pages/HelpPage.tsx) — used for /help body + FAQPage JSON-LD.
const HELP_FAQS = [
  ['Bagaimana cara memulai jalan?', 'Buka peta (tab Beranda), cari atau ketuk tujuan, lalu tap "Mulai" pada kartu rute. Breeva melacak jalanmu dan memberi EcoPoin saat selesai.'],
  ['Apa itu EcoPoin?', 'EcoPoin adalah hadiah yang kamu dapat dari berjalan kaki dan memilih rute bersih. Tukarkan di merchant ramah lingkungan untuk diskon & perk.'],
  ['Beda rute bersih dan rute cepat?', 'Rute paling sedikit asap menghindari jalan ramai; kartunya menyebut berapa persen asap kendaraan yang kamu hirup berkurang dan berapa menit tambahannya dibanding rute tercepat.'],
  ['Kenapa warna rute di peta berbeda?', 'Setiap rute punya warna sendiri di peta dan di kartunya. Kartu menyebut jarak, menit, dan asap kendaraan rata-rata di rute itu.'],
  ['Apa itu AQI dan dari mana datanya?', 'Udara latar ditampilkan sebagai ISPU dari PM2,5, dari CAMS (lewat Open-Meteo) dan sensor warga. Asap kendaraan per ruas jalan dihitung dari perkiraan lalu lintas, angin, dan rumus sebaran panduan EPA (Badung–Denpasar dan Kota Bogor). Makin rendah, makin bersih.'],
  ['Bisa pakai moda transportasi lain?', 'Rute di ponsel tersedia untuk jalan kaki dan motor. Rute motor juga menunjukkan asap yang ditimbulkan bagi orang lain (harga hirup) dan menghindari gang serta jalan kecil di depan sekolah pada jam sekolah.'],
  ['Bagaimana EcoPoin dihitung?', 'EcoPoin dihitung dari jarak jalan kaki yang terverifikasi, ditambah bonus dari misi harian dan pencapaian. Moda bermotor memberi poin lebih sedikit.'],
  ['Di mana menukar EcoPoin?', 'Buka tab Hadiah untuk melihat voucher dari merchant. Ketuk voucher untuk menukarnya dengan saldo EcoPoin-mu.'],
  ['Apakah data lokasi saya privat?', 'Ya. Lokasi dipakai untuk navigasi dan AQI di sekitarmu, dan tidak dijual atau dibagikan ke pihak ketiga untuk iklan. Lihat Kebijakan Privasi untuk detail.'],
  ['Bagaimana menghapus akun?', 'Buka Profil → Pengaturan, atau hubungi kami di halo@breeva.site. Penghapusan bersifat permanen.'],
];

const faqJsonLd = (faqs) => `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
})}</script>`;

const webApiJsonLd = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebAPI',
  name: 'Breeva Developer API',
  url: `${SITE}/developers`,
  documentation: `${SITE}/openapi.json`,
  description: 'REST API for calibrated per-road air quality (AQI), pollution-aware routing, and PM2.5 exposure for Indonesian cities.',
  provider: { '@type': 'Organization', name: 'Breeva', url: SITE },
})}</script>`;

// Per-route content map. title/description MIRROR each page's <Seo/> exactly.
const ROUTES = [
  {
    file: 'about.html', path: '/about',
    title: 'Tentang Breeva — Platform Intelijen Udara',
    description: 'Breeva memetakan kualitas udara per-jalan, menemukan rute jalan kaki paling bersih, dan menghitung paparan PM2.5 — platform navigasi udara untuk kota Indonesia.',
    body: page('Tentang Breeva', [
      'Breeva membuat kualitas udara <b>terlihat di setiap ruas jalan</b>, lalu mengubah jalan kaki menjadi pilihan yang cerdas, sehat, dan bermanfaat. Tujuan kami: menurunkan paparan polusi & emisi kota dengan memandu warga ke rute paling bersih dan memberi penghargaan atas tiap langkah rendah-emisi.',
      'Cara kerja: (1) lihat asap kendaraan per ruas jalan (Badung–Denpasar dan Kota Bogor, dihitung ulang tiap jam), (2) bandingkan rute tercepat dan rute paling sedikit asap, dihitung di ponselmu, lalu (3) jalan, pantau paparan PM2.5, dan kumpulkan EcoPoin, level, serta pencapaian.',
      'Fitur utama: peta asap kendaraan per ruas jalan, rute jalan kaki dan motor di ponsel, EcoPoin & level, Kalkulator Paparan (dosis PM2.5 per rute), papan peringkat (Desa → Nasional), dan merchant eco. Gratis sebagai PWA di browser. Kontak: halo@breeva.site.',
      'Breeva adalah aplikasi web navigasi udara bersih di <b>breeva.site</b> — bukan pemurni udara TCL "Breeva" A3WW, dan bukan proyek "VAYU" lain; "VAYU" di sini adalah mesin kualitas udara per-jalan internal Breeva. Kode sumber terbuka: <a href="https://github.com/Tristan-tech-ai/Breeva" style="color:#059669">github.com/Tristan-tech-ai/Breeva</a>.',
    ], NAV),
  },
  {
    file: 'paparan.html', path: '/paparan',
    title: 'Kalkulator Paparan Udara — Breeva',
    description: 'Hitung dosis PM2.5 yang Anda hirup di sebuah rute: laju napas per usia & aktivitas, perbandingan ambang WHO, dan setara rokok. Berbasis peta per ruas jalan Breeva.',
    body: page('Kalkulator Paparan Udara', [
      'Kalkulator Paparan Breeva memperkirakan <b>dosis PM2.5 yang kamu hirup</b> (dalam mikrogram) di sebuah rute, berdasarkan usia (anak/dewasa/lansia) dan aktivitas atau moda transport (jalan, lari, sepeda, motor, mobil, transportasi umum) yang menentukan laju napas dan intake.',
      'Hasilnya dibandingkan dengan <b>pedoman WHO 2021 untuk PM2.5 rata-rata 24 jam (15 µg/m³)</b> dan dinyatakan sebagai <b>setara batang rokok</b>, di mana sekitar 660 µg PM2.5 terhirup ≈ 1 batang rokok (Pope 2009). Kalkulator memisahkan paparan lalu lintas yang bisa dihindari dari paparan latar.',
      'Perbandingan rokok bersifat ilustratif agar mudah dipahami — bukan klaim klinis atau medis.',
    ], NAV),
  },
  {
    file: 'peta.html', path: '/peta',
    // F1-51: the page and its map chunks start with the HTML instead of one lazy level after the other
    preload: ['src/pages/ExploreMapPage.tsx', 'src/components/map/LeafletMap.tsx'],
    preloadScripts: ['/vendor/leaflet-vectorgrid.js'],
    // F1-54: the region manifest and the PMTiles header start with the HTML (needs the CDN field base of the build)
    earlyField: true,
    title: 'Peta Udara Langsung — Asap Kendaraan per Jalan & Rute Bersih | Breeva',
    description: 'Peta asap kendaraan dan kualitas udara per ruas jalan untuk Badung–Denpasar dan Kota Bogor, dihitung ulang tiap jam; rute jalan kaki dengan asap paling sedikit dihitung di ponsel. Kota lain: kualitas udara kota. Gratis, tanpa login.',
    body: page('Kualitas udara per jalan, langsung di peta', [
      'Breeva menghitung ulang setiap jam asap kendaraan dan kualitas udara untuk <b>tiap ruas jalan</b> di Badung–Denpasar dan Kota Bogor, dari perkiraan lalu lintas, angin, sensor warga, dan udara latar CAMS. Bukan satu angka untuk seluruh kota, tapi warna per ruas jalan. Kota lain menyusul bertahap begitu punya titik ukur.',
      'Cara kerja: (1) lihat asap kendaraan per jalan di peta, (2) bandingkan rute tercepat dan rute paling sedikit asap, dengan menit tambahan dan persen asap yang berkurang, lalu (3) hitung dosis PM2.5 yang kamu hirup lewat Kalkulator Paparan. Warna: hijau = baik (0–50), kuning = sedang (51–100), oranye/merah = tidak sehat (101–200), ungu = sangat buruk (201+).',
      'Lihat udara per kota: <a href="/udara/jakarta" style="color:#059669">Jakarta</a>, <a href="/udara/bandung" style="color:#059669">Bandung</a>, <a href="/udara/surabaya" style="color:#059669">Surabaya</a>, <a href="/udara/bali" style="color:#059669">Bali</a>, <a href="/udara/semarang" style="color:#059669">Semarang</a>, <a href="/udara/yogyakarta" style="color:#059669">Yogyakarta</a>, <a href="/udara/solo" style="color:#059669">Solo</a>, <a href="/udara/malang" style="color:#059669">Malang</a>. Bebas dipakai tanpa akun.',
    ], NAV),
  },
  {
    file: 'eco-tips.html', path: '/eco-tips',
    title: 'Tips Udara Bersih & Jalan Sehat — Breeva',
    description: 'Tips praktis mengurangi paparan polusi: pilih rute hijau, waktu terbaik berjalan, dan cara kurangi jejak karbon harian.',
    body: page('Tips Udara Bersih', [
      'Tips praktis dari Breeva untuk mengurangi paparan polusi dan jejak karbon sambil berjalan kaki:',
      '<b>Jalan kaki hemat CO₂</b> — berjalan 1 km menghemat ~120 g CO₂ dibanding berkendara. <b>Pilih rute lebih bersih</b> — jalur dekat taman & ruang hijau jauh lebih minim polusi; mesin VAYU mencarikannya. <b>30 menit jalan/hari</b> menurunkan risiko penyakit jantung. <b>Pohon menyaring udara</b> — satu pohon menyerap ~22 kg CO₂/tahun.',
      '<b>Hindari jam puncak polusi</b> — udara terburuk saat jam sibuk (07.00–09.00 & 17.00–19.00); jalan pagi atau sore untuk udara lebih bersih. <b>EcoPoin = hadiah nyata</b> — tukar di merchant ramah lingkungan untuk diskon makanan, minuman, dan produk eco.',
    ], NAV),
  },
  {
    file: 'developers.html', path: '/developers',
    title: 'Breeva API — Air Quality, Routing & Exposure API for Developers',
    description: 'Breeva Developer API: calibrated per-road air-quality (AQI), pollution-aware navigation/routing, and PM2.5 exposure in one REST API. Get a free API key — 1,000 requests/day. API kualitas udara, navigasi rute bersih & paparan untuk developer.',
    extraJsonLd: webApiJsonLd,
    body: page('Breeva Developer API', [
      'The Breeva Developer API exposes the engine behind breeva.site as REST: calibrated per-road air quality (AQI), pollution-aware routing, and PM2.5 exposure for Indonesian cities.',
      'Base URL <code>https://breeva.site/api/v1</code>. Authenticate with <code>Authorization: Bearer brv_live_…</code> or the <code>x-api-key</code> header. Three endpoints: <b>GET /road-aqi</b> (per-road AQI GeoJSON for a bounding box), <b>POST /route-score</b> (clean / balanced / fast routes, scored by air quality), and <b>POST /exposure</b> (cumulative inhaled PM2.5 dose and cigarette-equivalents).',
      'Free tier: 1,000 requests/day; pro: 50,000/day; enterprise: custom. Create a free API key at /developers; full machine-readable spec at <a href="/openapi.json" style="color:#059669">/openapi.json</a>.',
    ], [{ href: '/openapi.json', label: 'OpenAPI Spec' }, ...NAV]),
  },
  {
    file: 'help.html', path: '/help',
    title: 'Bantuan & Masukan — Breeva',
    description: 'Pertanyaan umum seputar Breeva: memulai jalan, rute, AQI, EcoPoin, dan privasi.',
    extraJsonLd: faqJsonLd(HELP_FAQS),
    body: page('Bantuan & FAQ Breeva',
      HELP_FAQS.map(([q, a]) => `<b>${esc(q)}</b><br>${esc(a)}`),
      NAV),
  },
  {
    file: 'terms.html', path: '/terms',
    title: 'Ketentuan Layanan — Breeva',
    description: 'Ketentuan Layanan penggunaan aplikasi Breeva — navigasi udara bersih & eco-walk.',
    body: page('Ketentuan Layanan Breeva', [
      'Ketentuan Layanan untuk penggunaan Breeva — platform navigasi udara bersih & eco-walk. Buka halaman ini di aplikasi untuk versi lengkap.',
    ], NAV),
  },
  {
    file: 'privacy.html', path: '/privacy',
    title: 'Kebijakan Privasi — Breeva',
    description: 'Bagaimana Breeva mengumpulkan, memakai, dan melindungi datamu.',
    body: page('Kebijakan Privasi Breeva', [
      'Bagaimana Breeva mengumpulkan, memakai, dan melindungi datamu. Lokasi dipakai untuk navigasi dan AQI di sekitarmu, dan tidak dijual atau dibagikan ke pihak ketiga untuk iklan. Buka halaman ini di aplikasi untuk versi lengkap.',
    ], NAV),
  },
];

// Programmatic per-city AQI pages → udara-${slug}.html (real text content for crawlers;
// the live AQI number is fetched client-side, so no build-time network call can fail the build).
for (const c of CITIES) {
  ROUTES.push({
    file: `udara-${c.slug}.html`, path: `/udara/${c.slug}`,
    title: `Kualitas Udara ${c.name} Hari Ini | Breeva`,
    description: c.perRoad
      ? `Asap kendaraan dan kualitas udara per ruas jalan di Badung–Denpasar, dihitung ulang tiap jam. ${c.blurb} Rute jalan kaki dengan asap paling sedikit — gratis di Breeva.`
      : `Kualitas udara ${c.name}, ${c.region}, per jam. ${c.blurb} Peta per ruas jalan baru tersedia di Badung–Denpasar dan Kota Bogor — gratis di Breeva.`,
    extraJsonLd: placeJsonLd(c),
    body: page(`Kualitas udara ${c.name} hari ini`, [
      c.perRoad
        ? `${c.blurb} Breeva menghitung ulang asap kendaraan dan kualitas udara untuk <b>tiap ruas jalan</b> di Badung–Denpasar setiap jam, lalu mencarikan rute jalan kaki dengan asap paling sedikit, dihitung di ponselmu.`
        : `${c.blurb} Untuk ${c.name}, Breeva saat ini menampilkan kualitas udara kota per jam. Peta per ruas jalan dan rute di ponsel baru tersedia di Badung–Denpasar dan Kota Bogor; kota lain menyusul bertahap begitu punya titik ukur.`,
      `Hitung juga dosis PM2.5 yang kamu hirup di Kalkulator Paparan. Bebas dipakai tanpa akun.`,
    ], [{ href: '/peta', label: 'Peta Udara Langsung' }, ...NAV]),
  });
}

// Replace the first match of `re` using a function replacer (avoids `$` pitfalls in values).
const sub = (html, re, value) => {
  if (!re.test(html)) { console.warn(`[prerender] pattern not found: ${re}`); return html; }
  return html.replace(re, () => value);
};

let count = 0;
for (const r of ROUTES) {
  const canonical = `${SITE}${r.path}`;
  let html = template;
  html = sub(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(r.title)}</title>`);
  html = sub(html, /<meta name="description" content="[\s\S]*?"\s*\/>/, `<meta name="description" content="${esc(r.description)}" />`);
  html = sub(html, /<link rel="canonical" href="[\s\S]*?"\s*\/>/, `<link rel="canonical" href="${canonical}" />`);
  html = sub(html, /<meta property="og:title" content="[\s\S]*?"\s*\/>/, `<meta property="og:title" content="${esc(r.title)}" />`);
  html = sub(html, /<meta property="og:url" content="[\s\S]*?"\s*\/>/, `<meta property="og:url" content="${canonical}" />`);
  html = sub(html, /<meta property="og:description" content="[\s\S]*?"\s*\/>/, `<meta property="og:description" content="${esc(r.description)}" />`);
  html = sub(html, /<meta name="twitter:title" content="[\s\S]*?"\s*\/>/, `<meta name="twitter:title" content="${esc(r.title)}" />`);
  html = sub(html, /<meta name="twitter:description" content="[\s\S]*?"\s*\/>/, `<meta name="twitter:description" content="${esc(r.description)}" />`);
  if (r.extraJsonLd) html = sub(html, /<\/head>/, `${r.extraJsonLd}</head>`);
  if (r.preload) {
    const files = preloadFiles(buildManifest, r.preload, referencedAssets(template));
    if (!files.js.length) { console.error(`[prerender] ${r.file}: no chunks to preload`); process.exit(1); }
    html = sub(html, /<\/head>/, `    ${preloadTags(files, r.preloadScripts ?? [])}
  </head>`);
    console.log(`[prerender] ${r.file}: preload ${files.js.length} JS, ${files.css.length} CSS, ${(r.preloadScripts ?? []).length} script`);
  }
  if (r.earlyField) {
    const regions = parseRegions(readFileSync(join(process.cwd(), 'src/lib/field/source.ts'), 'utf8'));
    const tag = process.env.VITE_FIELD_STATIC === 'true' ? earlyFieldScript(process.env.VITE_FIELD_BASE ?? '', regions) : '';
    // before the stylesheet: an inline script after it would wait for it (F1-56)
    if (tag) html = atHeadStart(html, tag);
    console.log(`[prerender] ${r.file}: early field ${tag ? `on (${regions.map((g) => g.name).join(', ')})` : 'off (no VITE_FIELD_STATIC or CDN base in this build)'}`);
  }
  html = sub(html, /<div id="root">[\s\S]*?<\/div>/, `<div id="root">${r.body}\n    </div>`);
  writeFileSync(join(DIST, r.file), html, 'utf8');
  count++;
}
// X-W7: the SPA shell (index.html, served for / and /home among others) starts the field requests of / and /home too;
// written after the route files, which were made from the template without it
{
  const regions = parseRegions(readFileSync(join(process.cwd(), 'src/lib/field/source.ts'), 'utf8'));
  const tag = process.env.VITE_FIELD_STATIC === 'true' ? earlyFieldScript(process.env.VITE_FIELD_BASE ?? '', regions, 'app') : '';
  // the map code of / and /home, preloaded only on those paths (the shell serves every route)
  const have = referencedAssets(template);
  const map = ['src/components/map/LeafletMap.tsx'];
  const vg = ['/vendor/leaflet-vectorgrid.js'];
  const byPath = {
    '/': { ...preloadFiles(buildManifest, ['src/pages/BerandaPage.tsx'], have), scripts: [] },
    '/home': { ...preloadFiles(buildManifest, ['src/pages/HomePage.tsx', ...map], have), scripts: vg },
  };
  const pre = appPreloadScript(byPath);
  writeFileSync(TEMPLATE_PATH, atHeadStart(template, `${pre}${tag ? `
    ${tag}` : ''}`), 'utf8');
  console.log(`[prerender] index.html: preload / ${byPath['/'].js.length} JS, /home ${byPath['/home'].js.length} JS; early field ${tag ? 'on for / and /home' : 'off (no VITE_FIELD_STATIC or CDN base in this build)'}`);
}

// the build manifest maps source paths to files; it is a build input, not something to serve
rmSync(join(DIST, '.vite'), { recursive: true, force: true });
console.log(`[prerender] wrote ${count} per-route HTML files to dist/ (${ROUTES.map((r) => r.path).join(', ')})`);
