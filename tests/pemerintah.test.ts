import { describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import PemerintahPage from '../src/pages/PemerintahPage';
import { emailSah, mintaRingkasan, PERTANYAAN_MASUKAN } from '../src/lib/dinas';

describe('N-28 /pemerintah', () => {
  it('shows what an agency gets, the request form (send locked until filled) and the feedback sheet', () => {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(PemerintahPage)));
    for (const href of ['href="/pantau"', 'href="/prioritas"', 'href="/validasi"']) expect(html).toContain(href);
    expect(html).toContain('Minta ringkasan mingguan');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Kirim permintaan/);
    for (const q of PERTANYAAN_MASUKAN) expect(html).toContain(q.slice(0, 20));
    expect(html).toContain('tidak ditampilkan dan tidak dibagikan');
  });
  it('checks e-mail addresses', () => {
    expect(emailSah('dlh@kotabogor.go.id')).toBe(true);
    expect(emailSah('dlh kotabogor')).toBe(false);
    expect(emailSah('a@b')).toBe(false);
  });
  it('sends the request to dinas_daftar and reports failures', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, sudah: false }), { status: 200 }));
    expect(await mintaRingkasan({ instansi: ' DLH Kota Bogor ', wilayah: 'kota-bogor', email: 'dlh@kotabogor.go.id' }, { url: 'https://x', key: 'k', fetchFn: f as unknown as typeof fetch })).toEqual({ ok: true, sudah: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x/rest/v1/rpc/dinas_daftar');
    expect(JSON.parse(String(init.body))).toEqual({ p_instansi: 'DLH Kota Bogor', p_wilayah: 'kota-bogor', p_email: 'dlh@kotabogor.go.id', p_uji: false });
    expect(await mintaRingkasan({ instansi: 'x', wilayah: 'y', email: 'z' }, { url: '', key: '' })).toEqual({ ok: false, alasan: 'konfigurasi' });
  });
});
