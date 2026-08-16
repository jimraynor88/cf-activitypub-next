import { describe, it, expect } from "vitest";
import { encodeStatusId, decodeStatusId } from "@/lib/mastodon/statusId";

describe("encodeStatusId", () => {
  it("reduces local object IRIs to the UUID tail", () => {
    const iri = "https://local.example/objects/9f2c4d7e-1234-4abc-9def-000000000001";
    expect(encodeStatusId(iri, true)).toBe("9f2c4d7e-1234-4abc-9def-000000000001");
  });

  it("base64url-encodes remote IRIs without URL-hostile characters", () => {
    const iri = "https://remote.example/users/bob/statuses/1234567890";
    const encoded = encodeStatusId(iri, false);
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("=");
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });
});

describe("decodeStatusId", () => {
  it("round-trips local UUID ids back to the object IRI", () => {
    const iri = "https://local.example/objects/9f2c4d7e-1234-4abc-9def-000000000001";
    expect(decodeStatusId(encodeStatusId(iri, true), "local.example")).toBe(iri);
  });

  it("round-trips remote base64url ids back to the original IRI", () => {
    const iri = "https://remote.example/users/bob/statuses/1234567890";
    expect(decodeStatusId(encodeStatusId(iri, false), "local.example")).toBe(iri);
  });

  it("handles legacy full-IRI ids as-is", () => {
    const iri = "https://old.example/statuses/42";
    expect(decodeStatusId(iri, "local.example")).toBe(iri);
  });

  it("rejects non-http base64 payloads as invalid", () => {
    // base64url of "not a url" decodes to a non-http string → must fall through.
    const notUrl = btoa("not a url").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(decodeStatusId(notUrl, "local.example")).toBe(notUrl);
  });

  it("returns the input unchanged when it is not valid base64 either", () => {
    expect(decodeStatusId("?!?not-valid?!?", "local.example")).toBe("?!?not-valid?!?");
  });

  it("round-trips remote ids that contain slashes and pluses", () => {
    const tricky = "https://x.example/objects/a+b/c%2Fd";
    const enc = encodeStatusId(tricky, false);
    expect(decodeStatusId(enc, "local.example")).toBe(tricky);
  });
});