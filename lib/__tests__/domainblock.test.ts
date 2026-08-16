// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Database, D1Result } from "@cloudflare/workers-types";
import { detectSpamDomains } from "@/lib/moderation/cycle";

/** Minimal D1 adapter backed by node:sqlite (in-memory, schema loaded). */
class D1Adapter {
  private sql = new DatabaseSync(":memory:");

  constructor(schemaSql: string) {
    this.sql.exec("PRAGMA foreign_keys = ON");
    this.sql.exec(schemaSql);
  }

  prepare(query: string) {
    const stmt = this.sql.prepare(query);
    return {
      bind(...params: unknown[]) {
        const bound = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
        return {
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
            const rows = stmt.all(...(bound as never[])) as unknown as T[];
            return { results: rows, success: true, meta: {} };
          },
          async first<T = unknown>(): Promise<T | null> {
            const row = stmt.get(...(bound as never[])) as unknown as T | undefined;
            return row ?? null;
          },
          async run(): Promise<D1Result> {
            const info = stmt.run(...(bound as never[]));
            return { success: true, meta: { changes: info.changes }, results: [] } as unknown as D1Result<unknown>;
          },
        };
      },
      async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
        const rows = stmt.all() as unknown as T[];
        return { results: rows, success: true, meta: {} };
      },
      async first<T = unknown>(): Promise<T | null> {
        const row = stmt.get() as unknown as T | undefined;
        return row ?? null;
      },
      async run(): Promise<D1Result> {
        const info = stmt.run();
        return { success: true, meta: { changes: info.changes }, results: [] } as unknown as D1Result<unknown>;
      },
    };
  }
}

let db: D1Database;

beforeEach(() => {
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db = new D1Adapter(schema) as unknown as D1Database;
});

function insertActor(id: string, username: string, domain: string, suspended = 0) {
  db.prepare(
    `INSERT INTO actors (id, username, domain, public_key_pem, is_local, suspended)
     VALUES (?, ?, ?, 'pem', 0, ?)`
  ).bind(id, username, domain, suspended ? 1 : 0).run();
}

/**
 * Regression test for the 2026-08-16 incident: the old `HAVING c >= 3` absolute
 * threshold made the Guardian block whole large instances (mastodon.social was
 * suspended — 11,547 collateral accounts — for just 3 real spammers). The fixed
 * rule requires BOTH an absolute count (>= 3) AND that the spammers make up
 * >= 50% of the domain's cached accounts.
 */
describe("detectSpamDomains proportional threshold", () => {
  it("does NOT block a large legitimate domain with a handful of spammers", async () => {
    // 12,000 cached mastodon.social accounts, only 3 suspended.
    for (let i = 0; i < 12000; i++) {
      insertActor(`https://mastodon.social/users/u${i}`, `u${i}`, "mastodon.social", i < 3 ? 1 : 0);
    }

    await detectSpamDomains({ DB: db, INSTANCE_URL: "https://cf-ap.example" } as never);

    const blocks = (await db.prepare("SELECT domain FROM domain_blocks").all<{ domain: string }>()).results;
    expect(blocks).toEqual([]);
  });

  it("blocks a small domain where the majority of cached accounts are spammers", async () => {
    insertActor("https://spam.example/users/a", "a", "spam.example", 1);
    insertActor("https://spam.example/users/b", "b", "spam.example", 1);
    insertActor("https://spam.example/users/c", "c", "spam.example", 1);
    insertActor("https://spam.example/users/d", "d", "spam.example", 0);

    await detectSpamDomains({ DB: db, INSTANCE_URL: "https://cf-ap.example" } as never);

    const blocks = (await db.prepare("SELECT domain FROM domain_blocks").all<{ domain: string }>()).results;
    expect(blocks.map((b) => b.domain)).toContain("spam.example");
  });

  it("does NOT block a domain with 3 spammers out of a larger pool (below 50%)", async () => {
    for (let i = 0; i < 10; i++) {
      insertActor(`https://mixed.example/users/u${i}`, `u${i}`, "mixed.example", i < 3 ? 1 : 0);
    }
    await detectSpamDomains({ DB: db, INSTANCE_URL: "https://cf-ap.example" } as never);
    const blocks = (await db.prepare("SELECT domain FROM domain_blocks").all<{ domain: string }>()).results;
    expect(blocks).toEqual([]);
  });

  it("never blocks the instance's own domain", async () => {
    insertActor("https://cf-ap.example/users/a", "a", "cf-ap.example", 1);
    insertActor("https://cf-ap.example/users/b", "b", "cf-ap.example", 1);
    insertActor("https://cf-ap.example/users/c", "c", "cf-ap.example", 1);

    await detectSpamDomains({ DB: db, INSTANCE_URL: "https://cf-ap.example" } as never);

    const blocks = (await db.prepare("SELECT domain FROM domain_blocks").all<{ domain: string }>()).results;
    expect(blocks).toEqual([]);
  });

  it("does not re-block an already blocked domain", async () => {
    db.prepare(
      `INSERT INTO actors (id, username, domain, public_key_pem, is_local)
       VALUES ('https://cf-ap.example/users/guardian', 'guardian', 'cf-ap.example', 'pem', 1)`
    ).run();
    db.prepare("INSERT INTO domain_blocks (id, actor_id, domain) VALUES ('b1', 'https://cf-ap.example/users/guardian', 'already.example')").run();
    insertActor("https://already.example/users/a", "a", "already.example", 1);
    insertActor("https://already.example/users/b", "b", "already.example", 1);
    insertActor("https://already.example/users/c", "c", "already.example", 1);

    await detectSpamDomains({ DB: db, INSTANCE_URL: "https://cf-ap.example" } as never);

    const count = await db.prepare("SELECT COUNT(*) AS c FROM domain_blocks WHERE domain = 'already.example'").first<{ c: number }>();
    expect(count?.c ?? 0).toBe(1);
  });
});