-- ============================================
-- BREEVA DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(100),
  avatar_url TEXT,
  ecopoints_balance INTEGER DEFAULT 0,
  total_distance_km DECIMAL(10,2) DEFAULT 0,
  total_walks INTEGER DEFAULT 0,
  total_co2_saved_grams INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_walk_date DATE,
  subscription_tier VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. WALKS/ROUTES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS walks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  origin_address TEXT,
  origin_lat DECIMAL(10,7) NOT NULL,
  origin_lng DECIMAL(10,7) NOT NULL,
  destination_address TEXT,
  destination_lat DECIMAL(10,7) NOT NULL,
  destination_lng DECIMAL(10,7) NOT NULL,
  route_polyline TEXT,
  distance_meters INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  ecopoints_earned INTEGER DEFAULT 0,
  co2_saved_grams INTEGER DEFAULT 0,
  avg_aqi INTEGER,
  route_type VARCHAR(20) DEFAULT 'eco',
  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  is_verified BOOLEAN DEFAULT false,
  verification_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. MERCHANTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  address TEXT,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  phone VARCHAR(20),
  website TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. REWARDS/VOUCHERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  terms_conditions TEXT,
  discount_percentage INTEGER,
  discount_amount INTEGER,
  points_required INTEGER NOT NULL,
  total_stock INTEGER,
  remaining_stock INTEGER,
  valid_from DATE DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. REDEEMED REWARDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS redeemed_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  reward_id UUID REFERENCES rewards(id) ON DELETE CASCADE NOT NULL,
  merchant_id UUID REFERENCES merchants(id) NOT NULL,
  points_spent INTEGER NOT NULL,
  qr_code VARCHAR(100) UNIQUE NOT NULL,
  backup_code VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. AIR QUALITY REPORTS (Crowdsourced)
-- ============================================
CREATE TABLE IF NOT EXISTS air_quality_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  aqi_rating INTEGER CHECK (aqi_rating >= 1 AND aqi_rating <= 5),
  description TEXT,
  photo_url TEXT,
  confidence_score DECIMAL(3,2) DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 7. QUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  quest_type VARCHAR(50) NOT NULL,
  target_value INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  is_daily BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 8. USER QUESTS PROGRESS
-- ============================================
CREATE TABLE IF NOT EXISTS user_quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  quest_id UUID REFERENCES quests(id) ON DELETE CASCADE NOT NULL,
  current_value INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  quest_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, quest_id, quest_date)
);

