-- Migration: saved_places cloud sync
-- Enables Supabase storage for saved places (previously localStorage only)

CREATE TABLE IF NOT EXISTS saved_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  category VARCHAR(50) DEFAULT 'favorite',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_places_user ON saved_places(user_id);

ALTER TABLE saved_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved places" ON saved_places
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved places" ON saved_places
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved places" ON saved_places
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved places" ON saved_places
  FOR DELETE USING (auth.uid() = user_id);
