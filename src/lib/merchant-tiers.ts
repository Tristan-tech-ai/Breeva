import { Leaf, Zap, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Shared sponsor-tier config — single source for dashboard, detail, and list pages.
export interface SponsorTier {
  key: string;
  label: string;
  cost: number;
  boost: number;
  icon: LucideIcon;
  color: string;
  badge: string;
  desc: string;
}

export const SPONSOR_TIERS: SponsorTier[] = [
  { key: 'free',     label: 'Free',     cost: 0,    boost: 0, icon: Leaf,     color: 'text-gray-400',    badge: '',         desc: 'Basic listing' },
  { key: 'basic',    label: 'Basic',    cost: 500,  boost: 1, icon: Leaf,     color: 'text-emerald-500', badge: '🌱',       desc: 'Visible at z14, filter highlight' },
  { key: 'premium',  label: 'Premium',  cost: 1500, boost: 2, icon: Zap,      color: 'text-amber-500',   badge: '🌿🌿',     desc: 'Prominent marker, top of list' },
  { key: 'featured', label: 'Featured', cost: 3000, boost: 3, icon: Sparkles, color: 'text-purple-500',  badge: '🌳🌳🌳',   desc: 'Always visible, homepage spotlight' },
];

export function tierFor(key: string | null | undefined): SponsorTier {
  return SPONSOR_TIERS.find((t) => t.key === key) || SPONSOR_TIERS[0];
}
