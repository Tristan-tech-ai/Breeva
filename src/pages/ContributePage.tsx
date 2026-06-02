import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ChevronLeft, MapPinPlus, Store, TreePine, Wind, Camera, Send, CheckCircle2,
  LocateFixed, Clock, Loader2, Sparkles, ShieldCheck, ShieldAlert, ArrowRight,
  MapPin, X, Coins,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { Seo } from '../components/Seo';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { submitContribution, reverseGeocode, type SubmitContributionResult } from '../lib/api';

const LocationPicker = lazy(() => import('../components/contribute/LocationPicker'));

type Mode = 'aqi' | 'missing_place' | 'eco_merchant' | 'green_space';

// 1 (cleanest) .. 5 (hazardous) — stored as air_quality_reports.aqi_rating.
const SEVERITY: { value: number; label: string; color: string }[] = [
  { value: 1, label: 'Sangat baik', color: '#22c55e' },
  { value: 2, label: 'Baik', color: '#84cc16' },
  { value: 3, label: 'Sedang', color: '#eab308' },
  { value: 4, label: 'Buruk', color: '#f97316' },
  { value: 5, label: 'Berbahaya', color: '#ef4444' },
];

const POI_TYPES: { type: Exclude<Mode, 'aqi'>; icon: LucideIcon; label: string; description: string; color: string; categories: string[] }[] = [
  { type: 'missing_place', icon: MapPinPlus, label: 'Tempat baru', description: 'Lokasi yang belum ada di peta', color: '#3b82f6',
    categories: ['Restoran', 'Kafe', 'Toko', 'Sekolah', 'Masjid', 'RS', 'Taman', 'Lainnya'] },
  { type: 'eco_merchant', icon: Store, label: 'Merchant ramah lingkungan', description: 'Usaha berkelanjutan', color: '#10b981',
    categories: ['Refill Station', 'Thrift', 'Vegan', 'Reparasi', 'Produk Eco', 'Pasar Organik'] },
  { type: 'green_space', icon: TreePine, label: 'Ruang hijau', description: 'Taman atau area hijau', color: '#16a34a', categories: [] },
];

const STATUS_THEME: Record<SubmitContributionResult['status'], { label: string; color: string; Icon: LucideIcon }> = {
  approved: { label: 'Terverifikasi', color: '#22c55e', Icon: ShieldCheck },
  pending: { label: 'Menunggu verifikasi', color: '#f59e0b', Icon: Clock },
  rejected: { label: 'Perlu ditinjau ulang', color: '#ef4444', Icon: ShieldAlert },
};

