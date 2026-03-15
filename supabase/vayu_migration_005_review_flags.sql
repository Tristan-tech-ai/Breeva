-- Review flags for moderation
CREATE TABLE IF NOT EXISTS review_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'inappropriate',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(review_id, user_id)
);

-- RLS
ALTER TABLE review_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can flag reviews" ON review_flags
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own flags" ON review_flags
  FOR SELECT USING (auth.uid() = user_id);
