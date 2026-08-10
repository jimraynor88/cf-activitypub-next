// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  generateKeyPackage,
  storeSessionInitKey,
  sealToKeyPackage,
  openEnvelope,
  encodeSenderContext,
  parseKeyPackageMessage,
  parseKeyPackageObject,
} from "@/lib/mls/keypackage";

// These run in Node, which ships WebCrypto (crypto.subtle) since v19.
const nodeCrypto = globalThis.crypto as Crypto;
if (!nodeCrypto?.subtle) {
  throw new Error("Node WebCrypto (crypto.subtle) required to run MLS tests");
}

describe("MLS key packages", () => {
  it("generates a parseable mls_key_package with a P-256 init key", async () => {
    const kp = await generateKeyPackage("https://example.org/users/alice");
    const parsed = parseKeyPackageMessage(kp.content);
    expect(parsed).not.toBeNull();
    expect(parsed!.ciphersuite).toBe(0x0002);
    expect(parsed!.initKey.length).toBe(65); // UncompressedPointRepresentation: 0x04 || X || Y
    expect(parsed!.initKey[0]).toBe(4);
    expect(() => parseKeyPackageObject({ content: kp.content })).not.toThrow();
  });

  it("rejects non key-package payloads", () => {
    expect(parseKeyPackageMessage("bm90IGFuc3RyaW5nCg")).toBeNull();
    expect(parseKeyPackageObject({ content: null })).toBeNull();
  });
});

describe("real message sealing", () => {
  it("round-trips plaintext through HPKE via the session init key", async () => {
    const recipient = "https://example.org/users/bob";
    const kp = await generateKeyPackage(recipient);
    const objectId = "https://example.org/users/bob/keyPackages/latest";
    storeSessionInitKey(objectId, kp.session());

    const parsed = parseKeyPackageObject({ content: kp.content })!;
    const senderContext = encodeSenderContext(objectId);
    const envelope = await sealToKeyPackage("hola, mensaje cifrado", parsed, senderContext);

    // The envelope is an MLSMessage base64 payload, not the plaintext.
    expect(envelope).not.toContain("hola");
    expect(envelope.length).toBeGreaterThan(64);

    const opened = await openEnvelope(envelope);
    expect(opened).not.toBeNull();
    expect(opened!.plaintext).toBe("hola, mensaje cifrado");
  });

  it("fails to open when the key package is not registered in the session", async () => {
    const recipient = "https://example.org/users/carol";
    const kp = await generateKeyPackage(recipient);
    const parsed = parseKeyPackageObject({ content: kp.content })!;
    const envelope = await sealToKeyPackage("secreto", parsed, encodeSenderContext(recipient));
    expect(await openEnvelope(envelope)).toBeNull();
  });

  it("rejects envelopes sealed to a different key", async () => {
    const alice = await generateKeyPackage("https://example.org/users/alice");
    const bob = await generateKeyPackage("https://example.org/users/bob");
    const objectId = "https://example.org/users/alice/keyPackages/one";
    storeSessionInitKey(objectId, alice.session());

    const parsed = parseKeyPackageObject({ content: bob.content })!;
    const envelope = await sealToKeyPackage("secreto", parsed, encodeSenderContext(objectId));
    expect(await openEnvelope(envelope)).toBeNull();
  });
});