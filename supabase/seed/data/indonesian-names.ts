export interface NameEntry {
  first: string;
  last: string;
  city: 'jakarta' | 'bali' | 'bandung' | 'surabaya';
  tier: 'power' | 'active' | 'casual' | 'new' | 'dormant';
}

export const INDONESIAN_NAMES: NameEntry[] = [
  // Power Users (3)
  { first: 'Ahmad', last: 'Pratama', city: 'jakarta', tier: 'power' },
  { first: 'Siti', last: 'Nurhaliza', city: 'bali', tier: 'power' },
  { first: 'Budi', last: 'Santoso', city: 'bandung', tier: 'power' },
  // Active Walkers (7)
  { first: 'Dewi', last: 'Lestari', city: 'jakarta', tier: 'active' },
  { first: 'Reza', last: 'Rahadian', city: 'jakarta', tier: 'active' },
  { first: 'Putri', last: 'Ayu', city: 'bali', tier: 'active' },
  { first: 'Fajar', last: 'Nugroho', city: 'surabaya', tier: 'active' },
  { first: 'Rina', last: 'Wulandari', city: 'bandung', tier: 'active' },
  { first: 'Andi', last: 'Wijaya', city: 'jakarta', tier: 'active' },
  { first: 'Maya', last: 'Sari', city: 'bali', tier: 'active' },
  // Casual Users (5)
  { first: 'Dimas', last: 'Putra', city: 'jakarta', tier: 'casual' },
  { first: 'Ayu', last: 'Kartika', city: 'bandung', tier: 'casual' },
  { first: 'Rizky', last: 'Firmansyah', city: 'surabaya', tier: 'casual' },
  { first: 'Nadia', last: 'Kusuma', city: 'bali', tier: 'casual' },
  { first: 'Hendra', last: 'Gunawan', city: 'jakarta', tier: 'casual' },
  // New Users (3)
  { first: 'Tara', last: 'Basro', city: 'jakarta', tier: 'new' },
  { first: 'Gilang', last: 'Dirga', city: 'bandung', tier: 'new' },
  { first: 'Lala', last: 'Karmela', city: 'bali', tier: 'new' },
  // Dormant Users (2)
  { first: 'Bayu', last: 'Aditya', city: 'surabaya', tier: 'dormant' },
  { first: 'Raisa', last: 'Andriana', city: 'jakarta', tier: 'dormant' },
];
