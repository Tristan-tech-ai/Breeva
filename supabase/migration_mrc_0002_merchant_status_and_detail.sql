-- mrc_0002: Honest verification lifecycle + richer merchant profile.
-- Adds a `status` (pending/approved/rejected) moderation lifecycle alongside the existing
-- `is_verified` trust badge, plus detail columns. Existing (demo/seed) rows are backfilled
-- to 'approved' BEFORE the public-read policy is tightened, so the map never empties.

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS document_url  text,
  ADD COLUMN IF NOT EXISTS opening_hours jsonb,
  ADD COLUMN IF NOT EXISTS instagram     text,
  ADD COLUMN IF NOT EXISTS whatsapp      text,
  ADD COLUMN IF NOT EXISTS gallery_urls  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS ai_notes      text,
  ADD COLUMN IF NOT EXISTS validated_at  timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchants_status_chk') THEN
    ALTER TABLE public.merchants
      ADD CONSTRAINT merchants_status_chk CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_merchants_status ON public.merchants(status);

-- Backfill ALL existing rows to approved BEFORE tightening the read policy.
UPDATE public.merchants
   SET status = 'approved', validated_at = COALESCE(validated_at, created_at)
 WHERE status <> 'approved';

-- Public visibility: only approved + active merchants are shown publicly; an owner always
-- sees their own (any status). get_nearby_merchants() is not SECURITY DEFINER → inherits this.
DROP POLICY IF EXISTS "Anyone can view active merchants" ON public.merchants;
CREATE POLICY "Anyone can view active merchants" ON public.merchants
  FOR SELECT USING ((is_active = true AND status = 'approved') OR auth.uid() = owner_id);
