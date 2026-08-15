// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Database, D1Result } from "@cloudflare/workers-types";
import { getActorByUri } from "@/lib/db";

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

const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----";

beforeEach(() => {
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db = new D1Adapter(schema) as unknown as D1Database;

  const insert = db.prepare(
    `INSERT INTO actors (id, username, domain, display_name, public_key_pem, is_local, inbox)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insert.bind(
    "https://mastodon.la/users/hcv13",
    "hcv13",
    "mastodon.la",
    "hcv13",
    PEM,
    0,
    "https://mastodon.la/users/hcv13/inbox"
  ).run();
  insert.bind(
    "https://cf-ap.com/users/ale",
    "ale",
    "cf-ap.com",
    "ale",
    PEM,
    1,
    "https://cf-ap.com/users/ale/inbox"
  ).run();
});

describe("getActorByUri", () => {
  it("resolves the canonical actor id", async () => {
    const a = await getActorByUri(db, "https://mastodon.la/users/hcv13");
    expect(a?.username).toBe("hcv13");
    expect(a?.domain).toBe("mastodon.la");
  });

  it("resolves the web profile URL (@username) of a remote actor", async () => {
    const a = await getActorByUri(db, "https://mastodon.la/@hcv13");
    expect(a?.username).toBe("hcv13");
    expect(a?.domain).toBe("mastodon.la");
  });

  it("resolves the plain acct form (name@host)", async () => {
    const a = await getActorByUri(db, "hcv13@mastodon.la");
    expect(a?.username).toBe("hcv13");
    expect(a?.domain).toBe("mastodon.la");
  });

  it("returns null for an unknown actor", async () => {
    expect(await getActorByUri(db, "https://unknown.example/@nobody")).toBeNull();
    expect(await getActorByUri(db, "nobody@unknown.example")).toBeNull();
    expect(await getActorByUri(db, "not a uri")).toBeNull();
  });

  it("resolves local actors by canonical id too", async () => {
    const a = await getActorByUri(db, "https://cf-ap.com/users/ale");
    expect(a?.username).toBe("ale");
  });
});
