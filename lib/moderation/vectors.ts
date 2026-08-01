/**
 * Guardian vector memory — Cloudflare Vectorize.
 *
 * Gives the moderation system a durable, semantic memory of confirmed abuse so
 * it catches spam variants the exact-match `contentHash` heuristic misses, and
 * grounds LLM decisions with past precedent (RAG) without a human admin.
 *
 * Flow:
 *   - When the Guardian confirms abuse (status deleted / account suspended) the
 *     offending text is embedded and upserted into a Vectorize index.
 *   - New content is embedded and queried against that index. Near-duplicates
 *     of known spam (score >= AUTO_ACTION_THRESHOLD) are acted on directly;
 *     moderately similar hits (score >= SIMILAR_FLAG_THRESHOLD) add a flag and
 *     are shown to the reasoning model as precedent.
 *
 * Everything degrades gracefully: if the AI or VECTORIZE binding is missing, or
 * the index does not exist yet, all functions become safe no-ops.
 *
 * Index setup (must match EMBEDDING_MODEL dimensions):
 *   npx wrangler vectorize create moderation-vectors --dimensions=1024 --metric=cosine
 */

export const EMBEDDING_MODEL = "@cf/baai/bge-m3" as Parameters<Ai["run"]>[0];
/** Text embedding models output this many dimensions for EMBEDDING_MODEL. */
export const EMBEDDING_DIMENSIONS = 1024;

/** Cosine distance score above which content is *flagged* as related to abuse. */
export const SIMILAR_FLAG_THRESHOLD = 0.8;
/**
 * Cosine distance score above which content is treated as a near-duplicate of
 * confirmed abuse and acted on without a fresh LLM decision.
 */
export const AUTO_ACTION_THRESHOLD = 0.94;
/** Truncate text before embedding — keeps inference cheap, nothing is lost for spam. */
export const MAX_EMBED_TEXT_LENGTH = 600;

export interface VectorEnv {
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
}

export type AbuseKind = "status" | "account" | "registration";
export type AbuseAction = "delete" | "suspend" | "reject";

export interface AbuseVectorInput {
  kind: AbuseKind;
  action: AbuseAction;
  text: string;
  reason?: string;
  confidence?: string;
  model?: string;
}

export interface AbuseMatch {
  id: string;
  kind: AbuseKind;
  action: AbuseAction;
  score: number;
  reason?: string;
  ts?: number;
}

export interface VectorPreScreen {
  /** Action to apply directly when content is a near-duplicate of known abuse. */
  autoAction: AbuseAction | null;
  /** Whether the content is at least flagged as related to known abuse. */
  flagged: boolean;
  /** Strongest matching precedent, if any. */
  best: AbuseMatch | null;
  /** Rendered precedent block for the reasoning-model prompt. */
  precedent: string | null;
}

// ── Pure helpers (unit-testable) ───────────────────────────────────────────

/** Normalise + truncate text before embedding. */
export function normalizeForEmbedding(text: string): string {
  return (text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EMBED_TEXT_LENGTH);
}

/** Deterministic vector id — upserting twice for the same source overwrites. */
export function buildAbuseVectorId(kind: AbuseKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

/** Decide what a set of matches means (auto-action / flag / nothing). */
export function classifyMatch(matches: AbuseMatch[]): {
  autoAction: AbuseAction | null;
  flagged: boolean;
  best: AbuseMatch | null;
} {
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const best = sorted[0] ?? null;
  if (!best) return { autoAction: null, flagged: false, best: null };
  if (best.score >= AUTO_ACTION_THRESHOLD) return { autoAction: best.action, flagged: true, best };
  if (best.score >= SIMILAR_FLAG_THRESHOLD) return { autoAction: null, flagged: true, best };
  return { autoAction: null, flagged: false, best: null };
}

/** Render the top related precedents for the reasoning-model prompt. */
export function precedentText(matches: AbuseMatch[]): string | null {
  const used = matches
    .filter((m) => m.score >= SIMILAR_FLAG_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (used.length === 0) return null;
  return used
    .map((m) => `- [similitud ${m.score.toFixed(2)}] ${m.kind}/${m.action}${m.reason ? ` — ${m.reason}` : ""}`)
    .join("\n");
}

// ── Runtime (AI + Vectorize) ───────────────────────────────────────────────

/** Embed a short text into a dense vector, or null on failure. */
export async function embedText(ai: Ai, text: string): Promise<number[] | null> {
  const normalized = normalizeForEmbedding(text);
  if (!normalized) return null;
  try {
    const result = (await ai.run(EMBEDDING_MODEL, { text: [normalized] } as Parameters<Ai["run"]>[1])) as {
      data?: number[][];
    };
    const vector = result.data?.[0];
    if (!Array.isArray(vector) || vector.length === 0) return null;
    return vector;
  } catch {
    return null;
  }
}

/**
 * Store confirmed-abuse content in the vector index.
 * Only remembered when the confidence is not low (avoid poisoning memory with
 * questionable calls). Returns true when stored.
 */
export async function rememberAbuse(env: VectorEnv, input: AbuseVectorInput & { id: string }): Promise<boolean> {
  if (!env.AI || !env.VECTORIZE) return false;
  if (!input.confidence || input.confidence === "low") return false;
  const text = normalizeForEmbedding(input.text);
  if (!text || text.length < 12) return false;

  const values = await embedText(env.AI, text);
  if (!values) return false;

  try {
    await env.VECTORIZE.upsert([
      {
        id: input.id,
        values,
        metadata: {
          kind: input.kind,
          action: input.action,
          ts: Math.floor(Date.now() / 1000),
          reason: (input.reason ?? "").slice(0, 300),
          confidence: input.confidence,
          model: input.model ?? "",
        },
      },
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Query the index for the closest confirmed-abuse vectors, if any. */
export async function findSimilarAbuse(env: VectorEnv, text: string, topK = 5): Promise<AbuseMatch[]> {
  if (!env.AI || !env.VECTORIZE) return [];
  const values = await embedText(env.AI, text);
  if (!values) return [];

  try {
    const result = await env.VECTORIZE.query(values, { topK, returnMetadata: "all" });
    return (result.matches ?? [])
      .filter((m) => m.score != null)
      .map((m) => ({
        id: m.id,
        kind: (m.metadata?.kind as AbuseKind | undefined) ?? "status",
        action: (m.metadata?.action as AbuseAction | undefined) ?? "delete",
        score: m.score,
        reason: typeof m.metadata?.reason === "string" ? m.metadata.reason : undefined,
        ts: typeof m.metadata?.ts === "number" ? m.metadata.ts : undefined,
      }));
  } catch {
    return [];
  }
}

/** Full pre-screen: query + classify + render precedent. Never throws. */
export async function vectorPreScreen(env: VectorEnv, text: string): Promise<VectorPreScreen> {
  const empty: VectorPreScreen = { autoAction: null, flagged: false, best: null, precedent: null };
  if (!env.AI || !env.VECTORIZE) return empty;
  const matches = await findSimilarAbuse(env, text, 5);
  const { autoAction, flagged, best } = classifyMatch(matches);
  return { autoAction, flagged, best, precedent: precedentText(matches) };
}
