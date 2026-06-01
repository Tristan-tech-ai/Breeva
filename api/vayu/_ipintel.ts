// Shared IP-intelligence for the Developer-API gate. Underscore prefix = inlined
// util, NOT a Vercel function (keeps us within the 12-function Hobby cap). Combines
// proxycheck.io + IPQualityScore + free hosting-ASN heuristics into one verdict,
// cached per-IP in `ip_reputation` with a 7-day TTL so paid free-tier quotas track
// distinct new IPs, not request volume. Fails open everywhere: missing provider key
// or env → that source is skipped; both absent → heuristics-only.

type Json = Record<string, unknown>;

export interface IpVerdict {
  is_vpn: boolean;
  is_proxy: boolean;
  is_datacenter: boolean;
  is_tor: boolean;
  risk_score: number;        // 0..100
  country: string | null;    // ISO-2
  asn: string | null;        // normalised 'AS15169'
  sources: Json;             // { proxycheck, ipqs, heuristics }
  cached: boolean;
}

function supaEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

// Major cloud / hosting ASNs (datacenter heuristic — secondary to the providers).
const HOSTING_ASNS = new Set([
  'AS16509', 'AS14618',                          // Amazon AWS
  'AS15169', 'AS396982', 'AS19527',              // Google / GCP
  'AS8075', 'AS8068', 'AS8069',                  // Microsoft / Azure
  'AS14061',                                     // DigitalOcean
  'AS16276',                                     // OVH
  'AS24940',                                     // Hetzner
  'AS63949', 'AS20940',                          // Linode / Akamai
  'AS20473', 'AS208046',                         // Vultr / Choopa
  'AS45102', 'AS37963',                          // Alibaba
  'AS132203', 'AS45090',                         // Tencent
  'AS14080', 'AS262287',                         // misc hosting
  'AS51167', 'AS197540',                         // Contabo / netcup
  'AS54113',                                     // Fastly
  'AS13335',                                     // Cloudflare
]);

function benign(country: string | null = null): IpVerdict {
  return { is_vpn: false, is_proxy: false, is_datacenter: false, is_tor: false, risk_score: 0, country, asn: null, sources: {}, cached: false };
}

// Skip provider calls for unroutable / private / loopback addresses (saves quota).
export function isPrivateOrUnknown(ip: string): boolean {
  if (!ip || ip === 'unknown') return true;
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = ip.match(/^172\.(\d{1,3})\./);
  if (m) { const o = parseInt(m[1], 10); if (o >= 16 && o <= 31) return true; }
  return false;
}

async function fetchJson(url: string, ms = 2500): Promise<Json | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return (await resp.json()) as Json;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface SourceResult {
  is_vpn: boolean; is_proxy: boolean; is_tor: boolean; is_hosting: boolean;
  risk: number; asn: string | null; country: string | null; raw: Json;
}

