/**
 * Shared content-screening pipeline used by BOTH the pre-publish gate
 * (app/api/v1/statuses) and the scheduled moderation cycle (src/worker.ts).
 *
 * Flow: fast Llama Guard screen → only flagged content escalates to the
 * reasoning model → action. If the reasoning model is unavailable but the guard
 * flagged a severe category, the pipeline blocks defensively.
 */

import { screenContent } from "./classifier";
import { evaluateContent } from "./ai";
import { stripHtml, computeContentSignals } from "./heuristics";
import { vectorPreScreen } from "./vectors";
import { warnAccount, suspendAccount, deleteStatus, markStatusSensitive, recordNoAction, GUARDIAN_MODEL } from "./actions";
import { countWarnings } from "./log";
import { runWithTimeout } from "./util";
import type { ModerationEnv } from "./actions";

/** Guard categories that are severe enough to block even without a verdict. */
const SEVERE_GUARD_CODES = new Set(["S1", "S2", "S3", "S4", "S10", "S11"]);
/** Categories that only warrant marking the content sensitive. */
const SENSITIVE_GUARD_CODES = new Set(["S12"]);

export interface ScreenStatusInput {
  contentHtml: string;
  spoilerText: string;
  mediaCount: number;
  isReply: boolean;
  visibility: string;
  authorId: string;
  authorUsername: string;
  accountAgeDays: number;
  statusesCount: number;
  /** null when the status has not been created yet (pre-publish gate). */
  objectId: string | null;
}

export interface ScreenStatusOutput {
  blocked: boolean;
  markedSensitive: boolean;
  reason?: string;
}

export async function screenStatus(
  env: ModerationEnv,
  input: ScreenStatusInput
): Promise<ScreenStatusOutput> {
  const plainText = stripHtml(input.contentHtml);
  if (!plainText) return { blocked: false, markedSensitive: false };

  // 1. Fast Llama Guard filter + Vectorize similarity pre-screen in parallel.
  //    The vector memory catches near-duplicate spam without a fresh LLM call.
  const [screen, vector] = await Promise.all([
    env.AI ? runWithTimeout(screenContent(env.AI, plainText), 2500, null) : Promise.resolve(null),
    vectorPreScreen(env, plainText),
  ]);

  const signals = computeContentSignals(input.contentHtml);
  if (vector.flagged) signals.flags.push("similar_confirmed_spam");

  const details = {
    stage: input.objectId ? "scheduled_scan" : "content_gate",
    authorId: input.authorId,
    objectId: input.objectId,
    flags: signals.flags,
    guardCategories: screen?.categories ?? [],
    vectorMatch: vector.best
      ? { id: vector.best.id, kind: vector.best.kind, action: vector.best.action, score: Number(vector.best.score.toFixed(4)) }
      : null,
    content: plainText.slice(0, 300),
  };

  // 2. Auto-action: this content is a near-duplicate of previously confirmed
  //    abuse — reuse the stored decision instead of re-asking the model.
  if (vector.autoAction && vector.best) {
    const previousWarnings = await countWarnings(env.DB, input.authorId);
    const reason = `Contenido casi idéntico a abuso confirmado previamente (similitud ${vector.best.score.toFixed(2)}): ${vector.best.reason ?? "spam conocido"}`.slice(0, 500);

    if (vector.autoAction === "suspend") {
      await suspendAccount(env, { actorId: input.authorId, reason, confidence: "high", source: "ai", model: GUARDIAN_MODEL, details });
      if (input.objectId) {
        await deleteStatus(env, { objectId: input.objectId, reason, confidence: "high", source: "ai", model: GUARDIAN_MODEL, details });
      }
      return { blocked: true, markedSensitive: false, reason };
    }

    if (vector.autoAction === "delete") {
      if (previousWarnings >= 1) {
        await suspendAccount(env, { actorId: input.authorId, reason, confidence: "high", source: "ai", model: GUARDIAN_MODEL, details });
      } else {
        await warnAccount(env, { actorId: input.authorId, reason, confidence: "high", source: "ai", model: GUARDIAN_MODEL, details });
      }
      if (input.objectId) {
        await deleteStatus(env, { objectId: input.objectId, reason, confidence: "high", source: "ai", model: GUARDIAN_MODEL, details });
      }
      return { blocked: true, markedSensitive: false, reason };
    }

    // "reject" precedents are registration-specific; nothing to do here.
  }

  // 3. Guard fast screen: nothing flagged and no vector signal → allow.
  if (!screen || screen.safe) {
    if (!vector.flagged) return { blocked: false, markedSensitive: false };
    // Only a moderate vector signal — let the reasoning model decide.
  }

  const guardCodes = new Set(screen ? screen.categories.map((c) => c.split(":")[0].trim().toUpperCase()) : []);
  const severe = [...guardCodes].some((c) => SEVERE_GUARD_CODES.has(c));

  const previousWarnings = await countWarnings(env.DB, input.authorId);

  const verdict = await runWithTimeout(
    evaluateContent(env, {
      content: plainText.slice(0, 1200),
      contentWarning: input.spoilerText,
      mediaCount: input.mediaCount,
      isReply: input.isReply,
      visibility: input.visibility,
      authorUsername: input.authorUsername,
      accountAgeDays: input.accountAgeDays,
      statusesCount: input.statusesCount,
      previousWarnings,
      flags: signals.flags,
      precedent: vector.precedent,
    }),
    6000,
    null
  );

  const action = verdict?.action ?? (severe ? "delete" : [...guardCodes].some((c) => SENSITIVE_GUARD_CODES.has(c)) ? "mark_sensitive" : "allow");

  if (action === "delete") {
    const reason = verdict?.reason ?? "Contenido clasificado como grave por el filtro de seguridad.";
    const confidence = verdict?.confidence ?? "high";
    if (previousWarnings >= 1) {
      await suspendAccount(env, { actorId: input.authorId, reason, confidence, source: "ai", model: GUARDIAN_MODEL, details });
    } else {
      await warnAccount(env, { actorId: input.authorId, reason, confidence, source: "ai", model: GUARDIAN_MODEL, details });
    }
    if (input.objectId) {
      await deleteStatus(env, { objectId: input.objectId, reason, confidence, source: "ai", model: GUARDIAN_MODEL, details });
    }
    return { blocked: true, markedSensitive: false, reason };
  }

  if (action === "mark_sensitive") {
    if (input.objectId) {
      await markStatusSensitive(env, {
        objectId: input.objectId,
        spoilerText: input.spoilerText || "Contenido sensible",
        reason: verdict?.reason ?? "Contenido marcado como sensible.",
        confidence: verdict?.confidence ?? "medium",
        source: "ai",
        model: GUARDIAN_MODEL,
        details,
      });
    } else {
      await recordNoAction(env, {
        targetType: "status",
        targetId: null,
        action: "marked_sensitive",
        reason: verdict?.reason ?? "Contenido marcado como sensible.",
        confidence: verdict?.confidence ?? "medium",
        source: "ai",
        model: GUARDIAN_MODEL,
        details,
        relatedId: input.authorId,
      });
    }
    return { blocked: false, markedSensitive: true };
  }

  // allow / escalate / reasoning unavailable but not severe → proceed.
  await recordNoAction(env, {
    targetType: "status",
    targetId: input.objectId,
    action: "no_action",
    reason: verdict?.reason ?? "Revisado y permitido.",
    confidence: verdict?.confidence,
    source: "ai",
    model: GUARDIAN_MODEL,
    details,
    relatedId: input.authorId,
  });

  return { blocked: false, markedSensitive: false };
}
