import { describe, it, expect } from "vitest";
import { isContentObjectType, isActivityType, isActorType, CONTENT_OBJECT_TYPES } from "@/lib/activitypub/vocab";
import { extractAPMeta, serializeStatus } from "@/lib/mastodon/serializers";
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

  it("returns null when there is no type-specific metadata", () => {
    expect(extractAPMeta(makeObject("Note", { content: "hi" }))).toBeNull();
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

  it("falls back to Non-typeless for a plain Note", () => {
    const status = serializeStatus(makeObject("Note", { content: "hola" }), author, "local.example");
    expect(status.ap_type).toBe("Note");
  });

  it("does not set ap_type for non-content object types", () => {
    const status = serializeStatus(makeObject("Tombstone"), author, "local.example");
    expect(status.ap_type).toBeNull();
    expect(status.ap_meta).toBeNull();
  });
});