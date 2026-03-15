import L from 'leaflet';

// ── Root category → color map ────────────────────────────────────────

const ROOT_COLORS: Record<string, string> = {
  catering:       '#ef4444', // red
  accommodation:  '#3b82f6', // blue
  commercial:     '#f59e0b', // amber
  tourism:        '#ec4899', // pink
  leisure:        '#22c55e', // green
  religion:       '#06b6d4', // cyan
  service:        '#6366f1', // indigo
  entertainment:  '#a855f7', // purple
  healthcare:     '#10b981', // emerald
  education:      '#0ea5e9', // sky
  office:         '#64748b', // slate
  parking:        '#78716c', // stone
  public_transport: '#8b5cf6', // violet
  production:     '#d97706', // amber-dark
  national_park:  '#16a34a', // green-dark
  eco_merchant:   '#059669', // emerald-600 — distinct from leisure green
};

const FALLBACK_COLOR = '#6b7280';

// ── Filled SVG icons (white on color, 16×16 viewBox) ─────────────────

const ICONS: Record<string, string> = {
  // Catering
  restaurant:  '<path d="M4 2v5a2 2 0 002 2v5h1V9a2 2 0 002-2V2M5 2v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M11 2c0 3-1 5-1 5v2h2v5h-1V9s-1-2-1-5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
  cafe:        '<rect x="3" y="4" width="7" height="6" rx="1" fill="#fff" opacity=".9"/><path d="M10 6h1.5a1.5 1.5 0 010 3H10" stroke="#fff" stroke-width="1.5" fill="none"/><line x1="3" y1="12" x2="10" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>',
  bar:         '<path d="M3 3h10l-4 5v3h2v1H5v-1h2V8L3 3z" fill="#fff" opacity=".9"/><circle cx="8" cy="6" r="1" fill="currentColor"/>',
  fast_food:   '<path d="M3 8h10M4 8l.5-3h7l.5 3M5 8v4h6V8" fill="#fff" opacity=".85" stroke="#fff" stroke-width="1" stroke-linejoin="round"/><path d="M6 5c0-1.5 1-2.5 2-2.5s2 1 2 2.5" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/>',

  // Accommodation
  hotel:       '<path d="M2 11V5M2 8h5a2 2 0 012 2v1h5V7a1 1 0 00-1-1H9" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="5" cy="6.5" r="1.5" fill="#fff" opacity=".9"/><line x1="2" y1="11" x2="14" y2="11" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>',

  // Leisure
  park:        '<circle cx="8" cy="5" r="3.5" fill="#fff" opacity=".85"/><rect x="7.2" y="8" width="1.6" height="5" rx=".5" fill="#fff" opacity=".9"/>',
  playground:  '<path d="M4 13l4-8 4 8" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="8" cy="4" r="1.5" fill="#fff" opacity=".9"/>',
  sport:       '<circle cx="8" cy="8" r="5" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M3.5 5.5l9 5M3.5 10.5l9-5" stroke="#fff" stroke-width="1" stroke-linecap="round"/>',

  // Healthcare
  hospital:    '<rect x="5.5" y="3" width="5" height="10" rx=".5" fill="#fff" opacity=".9"/><rect x="3" y="5.5" width="10" height="5" rx=".5" fill="#fff" opacity=".9"/>',
  pharmacy:    '<path d="M8 3v10M3 8h10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
  clinic:      '<path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',

  // Education
  school:      '<path d="M8 3L2 6l6 3 6-3-6-3z" fill="#fff" opacity=".85"/><path d="M4 7.5v3.5c0 1 1.8 2 4 2s4-1 4-2V7.5" stroke="#fff" stroke-width="1.3" fill="none"/>',
  university:  '<path d="M8 2L2 5l6 3 6-3-6-3z" fill="#fff" opacity=".85"/><path d="M4 7v4c0 1 1.8 2 4 2s4-1 4-2V7" stroke="#fff" stroke-width="1.3" fill="none"/><line x1="13" y1="5" x2="13" y2="11" stroke="#fff" stroke-width="1.3"/>',

  // Religion
  mosque:      '<path d="M8 2c-1 0-2 1.5-2 3v1h4V5c0-1.5-1-3-2-3z" fill="#fff" opacity=".9"/><rect x="5" y="6" width="6" height="6" fill="#fff" opacity=".85"/><rect x="7" y="9" width="2" height="3" fill="currentColor" opacity=".6"/><path d="M10 3a2 2 0 01-3 1.7" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/>',
  church:      '<rect x="7" y="2" width="2" height="4" fill="#fff" opacity=".9"/><rect x="5.5" y="3.5" width="5" height="2" rx=".3" fill="#fff" opacity=".9"/><path d="M4 7l4-1 4 1v6H4V7z" fill="#fff" opacity=".85"/>',
  worship:     '<path d="M8 2v4M6 4h4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M4 8l4-2 4 2v5H4V8z" fill="#fff" opacity=".85"/>',

  // Finance
  bank:        '<path d="M3 6l5-3 5 3H3z" fill="#fff" opacity=".9"/><rect x="3" y="6" width="10" height="1" fill="#fff" opacity=".7"/><path d="M4.5 7v4M7 7v4M9.5 7v4M12 7v4" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><rect x="3" y="11" width="10" height="1.5" rx=".3" fill="#fff" opacity=".85"/>',
  atm:         '<rect x="3" y="3" width="10" height="9" rx="1.5" fill="#fff" opacity=".85"/><rect x="5" y="5" width="6" height="3" rx=".5" fill="currentColor" opacity=".4"/><circle cx="6" cy="10" r=".6" fill="currentColor" opacity=".5"/><circle cx="8" cy="10" r=".6" fill="currentColor" opacity=".5"/><circle cx="10" cy="10" r=".6" fill="currentColor" opacity=".5"/>',

  // Service
  fuel:        '<path d="M3 13V4.5a1.5 1.5 0 011.5-1.5h4A1.5 1.5 0 0110 4.5V13H3z" fill="#fff" opacity=".85"/><rect x="4.5" y="5" width="4" height="2.5" rx=".3" fill="currentColor" opacity=".4"/><path d="M10 5.5l1.5-1.5 1 1v4a1 1 0 01-2 0V7" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  repair:      '<path d="M5 3L3 5l2 2 2-2-2-2z" fill="#fff" opacity=".85"/><path d="M5 5l6 6" stroke="#fff" stroke-width="1.5"/><path d="M9.5 9L13 12.5l-1 1L8.5 10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>',
  police:      '<path d="M8 2l5 3v4c0 3-2.5 5-5 5S3 12 3 9V5l5-3z" fill="#fff" opacity=".85"/><path d="M8 6v3M8 10.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".5"/>',
  post_office: '<rect x="2.5" y="4" width="11" height="8" rx="1" fill="#fff" opacity=".85"/><path d="M3 5l5 3.5L13 5" stroke="currentColor" stroke-width="1.2" fill="none" opacity=".4"/>',

  // Commercial
  store:       '<path d="M3 7v6h10V7" fill="#fff" opacity=".75"/><path d="M2 4h12l-1 3H3L2 4z" fill="#fff" opacity=".9"/><rect x="6.5" y="9" width="3" height="4" fill="currentColor" opacity=".3"/>',
  supermarket: '<circle cx="5.5" cy="13" r="1" fill="#fff"/><circle cx="11" cy="13" r="1" fill="#fff"/><path d="M2 3h2l1.5 7h7L14 5H5.5" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  convenience: '<path d="M4 4h8v9H4V4z" fill="#fff" opacity=".85"/><path d="M4 4l1-2h6l1 2" stroke="#fff" stroke-width="1" fill="none"/><path d="M4 7h8" stroke="currentColor" stroke-width=".8" opacity=".4"/><rect x="6.5" y="9" width="3" height="4" fill="currentColor" opacity=".3"/>',
  clothing:    '<path d="M5 3l-3 3 2 1 1-1v7h6V6l1 1 2-1-3-3H5z" fill="#fff" opacity=".85"/>',
  food_store:  '<path d="M3 5h10l-1 8H4L3 5z" fill="#fff" opacity=".85"/><path d="M6 5V3.5a2 2 0 014 0V5" stroke="#fff" stroke-width="1.3" fill="none"/>',

  // Tourism & Entertainment
  landmark:    '<path d="M8 2l1 4h3l-2.5 2 1 3.5L8 9.5 5.5 11.5l1-3.5L4 6h3l1-4z" fill="#fff" opacity=".9"/>',
  museum:      '<path d="M3 6l5-3 5 3H3z" fill="#fff" opacity=".9"/><rect x="3" y="6" width="10" height="1" fill="#fff" opacity=".7"/><path d="M5 7v4M8 7v4M11 7v4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><rect x="3" y="11" width="10" height="1.5" rx=".3" fill="#fff" opacity=".85"/>',
  cinema:      '<rect x="3" y="3" width="10" height="8" rx="1" fill="#fff" opacity=".85"/><path d="M6 6l5 2.5L6 11V6z" fill="currentColor" opacity=".4"/><path d="M3 12h10" stroke="#fff" stroke-width="1.2"/>',
  attraction:  '<path d="M8 2l1.5 4H14l-3.5 3 1.5 4.5L8 10.5 3.5 13.5 5 9 1.5 6H6L8 2z" fill="#fff" opacity=".85"/>',

  // Transport
  bus_stop:    '<rect x="4" y="3" width="8" height="9" rx="1.5" fill="#fff" opacity=".85"/><rect x="5.5" y="4.5" width="5" height="3" rx=".5" fill="currentColor" opacity=".35"/><circle cx="6" cy="10.5" r=".8" fill="currentColor" opacity=".5"/><circle cx="10" cy="10.5" r=".8" fill="currentColor" opacity=".5"/>',

  // Personal care
  salon:       '<circle cx="8" cy="5" r="3" fill="#fff" opacity=".85"/><path d="M5 8c0 3 1.5 5 3 5s3-2 3-5" fill="#fff" opacity=".7"/>',

  // Fallback
  generic:     '<circle cx="8" cy="8" r="4" fill="#fff" opacity=".85"/><circle cx="8" cy="8" r="1.5" fill="currentColor" opacity=".4"/>',

  // Eco Merchant (leaf icon)
  eco_merchant: '<path d="M8 2C5 2 3 5 3 8c0 2 1 3.5 2 4.5L8 14l3-1.5c1-1 2-2.5 2-4.5 0-3-2-6-5-6z" fill="#fff" opacity=".9"/><path d="M8 5v5M6 7c1 1 3 1 4 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none" opacity=".5"/>',
};

