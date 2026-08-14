import { describe, it, expect } from "vitest";
import { isContentObjectType, isActivityType, isActorType, CONTENT_OBJECT_TYPES } from "@/lib/activitypub/vocab";
import { extractAPMeta, rewriteProfileLinks, serializeStatus } from "@/lib/mastodon/serializers";
import type { LocalActor, LocalObject } from "@/lib/types";

function makeObject(type: string, extra: Record<string, unknown> = {}): LocalObject {
  const rawObj = { id: "https://remote.example/objects/1", type, ...extra };
  return {
    id: "https://remote.example/objects/1",
    type,
    actorId: "https://remote.example/users/a",
    content: "<p>hello</p>",
    contentWarning: null,
    sensitive: false,
    visibility: "public",
    inReplyToId: null,
    language: "en",
    url: "https://remote.example/objects/1",
    repliesCount: 0,
    reblogsCount: 0,
    favouritesCount: 0,
    published: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    local: false,
    raw: JSON.stringify(rawObj),
  };
}

const author: LocalActor = {
  id: "https://remote.example/users/a",
  username: "a",
  domain: "remote.example",
  displayName: "A",
  summary: null,
  avatarUrl: null,
  headerUrl: null,
  publicKeyPem: "pem",
  privateKeyPem: null,
  isLocal: false,
  isBot: false,
  manuallyApprovesFollowers: false,
  discoverable: true,
  followersCount: 0,
  followingCount: 0,
  statusesCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  email: null,
  passwordHash: null,
  emailVerified: false,
  autoDeleteAfter: null,
};

describe("ActivityStreams vocabulary", () => {
  it("classifies content types, activity types, and actor types", () => {
    for (const t of CONTENT_OBJECT_TYPES) {
      expect(isContentObjectType(t), `expected ${t} to be a content type`).toBe(true);
    }
    expect(isContentObjectType("Tombstone")).toBe(false);
    expect(isContentObjectType("Note")).toBe(true);
    expect(isActivityType("Create")).toBe(true);
    expect(isActivityType("Block")).toBe(true);
    expect(isActivityType("Nonsense")).toBe(false);
    expect(isActorType("Person")).toBe(true);
    expect(isActorType("Service")).toBe(true);
    expect(isActorType("Note")).toBe(false);
  });

  it("covers the core AS2 object types", () => {
    ["Article", "Audio", "Document", "Event", "Image", "Note", "Page", "Place", "Profile", "Relationship", "Tombstone", "Video"]
      .forEach((t) => expect(isContentObjectType(t) || t === "Tombstone" || t === "Profile" || t === "Relationship").toBe(true));
  });
});

describe("extractAPMeta", () => {
  it("extracts Event metadata (name, startTime, endTime, location)", () => {
    const meta = extractAPMeta(makeObject("Event", {
      name: "FestaJS",
      startTime: "2026-05-01T10:00:00Z",
      endTime: "2026-05-01T18:00:00Z",
      location: { type: "Place", name: "W3C HQ", latitude: 48.756, longitude: 2.299 },
    }));
    expect(meta).toMatchObject({
      name: "FestaJS",
      startTime: "2026-05-01T10:00:00Z",
      endTime: "2026-05-01T18:00:00Z",
      location: "W3C HQ",
      latitude: 48.756,
      longitude: 2.299,
    });
  });

  it("extracts a Place with top-level coordinates", () => {
    const meta = extractAPMeta(makeObject("Place", { latitude: [40.4], longitude: [-3.7], name: "Madrid" }));
    expect(meta).toMatchObject({ name: "Madrid", latitude: 40.4, longitude: -3.7 });
  });

  it("normalizes duration string to seconds", () => {
    const meta = extractAPMeta(makeObject("Audio", { duration: "63s", url: "https://cdn.example/x.mp3" }));
    expect(meta?.duration).toBe(63);
  });

  it("returns only the url fallback when there is no other type-specific metadata", () => {
    const meta = extractAPMeta(makeObject("Note", { content: "hi" }));
    // The stored object URL is always resolved, so the meta still carries a
    // usable url instead of being null.
    expect(meta).toMatchObject({ url: "https://remote.example/objects/1" });
  });
});

