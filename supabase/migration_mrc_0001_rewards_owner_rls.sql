-- mrc_0001: Owner write access to their merchant's rewards.
-- rewards had RLS enabled but ONLY a SELECT policy → owner create/edit/toggle from the
-- dashboard was silently DENIED. Add INSERT/UPDATE/DELETE keyed on the merchant owner.
-- redeem_reward() (SECURITY DEFINER) bypasses RLS and is unaffected.

DROP POLICY IF EXISTS "Merchant owner can insert rewards" ON public.rewards;
CREATE POLICY "Merchant owner can insert rewards" ON public.rewards
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Merchant owner can update rewards" ON public.rewards;
CREATE POLICY "Merchant owner can update rewards" ON public.rewards
  FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Merchant owner can delete rewards" ON public.rewards;
CREATE POLICY "Merchant owner can delete rewards" ON public.rewards
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = merchant_id AND m.owner_id = auth.uid()));