-- ============================================
-- 9. ACHIEVEMENTS/BADGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  category VARCHAR(50),
  requirement_type VARCHAR(50) NOT NULL,
  requirement_value INTEGER NOT NULL,
  points_reward INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 10. USER ACHIEVEMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS user_achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  achievement_id UUID REFERENCES achievements(id) ON DELETE CASCADE NOT NULL,
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- ============================================
-- 11. ECOPOINTS TRANSACTIONS LOG
-- ============================================
CREATE TABLE IF NOT EXISTS points_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 12. LEADERBOARD (Materialized View or Table)
-- ============================================
CREATE TABLE IF NOT EXISTS leaderboard_weekly (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  week_start DATE NOT NULL,
  total_distance_meters INTEGER DEFAULT 0,
  total_walks INTEGER DEFAULT 0,
  total_points_earned INTEGER DEFAULT 0,
  rank INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Walks indexes
CREATE INDEX IF NOT EXISTS idx_walks_user_id ON walks(user_id);
CREATE INDEX IF NOT EXISTS idx_walks_status ON walks(status);
CREATE INDEX IF NOT EXISTS idx_walks_created_at ON walks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_walks_user_status ON walks(user_id, status);

-- Merchants indexes
CREATE INDEX IF NOT EXISTS idx_merchants_category ON merchants(category);
CREATE INDEX IF NOT EXISTS idx_merchants_active ON merchants(is_active);
CREATE INDEX IF NOT EXISTS idx_merchants_location ON merchants(lat, lng);

-- Rewards indexes
CREATE INDEX IF NOT EXISTS idx_rewards_merchant ON rewards(merchant_id);
CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards(is_active, valid_until);

-- Redeemed rewards indexes
CREATE INDEX IF NOT EXISTS idx_redeemed_user ON redeemed_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_redeemed_status ON redeemed_rewards(status);

-- Air quality indexes
CREATE INDEX IF NOT EXISTS idx_air_reports_location ON air_quality_reports(lat, lng);
CREATE INDEX IF NOT EXISTS idx_air_reports_created ON air_quality_reports(created_at DESC);

-- User quests indexes
CREATE INDEX IF NOT EXISTS idx_user_quests_date ON user_quests(user_id, quest_date);

-- Points transactions indexes
CREATE INDEX IF NOT EXISTS idx_points_user_created ON points_transactions(user_id, created_at DESC);

-- Leaderboard indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_week ON leaderboard_weekly(week_start, rank);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all user-related tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE walks ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeemed_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE air_quality_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_weekly ENABLE ROW LEVEL SECURITY;

-- Public read access tables (no RLS needed for SELECT)
-- merchants, rewards, quests, achievements

-- ============================================
-- RLS POLICIES - USERS
-- ============================================
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================
-- RLS POLICIES - WALKS
-- ============================================
CREATE POLICY "Users can view own walks" ON walks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own walks" ON walks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own walks" ON walks
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES - REDEEMED REWARDS
-- ============================================
CREATE POLICY "Users can view own redeemed rewards" ON redeemed_rewards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can redeem rewards" ON redeemed_rewards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES - AIR QUALITY REPORTS
-- ============================================
CREATE POLICY "Anyone can view air quality reports" ON air_quality_reports
  FOR SELECT USING (true);

CREATE POLICY "Users can create air quality reports" ON air_quality_reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES - USER QUESTS
-- ============================================
CREATE POLICY "Users can view own quests" ON user_quests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own quests" ON user_quests
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "System can insert user quests" ON user_quests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES - USER ACHIEVEMENTS
-- ============================================
CREATE POLICY "Users can view own achievements" ON user_achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view all achievements for leaderboard" ON user_achievements
  FOR SELECT USING (true);

-- ============================================
-- RLS POLICIES - POINTS TRANSACTIONS
-- ============================================
CREATE POLICY "Users can view own transactions" ON points_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES - LEADERBOARD
-- ============================================
CREATE POLICY "Anyone can view leaderboard" ON leaderboard_weekly
  FOR SELECT USING (true);

-- ============================================
-- DATABASE FUNCTIONS
-- ============================================

-- Function: Add EcoPoints with transaction logging
CREATE OR REPLACE FUNCTION add_ecopoints(
  p_user_id UUID,
  p_amount INTEGER,
  p_type VARCHAR(50),
  p_description TEXT DEFAULT NULL,
  p_reference_type VARCHAR(50) DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  -- Update user balance
  UPDATE users 
  SET ecopoints_balance = ecopoints_balance + p_amount,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING ecopoints_balance INTO new_balance;
  
  -- Log transaction
  INSERT INTO points_transactions (user_id, amount, transaction_type, description, reference_type, reference_id)
  VALUES (p_user_id, p_amount, p_type, p_description, p_reference_type, p_reference_id);
  
  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Complete a walk and award points
CREATE OR REPLACE FUNCTION complete_walk(
  p_walk_id UUID,
  p_distance_meters INTEGER,
  p_duration_seconds INTEGER,
  p_avg_aqi INTEGER DEFAULT NULL
) RETURNS TABLE(ecopoints_earned INTEGER, co2_saved INTEGER) AS $$
DECLARE
  v_user_id UUID;
  v_points INTEGER;
  v_co2 INTEGER;
  v_distance_km DECIMAL(10,2);
BEGIN
  -- Get user_id from walk
  SELECT user_id INTO v_user_id FROM walks WHERE id = p_walk_id;
  
  -- Calculate points (10 points per km + AQI bonus)
  v_distance_km := p_distance_meters / 1000.0;
  v_points := FLOOR(v_distance_km * 10);
  
  -- AQI bonus
  IF p_avg_aqi IS NOT NULL AND p_avg_aqi <= 50 THEN
    v_points := v_points + FLOOR(v_points * 0.5);
  ELSIF p_avg_aqi IS NOT NULL AND p_avg_aqi <= 100 THEN
    v_points := v_points + FLOOR(v_points * 0.25);
  END IF;
  
  -- Calculate CO2 saved (120g per km vs driving)
  v_co2 := FLOOR(v_distance_km * 120);
  
  -- Update walk record
  UPDATE walks SET
    distance_meters = p_distance_meters,
    duration_seconds = p_duration_seconds,
    avg_aqi = p_avg_aqi,
    ecopoints_earned = v_points,
    co2_saved_grams = v_co2,
    status = 'completed',
    completed_at = NOW(),
    is_verified = true
  WHERE id = p_walk_id;
  
  -- Update user stats
  UPDATE users SET
    total_distance_km = total_distance_km + v_distance_km,
    total_walks = total_walks + 1,
    total_co2_saved_grams = total_co2_saved_grams + v_co2,
    last_walk_date = CURRENT_DATE,
    updated_at = NOW()
  WHERE id = v_user_id;
  
  -- Add ecopoints
  PERFORM add_ecopoints(v_user_id, v_points, 'walk', 'Points earned from walking', 'walk', p_walk_id);
  
  RETURN QUERY SELECT v_points, v_co2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get nearby merchants
CREATE OR REPLACE FUNCTION get_nearby_merchants(
  user_lat DECIMAL(10,7),
  user_lng DECIMAL(10,7),
  radius_km DECIMAL(5,2) DEFAULT 5.0
) RETURNS SETOF merchants AS $$
BEGIN
  RETURN QUERY
  SELECT m.*
  FROM merchants m
  WHERE m.is_active = true
    AND (
      6371 * acos(
        cos(radians(user_lat)) * cos(radians(m.lat)) *
        cos(radians(m.lng) - radians(user_lng)) +
        sin(radians(user_lat)) * sin(radians(m.lat))
      )
    ) <= radius_km
  ORDER BY (
    6371 * acos(
      cos(radians(user_lat)) * cos(radians(m.lat)) *
      cos(radians(m.lng) - radians(user_lng)) +
      sin(radians(user_lat)) * sin(radians(m.lat))
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Function: Redeem a reward
CREATE OR REPLACE FUNCTION redeem_reward(
  p_user_id UUID,
  p_reward_id UUID
) RETURNS TABLE(success BOOLEAN, message TEXT, qr_code VARCHAR(100)) AS $$
DECLARE
  v_merchant_id UUID;
  v_points_required INTEGER;
  v_user_balance INTEGER;
  v_remaining_stock INTEGER;
  v_qr VARCHAR(100);
  v_backup VARCHAR(10);
  v_valid_until DATE;
BEGIN
  -- Get reward details
  SELECT merchant_id, points_required, remaining_stock, valid_until
  INTO v_merchant_id, v_points_required, v_remaining_stock, v_valid_until
  FROM rewards WHERE id = p_reward_id AND is_active = true;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Reward not found or inactive'::TEXT, NULL::VARCHAR(100);
    RETURN;
  END IF;
  
  -- Check if still valid
  IF v_valid_until < CURRENT_DATE THEN
    RETURN QUERY SELECT false, 'Reward has expired'::TEXT, NULL::VARCHAR(100);
    RETURN;
  END IF;
  
  -- Check stock
  IF v_remaining_stock IS NOT NULL AND v_remaining_stock <= 0 THEN
    RETURN QUERY SELECT false, 'Reward out of stock'::TEXT, NULL::VARCHAR(100);
    RETURN;
  END IF;
  
  -- Check user balance
  SELECT ecopoints_balance INTO v_user_balance FROM users WHERE id = p_user_id;
  
  IF v_user_balance < v_points_required THEN
    RETURN QUERY SELECT false, 'Insufficient EcoPoints'::TEXT, NULL::VARCHAR(100);
    RETURN;
  END IF;
  
  -- Generate QR code and backup code
  v_qr := 'BRV-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 16));
  v_backup := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
  
  -- Create redeemed reward record
  INSERT INTO redeemed_rewards (user_id, reward_id, merchant_id, points_spent, qr_code, backup_code, expires_at)
  VALUES (p_user_id, p_reward_id, v_merchant_id, v_points_required, v_qr, v_backup, v_valid_until + INTERVAL '7 days');
  
  -- Deduct points
  PERFORM add_ecopoints(p_user_id, -v_points_required, 'redemption', 'Reward redeemed', 'reward', p_reward_id);
  
  -- Update stock
  IF v_remaining_stock IS NOT NULL THEN
    UPDATE rewards SET remaining_stock = remaining_stock - 1 WHERE id = p_reward_id;
  END IF;
  
  RETURN QUERY SELECT true, 'Reward redeemed successfully'::TEXT, v_qr;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update user streak
CREATE OR REPLACE FUNCTION update_user_streak(p_user_id UUID) RETURNS INTEGER AS $$
DECLARE
  v_last_walk DATE;
  v_current_streak INTEGER;
  v_longest_streak INTEGER;
BEGIN
  SELECT last_walk_date, current_streak, longest_streak
  INTO v_last_walk, v_current_streak, v_longest_streak
  FROM users WHERE id = p_user_id;
  
  IF v_last_walk IS NULL OR v_last_walk < CURRENT_DATE - INTERVAL '1 day' THEN
    -- Reset streak
    v_current_streak := 1;
  ELSIF v_last_walk = CURRENT_DATE - INTERVAL '1 day' THEN
    -- Continue streak
    v_current_streak := v_current_streak + 1;
  END IF;
  -- If walked today already, don't change streak
  
  -- Update longest streak if needed
  IF v_current_streak > v_longest_streak THEN
    v_longest_streak := v_current_streak;
  END IF;
  
  UPDATE users SET
    current_streak = v_current_streak,
    longest_streak = v_longest_streak
  WHERE id = p_user_id;
  
  RETURN v_current_streak;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- TRIGGER: Auto-create user profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- SEED DATA: Default Quests
-- ============================================
INSERT INTO quests (title, description, icon, quest_type, target_value, reward_points, is_daily) VALUES
('First Steps', 'Walk at least 500 meters today', 'footprints', 'distance', 500, 5, true),
('Morning Walker', 'Complete a walk before 9 AM', 'sunrise', 'time', 9, 10, true),
('Kilometer Champion', 'Walk at least 2 km today', 'trophy', 'distance', 2000, 20, true),
('Air Quality Reporter', 'Report air quality in your area', 'wind', 'report', 1, 15, true),
('Streak Keeper', 'Maintain a 3-day walking streak', 'fire', 'streak', 3, 30, false),
('Weekend Warrior', 'Walk on both Saturday and Sunday', 'calendar', 'weekend', 2, 25, false)
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED DATA: Default Achievements
-- ============================================
INSERT INTO achievements (name, description, icon, category, requirement_type, requirement_value, points_reward) VALUES
('First Walk', 'Complete your first walk', 'baby', 'milestone', 'walks', 1, 50),
('5K Club', 'Walk a total of 5 kilometers', 'medal', 'distance', 'total_distance', 5000, 100),
('10K Master', 'Walk a total of 10 kilometers', 'award', 'distance', 'total_distance', 10000, 200),
('Marathon Hero', 'Walk a total of 42.195 kilometers', 'crown', 'distance', 'total_distance', 42195, 500),
('Week Warrior', 'Maintain a 7-day streak', 'fire', 'streak', 'streak', 7, 150),
('Month Master', 'Maintain a 30-day streak', 'star', 'streak', 'streak', 30, 500),
('Eco Champion', 'Save 1kg of CO2 by walking', 'leaf', 'eco', 'co2_saved', 1000, 100),
('Carbon Crusher', 'Save 10kg of CO2 by walking', 'tree', 'eco', 'co2_saved', 10000, 300),
('Point Collector', 'Earn 500 EcoPoints', 'coins', 'points', 'total_points', 500, 75),
('Point Master', 'Earn 2000 EcoPoints', 'gem', 'points', 'total_points', 2000, 200)
ON CONFLICT DO NOTHING;

-- ============================================
-- DONE!
-- ============================================
