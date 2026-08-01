import { describe, it, expect, vi } from "vitest";
import {
  EMBEDDING_MODEL,
  SIMILAR_FLAG_THRESHOLD,
  AUTO_ACTION_THRESHOLD,
  MAX_EMBED_TEXT_LENGTH,
  normalizeForEmbedding,
  buildAbuseVectorId,
  classifyMatch,
  precedentText,
  rememberAbuse,
  findSimilarAbuse,
  vectorPreScreen,
} from "@/lib/moderation/vectors";

const FIXED_VECTOR = Array.from({ length: 16 }, (_, i) => i / 16);

/** Minimal fake embedding model returning a deterministic vector. */
function fakeAi(): Ai {
  return {
    run: vi.fn(async () => ({ data: [FIXED_VECTOR] })),
  } as unknown as Ai;
}

/** Minimal fake Vectorize index. */
function fakeIndex() {
  const upserted: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }> = [];
  return {
    upserted,
    index: {
      upsert: vi.fn(async (vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[]) => {
        upserted.push(...vectors);
        return { mutationId: "m1" };
      }),
      query: vi.fn(async () => ({ matches: [] })),
    } as unknown as VectorizeIndex,
  };
}

describe("buildAbuseVectorId", () => {
  it("is deterministic and namespaced by kind", () => {
    expect(buildAbuseVectorId("status", "abc")).toBe("status:abc");
    expect(buildAbuseVectorId("status", "abc")).toBe(buildAbuseVectorId("status", "abc"));
    expect(buildAbuseVectorId("account", "abc")).not.toBe(buildAbuseVectorId("status", "abc"));
  });
});

describe("normalizeForEmbedding", () => {
  it("strips HTML and collapses whitespace", () => {
    expect(normalizeForEmbedding("<p>Hola <b>mundo</b></p>  spam")).toBe("Hola mundo spam");
  });

  it("truncates long text to the embedding window", () => {
    const long = "x ".repeat(1000);
    expect(normalizeForEmbedding(long).length).toBeLessThanOrEqual(MAX_EMBED_TEXT_LENGTH);
  });
});

describe("classifyMatch", () => {
  it("returns nothing when there are no matches", () => {
    expect(classifyMatch([])).toEqual({ autoAction: null, flagged: false, best: null });
  });

  it("auto-acts on near-duplicates of confirmed abuse", () => {
    const res = classifyMatch([
      { id: "status:1", kind: "status", action: "delete", score: AUTO_ACTION_THRESHOLD + 0.01 },
    ]);
    expect(res.autoAction).toBe("delete");
    expect(res.flagged).toBe(true);
    expect(res.best?.id).toBe("status:1");
  });

  it("flags moderate similarity without auto-acting", () => {
    const res = classifyMatch([
      { id: "account:2", kind: "account", action: "suspend", score: (SIMILAR_FLAG_THRESHOLD + AUTO_ACTION_THRESHOLD) / 2 },
    ]);
    expect(res.autoAction).toBeNull();
    expect(res.flagged).toBe(true);
  });

  it("ignores weak matches", () => {
    const res = classifyMatch([{ id: "status:3", kind: "status", action: "delete", score: 0.5 }]);
    expect(res.autoAction).toBeNull();
    expect(res.flagged).toBe(false);
  });

  it("picks the highest-score match as best", () => {
    const res = classifyMatch([
      { id: "a", kind: "status", action: "delete", score: 0.82 },
      { id: "b", kind: "status", action: "delete", score: 0.96 },
    ]);
    expect(res.best?.id).toBe("b");
    expect(res.autoAction).toBe("delete");
  });
});

describe("precedentText", () => {
  it("renders only matches above the flag threshold, sorted by score", () => {
    const text = precedentText([
      { id: "a", kind: "status", action: "delete", score: 0.6, reason: "spam" },
      { id: "b", kind: "account", action: "suspend", score: 0.95, reason: "estafa" },
      { id: "c", kind: "status", action: "delete", score: 0.83 },
    ]);
    expect(text).toContain("account/suspend");
    expect(text).toContain("estafa");
    expect(text).toContain("status/delete");
    expect(text).not.toContain("spam");
    expect(text!.indexOf("0.95")).toBeLessThan(text!.indexOf("0.83"));
  });

  it("returns null when nothing qualifies", () => {
    expect(precedentText([{ id: "a", kind: "status", action: "delete", score: 0.4 }])).toBeNull();
  });
});

