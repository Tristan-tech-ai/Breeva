-- gam_0001: Levels/XP, transport_mode, quest templates + per-user generated quest rows.
-- Light + idempotent: constant-default ADD COLUMNs (no table rewrite), one small
-- table, guarded constraint/index, trivial backfills. Applied 2026-05-31.

-- A1. users: lifetime XP + level + tier (xp is monotonic, != spendable ecopoints_balance)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS xp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'seed';

-- A2. walks: record transport mode (drives eco-mode quest; future server multiplier)
ALTER TABLE public.walks
  ADD COLUMN IF NOT EXISTS transport_mode text NOT NULL DEFAULT 'walking';

-- A3. quest_templates: adaptive recipe library
CREATE TABLE IF NOT EXISTS public.quest_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code text UNIQUE NOT NULL,
  title_template text NOT NULL,
  description_template text NOT NULL,
  icon text NOT NULL DEFAULT 'sparkles',
  quest_type text NOT NULL,
  event_type text NOT NULL,
  unit text NOT NULL DEFAULT 'count',        -- 'count' | 'meters'
  base_target integer NOT NULL,
  target_per_level numeric NOT NULL DEFAULT 0,
  target_min integer NOT NULL,
  target_max integer NOT NULL,
  base_reward integer NOT NULL,
  reward_per_level numeric NOT NULL DEFAULT 0,
  min_level integer NOT NULL DEFAULT 1,
  weight integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quest_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quest_templates_read ON public.quest_templates;
CREATE POLICY quest_templates_read ON public.quest_templates FOR SELECT USING (true);

-- A4. user_quests: self-describing generated rows + slot + replace-on-completion
ALTER TABLE public.user_quests
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.quest_templates(id),
  ADD COLUMN IF NOT EXISTS slot smallint,
  ADD COLUMN IF NOT EXISTS quest_type text,
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS target_value integer,
  ADD COLUMN IF NOT EXISTS reward_points integer,
  ADD COLUMN IF NOT EXISTS replaced_at timestamptz;

ALTER TABLE public.user_quests ALTER COLUMN quest_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_quest_source_chk') THEN
    ALTER TABLE public.user_quests
      ADD CONSTRAINT uq_quest_source_chk CHECK (quest_id IS NOT NULL OR template_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_quests_active_slot
  ON public.user_quests (user_id, quest_date, slot)
  WHERE template_id IS NOT NULL AND replaced_at IS NULL AND is_completed = false;
CREATE INDEX IF NOT EXISTS idx_user_quests_user_date_active
  ON public.user_quests (user_id, quest_date) WHERE replaced_at IS NULL;

-- A6. seed ~7 adaptive templates ({t} replaced at generation time)
INSERT INTO public.quest_templates
  (code, title_template, description_template, icon, quest_type, event_type, unit,
   base_target, target_per_level, target_min, target_max, base_reward, reward_per_level, min_level, weight)
VALUES
  ('distance_walk','Jalan kaki {t}','Tempuh {t} dengan berjalan kaki hari ini.','footprints','distance','walk_distance_m','meters',1000,250,500,6000,10,2,1,3),
  ('multi_walk','{t} sesi jalan','Selesaikan {t} sesi jalan kaki hari ini.','route','walks','walk_completed','count',1,0.15,1,4,12,2,2,2),
  ('clean_air_walk','Udara bersih','Jalan kaki {t}x saat AQI di bawah 50.','wind','clean_air','clean_air_walk','count',1,0,1,2,18,3,1,2),
  ('morning_walk','Jalan pagi','Jalan kaki sebelum jam 9 pagi.','sunrise','time','morning_walk','count',1,0,1,1,15,1,1,2),
  ('eco_mode_walk','Mode hijau','Tempuh {t} rute pakai jalan kaki atau sepeda.','leaf','eco_route','eco_mode_walk','count',1,0.1,1,3,14,2,1,2),
  ('aqi_report','Lapor udara','Kirim {t} laporan kualitas udara.','map-pin','report','aqi_report','count',1,0.1,1,3,15,2,1,2),
  ('streak_touch','Jaga streak','Jalan kaki hari ini untuk menjaga streak-mu.','flame','streak','walk_completed','count',1,0,1,1,8,1,1,1)
ON CONFLICT (code) DO NOTHING;

-- backfill XP from lifetime positive ledger (fallback to balance), then level/tier
UPDATE public.users u SET xp = COALESCE(
  (SELECT SUM(pt.amount)::int FROM public.points_transactions pt WHERE pt.user_id = u.id AND pt.amount > 0),
  GREATEST(u.ecopoints_balance, 0))
WHERE u.xp = 0;
UPDATE public.users SET level = GREATEST(1, floor(sqrt(xp / 50.0))::int + 1);
UPDATE public.users SET tier = CASE
  WHEN level >= 15 THEN 'forest' WHEN level >= 10 THEN 'tree'
  WHEN level >= 6 THEN 'sapling' WHEN level >= 3 THEN 'sprout' ELSE 'seed' END;
