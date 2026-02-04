import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format distance in meters to human readable string
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Format duration in seconds to human readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Format number with thousand separators
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('id-ID').format(num);
}

/**
 * Calculate CO2 saved based on distance walked (vs driving)
 * Average car emits ~120g CO2 per km
 */
export function calculateCO2Saved(distanceMeters: number): number {
  const distanceKm = distanceMeters / 1000;
  const co2GramsPerKm = 120;
  return Math.round(distanceKm * co2GramsPerKm);
}

/**
 * Get AQI level label and color
 */
export function getAQIInfo(aqi: number): { level: string; color: string; bgColor: string } {
  if (aqi <= 50) {
    return { level: 'Good', color: 'text-green-600', bgColor: 'bg-aqi-good' };
  }
  if (aqi <= 100) {
    return { level: 'Moderate', color: 'text-yellow-600', bgColor: 'bg-aqi-moderate' };
  }
  if (aqi <= 150) {
    return { level: 'Unhealthy for Sensitive', color: 'text-orange-600', bgColor: 'bg-aqi-unhealthy-sensitive' };
  }
  if (aqi <= 200) {
    return { level: 'Unhealthy', color: 'text-red-600', bgColor: 'bg-aqi-unhealthy' };
  }
  if (aqi <= 300) {
    return { level: 'Very Unhealthy', color: 'text-purple-600', bgColor: 'bg-aqi-very-unhealthy' };
  }
  return { level: 'Hazardous', color: 'text-red-900', bgColor: 'bg-aqi-hazardous' };
}

/**
 * Calculate EcoPoints based on distance and AQI avoided
 * Formula: base points + AQI bonus
 */
export function calculateEcoPoints(distanceMeters: number, avgAQI: number): number {
  const distanceKm = distanceMeters / 1000;
  const basePoints = Math.floor(distanceKm * 10); // 10 points per km
  
  // Bonus for walking in cleaner air routes
  let aqiBonus = 0;
  if (avgAQI <= 50) {
    aqiBonus = Math.floor(basePoints * 0.5); // 50% bonus for good air
  } else if (avgAQI <= 100) {
    aqiBonus = Math.floor(basePoints * 0.25); // 25% bonus for moderate
  }
  
  return basePoints + aqiBonus;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
export function calculateHaversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Local storage helpers with JSON parsing
 */
export const storage = {
  get<T>(key: string, defaultValue: T): T {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },
  
  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      console.error('Failed to save to localStorage');
    }
  },
  
  remove(key: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  },
};