describe("rememberAbuse", () => {
  it("skips when the bindings are missing", async () => {
    expect(await rememberAbuse({}, { id: "status:1", kind: "status", action: "delete", text: "spam!", confidence: "high" })).toBe(false);
  });

  it("skips low-confidence decisions to avoid poisoning memory", async () => {
    const { index, upserted } = fakeIndex();
    const ok = await rememberAbuse(
      { AI: fakeAi(), VECTORIZE: index },
      { id: "status:1", kind: "status", action: "delete", text: "this is spam", confidence: "low" }
    );
    expect(ok).toBe(false);
    expect(upserted.length).toBe(0);
  });

  it("skips empty or trivial text", async () => {
    const { index, upserted } = fakeIndex();
    const ok = await rememberAbuse(
      { AI: fakeAi(), VECTORIZE: index },
      { id: "status:1", kind: "status", action: "delete", text: "<p></p>", confidence: "high" }
    );
    expect(ok).toBe(false);
    expect(upserted.length).toBe(0);
  });

  it("upserts a vector with metadata", async () => {
    const { index, upserted } = fakeIndex();
    const ok = await rememberAbuse(
      { AI: fakeAi(), VECTORIZE: index },
      {
        id: "status:1",
        kind: "status",
        action: "delete",
        text: "free money now, click here!",
        reason: "spam",
        confidence: "high",
        model: "test",
      }
    );
    expect(ok).toBe(true);
    expect(upserted).toHaveLength(1);
    expect(upserted[0].id).toBe("status:1");
    expect(upserted[0].values).toEqual(FIXED_VECTOR);
    expect(upserted[0].metadata).toMatchObject({ kind: "status", action: "delete", confidence: "high", reason: "spam" });
  });
});

describe("findSimilarAbuse", () => {
  it("queries the index and maps matches with metadata", async () => {
    const { index } = fakeIndex();
    const query = vi.fn(async () => ({
      matches: [
        { id: "status:9", score: 0.97, metadata: { kind: "status", action: "delete", reason: "scam", ts: 123 } },
      ],
    }));
    (index as unknown as { query: unknown }).query = query;

    const matches = await findSimilarAbuse({ AI: fakeAi(), VECTORIZE: index }, "win a prize now");
    expect(query).toHaveBeenCalledWith(FIXED_VECTOR, expect.objectContaining({ topK: 5, returnMetadata: "all" }));
    expect(matches[0]).toMatchObject({ id: "status:9", kind: "status", action: "delete", score: 0.97, reason: "scam", ts: 123 });
  });

  it("returns [] when bindings are missing", async () => {
    expect(await findSimilarAbuse({}, "text")).toEqual([]);
  });
});

describe("vectorPreScreen", () => {
  it("returns empty pre-screen without bindings", async () => {
    expect(await vectorPreScreen({}, "text")).toEqual({ autoAction: null, flagged: false, best: null, precedent: null });
  });

  it("derives auto-action + precedent from matches", async () => {
    const { index } = fakeIndex();
    const query = vi.fn(async () => ({
      matches: [
        { id: "account:7", score: 0.96, metadata: { kind: "account", action: "suspend", reason: "bot spam" } },
      ],
    }));
    (index as unknown as { query: unknown }).query = query;

    const res = await vectorPreScreen({ AI: fakeAi(), VECTORIZE: index }, "same spam text");
    expect(res.autoAction).toBe("suspend");
    expect(res.flagged).toBe(true);
    expect(res.best?.id).toBe("account:7");
    expect(res.precedent).toContain("bot spam");
  });
});

describe("embedding model", () => {
  it("targets the multilingual bge-m3 model", () => {
    expect(String(EMBEDDING_MODEL)).toBe("@cf/baai/bge-m3");
  });
});
