export interface NameEntry {
  first: string;
  last: string;
  city: 'jakarta' | 'bali' | 'bandung' | 'surabaya';
  tier: 'power' | 'active' | 'casual' | 'new' | 'dormant';
  /** Role for demo-specific accounts */
  role?: 'demo' | 'merchant_owner' | 'user';
}

export const INDONESIAN_NAMES: NameEntry[] = [
  // ── Demo Accounts (special roles) ──────────────────────
  // Demo showcase account: fully loaded power user for presentations
  { first: 'Demo', last: 'Breeva', city: 'jakarta', tier: 'power', role: 'demo' },
  // Merchant owner account: owns eco-merchants, can manage them
  { first: 'Merchant', last: 'Owner', city: 'jakarta', tier: 'active', role: 'merchant_owner' },

  // ── Power Users (3) ───────────────────────────────────
  { first: 'Ahmad', last: 'Pratama', city: 'jakarta', tier: 'power' },
  { first: 'Siti', last: 'Nurhaliza', city: 'bali', tier: 'power' },
  { first: 'Budi', last: 'Santoso', city: 'bandung', tier: 'power' },
  // ── Active Walkers (7) ────────────────────────────────
  { first: 'Dewi', last: 'Lestari', city: 'jakarta', tier: 'active' },
  { first: 'Reza', last: 'Rahadian', city: 'jakarta', tier: 'active' },
  { first: 'Putri', last: 'Ayu', city: 'bali', tier: 'active' },
  { first: 'Fajar', last: 'Nugroho', city: 'surabaya', tier: 'active' },
  { first: 'Rina', last: 'Wulandari', city: 'bandung', tier: 'active' },
  { first: 'Andi', last: 'Wijaya', city: 'jakarta', tier: 'active' },
  { first: 'Maya', last: 'Sari', city: 'bali', tier: 'active' },
  // ── Casual Users (5) ─────────────────────────────────
  { first: 'Dimas', last: 'Putra', city: 'jakarta', tier: 'casual' },
  { first: 'Ayu', last: 'Kartika', city: 'bandung', tier: 'casual' },
  { first: 'Rizky', last: 'Firmansyah', city: 'surabaya', tier: 'casual' },
  { first: 'Nadia', last: 'Kusuma', city: 'bali', tier: 'casual' },
  { first: 'Hendra', last: 'Gunawan', city: 'jakarta', tier: 'casual' },
  // ── New Users (3) ────────────────────────────────────
  { first: 'Tara', last: 'Basro', city: 'jakarta', tier: 'new' },
  { first: 'Gilang', last: 'Dirga', city: 'bandung', tier: 'new' },
  { first: 'Lala', last: 'Karmela', city: 'bali', tier: 'new' },
  // ── Dormant Users (2) ────────────────────────────────
  { first: 'Bayu', last: 'Aditya', city: 'surabaya', tier: 'dormant' },
  { first: 'Raisa', last: 'Andriana', city: 'jakarta', tier: 'dormant' },
];

/** Well-known demo credentials */
export const DEMO_CREDENTIALS = {
  demo: { email: 'demo@breeva.app', password: 'BreevaDemo2026!' },
  merchant: { email: 'merchant@breeva.app', password: 'BreevaMerchant2026!' },
} as const;
