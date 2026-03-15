/**
 * Breeva Data Factory & Seeder — Main Runner
 *
 * Usage:
 *   npx tsx supabase/seed/index.ts              # seed all tables
 *   npx tsx supabase/seed/index.ts --fresh       # truncate then seed
 *   npx tsx supabase/seed/index.ts --only=users  # seed specific table
 *
 * Requires env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { supabaseAdmin } from './utils/supabase-admin';
import { UserSeeder } from './seeders/UserSeeder';
import { MerchantSeeder } from './seeders/MerchantSeeder';
import { RewardSeeder } from './seeders/RewardSeeder';
import { WalkSeeder } from './seeders/WalkSeeder';
import { ReportSeeder } from './seeders/ReportSeeder';
import { RedemptionSeeder } from './seeders/RedemptionSeeder';
import { QuestProgressSeeder } from './seeders/QuestProgressSeeder';
import { AchievementSeeder } from './seeders/AchievementSeeder';

// ─── CLI Flags ───────────────────────────────────────────
const args = process.argv.slice(2);
const isFresh = args.includes('--fresh');
const onlyFlag = args.find((a) => a.startsWith('--only='));
const onlyTable = onlyFlag?.split('=')[1]?.toLowerCase();

const SEEDER_ORDER = [
  'users',
  'merchants',
  'rewards',
  'walks',
  'reports',
  'redemptions',
  'quests',
  'achievements',
] as const;

type SeederName = (typeof SEEDER_ORDER)[number];

function shouldRun(name: SeederName): boolean {
  if (!onlyTable) return true;
  return name === onlyTable;
}

// ─── Fresh Truncation ────────────────────────────────────
async function truncateAll() {
  console.log('\n🗑️  --fresh mode: truncating tables...');

  // Order matters for FK constraints — children first
  const tables = [
    'user_achievements',
    'user_quests',
    'points_transactions',
    'leaderboard_weekly',
    'redeemed_rewards',
    'air_quality_reports',
    'walks',
    'rewards',
    'merchants',
  ];

  for (const table of tables) {
    const { error } = await supabaseAdmin.rpc('truncate_table' as never, {
      table_name: table,
    } as never);
    if (error) {
      // Fallback: delete all rows
      const { error: delErr } = await supabaseAdmin.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delErr) {
        console.error(`   ✗ Could not clear ${table}: ${delErr.message}`);
      } else {
        console.log(`   ✓ Cleared ${table}`);
      }
    } else {
      console.log(`   ✓ Truncated ${table}`);
    }
  }

  // Delete auth users (which cascades to public.users via trigger)
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
  if (authUsers?.users) {
    for (const u of authUsers.users) {
      // Only delete seed users (identified by email pattern)
      if (u.email?.endsWith('@breeva.seed')) {
        await supabaseAdmin.auth.admin.deleteUser(u.id);
        console.log(`   ✓ Deleted auth user ${u.email}`);
      }
    }
  }
}

// ─── Main Runner ─────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🌱 Breeva Data Factory & Seeder    ║');
  console.log('╚══════════════════════════════════════╝');

  if (onlyTable) {
    console.log(`\n📌 Running only: ${onlyTable}`);
  }

  const summary: Record<string, number> = {};

  try {
    // ── Fresh mode ──
    if (isFresh) {
      await truncateAll();
    }

    // ── 1. Users ──
    let userMap = new Map<string, import('./factories/userFactory').UserSeedData>();
    if (shouldRun('users')) {
      console.log('\n👤 Seeding users...');
      const seeder = new UserSeeder(supabaseAdmin);
      const result = await seeder.run();
      summary['users'] = result.count;
      userMap = result.userMap;
    } else {
      // If we're not seeding users but need them for other seeders,
      // fetch existing users
      const { data: existingUsers } = await supabaseAdmin.from('users').select('id, email');
      if (existingUsers) {
        for (const u of existingUsers) {
          userMap.set(u.id, {
            email: u.email ?? '',
            password: '',
            full_name: '',
            avatar_url: '',
            ecopoints_balance: 0,
            total_ecopoints_earned: 0,
            total_distance_km: 0,
            total_walks: 0,
            total_co2_saved_grams: 0,
            current_streak: 0,
            longest_streak: 0,
            last_walk_date: null,
            subscription_tier: 'free',
            city: 'jakarta',
            tier: 'active',
          } satisfies import('./factories/userFactory').UserSeedData);
        }
      }
    }

    // ── 2. Merchants ──
    let merchantList: Array<{ id: string; category: string }> = [];
    if (shouldRun('merchants')) {
      console.log('\n🏪 Seeding merchants...');
      const seeder = new MerchantSeeder(supabaseAdmin);
      const result = await seeder.run();
      summary['merchants'] = result.count;
      merchantList = result.merchants;
    } else {
      const { data } = await supabaseAdmin.from('merchants').select('id, category');
      merchantList = data ?? [];
    }

    // ── 3. Rewards ──
    let rewardList: Array<{ id: string; merchant_id: string; points_cost: number }> = [];
    if (shouldRun('rewards')) {
      console.log('\n🎁 Seeding rewards...');
      const seeder = new RewardSeeder(supabaseAdmin);
      const result = await seeder.run(merchantList);
      summary['rewards'] = result.count;
      rewardList = result.rewards;
    } else {
      const { data } = await supabaseAdmin.from('rewards').select('id, merchant_id, points_cost');
      rewardList = data ?? [];
    }

    // ── 4. Walks ──
    if (shouldRun('walks')) {
      console.log('\n🚶 Seeding walks...');
      const seeder = new WalkSeeder(supabaseAdmin);
      const result = await seeder.run(userMap);
      summary['walks'] = result.count;
    }

    // ── 5. Reports ──
    if (shouldRun('reports')) {
      console.log('\n📊 Seeding air quality reports...');
      const seeder = new ReportSeeder(supabaseAdmin);
      const result = await seeder.run(userMap);
      summary['reports'] = result.count;
    }

    // ── 6. Redemptions ──
    if (shouldRun('redemptions')) {
      console.log('\n🎟️  Seeding redemptions...');
      const seeder = new RedemptionSeeder(supabaseAdmin);
      const result = await seeder.run(userMap, rewardList);
      summary['redemptions'] = result.count;
    }

    // ── 7. Quest progress ──
    if (shouldRun('quests')) {
      console.log('\n📋 Seeding quest progress...');
      const seeder = new QuestProgressSeeder(supabaseAdmin);
      const result = await seeder.run(userMap);
      summary['quest_progress'] = result.count;
    }

    // ── 8. Achievements ──
    if (shouldRun('achievements')) {
      console.log('\n🏆 Seeding achievements...');
      const seeder = new AchievementSeeder(supabaseAdmin);
      const result = await seeder.run(userMap);
      summary['achievements'] = result.count;
    }

    // ── Summary ──
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║          📊 Seed Summary             ║');
    console.log('╠══════════════════════════════════════╣');
    let grandTotal = 0;
    for (const [table, count] of Object.entries(summary)) {
      const label = table.padEnd(20);
      console.log(`║  ${label} ${String(count).padStart(6)} rows ║`);
      grandTotal += count;
    }
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  ${'TOTAL'.padEnd(20)} ${String(grandTotal).padStart(6)} rows ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('\n✅ Seeding complete!');
  } catch (err) {
    console.error('\n❌ Seeding failed:', err);
    process.exit(1);
  }
}

main();
