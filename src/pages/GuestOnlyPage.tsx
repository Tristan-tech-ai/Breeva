import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, CloudOff, Footprints, LogIn, Map as MapIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import { GUEST_NEEDS_ACCOUNT, useGuestStore } from '../stores/guestStore';
import { useAuthStore } from '../stores/authStore';

const dateFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What a guest sees on a page that needs the account server (GuestGate), optionally with the walks kept locally. */
export default function GuestOnlyPage({ title, walks = false }: { title: string; walks?: boolean }) {
  const navigate = useNavigate();
  const list = useGuestStore((s) => s.walks);
  const leaveGuest = useAuthStore((s) => s.leaveGuest);
  // Signing in leaves guest mode; the walks kept on this device stay in the guest store.
  const signIn = () => { leaveGuest(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-28">
      <div className="sticky top-0 z-30 glass-nav px-4 py-3 flex items-center gap-2 safe-area-top">
        <button onClick={() => navigate(-1)} aria-label="Kembali" className="text-gray-600 dark:text-gray-300 p-1 -ml-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h1>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        <div className="glass-card p-5" role="status">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <CloudOff className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Mode tamu</p>
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">{GUEST_NEEDS_ACCOUNT}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={signIn} data-guest-masuk className="inline-flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-sm">
              <LogIn className="h-3.5 w-3.5" /> Masuk atau daftar
            </button>
            <Link to="/home" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
              <MapIcon className="h-3.5 w-3.5" /> Kembali ke peta
            </Link>
            <Link to="/profile" className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
              Profil tamu
            </Link>
          </div>
        </div>

        {walks && (
          <section className="glass-card p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
              <Footprints className="h-4 w-4 text-primary-500" /> Catatan jalan di perangkat ini
            </h2>
            {list.length === 0 ? (
              <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">
                Belum ada jalan tercatat. Pilih tujuan di peta, hitung rute, lalu tekan Mulai.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {list.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900 dark:text-white">{dateFmt.format(new Date(w.started_at))}</span>
                      <span className="block text-gray-500 dark:text-gray-400">
                        {(w.distance_meters / 1000).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km · {Math.max(1, Math.round(w.duration_seconds / 60))} menit
                        {w.transport_mode === 'motorcycle' ? ' · motor' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">+{w.ecopoints_earned} poin</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
