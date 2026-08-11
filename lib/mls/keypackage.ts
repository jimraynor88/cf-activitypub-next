// RFC 9420 §10 KeyPackage generation using Web Crypto (P-256 suite,
// 0x0002 = MLS_128_DHKEMP256_AES128GCM_SHA256_P256). This is the suite used
// in the "activitypub-e2ee" draft examples and maps to ECDH/ECDSA P-256, both
// available in browsers via crypto.subtle — no third-party crypto needed.
//
// The generated KeyPackage is wrapped in an MLSMessage (wire_format
// mls_key_package) and returned base64-encoded, ready to publish as `content`
// on an ActivityPub Object of type "KeyPackage".
//
// In this reference UI the private keys are ephemeral (never leave the page):
// a real client would persist them alongside the KeyPackage so it can later
// decrypt messages addressed to this leaf.

import {
  CIPHERSUITE_P256,
  concat,
  CREDENTIAL_BASIC,
  encodeBasicCredential,
  encodeCapabilities,
  encodeExtension,
  encodeText,
  LEAF_SOURCE_KEY_PACKAGE,
  MLS10,
  opaque,
  toBase64,
  toUint16,
  toUint64,
  toUint8,
  vector,
  type Bytes,
  wrapMlsMessage,
} from "./wire";
import {
  frameAppMessage,
  hpkeOpenBase,
  hpkeSealBase,
  unframeAppMessage,
  parseKeyPackageObject,
  parseKeyPackageMessage,
  type ParsedKeyPackage,
} from "./hpke";

export const CIPHERSUITE_NAME = "MLS_128_DHKEMP256_AES128GCM_SHA256_P256";

// RFC 9420 §13.5 GREASE values. We pepper a few random ones through the
// capabilities and extension lists, as the RFC recommends, so that strict
// peers exercise their "ignore unknown / GREASE" code paths.
const GREASE_VALUES = [0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a];

function randomGrease(): number {
  return GREASE_VALUES[Math.floor(Math.random() * GREASE_VALUES.length)]!;
}

// RFC 9420 §5.1.2: ECDSA signatures are DER encoded (RFC 8446). WebCrypto
// returns IEEE-P1363 raw (r||s); convert to DER SEQUENCE of two INTEGERs.
function rawEcdsaToDer(raw: Bytes): Bytes {
  const parts: Bytes[] = [];
  for (const int of [raw.slice(0, 32), raw.slice(32, 64)]) {
    parts.push(encodeDerInteger(int));
  }
  const body = concat(...parts);
  return concat(toUint8(0x30), encodeDerLength(body.length), body);
}

function encodeDerLength(len: number): Bytes {
  if (len < 0x80) return Uint8Array.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

// DER INTEGER: unsigned big-endian, minimal bytes, 0x00 prefix if high bit set.
function encodeDerInteger(bytes: Bytes): Bytes {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  let value = bytes.slice(i);
  if (value.length === 0) value = Uint8Array.from([0]);
  const signByte = value[0]! & 0x80 ? Uint8Array.from([0]) : new Uint8Array(0);
  const content = concat(signByte, value);
  return concat(toUint8(0x02), encodeDerLength(content.length), content);
}

async function exportRawPublicKey(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

// RFC 9420 §5.1.2 SignWithLabel(SignatureKey, Label, Content) over the
// P-256 cipher suite's ECDSA-P-256-SHA256 signature scheme.
async function signWithLabel(key: CryptoKey, label: string, tbs: Bytes): Promise<Bytes> {
  const labelBytes = encodeText("MLS 1.0 " + label);
  const signContent = concat(opaque(labelBytes), opaque(tbs));
  const signBuffer = new Uint8Array(signContent.length);
  signBuffer.set(signContent);
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signBuffer)
  );
  return rawEcdsaToDer(raw);
}

function encodeLifetime(nowSec: bigint): Bytes {
  return concat(toUint64(BigInt(0)), toUint64(nowSec + BigInt(31536000)));
}