// ── Subcategory → icon key mapping ────────────────────────────────────
// Maps Geoapify subcategory paths to the right icon key

const SUBCATEGORY_MAP: Record<string, string> = {
  // catering
  'catering.restaurant': 'restaurant',
  'catering.fast_food':  'fast_food',
  'catering.cafe':       'cafe',
  'catering.coffee_shop':'cafe',
  'catering.bar':        'bar',
  'catering.pub':        'bar',
  'catering.food_court': 'restaurant',
  'catering.biergarten': 'bar',
  'catering.ice_cream':  'cafe',
  'catering.taproom':    'bar',

  // accommodation
  'accommodation.hotel':        'hotel',
  'accommodation.guest_house':  'hotel',
  'accommodation.hostel':       'hotel',
  'accommodation.motel':        'hotel',
  'accommodation.apartment':    'hotel',

  // commercial
  'commercial.supermarket':      'supermarket',
  'commercial.convenience':      'convenience',
  'commercial.shopping_mall':    'store',
  'commercial.department_store': 'store',
  'commercial.clothing':         'clothing',
  'commercial.food_and_drink':   'food_store',
  'commercial.marketplace':      'store',
  'commercial.chemist':          'pharmacy',
  'commercial.books':            'store',
  'commercial.electronics':      'store',
  'commercial.hardware':         'store',
  'commercial.furniture':        'store',
  'commercial.houseware':        'store',
  'commercial.beauty':           'salon',
  'commercial.gift_and_souvenir':'store',
  'commercial.bag':              'store',
  'commercial.toys':             'store',
  'commercial.pet':              'store',
  'commercial.outdoor_and_sport':'sport',

  // healthcare
  'healthcare.hospital':  'hospital',
  'healthcare.pharmacy':  'pharmacy',
  'healthcare.clinic':    'clinic',
  'healthcare.dentist':   'clinic',
  'healthcare.veterinary':'clinic',

  // education
  'education.school':     'school',
  'education.university': 'university',
  'education.college':    'university',
  'education.library':    'museum',
  'education.kindergarten':'school',

  // religion
  'religion.place_of_worship':       'worship',
  'religion.place_of_worship.islam': 'mosque',
  'religion.place_of_worship.christianity': 'church',
  'religion.place_of_worship.catholic':     'church',
  'religion.place_of_worship.protestant':   'church',
  'religion.place_of_worship.buddhism':     'worship',
  'religion.place_of_worship.hinduism':     'worship',

  // service
  'service.financial.atm':   'atm',
  'service.financial.bank':  'bank',
  'service.vehicle.fuel':    'fuel',
  'service.vehicle.repair':  'repair',
  'service.post_office':     'post_office',
  'service.police':          'police',

  // leisure
  'leisure.park':        'park',
  'leisure.playground':  'playground',
  'leisure.garden':      'park',
  'leisure.sport':       'sport',
  'leisure.fitness':     'sport',
  'leisure.swimming':    'sport',

  // tourism
  'tourism.sights':      'landmark',
  'tourism.attraction':  'attraction',
  'tourism.information': 'landmark',

  // entertainment
  'entertainment.museum':   'museum',
  'entertainment.cinema':   'cinema',
  'entertainment.culture':  'museum',
  'entertainment.zoo':      'park',
  'entertainment.theme_park':'attraction',
  'entertainment.aquarium': 'attraction',
  'entertainment.miniature_golf': 'sport',

  // transport
  'public_transport.bus':    'bus_stop',
  'public_transport.train':  'bus_stop',

  // national_park
  'national_park': 'park',

  // eco_merchant
  'eco_merchant':                    'eco_merchant',
  'eco_merchant.refill_station':     'eco_merchant',
  'eco_merchant.thrift_store':       'eco_merchant',
  'eco_merchant.vegan':              'eco_merchant',
  'eco_merchant.repair_shop':        'eco_merchant',
  'eco_merchant.eco_products':       'eco_merchant',
  'eco_merchant.café':               'eco_merchant',
  'eco_merchant.market':             'eco_merchant',
  'eco_merchant.books':              'eco_merchant',
  'eco_merchant.other':              'eco_merchant',
  'eco_merchant.general':            'eco_merchant',
};

