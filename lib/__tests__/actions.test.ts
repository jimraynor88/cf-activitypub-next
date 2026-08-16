// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { D1Database, D1Result } from "@cloudflare/workers-types";
import {
  suspendAccount,
  unsuspendAccount,
  blockDomain,
  resolveReport,
  dismissReport,
  deleteStatus,
} from "@/lib/moderation/actions";

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

const ENV = {
  DB: {} as D1Database,
  INSTANCE_URL: "https://cf-ap.example",
} as unknown as Parameters<typeof suspendAccount>[0];

const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----";

function insertActor(id: string, username: string, domain: string, opts: { isLocal?: boolean; email?: string | null; suspended?: boolean } = {}) {
  db.prepare(
    `INSERT INTO actors (id, username, domain, display_name, public_key_pem, private_key_pem, is_local, is_bot,
       manually_approves_followers, discoverable, followers_count, following_count, statuses_count,
       email, password_hash, email_verified, suspended, inbox)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1, 0, 0, 0, ?, NULL, 1, ?, ?)`
  ).bind(
    id,
    username.toLowerCase(),
    domain.toLowerCase(),
    username,
    PEM,
    opts.isLocal ? "priv" : null,
    opts.isLocal ? 1 : 0,
    opts.email ?? null,
    opts.suspended ? 1 : 0,
    opts.isLocal ? `https://${domain}/users/${username.toLowerCase()}/inbox` : null
  ).run();
}

async function countLog(targetType: string, targetId: string, action: string): Promise<number> {
  const row = (await db.prepare(
    "SELECT COUNT(*) AS c FROM moderation_log WHERE target_type = ? AND target_id = ? AND action = ?"
  ).bind(targetType, targetId, action).first<{ c: number }>()) as { c: number };
  return row.c ?? 0;
}

beforeEach(() => {
  const schema = readFileSync(join(process.cwd(), "lib/db/schema.sql"), "utf8");
  db = new D1Adapter(schema) as unknown as D1Database;
  (ENV as { DB: D1Database }).DB = db;
});

describe("suspendAccount / unsuspendAccount", () => {
  it("suspends an account, clears its content, and audits the action", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true, email: "ale@example.com" });
    db.prepare(
      `INSERT INTO objects (id, type, actor_id, content, content_warning, sensitive, visibility, is_local)
       VALUES ('obj1', 'Note', 'https://cf-ap.example/users/ale', '<p>toxic</p>', NULL, 0, 'public', 1)`
    ).run();

    const res = await suspendAccount(ENV, { actorId: "https://cf-ap.example/users/ale", reason: "spam", source: "ai", confidence: "high" });
    expect(res.applied).toBe(true);
    expect(res.action).toBe("suspended");

    const actor = await db.prepare("SELECT suspended FROM actors WHERE id = ?").bind("https://cf-ap.example/users/ale").first<{ suspended: number }>();
    expect(actor?.suspended).toBe(1);
    const obj = await db.prepare("SELECT content, sensitive FROM objects WHERE id = 'obj1'").first<{ content: string | null; sensitive: number }>();
    expect(obj?.content).toBeNull();
    expect(obj?.sensitive).toBe(1);
    expect(await countLog("account", "https://cf-ap.example/users/ale", "suspended")).toBe(1);
  });

  it("is idempotent — does not double-suspend or double-log", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true, suspended: true });
    const res = await suspendAccount(ENV, { actorId: "https://cf-ap.example/users/ale", reason: "again" });
    expect(res.applied).toBe(false);
    expect(await countLog("account", "https://cf-ap.example/users/ale", "suspended")).toBe(0);
  });

  it("unsuspends a suspended account and audits the action", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true, suspended: true });
    const res = await unsuspendAccount(ENV, { actorId: "https://cf-ap.example/users/ale", reason: "reinstated" });
    expect(res.applied).toBe(true);
    const actor = await db.prepare("SELECT suspended FROM actors WHERE id = ?").bind("https://cf-ap.example/users/ale").first<{ suspended: number }>();
    expect(actor?.suspended).toBe(0);
    expect(await countLog("account", "https://cf-ap.example/users/ale", "unsuspended")).toBe(1);
  });

  it("returns applied=false for a non-suspended account", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true });
    const res = await unsuspendAccount(ENV, { actorId: "https://cf-ap.example/users/ale" });
    expect(res.applied).toBe(false);
  });
});