export default function ContributePage() {
  const navigate = useNavigate();
  const reduce = useReducedMotion() ?? false;
  const user = useAuthStore((s) => s.user);
  // Reactive VAYU auto-trace consent (mirrors breeva_anonymous_data; default on).
  const autoTraceOn = useSettingsStore((s) => s.anonymous_data);

  const [mode, setMode] = useState<Mode>('aqi');
  const [severity, setSeverity] = useState(3);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitContributionResult | null>(null);

  const isPoi = mode !== 'aqi';
  const poi = POI_TYPES.find((t) => t.type === mode);

  const container: Variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.04 } } };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } } };

  const applyCoords = async (lat: number, lng: number) => {
    setCoords({ lat, lng });
    setAddress(null);
    try { const r = await reverseGeocode({ lat, lng }); if (r.address) setAddress(r.address); } catch { /* non-fatal */ }
  };

  const handleLocate = () => {
    if (!('geolocation' in navigator)) { setLocError('Perangkat tidak mendukung lokasi.'); return; }
    setLocating(true); setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); void applyCoords(pos.coords.latitude, pos.coords.longitude); },
      () => { setLocating(false); setLocError('Tidak bisa mengambil lokasi. Aktifkan izin lokasi atau geser pin di peta.'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handlePhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFormError('Ukuran foto maksimal 5MB.'); return; }
    setFormError(null);
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setFormError(null);
    if (mode === 'aqi' && !coords) { setFormError('Tentukan lokasi laporan dulu.'); return; }
    if (isPoi && name.trim().length < 3) { setFormError('Nama tempat minimal 3 karakter.'); return; }

    setSubmitting(true);
    try {
      let photo_url: string | undefined;
      if (photoFile) {
        const ext = photoFile.name.split('.').pop() || 'jpg';
        const filePath = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('contributions').upload(filePath, photoFile, { contentType: photoFile.type });
        if (!upErr) photo_url = supabase.storage.from('contributions').getPublicUrl(filePath).data.publicUrl;
      }

      const res = await submitContribution({
        type: mode === 'aqi' ? 'hazard' : mode,
        user_id: user.id,
        ...(isPoi ? { name: name.trim(), category: category || undefined } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        ...(mode === 'aqi' ? { aqi_rating: severity } : {}),
        ...(photo_url ? { photo_url } : {}),
      });

      if (!res.ok) { setFormError('Gagal mengirim. Coba lagi.'); return; }
      useAuthStore.getState().fetchProfile?.();
      setResult(res);
    } catch {
      setFormError('Terjadi kesalahan. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetAll = () => {
    setMode('aqi'); setSeverity(3); setName(''); setCategory(''); setDescription('');
    setCoords(null); setAddress(null); setLocError(null); setPhotoFile(null); setPhotoPreview(null);
    setFormError(null); setResult(null);
  };

  // ── Success ────────────────────────────────────────────────────────────────
  if (result) {
    const st = STATUS_THEME[result.status];
    return (
      <div className="gradient-mesh-bg min-h-screen pb-24">
        <div className="max-w-2xl mx-auto px-4 pt-16">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            className="glass-card relative overflow-hidden p-7 text-center" role="status" aria-live="polite"
          >
            <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(120% 80% at 50% -10%, ${st.color}1f, transparent 60%)` }} />
            <motion.div initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: reduce ? 0 : 0.15 }}
              className="relative grid place-items-center w-16 h-16 mx-auto rounded-2xl mb-4" style={{ background: `${st.color}1f` }}>
              <CheckCircle2 className="w-9 h-9" style={{ color: st.color }} />
            </motion.div>
            <h2 className="relative text-xl font-extrabold text-gray-900 dark:text-white">Terima kasih!</h2>
            <p className="relative text-sm text-gray-500 dark:text-gray-400 mt-1">Kontribusimu membantu memperbaiki peta udara bersih untuk semua.</p>

            <div className="relative mt-4 flex flex-col items-center gap-2">
              {result.ecopoints_earned > 0 ? (
                <div className="inline-flex items-center gap-1.5 text-primary-600 dark:text-primary-400 font-bold">
                  <Coins className="w-4 h-4" /> +{result.ecopoints_earned} EcoPoints
                </div>
              ) : result.capped ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
                  Batas poin harian (5/hari) tercapai — laporanmu <strong>tetap dihitung</strong>.
                </p>
              ) : null}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ color: st.color, background: `${st.color}1f` }}>
                <st.Icon className="w-3.5 h-3.5" /> {st.label}
              </span>
              {result.status === 'rejected' && result.ai_notes && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">{result.ai_notes}</p>
              )}
              {result.quest_updates.map((q) => (
                <div key={q.title} className="inline-flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  <Sparkles className="w-3 h-3" /> Quest selesai: {q.title} (+{q.reward})
                </div>
              ))}
            </div>

            <div className="relative flex gap-2.5 mt-6">
              <button onClick={resetAll} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200">Tambah lagi</button>
              <button onClick={() => navigate('/contribute/history')} className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200">Riwayat</button>
              <button onClick={() => navigate('/')} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm font-semibold shadow-lg shadow-primary-500/30">Ke peta</button>
            </div>
          </motion.div>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  const sevTheme = SEVERITY[severity - 1];

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <Seo title="Kontribusi Udara & Peta — Breeva" description="Laporkan kualitas udara per-jalan dan tambahkan tempat ke peta Breeva. Kontribusimu memberi makan engine VAYU dan memajukan quest harian." path="/contribute" />

      {/* Header */}
      <div className="sticky top-0 z-20 glass-nav px-4 py-3 flex items-center justify-between safe-area-top">
        <button onClick={() => navigate(-1)} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Kontribusi</h1>
        <button onClick={() => navigate('/contribute/history')} aria-label="Riwayat kontribusi" className="text-primary-500 p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <Clock className="w-5 h-5" />
        </button>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-4">
        {/* Branded explainer */}
        <motion.div variants={item} className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-emerald-900/10"
          style={{ background: 'linear-gradient(135deg,#047857 0%,#059669 42%,#0ea5e9 100%)' }}>
          <div className="absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <div className="relative">
            <div className="flex items-center gap-1.5 text-white/90">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-[0.18em] font-bold">Komunitas · VAYU Contributor</span>
            </div>
            <h2 className="mt-2 text-lg font-extrabold leading-snug">{isPoi ? 'Tambahkan tempat ke peta' : 'Laporkan kualitas udara di sekitarmu'}</h2>
            <p className="mt-1.5 text-[12.5px] text-white/85 leading-relaxed max-w-md">
              {isPoi
                ? 'Lengkapi peta Breeva — usulanmu ditinjau lalu membantu navigasi udara bersih semua pengguna.'
                : 'Laporanmu memberi makan engine VAYU per-jalan dan memajukan quest harian “Lapor udara”.'}
            </p>
          </div>
        </motion.div>

        {/* AQI hero report (primary) */}
        {!isPoi && (
          <motion.div variants={item} className="glass-card p-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 block">Seberapa buruk udaranya di sini?</label>
              <div className="flex gap-1.5">
                {SEVERITY.map((s) => {
                  const active = severity === s.value;
                  return (
                    <button key={s.value} type="button" onClick={() => setSeverity(s.value)}
                      aria-label={s.label} aria-pressed={active}
                      className="flex-1 h-11 rounded-xl text-sm font-bold transition border-2"
                      style={active
                        ? { background: s.color, borderColor: s.color, color: '#fff' }
                        : { background: `${s.color}14`, borderColor: 'transparent', color: s.color }}>
                      {s.value}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs font-semibold" style={{ color: sevTheme.color }}>{sevTheme.label}</p>
            </div>
          </motion.div>
        )}

        {/* POI form */}
        {isPoi && poi && (
          <motion.div variants={item} className="glass-card p-4 space-y-4">
            <button onClick={() => { setMode('aqi'); setFormError(null); }} className="text-xs text-primary-500 font-medium flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" /> Kembali ke laporan udara
            </button>
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: `${poi.color}1f` }}><poi.icon className="w-[18px] h-[18px]" style={{ color: poi.color }} /></span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{poi.label}</span>
            </div>
            <div>
              <label htmlFor="poi-name" className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 block">Nama tempat *</label>
              <input id="poi-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Taman Kota Baru"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition" />
            </div>
            {poi.categories.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 block">Kategori</label>
                <div className="flex flex-wrap gap-2">
                  {poi.categories.map((cat) => (
                    <button key={cat} type="button" onClick={() => setCategory(cat === category ? '' : cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${category === cat
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-300 border border-primary-200 dark:border-primary-800'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Shared: location */}
        <motion.div variants={item} className="glass-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Lokasi {!isPoi && <span className="text-danger-500">*</span>}</label>
            <button onClick={handleLocate} disabled={locating} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 disabled:opacity-60">
              {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />} Gunakan lokasi saya
            </button>
          </div>
          {coords ? (
            <>
              <Suspense fallback={<div className="h-[168px] rounded-[14px] bg-gray-100 dark:bg-gray-800 animate-pulse" />}>
                <LocationPicker lat={coords.lat} lng={coords.lng} onChange={(la, ln) => void applyCoords(la, ln)} />
              </Suspense>
              <p className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary-500" />
                <span>{address || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`} · ketuk/geser pin untuk menyesuaikan</span>
              </p>
            </>
          ) : (
            <button onClick={handleLocate} className="w-full py-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-primary-300 hover:text-primary-500 transition flex flex-col items-center gap-1.5">
              <MapPin className="w-6 h-6" />
              <span className="text-xs font-medium">Tentukan lokasi</span>
            </button>
          )}
          {locError && <p className="text-xs text-amber-600 dark:text-amber-400" role="alert">{locError}</p>}
        </motion.div>

        {/* Shared: description + photo */}
        <motion.div variants={item} className="glass-card p-4 space-y-4">
          <div>
            <label htmlFor="desc" className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 block">Catatan (opsional)</label>
            <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Detail yang membantu…"
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5 block">Foto (opsional)</label>
            {photoPreview ? (
              <div className="relative">
                <img src={photoPreview} alt="Pratinjau" className="w-full h-40 object-cover rounded-xl" />
                <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); }} aria-label="Hapus foto" className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white grid place-items-center">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-2 w-full py-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:border-primary-300 hover:text-primary-500 transition cursor-pointer">
                <Camera className="w-6 h-6" />
                <span className="text-xs font-medium">Ketuk untuk tambah foto</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhoto(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </motion.div>

        {formError && <motion.p variants={item} className="text-xs text-danger-500 text-center" role="alert">{formError}</motion.p>}

        {/* Submit */}
        <motion.button variants={item} whileTap={reduce ? undefined : { scale: 0.98 }} onClick={handleSubmit}
          disabled={submitting || (mode === 'aqi' ? !coords : name.trim().length < 3)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm font-semibold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:opacity-50 disabled:shadow-none transition">
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim…</> : <><Send className="w-4 h-4" /> Kirim kontribusi</>}
        </motion.button>

        {/* Secondary: add a place (only on the AQI view) */}
        {!isPoi && (
          <motion.div variants={item} className="pt-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">Atau tambahkan ke peta</p>
            <div className="space-y-2">
              {POI_TYPES.map((t) => (
                <button key={t.type} onClick={() => { setMode(t.type); setFormError(null); }}
                  className="w-full glass-card p-3.5 flex items-center gap-3 text-left hover:shadow-md transition">
                  <span className="grid place-items-center w-10 h-10 rounded-xl shrink-0" style={{ background: `${t.color}1f` }}><t.icon className="w-5 h-5" style={{ color: t.color }} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{t.label}</span>
                    <span className="block text-[11px] text-gray-400 dark:text-gray-500">{t.description}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* VAYU auto-trace note */}
        <motion.div variants={item} className="glass-card p-4 flex gap-3">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-emerald-500 shrink-0"><Wind className="w-[18px] h-[18px] text-white" /></span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-gray-900 dark:text-white">VAYU Auto-trace</p>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={autoTraceOn ? { color: '#16a34a', background: '#22c55e1f' } : { color: '#9ca3af', background: '#9ca3af1f' }}>
                {autoTraceOn ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">
              Jejak pergerakan anonim (bukan identitasmu) memperkaya peta udara VAYU tiap kamu jalan — +5 EcoPoints/sesi. Bisa dimatikan kapan saja.
            </p>
            <div className="flex items-center gap-4 mt-2">
              <button onClick={() => navigate('/privacy')} className="text-[11px] font-semibold text-primary-600 dark:text-primary-400">Pelajari privasi →</button>
              <button onClick={() => navigate('/settings')} className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Atur di Setelan</button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <BottomNavigation />
    </div>
  );
}
