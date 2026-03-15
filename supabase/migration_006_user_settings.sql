-- ============================================
-- USER SETTINGS TABLE
-- Persist user preferences to cloud
-- ============================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE PRIMARY KEY,
  dark_mode BOOLEAN DEFAULT false,
  push_notifications BOOLEAN DEFAULT true,
  location_tracking BOOLEAN DEFAULT true,
  quest_reminders BOOLEAN DEFAULT true,
  anonymous_data BOOLEAN DEFAULT true,
  profile_visible BOOLEAN DEFAULT true,
  distance_unit VARCHAR(10) DEFAULT 'km',
  language VARCHAR(5) DEFAULT 'en',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);