// Root category → default icon
const ROOT_ICON_MAP: Record<string, string> = {
  catering:       'restaurant',
  accommodation:  'hotel',
  commercial:     'store',
  tourism:        'landmark',
  leisure:        'park',
  religion:       'worship',
  service:        'repair',
  entertainment:  'cinema',
  healthcare:     'hospital',
  education:      'school',
  office:         'generic',
  parking:        'generic',
  public_transport: 'bus_stop',
  production:     'generic',
  national_park:  'park',
  eco_merchant:   'eco_merchant',
};

// ── Priority tiers (min zoom to show) ─────────────────────────────────

const PRIORITY_MAP: Record<string, number> = {
  // Tier 1 — z14: essential services
  'healthcare.hospital': 14,
  'service.vehicle.fuel': 14,
  'accommodation.hotel': 14,
  'service.financial.atm': 14,
  'service.financial.bank': 14,
  'service.police': 14,

  // Tier 2 — z15: important
  'religion': 15,
  'education.university': 15,
  'entertainment.museum': 15,
  'leisure.park': 15,
  'commercial.supermarket': 15,
  'catering.restaurant': 15,
  'catering.cafe': 15,
  'healthcare.pharmacy': 15,
  'national_park': 15,
  'tourism.sights': 15,
  'tourism.attraction': 15,

  // Tier 3 — z16: standard
  'catering.fast_food': 16,
  'commercial.convenience': 16,
  'commercial.beauty': 16,
  'service.post_office': 16,
  'healthcare.clinic': 16,
  'leisure.sport': 16,
  'education.school': 16,
  'catering.bar': 16,
  'catering.coffee_shop': 16,
  'accommodation.guest_house': 16,
  'accommodation.hostel': 16,
  'leisure.playground': 16,
  'entertainment.cinema': 16,
};