describe("serializeStatus type passthrough", () => {
  it("surfaces ap_type + ap_meta for content objects", () => {
    const status = serializeStatus(makeObject("Event", {
      name: "Taller", startTime: "2026-06-01T09:00:00Z",
      location: { type: "Place", name: "Aula 3" },
    }), author, "local.example");
    expect(status.ap_type).toBe("Event");
    expect(status.ap_meta?.name).toBe("Taller");
    expect(status.ap_meta?.location).toBe("Aula 3");
  });

  it("falls back to the stored object url for a Page without a raw url field", () => {
    const obj = makeObject("Page", { name: "Mi artículo", content: "<p>texto</p>" });
    const status = serializeStatus(obj, author, "local.example");
    expect(status.ap_type).toBe("Page");
    expect(status.ap_meta?.name).toBe("Mi artículo");
    // No raw `url` on the object → the DB column (object id here) is used so
    // the rendered header never produces a dead link.
    expect(status.ap_meta?.url).toBe("https://remote.example/objects/1");
  });

  it("falls back to Non-typeless for a plain Note", () => {
    const status = serializeStatus(makeObject("Note", { content: "hola" }), author, "local.example");
    expect(status.ap_type).toBe("Note");
  });

  it("does not set ap_type for non-renderable object types", () => {
    const status = serializeStatus(makeObject("Object", { content: "hi" }), author, "local.example");
    expect(status.ap_type).toBeNull();
    expect(status.ap_meta).toBeNull();
  });

  it("surfaces ap_type + ap_meta for Tombstone objects", () => {
    const status = serializeStatus(makeObject("Tombstone", { formerType: "Note", deleted: "2026-01-02T00:00:00Z" }), author, "local.example");
    expect(status.ap_type).toBe("Tombstone");
    expect(status.ap_meta?.formerType).toBe("Note");
    expect(status.ap_meta?.deleted).toBe("2026-01-02T00:00:00Z");
  });
});

describe("rewriteProfileLinks", () => {
  it("rewrites remote mention links to the local resolver route", () => {
    const raw = JSON.stringify({
      id: "https://remote.example/objects/1",
      type: "Note",
      tag: [{ type: "Mention", href: "https://remote.example/users/a", name: "@a@remote.example" }],
    });
    const content = '<p>hola <a href="https://remote.example/users/a" class="u-url mention" rel="nofollow noopener noreferrer" target="_blank">@a</a></p>';
    const out = rewriteProfileLinks(content, raw, "local.example");
    expect(out).toContain('href="/users/remote?url=' + encodeURIComponent("https://remote.example/users/a") + '"');
    expect(out).not.toContain("target=\"_blank\"");
    expect(out).not.toContain("https://remote.example/users/a\"");
  });

  it("keeps local and relative links untouched", () => {
    const raw = JSON.stringify({
      id: "https://remote.example/objects/1",
      type: "Note",
      tag: [{ type: "Mention", href: "https://local.example/users/me", name: "@me@local.example" }],
    });
    const content = '<p><a href="https://local.example/users/me" class="mention">@me</a> <a href="/tags/x" class="tag">#x</a></p>';
    const out = rewriteProfileLinks(content, raw, "local.example");
    expect(out).toContain('href="https://local.example/users/me"');
    expect(out).toContain('href="/tags/x"');
  });

  it("rewrites remote mention links via the mention class fallback", () => {
    const content = '<p><a href="https://other.example/@bob" class="u-url mention" rel="nofollow">@bob</a></p>';
    const out = rewriteProfileLinks(content, "{}", "local.example");
    expect(out).toContain('href="/users/remote?url=' + encodeURIComponent("https://other.example/@bob") + '"');
  });

  it("keeps ordinary external links untouched", () => {
    const content = '<p><a href="https://example.com/article" target="_blank" rel="nofollow noopener noreferrer">article</a></p>';
    const out = rewriteProfileLinks(content, "{}", "local.example");
    expect(out).toContain('href="https://example.com/article"');
    expect(out).toContain('target="_blank"');
  });
});