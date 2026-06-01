import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Leaf, Footprints, Share2, Trophy, MapPin, Flame, Wind, TreePine, CalendarHeart } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import { co2KgFromGrams, treesFromCo2Kg } from '../lib/metrics';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import HeroCard from '../components/ui/HeroCard';
import StatTile from '../components/ui/StatTile';
import SectionCard from '../components/ui/SectionCard';
import ChartCard from '../components/ui/ChartCard';
import Segmented from '../components/ui/Segmented';
import { SkeletonGrid } from '../components/ui/Skeleton';

interface WalkRow {
  distance_meters: number;
  co2_saved_grams: number;
  ecopoints_earned: number;
  avg_aqi: number | null;
  completed_at: string | null;
  created_at: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const whenOf = (w: WalkRow) => new Date(w.completed_at || w.created_at);

export default function YearInReviewPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [walks, setWalks] = useState<WalkRow[]>([]);
  const [contribDates, setContribDates] = useState<string[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      setIsLoading(true);
      const [{ data: w }, { data: c }] = await Promise.all([
        supabase.from('walks')
          .select('distance_meters, co2_saved_grams, ecopoints_earned, avg_aqi, completed_at, created_at')
          .eq('user_id', user.id).eq('status', 'completed'),
        supabase.from('air_quality_reports').select('created_at').eq('user_id', user.id),
      ]);
      if (!alive) return;
      const ww = (w ?? []) as WalkRow[];
      setWalks(ww);
      setContribDates((c ?? []).map((r) => r.created_at as string));
      const years = [...new Set(ww.map((r) => whenOf(r).getFullYear()))].sort((a, b) => b - a);
      if (years.length) setYear(years[0]);
      setIsLoading(false);
    })();
    return () => { alive = false; };
  }, [user]);

  const availableYears = useMemo(() => {
    const ys = new Set<number>(walks.map((r) => whenOf(r).getFullYear()));
    contribDates.forEach((d) => ys.add(new Date(d).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [walks, contribDates]);

  const stats = useMemo(() => {
    const yw = walks.filter((r) => whenOf(r).getFullYear() === year);
    const monthly = new Array(12).fill(0) as number[];
    yw.forEach((r) => { monthly[whenOf(r).getMonth()]++; });
    const distanceKm = yw.reduce((s, r) => s + (r.distance_meters || 0) / 1000, 0);
    const co2Kg = co2KgFromGrams(yw.reduce((s, r) => s + (r.co2_saved_grams || 0), 0));
    const points = yw.reduce((s, r) => s + (r.ecopoints_earned || 0), 0);
    const aqiRows = yw.filter((r) => r.avg_aqi != null);
    const avgAqi = aqiRows.length ? Math.round(aqiRows.reduce((s, r) => s + (r.avg_aqi || 0), 0) / aqiRows.length) : 0;
    const contribs = contribDates.filter((d) => new Date(d).getFullYear() === year).length;
    const bestIdx = monthly.indexOf(Math.max(...monthly));
    return { walks: yw.length, distanceKm, co2Kg, points, avgAqi, contribs, monthly, bestIdx, bestWalks: monthly[bestIdx] || 0 };
  }, [walks, contribDates, year]);

  const handleShare = async () => {
    const text = `🌿 Rekap Breeva ${year}:\n🚶 ${stats.walks} jalan\n📏 ${stats.distanceKm.toFixed(1)} km\n🌱 ${stats.co2Kg.toFixed(1)} kg CO₂\n🏆 ${stats.points} EcoPoin\n\nJalan hijau bareng Breeva!`;
    try {
      if (navigator.share) await navigator.share({ title: `Breeva Rekap ${year}`, text });
      else await navigator.clipboard.writeText(text);
    } catch { /* cancelled */ }
  };

  const chartData = stats.monthly.map((n, i) => ({ month: MONTHS[i], jalan: n }));

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-primary-400/15 blur-3xl" />
      <PageHeader
        title={`Rekap ${year}`}
        onBack={() => navigate(-1)}
        right={<button onClick={handleShare} className="p-1 text-gray-600 dark:text-gray-300" aria-label="Bagikan"><Share2 className="w-5 h-5" /></button>}
      />

      <div className="relative max-w-2xl mx-auto px-4 pt-4 space-y-4">
        <HeroCard
          eyebrow="Rekap tahunan"
          title={`Perjalanan hijaumu ${year}`}
          subtitle={`${stats.walks} jalan · ${stats.distanceKm.toFixed(1)} km`}
          media={<div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center"><CalendarHeart className="w-7 h-7 text-white" /></div>}
        >
          {availableYears.length > 1 && (
            <Segmented<string>
              idBase="yir-year"
              size="sm"
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={availableYears.map((y) => ({ value: String(y), label: String(y) }))}
            />
          )}
        </HeroCard>

        {isLoading ? (
          <SkeletonGrid count={4} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile icon={<Footprints className="w-4 h-4" />} accent="text-blue-500" label="Total Jalan" value={stats.walks} />
              <StatTile icon={<MapPin className="w-4 h-4" />} accent="text-emerald-500" label="Jarak" value={stats.distanceKm} unit="km" decimals={1} />
              <StatTile icon={<Leaf className="w-4 h-4" />} accent="text-green-500" label="CO₂ Dihemat" value={stats.co2Kg} unit="kg" decimals={1} />
              <StatTile icon={<Trophy className="w-4 h-4" />} accent="text-amber-500" label="EcoPoin" value={stats.points} unit="poin" />
            </div>

            <SectionCard title="Jalan per bulan">
              {stats.walks > 0 ? (
                <ChartCard data={chartData} xKey="month" series={[{ dataKey: 'jalan', color: '#10b981' }]} kind="bar" height={180} valueFormatter={(v) => `${v} jalan`} />
              ) : (
                <div className="py-8 text-center text-sm text-gray-400">Belum ada jalan di tahun ini.</div>
              )}
            </SectionCard>

            <SectionCard title="Sorotan">
              <div className="space-y-2.5">
                {[
                  { Icon: CalendarHeart, tint: 'text-indigo-500', text: `Bulan terbaik: ${MONTHS[stats.bestIdx]} (${stats.bestWalks} jalan)` },
                  { Icon: Flame, tint: 'text-orange-500', text: `Streak terpanjang: ${profile?.longest_streak ?? 0} hari` },
                  { Icon: Wind, tint: 'text-cyan-500', text: `Rata-rata AQI saat jalan: ${stats.avgAqi || '—'}` },
                  { Icon: MapPin, tint: 'text-rose-500', text: `${stats.contribs} kontribusi kualitas udara` },
                  { Icon: TreePine, tint: 'text-green-500', text: `Setara ${treesFromCo2Kg(stats.co2Kg).toFixed(1)} pohon ditanam` },
                ].map((h, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                    <h.Icon className={`w-4 h-4 shrink-0 ${h.tint}`} />
                    <span>{h.text}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <button
              onClick={handleShare}
              className="w-full gradient-primary text-white font-semibold py-3 rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Share2 className="w-4 h-4" /> Bagikan Rekap Tahunmu
            </button>
          </>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}