// Root category default priority
const ROOT_PRIORITY: Record<string, number> = {
  healthcare: 14,
  accommodation: 15,
  religion: 15,
  leisure: 16,
  catering: 16,
  education: 16,
  tourism: 16,
  commercial: 17,
  entertainment: 17,
  service: 17,
  office: 18,
  parking: 18,
  public_transport: 17,
  production: 18,
  national_park: 15,
  eco_merchant: 15, // Green merchants visible from z15 (free tier default)
};

// ── Public API ────────────────────────────────────────────────────────

/**
 * Resolve icon key and color from a POI's full category paths.
 * Tries specific subcategory match first, then walks up to root.
 */
export function resolveIcon(types: string[]): { iconKey: string; color: string } {
  // Sort by specificity: longer paths first
  const sorted = [...types].sort((a, b) => b.length - a.length);

  for (const cat of sorted) {
    // Try exact match first
    if (SUBCATEGORY_MAP[cat]) {
      const root = cat.split('.')[0];
      return {
        iconKey: SUBCATEGORY_MAP[cat],
        color: ROOT_COLORS[root] || FALLBACK_COLOR,
      };
    }
    // Try trimming to parent paths
    const parts = cat.split('.');
    for (let i = parts.length - 1; i >= 2; i--) {
      const prefix = parts.slice(0, i).join('.');
      if (SUBCATEGORY_MAP[prefix]) {
        return {
          iconKey: SUBCATEGORY_MAP[prefix],
          color: ROOT_COLORS[parts[0]] || FALLBACK_COLOR,
        };
      }
    }
  }

  // Fallback to root category icon
  const root = sorted[0]?.split('.')[0] || '';
  return {
    iconKey: ROOT_ICON_MAP[root] || 'generic',
    color: ROOT_COLORS[root] || FALLBACK_COLOR,
  };
}

