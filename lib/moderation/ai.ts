/**
 * AI decision engine — the "Guardian".
 *
 * Wraps Workers AI LLM calls behind small typed functions used by the
 * moderation pipeline. All functions return a structured verdict (or null when
 * the model is unavailable / output is invalid), so callers never crash.
 *
 * The prompts are defined in ./prompts.ts and always ask for strict JSON.
 */

import { GUARDIAN_SYSTEM_PROMPT, buildReportPrompt, buildRegistrationPrompt, buildContentPrompt, buildAccountPrompt } from "./prompts";

export interface Verdict {
  action: string;
  reason: string;
  confidence: "low" | "medium" | "high";
}

export type ReportVerdict = Verdict & { action: "dismiss" | "warn" | "delete" | "suspend" };
export type RegistrationVerdict = Verdict & { action: "approve" | "reject" };
export type ContentVerdict = Verdict & { action: "allow" | "mark_sensitive" | "delete" | "escalate" };
export type AccountVerdict = Verdict & { action: "monitor" | "warn" | "suspend" };

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<Ai["run"]>[0];

/** Model id used for audit logging. */
export const GUARDIAN_MODEL = String(MODEL).replace(/^@/, "");

interface AiEnv {
  AI?: Ai;
}

async function ask(
  env: AiEnv,
  userPrompt: string,
  allowedActions: string[],
  maxTokens = 256
): Promise<Verdict | null> {
  if (!env.AI) return null;

  try {
    const result = (await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: GUARDIAN_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    } as Parameters<Ai["run"]>[1])) as { response?: string };

    const text = (result.response ?? "").trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as Partial<Verdict>;
    if (
      typeof parsed.action !== "string" ||
      !allowedActions.includes(parsed.action) ||
      typeof parsed.reason !== "string"
    ) {
      return null;
    }

    const confidence = (["low", "medium", "high"] as const).includes(
      parsed.confidence as Verdict["confidence"]
    )
      ? (parsed.confidence as Verdict["confidence"])
      : "medium";

    return {
      action: parsed.action,
      reason: parsed.reason.slice(0, 500),
      confidence,
    };
  } catch {
    return null;
  }
}

/** Evaluate a user report. */
export async function evaluateReport(
  env: AiEnv,
  report: {
    category: string;
    comment: string;
    statusContent: string;
    targetUsername: string;
    reporterUsername: string;
    invalidStatuses: boolean;
    mismatchedOwnership: boolean;
  }
): Promise<ReportVerdict | null> {
  const v = await ask(env, buildReportPrompt(report), ["dismiss", "warn", "delete", "suspend"]);
  return v as ReportVerdict | null;
}

/** Review a brand-new local account profile. */
export async function evaluateRegistration(
  env: AiEnv,
  profile: {
    username: string;
    displayName: string;
    summary: string;
    source: "web" | "api";
    ipSuspicious: boolean;
  }
): Promise<RegistrationVerdict | null> {
  const v = await ask(env, buildRegistrationPrompt(profile), ["approve", "reject"]);
  return v as RegistrationVerdict | null;
}

/** Screen individual status content. */
export async function evaluateContent(
  env: AiEnv,
  status: {
    content: string;
    contentWarning: string;
    mediaCount: number;
    isReply: boolean;
    visibility: string;
    authorUsername: string;
    accountAgeDays: number;
    statusesCount: number;
    previousWarnings: number;
    flags: string[];
  }
): Promise<ContentVerdict | null> {
  const v = await ask(env, buildContentPrompt(status), ["allow", "mark_sensitive", "delete", "escalate"], 320);
  return v as ContentVerdict | null;
}

/** Evaluate long-term account behavior. */
export async function evaluateAccount(
  env: AiEnv,
  account: {
    username: string;
    isLocal: boolean;
    domain: string;
    statusesCount: number;
    followersCount: number;
    followingCount: number;
    isBot: boolean;
    ageDays: number;
    postsLastHour: number;
    postsLastDay: number;
    linkRatio: number;
    followsLastHour: number;
    reportsReceived: number;
    previousWarnings: number;
    isSuspended: boolean;
    isVerified: boolean;
    flags: string[];
  }
): Promise<AccountVerdict | null> {
  const v = await ask(env, buildAccountPrompt(account), ["monitor", "warn", "suspend"], 320);
  return v as AccountVerdict | null;
}
