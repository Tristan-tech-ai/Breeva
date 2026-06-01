-- mrc_0005: Storage buckets. Only `ml-models` existed → ContributePage photo upload
-- (already shipped) AND merchant doc/logo upload were silently failing.
--   merchant-assets : public  (logos, covers, gallery)
--   contributions   : public  (contribution photos — fixes the live bug)
--   merchant-docs   : private (KYC docs: KTP/SIUP) — owner-only read
-- Path convention: "<auth.uid()>/<file>"  → (storage.foldername(name))[1] = uid.

INSERT INTO storage.buckets (id, name, public) VALUES
  ('merchant-assets', 'merchant-assets', true),
  ('contributions',   'contributions',   true),
  ('merchant-docs',   'merchant-docs',   false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "breeva public bucket read" ON storage.objects;
CREATE POLICY "breeva public bucket read" ON storage.objects
  FOR SELECT USING (bucket_id IN ('merchant-assets', 'contributions'));

DROP POLICY IF EXISTS "breeva owner foldered insert" ON storage.objects;
CREATE POLICY "breeva owner foldered insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id IN ('merchant-assets', 'contributions', 'merchant-docs')
    AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "breeva owner foldered update" ON storage.objects;
CREATE POLICY "breeva owner foldered update" ON storage.objects
  FOR UPDATE USING (
    bucket_id IN ('merchant-assets', 'contributions', 'merchant-docs')
    AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "breeva merchant-docs owner read" ON storage.objects;
CREATE POLICY "breeva merchant-docs owner read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'merchant-docs' AND (storage.foldername(name))[1] = auth.uid()::text);
