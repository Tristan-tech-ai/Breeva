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
export type AQIFreshness = 'live' | 'recent' | 'stale' | 'fallback';

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
  // VAYU Engine fields
  confidence?: number;        // 0.0-1.0
  freshness?: AQIFreshness;
  layer_source?: number;      // 0=cache, 1=computed, 2=crowdsource, 3=sensor, 4=ML
  tile_id?: string;           // H3 hex id
}

// VAYU Exposure result
export interface ExposureResult {
  total_dose_ug: number;
  cigarette_equivalent: number;
  health_risk_level: 'low' | 'moderate' | 'high' | 'very_high';
  avg_pm25: number;
  vehicle_type: string;
  vehicle_label: string;
  duration_minutes: number;
  sample_count: number;
}

// VAYU Route Score result
export interface RouteScoreResult {
  avg_aqi: number;
  max_aqi: number;
  min_aqi: number;
  combined_score: number;
  sample_count: number;
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

// VAYU Road-level pollution types
export type PollutantType = 'aqi' | 'pm25' | 'no2' | 'o3' | 'pm10';

export interface RoadAQIFeature {
  osm_way_id: number;
  geometry: { type: string; coordinates: number[][] };
  aqi: number;
  pm25: number;
  no2: number;
  o3: number;
  pm10: number;
  highway: string;
  weight: number;
}

export interface RoadAQIResponse {
  roads: RoadAQIFeature[];
  meta: {
    count: number;
    zoom: number;
    forecast_hour: number;
    baseline_pm25: number;
    baseline_no2: number;
    baseline_o3: number;
    baseline_pm10: number;
    wind_speed: number;
    waqi_station: string | null;
    waqi_bias_pm25: number;
    waqi_bias_no2: number;
    satellite_no2: boolean;
    iqair_aqi: number | null;
    iqair_city: string | null;
    iqair_validation: 'cross-validated' | 'partially-validated' | 'divergent' | null;
    iqair_confidence_adj: number | null;
    computed_at: string;
  };
}
