// Breeva Type Definitions

// User Types
export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  eco_points: number;
  total_distance_walked: number;
  total_co2_saved: number;
  created_at: string;
  updated_at: string;
}

// Transport Modes
export type TransportMode = 'walking' | 'cycling' | 'ebike' | 'motorcycle' | 'car';

export interface TransportModeInfo {
  id: TransportMode;
  label: string;
  icon: string;
  orsProfile: string;              // ORS routing profile
  co2PerKm: number;                // grams CO2 per km
  ecoPointsMultiplier: number;     // multiplier for EcoPoints
  speedFactor: number;             // relative speed compared to walking
  color: string;
}

// Route Types
export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RoutePoint extends Coordinate {
  aqi?: number;
  timestamp?: string;
}

export interface RouteInstruction {
  text: string;
  distance: number; // meters
  duration: number; // seconds
  type: number; // ORS instruction type code
  waypoint_index: number;
}

export interface Route {
  id: string;
  user_id: string;
  start_point: Coordinate;
  end_point: Coordinate;
  waypoints: RoutePoint[];
  instructions: RouteInstruction[];
  distance_meters: number;
  duration_seconds: number;
  avg_aqi: number;
  eco_points_earned: number;
  route_type: 'eco' | 'fast' | 'balanced';
  created_at: string;

  // Route environment analysis (populated during smart route calculation)
  traffic_level?: 'low' | 'moderate' | 'high' | 'very-high';
  green_score?: number;        // 0-100: how green/pedestrian-friendly the route is
  aqi_confidence?: number;     // 0-100: confidence in estimated AQI
  road_summary?: string;       // e.g. "Through parks and green areas"
  aqi_factors?: string[];      // e.g. ["Near major roads (+20%)", "Park area (-15%)"]
}

// Air Quality Types
export type AQILevel = 'good' | 'moderate' | 'unhealthy-sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';

export interface AirQualityData {
  aqi: number;
  level: AQILevel;
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  co: number;
  so2: number;
  timestamp: string;
  location: Coordinate;
}

// EcoPoints Types
export interface EcoPointsTransaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'earned' | 'redeemed';
  source: 'walk' | 'achievement' | 'referral' | 'redemption';
  description: string;
  created_at: string;
}

// Merchant Types
export interface Merchant {
  id: string;
  name: string;
  description: string;
  logo_url: string;
  category: string;
  location: Coordinate;
  address: string;
  is_active: boolean;
}

export interface Reward {
  id: string;
  merchant_id: string;
  merchant?: Merchant;
  title: string;
  description: string;
  points_required: number;
  discount_percentage?: number;
  discount_amount?: number;
  valid_until: string;
  terms_conditions: string;
  stock: number;
  is_active: boolean;
}

// Walk Tracking Types
export interface WalkSession {
  id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  route_points: RoutePoint[];
  distance_meters: number;
  duration_seconds: number;
  avg_speed_mps: number;
  eco_points_earned: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
}

// Achievement Types
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  points_reward: number;
  requirement_type: 'distance' | 'walks' | 'streak' | 'points' | 'special';
  requirement_value: number;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  achievement?: Achievement;
  unlocked_at: string;
}

// API Response Types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

// Saved Places
export interface SavedPlace {
  id: string;
  name: string;
  address?: string;
  coordinate: Coordinate;
  category: 'home' | 'work' | 'favorite' | 'custom';
  icon?: string;
  createdAt: string;
}

// Place Report
export interface PlaceReport {
  id: string;
  name: string;
  category: string;
  coordinate: Coordinate;
  description?: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
