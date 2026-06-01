-- mrc_0003: Finish the (already-existing) reviews system — owner replies + moderation flags.
-- The `reviews` table + trg_update_merchant_rating already exist (migration_007). This adds
-- owner_reply, an owner UPDATE policy, a column-guard trigger (RLS can't restrict columns),
-- and the review_flags table (vayu_migration_005 was authored but never applied live).

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS owner_reply    text,
  ADD COLUMN IF NOT EXISTS owner_reply_at timestamptz;

-- Merchant owner may UPDATE reviews on their own merchant (to reply). The guard trigger
-- below restricts non-authors to only owner_reply/owner_reply_at.
DROP POLICY IF EXISTS "Merchant owner can reply to reviews" ON public.reviews;
CREATE POLICY "Merchant owner can reply to reviews" ON public.reviews
  FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = reviews.merchant_id AND m.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = reviews.merchant_id AND m.owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.reviews_guard_owner_reply()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  -- A non-author (e.g. the merchant owner) may only set owner_reply; the author may edit content.
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF NEW.rating      IS DISTINCT FROM OLD.rating
    OR NEW.comment     IS DISTINCT FROM OLD.comment
    OR NEW.user_id     IS DISTINCT FROM OLD.user_id
    OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only the review author may change rating/comment';
    END IF;
  END IF;
  IF NEW.owner_reply IS DISTINCT FROM OLD.owner_reply THEN
    NEW.owner_reply_at := now();
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_reviews_guard_owner_reply ON public.reviews;
CREATE TRIGGER trg_reviews_guard_owner_reply
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_guard_owner_reply();

-- review_flags (authored in vayu_migration_005 but never applied to live)
CREATE TABLE IF NOT EXISTS public.review_flags (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  review_id  uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason     text NOT NULL DEFAULT 'inappropriate',
  created_at timestamptz DEFAULT now(),
  UNIQUE (review_id, user_id)
);
ALTER TABLE public.review_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can flag reviews" ON public.review_flags;
CREATE POLICY "Users can flag reviews" ON public.review_flags FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view own flags" ON public.review_flags;
CREATE POLICY "Users can view own flags" ON public.review_flags FOR SELECT USING (auth.uid() = user_id);
