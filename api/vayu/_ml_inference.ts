/**
 * Lightweight XGBoost-residual inference for Vercel functions.
 *
 * Loads model JSON from ml_model_registry.artifact_url (Supabase Storage)
 * and applies hand-rolled tree traversal. Cached in function-instance memory
 * after first call (model JSON is small, <2 MB).
 *
 * Falls back to identity (no correction) if no active model registered.
 */

interface XGBNode {
  // Internal node
  nodeid?: number;
  split?: string;        // feature name (newer xgboost) OR
  split_index?: number;  // feature index (older)
  split_condition?: number;
  yes?: XGBNode;
  no?: XGBNode;
  // Leaf
  leaf?: number;
}

interface XGBoostModel {
  trees: XGBNode[];
  feature_names: string[];
  base_score: number;
}

const modelCache = new Map<string, { m: XGBoostModel | null; at: number }>();
const MODEL_TTL_MS = 30 * 60 * 1000;

async function fetchActiveModelMeta(region: string): Promise<{ url: string; version: string } | null> {
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return null;

  const tryUrl = async (regionFilter: string) => {
    const r = await fetch(
      `${supaUrl}/rest/v1/ml_model_registry?model_name=eq.caline3_residual&active=eq.true&${regionFilter}&select=artifact_url,version&limit=1`,
      { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
    );
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ artifact_url: string; version: string }>;
    return rows[0] ?? null;
  };

  // 1) Region-specific
  const regSpecific = await tryUrl(`region=eq.${encodeURIComponent(region)}`);
  if (regSpecific?.artifact_url) return { url: regSpecific.artifact_url, version: regSpecific.version };

  // 2) Global (region IS NULL)
  const global = await tryUrl('region=is.null');
  if (global?.artifact_url) return { url: global.artifact_url, version: global.version };

  return null;
}

async function loadModel(region: string): Promise<XGBoostModel | null> {
  const cached = modelCache.get(region);
  if (cached && Date.now() - cached.at < MODEL_TTL_MS) return cached.m;

  const meta = await fetchActiveModelMeta(region);
  if (!meta) {
    modelCache.set(region, { m: null, at: Date.now() });
    return null;
  }

  try {
    const r = await fetch(meta.url, { headers: { 'cache-control': 'no-store' } });
    if (!r.ok) {
      modelCache.set(region, { m: null, at: Date.now() });
      return null;
    }
    const raw = await r.json();
    // XGBoost native JSON: { learner: { gradient_booster: { model: { trees: [...] } } } } OR
    // simplified shape with top-level trees[]. Try both.
    const m = normalizeXgboostJson(raw);
    modelCache.set(region, { m, at: Date.now() });
    return m;
  } catch {
    modelCache.set(region, { m: null, at: Date.now() });
    return null;
  }
}

function normalizeXgboostJson(raw: any): XGBoostModel | null {
  // Heuristic: if top-level has `trees`, accept.
  if (Array.isArray(raw?.trees) && Array.isArray(raw?.feature_names)) {
    return {
      trees: raw.trees as XGBNode[],
      feature_names: raw.feature_names as string[],
      base_score: typeof raw.base_score === 'number' ? raw.base_score : 0.0,
    };
  }
  // XGBoost dump format (`booster.save_model("model.json")` in xgboost>=1.6):
  //   raw.learner.gradient_booster.model.trees[]
  const trees = raw?.learner?.gradient_booster?.model?.trees;
  const fnames = raw?.learner?.feature_names ?? [];
  if (Array.isArray(trees) && trees.length > 0) {
    return {
      trees: trees as XGBNode[],
      feature_names: fnames as string[],
      base_score: Number(raw?.learner?.learner_model_param?.base_score ?? 0.0),
    };
  }
  return null;
}

function traverseTree(node: XGBNode, features: Record<string, number>, fnames: string[]): number {
  while (true) {
    if (node.leaf !== undefined) return node.leaf;
    const fkey = node.split ?? fnames[node.split_index ?? 0];
    const value = features[fkey] ?? 0;
    const threshold = node.split_condition ?? 0;
    if (value < threshold) {
      if (!node.yes) return 0;
      node = node.yes;
    } else {
      if (!node.no) return 0;
      node = node.no;
    }
  }
}

export async function applyResidualCorrection(
  region: string,
  rawPrediction: number,
  features: Record<string, number>,
): Promise<{ corrected: number; residual: number; model_version: string | null }> {
  const model = await loadModel(region);
  if (!model) return { corrected: rawPrediction, residual: 0, model_version: null };

  const fullFeatures = { ...features, predicted_pm25: rawPrediction };
  let residual = model.base_score;
  for (const tree of model.trees) {
    residual += traverseTree(tree, fullFeatures, model.feature_names);
  }
  const corrected = Math.max(0, rawPrediction + residual);
  return { corrected, residual, model_version: 'active' };
}

/**
 * Fire-and-forget log of a prediction sample. 10% sampling by default
 * (modify rate via PREDICTION_LOG_SAMPLE env var, 0..1 float).
 */
export async function logPrediction(p: {
  osm_way_id: number;
  cell_id?: string;
  region: string;
  predicted_pm25: number;
  corrected_pm25: number | null;
  features: Record<string, number>;
}): Promise<void> {
  const sampleRate = Number(process.env.PREDICTION_LOG_SAMPLE ?? '0.1');
  if (sampleRate <= 0) return;
  if (Math.random() > sampleRate) return;
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return;
  try {
    await fetch(`${supaUrl}/rest/v1/prediction_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(p),
    });
  } catch {
    // non-fatal
  }
}