// RFC 9420 §17.5: P-256 public keys are UncompressedPointRepresentation,
// which is exactly what WebCrypto's "raw" ECDH/ECDSA export produces (65
// bytes: 0x04 || X || Y).
async function buildKeyPackage(identity: string): Promise<{ message: Bytes; initEcdh: CryptoKeyPair }> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  // Three ephemeral P-256 keypairs: HPKE init key, leaf encryption key and
  // the signing (credential) key. A real client persists these private keys.
  const signKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const initEcdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const leafEcdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);

  const initKey = await exportRawPublicKey(initEcdh.publicKey);
  const leafEncKey = await exportRawPublicKey(leafEcdh.publicKey);
  const sigKeyRaw = await exportRawPublicKey(signKeys.publicKey);

  // LeafNode capabilities (RFC 9420 §7.2), GREASE sprinkled per §13.5.
  const greaseExt = randomGrease();
  const capabilities = encodeCapabilities({
    versions: [MLS10],
    cipherSuites: [CIPHERSUITE_P256, randomGrease()],
    extensions: [greaseExt],
    proposals: [randomGrease()],
    credentials: [CREDENTIAL_BASIC, randomGrease()],
  });

  const credential = encodeBasicCredential(encodeText(identity));
  const lifetime = encodeLifetime(nowSec);

  // GREASE extension echoed in both KeyPackage.extensions and
  // LeafNode.extensions (must be reflected in capabilities.extensions).
  const greaseData = new Uint8Array(4);
  crypto.getRandomValues(greaseData);
  const greaseExtension = encodeExtension(greaseExt, greaseData);

  // LeafNodeTBS (RFC 9420 §7.2) then signed with label "LeafNodeTBS".
  const leafNodeTbs = concat(
    opaque(leafEncKey),
    opaque(sigKeyRaw),
    credential,
    capabilities,
    toUint8(LEAF_SOURCE_KEY_PACKAGE),
    lifetime,
    vector([greaseExtension])
  );
  const leafSignature = await signWithLabel(signKeys.privateKey, "LeafNodeTBS", leafNodeTbs);
  const leafNode = concat(leafNodeTbs, opaque(leafSignature));

  // KeyPackageTBS (RFC 9420 §10) then signed with label "KeyPackageTBS".
  const keyPackageTbs = concat(
    toUint16(MLS10),
    toUint16(CIPHERSUITE_P256),
    opaque(initKey),
    leafNode,
    vector([greaseExtension])
  );
  const keyPackageSignature = await signWithLabel(signKeys.privateKey, "KeyPackageTBS", keyPackageTbs);

  const keyPackage = concat(keyPackageTbs, opaque(keyPackageSignature));

  // MLSMessage wrapper: version(mls10) + wire_format(mls_key_package) + payload.
  return { message: wrapMlsMessage(keyPackage), initEcdh };
}

/** Key package generation entrypoint used by the E2EE UI. */
export async function generateKeyPackage(identity: string): Promise<{ ciphersuite: string; mediaType: string; encoding: string; content: string; session: () => CryptoKeyPair }> {
  const { message, initEcdh } = await buildKeyPackage(identity);
  return {
    ciphersuite: CIPHERSUITE_NAME,
    mediaType: "message/mls",
    encoding: "base64",
    content: toBase64(message),
    session: () => initEcdh,
  };
}

// ─── Session key store ──────────────────────────────────────────────────────
// The private init key is kept in the page's memory keyed by the KeyPackage
// objectId so a message sealed to that key package can be opened in the same
// browser. To survive reloads (and so messages keep showing their plaintext in
// the message list), the key pair is also mirrored into localStorage — the
// objectId already embeds the owning actor IRI, so keys never leak across
// accounts. A real client would use IndexedDB + a secure TS, but this mirrors
// the draft: the client must hold the private half of the init_key to open
// application messages sealed to its KeyPackage.

const sessionInitKeys = new Map<string, CryptoKeyPair>();
const STORAGE_PREFIX = "cf-ap-mls:session-init:v1:";

export function storeSessionInitKey(objectId: string, keypair: CryptoKeyPair): void {
  sessionInitKeys.set(objectId, keypair);
  void persistSessionInitKey(objectId, keypair);
}

export function getSessionInitKey(objectId: string): CryptoKeyPair | undefined {
  return sessionInitKeys.get(objectId);
}

/** Drop the in-memory and persisted copy of a key pair (e.g. on delete). */
export function forgetSessionInitKey(objectId: string): void {
  sessionInitKeys.delete(objectId);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_PREFIX + objectId);
  } catch {
    /* ignore */
  }
}

/** ObjectIds of every init key currently held by this browser (memory or store). */
export function listSessionInitKeys(): string[] {
  return Array.from(sessionInitKeys.keys());
}

async function persistSessionInitKey(objectId: string, keypair: CryptoKeyPair): Promise<void> {
  try {
    if (typeof localStorage === "undefined") return;
    const [publicJwk, privateJwk] = await Promise.all([
      crypto.subtle.exportKey("jwk", keypair.publicKey),
      crypto.subtle.exportKey("jwk", keypair.privateKey),
    ]);
    localStorage.setItem(STORAGE_PREFIX + objectId, JSON.stringify({ publicJwk, privateJwk }));
  } catch {
    /* non-fatal: the in-memory copy still decodes this page session */
  }
}

/** Restore the init key pairs this browser previously published. */
export async function hydrateSessionInitKeys(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const objectId = key.slice(STORAGE_PREFIX.length);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const { publicJwk, privateJwk } = JSON.parse(raw) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey };
      jobs.push(
        (async () => {
          const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
          const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
          sessionInitKeys.set(objectId, { publicKey, privateKey });
        })()
      );
    } catch {
      localStorage.removeItem(key);
    }
  }
  await Promise.all(jobs);
}

