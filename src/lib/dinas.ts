/** N-28: an agency asks for a weekly summary of one kab/kota (database function dinas_daftar). The e-mail is typed by the
 * agency itself and never shown anywhere. */

export type DinasHasil = { ok: true; sudah: boolean } | { ok: false; alasan: 'instansi' | 'wilayah' | 'email' | 'batas' | 'jaringan' | 'konfigurasi' };

export const emailSah = (e: string) => e.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

export async function mintaRingkasan(i: { instansi: string; wilayah: string; email: string }, opts: { url?: string; key?: string; fetchFn?: typeof fetch } = {}): Promise<DinasHasil> {
  const url = opts.url ?? import.meta.env.VITE_SUPABASE_URL;
  const key = opts.key ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, alasan: 'konfigurasi' };
  try {
    const r = await (opts.fetchFn ?? fetch)(`${url}/rest/v1/rpc/dinas_daftar`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_instansi: i.instansi.trim(), p_wilayah: i.wilayah, p_email: i.email.trim(), p_uji: false }),
    });
    if (!r.ok) return { ok: false, alasan: 'jaringan' };
    return (await r.json()) as DinasHasil;
  } catch {
    return { ok: false, alasan: 'jaringan' };
  }
}

/** The questions of the agency feedback sheet (the printed sheet of the trial, Downloads/teknopak/uji_coba). */
export const PERTANYAAN_MASUKAN = [
  'Nama instansi dan bagian',
  'Jabatan pemberi masukan (tanpa nama pun boleh)',
  'Tanggal peragaan',
  'Apakah daftar prioritas sekolah dan fasilitas kesehatan berguna untuk pekerjaan instansi? (tidak / mungkin / ya, untuk ...)',
  'Data apa yang instansi miliki dan bisa membuat Breeva lebih tepat (hitungan lalu lintas, laporan ISPA, lokasi pembakaran sampah)?',
  'Apa yang perlu diubah supaya bisa dipakai instansi (tampilan, bahasa, laporan, akurasi)?',
  'Apakah instansi bersedia dihubungi lagi untuk uji lanjutan? (tidak / ya)',
  'Catatan lain',
] as const;