/**
 * Resolve the minimum zoom level at which a POI should appear.
 * Lower value = appears sooner = higher priority.
 */
export function resolvePriority(types: string[]): number {
  let best = 18; // default: only at max zoom

  for (const cat of types) {
    // Exact match
    if (PRIORITY_MAP[cat] !== undefined) {
      best = Math.min(best, PRIORITY_MAP[cat]);
      continue;
    }
    // Walk up hierarchy
    const parts = cat.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      if (PRIORITY_MAP[prefix] !== undefined) {
        best = Math.min(best, PRIORITY_MAP[prefix]);
        break;
      }
    }
    // Root fallback
    if (ROOT_PRIORITY[parts[0]] !== undefined) {
      best = Math.min(best, ROOT_PRIORITY[parts[0]]);
    }
  }

  return best;
}

// ── Cached DivIcon factory ────────────────────────────────────────────

const divIconCache = new Map<string, L.DivIcon>();

export function getCategoryDivIcon(iconKey: string, color: string, size: 'sm' | 'lg' = 'sm'): L.DivIcon {
  const cacheKey = `${iconKey}_${color}_${size}`;
  if (divIconCache.has(cacheKey)) return divIconCache.get(cacheKey)!;

  const px = size === 'lg' ? 36 : 28;
  const svgPx = size === 'lg' ? 18 : 14;
  const cls = size === 'lg' ? 'poi-icon-marker poi-icon-marker-lg' : 'poi-icon-marker';
  const svgInner = ICONS[iconKey] || ICONS['generic'];
  const html = `<div class="${cls}" style="--poi-color:${color}">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${svgPx}" height="${svgPx}">${svgInner}</svg>
  </div>`;

  const icon = L.divIcon({
    className: 'poi-icon-wrapper',
    html,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
  });
  divIconCache.set(cacheKey, icon);
  return icon;
}

