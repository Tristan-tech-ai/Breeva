-- ============================================
-- Migration 008: Merchant Ownership & Sponsorship
-- ============================================
-- Adds owner tracking, sponsorship tiers, and map visibility boost

-- 1. Owner link
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_merchants_owner ON merchants(owner_id);

-- 2. Sponsorship columns
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS sponsor_tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS sponsor_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS priority_boost INTEGER DEFAULT 0;

-- 3. Eco certification (optional metadata)
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_eco_certified BOOLEAN DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS eco_badge TEXT;

-- 4. Update get_nearby_merchants to include new columns + ordering by priority
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
  ORDER BY
    m.priority_boost DESC,
    (
      6371 * acos(
        cos(radians(user_lat)) * cos(radians(m.lat)) *
        cos(radians(m.lng) - radians(user_lng)) +
        sin(radians(user_lat)) * sin(radians(m.lat))
      )
    );
END;
$$ LANGUAGE plpgsql;

-- 5. RPC: Upgrade merchant sponsor tier (deducting EcoPoints)
CREATE OR REPLACE FUNCTION upgrade_merchant_sponsor(
  p_merchant_id UUID,
  p_user_id UUID,
  p_tier VARCHAR(20),
  p_cost INTEGER
) RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_current_points INTEGER;
  v_boost INTEGER;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND owner_id = p_user_id) THEN
    RETURN QUERY SELECT false, 'You do not own this merchant'::TEXT;
    RETURN;
  END IF;

  -- Check points
  SELECT eco_points INTO v_current_points FROM users WHERE id = p_user_id;
  IF v_current_points < p_cost THEN
    RETURN QUERY SELECT false, 'Insufficient EcoPoints'::TEXT;
    RETURN;
  END IF;

  -- Map tier to boost
  v_boost := CASE p_tier
    WHEN 'basic' THEN 1
    WHEN 'premium' THEN 2
    WHEN 'featured' THEN 3
    ELSE 0
  END;

  -- Update merchant
  UPDATE merchants SET
    sponsor_tier = p_tier,
    sponsor_expires_at = NOW() + INTERVAL '30 days',
    priority_boost = v_boost,
    updated_at = NOW()
  WHERE id = p_merchant_id;

  -- Deduct points
  UPDATE users SET eco_points = eco_points - p_cost WHERE id = p_user_id;

  -- Log transaction
  INSERT INTO eco_points_transactions (user_id, amount, type, source, description)
  VALUES (p_user_id, -p_cost, 'redeemed', 'redemption',
    'Sponsor upgrade to ' || p_tier || ' for merchant');

  RETURN QUERY SELECT true, ('Upgraded to ' || p_tier)::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