describe("blockDomain", () => {
  it("inserts a domain block and suspends all cached remote accounts of the domain", async () => {
    insertActor("https://spam.example/users/a", "a", "spam.example");
    insertActor("https://spam.example/users/b", "b", "spam.example");

    const res = await blockDomain(ENV, { domain: "spam.example", instanceDomain: "cf-ap.example", reason: "abuse" });
    expect(res.applied).toBe(true);

    const block = await db.prepare("SELECT domain FROM domain_blocks WHERE domain = 'spam.example'").first<{ domain: string }>();
    expect(block?.domain).toBe("spam.example");
    const suspended = await db.prepare("SELECT COUNT(*) AS c FROM actors WHERE domain = 'spam.example' AND suspended = 1").first<{ c: number }>() as { c: number }; 
    expect(suspended.c).toBe(2);
    expect(await countLog("domain", "spam.example", "blocked_domain")).toBe(1);
  });

  it("refuses to block the instance's own domain", async () => {
    const res = await blockDomain(ENV, { domain: "cf-ap.example", instanceDomain: "cf-ap.example" });
    expect(res.applied).toBe(false);
    expect((await db.prepare("SELECT COUNT(*) AS c FROM domain_blocks").first<{ c: number }>())?.c ?? 0).toBe(0);
  });

  it("normalizes case and whitespace in the domain", async () => {
    const res = await blockDomain(ENV, { domain: "  Spam.Example  ", instanceDomain: "cf-ap.example" });
    expect(res.applied).toBe(true);
    const block = await db.prepare("SELECT domain FROM domain_blocks").first<{ domain: string }>();
    expect(block?.domain).toBe("spam.example");
  });
});

describe("resolveReport / dismissReport", () => {
  function insertReport(id: string, actionTaken = 0) {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true });
    insertActor("https://cf-ap.example/users/bob", "bob", "cf-ap.example", { isLocal: true });
    db.prepare(
      `INSERT INTO reports (id, actor_id, target_id, status_ids, comment, category, forwarded, action_taken)
       VALUES (?, 'https://cf-ap.example/users/ale', 'https://cf-ap.example/users/bob', NULL, 'spam', 'spam', 0, ?)`
    ).bind(id, actionTaken).run();
  }

  it("marks a report resolved and appends the resolution note", async () => {
    insertReport("rep1");
    const res = await resolveReport(ENV, { reportId: "rep1", reason: "actioned", source: "ai", confidence: "high" });
    expect(res.applied).toBe(true);

    const report = await db.prepare("SELECT action_taken, comment FROM reports WHERE id = 'rep1'").first<{ action_taken: number; comment: string }>();
    expect(report?.action_taken).toBe(1);
    expect(report?.comment).toContain("actioned");
    expect(await countLog("report", "rep1", "resolved")).toBe(1);
  });

  it("does not resolve a report that does not exist", async () => {
    const res = await resolveReport(ENV, { reportId: "nope" });
    expect(res.applied).toBe(false);
    expect(await countLog("report", "nope", "resolved")).toBe(0);
  });

  it("dismisses a report by deleting it", async () => {
    insertReport("rep2");
    const res = await dismissReport(ENV, { reportId: "rep2", reason: "unfounded", source: "ai", confidence: "high" });
    expect(res.applied).toBe(true);

    const report = await db.prepare("SELECT id FROM reports WHERE id = 'rep2'").first();
    expect(report).toBeNull();
    expect(await countLog("report", "rep2", "dismissed")).toBe(1);
  });
});

describe("deleteStatus", () => {
  it("soft-deletes a status (strips content, marks sensitive) and audits it", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true });
    db.prepare(
      `INSERT INTO objects (id, type, actor_id, content, content_warning, sensitive, visibility, is_local)
       VALUES ('obj1', 'Note', 'https://cf-ap.example/users/ale', '<p>bad</p>', NULL, 0, 'public', 1)`
    ).run();

    const res = await deleteStatus(ENV, { objectId: "obj1", reason: "spam", source: "heuristic", confidence: "high" });
    expect(res.applied).toBe(true);

    const obj = await db.prepare("SELECT content, sensitive FROM objects WHERE id = 'obj1'").first<{ content: string | null; sensitive: number }>();
    expect(obj?.content).toBeNull();
    expect(obj?.sensitive).toBe(1);
    expect(await countLog("status", "obj1", "deleted")).toBe(1);
  });

  it("is idempotent via hadAction", async () => {
    insertActor("https://cf-ap.example/users/ale", "ale", "cf-ap.example", { isLocal: true });
    db.prepare(
      `INSERT INTO objects (id, type, actor_id, content, content_warning, sensitive, visibility, is_local)
       VALUES ('obj1', 'Note', 'https://cf-ap.example/users/ale', '<p>bad</p>', NULL, 0, 'public', 1)`
    ).run();
    await deleteStatus(ENV, { objectId: "obj1", reason: "spam" });
    const again = await deleteStatus(ENV, { objectId: "obj1", reason: "spam" });
    expect(again.applied).toBe(false);
    expect(await countLog("status", "obj1", "deleted")).toBe(1);
  });
});