// ─── Cross-browser key backup / restore ─────────────────────────────────────
// The private init keys are what let a browser open messages sealed to its
// key packages. Exporting them to a file and importing that file in another
// browser lets the user encrypt/decrypt without staying on one device. The
// exported bundle carries the same JWK payload the keys are persisted with,
// so `importSessionInitKeys` round-trips with what the page already stores.

export interface SessionInitKeyBundle {
  format: "cf-ap-mls-session-init-keys";
  version: 1;
  exportedAt: string;
  keys: { objectId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey }[];
}

/** Serialize every session init key currently held by this browser. */
export async function exportSessionInitKeys(): Promise<SessionInitKeyBundle> {
  const keys: SessionInitKeyBundle["keys"] = [];
  for (const [objectId, keypair] of sessionInitKeys) {
    const [publicJwk, privateJwk] = await Promise.all([
      crypto.subtle.exportKey("jwk", keypair.publicKey),
      crypto.subtle.exportKey("jwk", keypair.privateKey),
    ]);
    keys.push({ objectId, publicJwk, privateJwk });
  }
  return { format: "cf-ap-mls-session-init-keys", version: 1, exportedAt: new Date().toISOString(), keys };
}

/**
 * Import a bundle previously exported from another browser. Each valid key is
 * imported into memory AND persisted to localStorage, so messages sealed to it
 * can be opened immediately and after reloads. Returns the number of keys
 * imported; throws when the payload is not a valid backup bundle.
 */
export async function importSessionInitKeys(bundle: unknown): Promise<number> {
  if (!bundle || typeof bundle !== "object") throw new Error("invalid bundle");
  const b = bundle as Partial<SessionInitKeyBundle>;
  if (b.format !== "cf-ap-mls-session-init-keys" || b.version !== 1 || !Array.isArray(b.keys)) {
    throw new Error("invalid bundle");
  }
  let count = 0;
  for (const item of b.keys) {
    if (!item || typeof item.objectId !== "string" || !item.publicJwk || !item.privateJwk) continue;
    try {
      const publicKey = await crypto.subtle.importKey("jwk", item.publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
      const privateKey = await crypto.subtle.importKey("jwk", item.privateJwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
      storeSessionInitKey(item.objectId, { publicKey, privateKey });
      count++;
    } catch {
      /* skip malformed entry */
    }
  }
  return count;
}

// ─── Real message sealing / opening ─────────────────────────────────────────
// "Send" encrypts the plaintext to the recipient's KeyPackage init_key with
// HPKE (RFC 9180) and wraps it as an MLSMessage. This is the same step a real
// MLS client runs (SealBase) before delivering the envelope; only the MLS group
// ratchet is out of scope for this reference UI.

const ENCRYPT_LABEL = "MLS 1.0 PrivateMessage";

/** Encrypt plaintext to a recipient KeyPackage object. */
export async function sealToKeyPackage(
  plaintext: string,
  recipientKeyPackage: ParsedKeyPackage,
  senderContext: Bytes
): Promise<string> {
  const info = encodeText(ENCRYPT_LABEL);
  const { enc, ciphertext } = await hpkeSealBase(recipientKeyPackage.initKey, info, encodeText(plaintext));
  return frameAppMessage(enc, ciphertext, senderContext);
}

/**
 * Attempt to open an MLSMessage envelope using a session init key matched by
 * the keyPackage objectId embedded in the sender context. Returns the
 * plaintext and context, or null when the key package was never registered in
 * this browser (e.g. published from another client) or parsing fails.
 */
export async function openEnvelope(content: string): Promise<{ plaintext: string; senderContext: Bytes } | null> {
  try {
    const { enc, ciphertext, senderContext } = unframeAppMessage(content);
    const keyPackageId = parseSenderContextKeyPackage(senderContext);
    const keypair = keyPackageId ? getSessionInitKey(keyPackageId) : undefined;
    if (!keypair) return null;
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey));
    const info = encodeText(ENCRYPT_LABEL);
    const plaintextBytes = await hpkeOpenBase(keypair.privateKey, publicRaw, info, enc, ciphertext);
    return { plaintext: new TextDecoder().decode(plaintextBytes), senderContext };
  } catch {
    return null;
  }
}

// The sender context is a small JSON blob `{ keyPackage: "<objectId>" }` so the
// recipient can find the matching session init key. Kept opaque on the wire.
export function encodeSenderContext(keyPackageId: string): Bytes {
  return encodeText(JSON.stringify({ keyPackage: keyPackageId }));
}

function parseSenderContextKeyPackage(senderContext: Bytes): string | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(senderContext)) as { keyPackage?: unknown };
    return typeof parsed.keyPackage === "string" ? parsed.keyPackage : null;
  } catch {
    return null;
  }
}

// Re-export so the UI can extract a recipient's init_key from a KeyPackage object.
export { parseKeyPackageObject, parseKeyPackageMessage };
export type { ParsedKeyPackage };