// proxycheck.io — GET /v2/{ip}?key=&vpn=1&asn=1&risk=1 → { [ip]: { proxy, type, risk, asn, isocode } }
async function queryProxycheck(ip: string): Promise<SourceResult | null> {
  const key = process.env.PROXYCHECK_API_KEY;
  if (!key) return null;
  const j = await fetchJson(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${key}&vpn=1&asn=1&risk=1`);
  const node = j && (j[ip] as Json | undefined);
  if (!node) return null;
  const type = String(node.type ?? '');
  return {
    is_proxy: node.proxy === 'yes',
    is_vpn: type === 'VPN',
    is_tor: type === 'TOR',
    is_hosting: type === 'Hosting' || type === 'Compromised Server',
    risk: Number(node.risk) || 0,
    asn: node.asn ? String(node.asn) : null,
    country: node.isocode ? String(node.isocode) : null,
    raw: { proxy: node.proxy, type: node.type, risk: node.risk },
  };
}

// IPQualityScore — GET /api/json/ip/{key}/{ip}?strictness=1 → { proxy, vpn, tor, fraud_score, ASN, country_code }
async function queryIpqs(ip: string): Promise<SourceResult | null> {
  const key = process.env.IPQUALITYSCORE_API_KEY;
  if (!key) return null;
  const j = await fetchJson(`https://ipqualityscore.com/api/json/ip/${key}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`);
  if (!j || j.success === false) return null;
  const asnNum = Number(j.ASN);
  return {
    is_vpn: !!j.vpn,
    is_proxy: !!j.proxy,
    is_tor: !!j.tor,
    is_hosting: false, // IPQS has no clean datacenter flag; rely on ASN heuristic
    risk: Number(j.fraud_score) || 0,
    asn: Number.isFinite(asnNum) && asnNum > 0 ? `AS${asnNum}` : null,
    country: j.country_code ? String(j.country_code) : null,
    raw: { proxy: j.proxy, vpn: j.vpn, tor: j.tor, fraud_score: j.fraud_score },
  };
}

/** Cache-only read. Hit iff a non-expired row exists; null on miss/expired/error (fail-open). */
export async function readIpReputation(ip: string): Promise<IpVerdict | null> {
  const { url, key } = supaEnv();
  if (!url || !key) return null;
  try {
    const resp = await fetch(
      `${url}/rest/v1/ip_reputation?ip=eq.${encodeURIComponent(ip)}&select=*&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<Json>;
    const r = Array.isArray(rows) && rows[0];
    if (!r) return null;
    if (new Date(String(r.expires_at)).getTime() <= Date.now()) return null; // expired → treat as miss
    return {
      is_vpn: !!r.is_vpn, is_proxy: !!r.is_proxy, is_datacenter: !!r.is_datacenter, is_tor: !!r.is_tor,
      risk_score: Number(r.risk_score) || 0, country: (r.country as string) ?? null, asn: (r.asn as string) ?? null,
      sources: (r.provider_sources as Json) ?? {}, cached: true,
    };
  } catch {
    return null;
  }
}

async function persist(ip: string, v: IpVerdict): Promise<void> {
  const { url, key } = supaEnv();
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/rpc/upsert_ip_reputation`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_ip: ip, p_is_vpn: v.is_vpn, p_is_proxy: v.is_proxy, p_is_datacenter: v.is_datacenter,
        p_is_tor: v.is_tor, p_risk_score: v.risk_score, p_country: v.country, p_asn: v.asn,
        p_sources: v.sources, p_ttl_days: 7,
      }),
    });
  } catch { /* cache persistence is best-effort */ }
}

/**
 * Full check: cache → on miss query providers (parallel) + heuristics → combine →
 * persist with TTL. Returns a verdict even if every source fails (heuristics-only /
 * benign). Call this fire-and-forget from the gate on a cache miss.
 */
export async function checkIp(ip: string, ctxCountry: string | null = null): Promise<IpVerdict> {
  if (isPrivateOrUnknown(ip)) return benign(ctxCountry);

  const cached = await readIpReputation(ip);
  if (cached) return cached;

  const [pcR, ipqsR] = await Promise.allSettled([queryProxycheck(ip), queryIpqs(ip)]);
  const pc = pcR.status === 'fulfilled' ? pcR.value : null;
  const ipqs = ipqsR.status === 'fulfilled' ? ipqsR.value : null;

  const asn = pc?.asn ?? ipqs?.asn ?? null;
  const datacenterAsn = !!(asn && HOSTING_ASNS.has(asn));

  const verdict: IpVerdict = {
    is_vpn: !!(pc?.is_vpn || ipqs?.is_vpn),
    is_proxy: !!(pc?.is_proxy || ipqs?.is_proxy),
    is_tor: !!(pc?.is_tor || ipqs?.is_tor),
    is_datacenter: datacenterAsn || !!pc?.is_hosting,
    risk_score: Math.round(Math.max(pc?.risk ?? 0, ipqs?.risk ?? 0)),
    country: pc?.country ?? ipqs?.country ?? ctxCountry,
    asn,
    sources: {
      proxycheck: pc?.raw ?? null,
      ipqs: ipqs?.raw ?? null,
      heuristics: { datacenter_asn: datacenterAsn, asn },
    },
    cached: false,
  };

  await persist(ip, verdict);
  return verdict;
}