// ── Cached cluster icon factory ───────────────────────────────────────

const clusterIconCache = new Map<string, L.DivIcon>();

export function getClusterDivIcon(count: number, color?: string): L.DivIcon {
  const cKey = `${count < 50 ? count : count < 100 ? 100 : count < 500 ? 500 : 999}_${color || ''}`;
  if (clusterIconCache.has(cKey)) return clusterIconCache.get(cKey)!;

  const size = count < 10 ? 30 : count < 50 ? 34 : count < 100 ? 38 : 42;
  const bgStyle = color
    ? `background:${color}; box-shadow: 0 2px 10px ${color}60, 0 0 0 1px rgba(0,0,0,0.08);`
    : '';
  const icon = L.divIcon({
    className: 'poi-cluster-wrapper',
    html: `<div class="poi-cluster-icon" style="width:${size}px;height:${size}px;${bgStyle}">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  clusterIconCache.set(cKey, icon);
  return icon;
}

// ── Merchant tier-aware icon ──────────────────────────────────────────

const merchantIconCache = new Map<string, L.DivIcon>();

/**
 * Creates a merchant-specific marker icon with tier-based sizing and glow effect.
 * free=14px, basic=18px, premium=22px, featured=26px with animated pulse.
 */
export function getMerchantDivIcon(tier: string): L.DivIcon {
  if (merchantIconCache.has(tier)) return merchantIconCache.get(tier)!;

  const color = ROOT_COLORS['eco_merchant'];
  const svgInner = ICONS['eco_merchant'] || ICONS['generic'];

  let px: number, svgPx: number, extraCls: string, glowStyle: string;
  switch (tier) {
    case 'featured':
      px = 34; svgPx = 18;
      extraCls = 'poi-merchant-featured';
      glowStyle = `box-shadow: 0 0 12px ${color}80, 0 0 24px ${color}40;`;
      break;
    case 'premium':
      px = 30; svgPx = 16;
      extraCls = 'poi-merchant-premium';
      glowStyle = `box-shadow: 0 0 8px ${color}60;`;
      break;
    case 'basic':
      px = 26; svgPx = 14;
      extraCls = '';
      glowStyle = `box-shadow: 0 2px 6px ${color}40;`;
      break;
    default: // free
      px = 22; svgPx = 12;
      extraCls = '';
      glowStyle = '';
  }

  const html = `<div class="poi-icon-marker ${extraCls}" style="--poi-color:${color};${glowStyle}">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${svgPx}" height="${svgPx}">${svgInner}</svg>
  </div>`;

  const icon = L.divIcon({
    className: 'poi-icon-wrapper',
    html,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
  });
  merchantIconCache.set(tier, icon);
  return icon;
}

/**
 * Resolve the min-zoom for a merchant based on its priority boost.
 * Higher boost = visible at lower zoom = higher priority.
 */
export function merchantPriority(boost: number): number {
  switch (boost) {
    case 3: return 10; // featured — always visible
    case 2: return 13; // premium
    case 1: return 14; // basic
    default: return 15; // free
  }
}
