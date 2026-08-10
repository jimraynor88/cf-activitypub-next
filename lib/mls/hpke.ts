// RFC 9180 (HPKE) base mode over WebCrypto: DHKEM(P-256, HKDF-SHA256) with
// AES-128-GCM (kem_id 0x0010). These are the primitives behind RFC 9420 cipher
// suite 0x0002 (MLS_128_DHKEMP256_AES128GCM_SHA256_P256). No third-party crypto.
//
// Used here to encrypt the app payload to a recipient's KeyPackage init_key —
// SealBase/OpenBase as in RFC 9420 §5.1.3 EncryptWithLabel/DecryptWithLabel.

import { concat, encodeText, opaque, toBase64, fromBase64, type Bytes, toUint16, readOpaqueAt, readUint16At } from "./wire";
import { MLS10, WIRE_FORMAT_KEY_PACKAGE, WIRE_FORMAT_PRIVATE_MESSAGE } from "./wire";

const KEM_P256 = 0x0010;
const SUITE_ID = concat(encodeText("HPKE"), Uint8Array.from([(KEM_P256 >> 8) & 0xff, KEM_P256 & 0xff]));

async function hmacKey(raw: Bytes, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fresh(raw), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

function fresh(b: Bytes): ArrayBuffer {
  const out = new Uint8Array(b.length);
  out.set(b);
  return out.buffer;
}

// HKDF-Extract(salt, ikm) = HMAC-SHA256(salt, ikm)
async function hkdfExtract(salt: Bytes, ikm: Bytes): Promise<Bytes> {
  const key = await hmacKey(salt.length ? salt : new Uint8Array(32), ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, fresh(ikm)));
}

// HKDF-Expand(prk, info, L): HMAC chain with counter octets.
async function hkdfExpand(prk: Bytes, info: Bytes, length: number): Promise<Bytes> {
  let t: Bytes = new Uint8Array(0);
  let okm: Bytes = new Uint8Array(0);
  let counter = 1;
  while (okm.length < length) {
    const key = await hmacKey(prk, ["sign"]);
    const block = concat(t, info, Uint8Array.from([counter]));
    t = new Uint8Array(await crypto.subtle.sign("HMAC", key, fresh(block)));
    okm = concat(okm, t);
    counter++;
  }
  return okm.slice(0, length);
}

// RFC 9180 §6.1: LabeledExtract / LabeledExpand
function labeledIkm(label: string, ikm: Bytes): Bytes {
  return concat(encodeText("HPKE-v1"), SUITE_ID, encodeText(label), ikm);
}
function labeledInfo(label: string, info: Bytes, length: number): Bytes {
  return concat(Uint8Array.from([(length >> 8) & 0xff, length & 0xff]), encodeText("HPKE-v1"), SUITE_ID, encodeText(label), info);
}

async function labelExtract(salt: Bytes, label: string, ikm: Bytes): Promise<Bytes> {
  return hkdfExtract(salt, labeledIkm(label, ikm));
}
async function labelExpand(prk: Bytes, label: string, info: Bytes, length: number): Promise<Bytes> {
  return hkdfExpand(prk, labeledInfo(label, info, length), length);
}

// KeySchedule (base mode, psk="", psk_id="")
async function keySchedule(sharedSecret: Bytes, info: Bytes): Promise<{ key: Bytes; baseNonce: Bytes }> {
  const pskIdHash = await labelExtract(new Uint8Array(0), "psk_id_hash", new Uint8Array(0));
  const infoHash = await labelExtract(new Uint8Array(0), "info_hash", info);
  const context = concat(Uint8Array.from([0x00]), pskIdHash, infoHash); // mode_base = 0
  const secret = await labelExtract(sharedSecret, "secret", context);
  const key = await labelExpand(secret, "key", context, 16);
  const baseNonce = await labelExpand(secret, "base_nonce", context, 12);
  return { key, baseNonce };
}

async function aeadKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fresh(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function xorNonce(base: Bytes, seq: number): Bytes {
  const out = new Uint8Array(base.length);
  for (let i = 0; i < out.length; i++) out[i] = base[i]!;
  if (seq > 0) {
    let carry = seq;
    for (let i = out.length - 1; i >= 0 && carry > 0; i--) {
      out[i] = out[i]! ^ (carry & 0xff);
      carry = Math.floor(carry / 256);
    }
  }
  return out;
}

async function ecdhShared(sk: CryptoKey, pkRaw: Bytes): Promise<Bytes> {
  const pk = await crypto.subtle.importKey("raw", fresh(pkRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pk }, sk, 256));
}

// RFC 9180 §4.1 DHKEM(P-256, HKDF-SHA256) Encap
async function dhkemEncap(pkR: Bytes): Promise<{ sharedSecret: Bytes; enc: Bytes }> {
  const skE = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const enc = new Uint8Array(await crypto.subtle.exportKey("raw", skE.publicKey));
  const dh = await ecdhShared(skE.privateKey, pkR);
  const eaePrk = await labelExtract(new Uint8Array(0), "eae_prk", dh);
  const kemContext = concat(enc, pkR);
  const sharedSecret = await labelExtract(eaePrk, "shared_secret", kemContext);
  return { sharedSecret, enc };
}

// RFC 9180 §4.1 DHKEM(P-256, HKDF-SHA256) Decap
async function dhkemDecap(skR: CryptoKey, pkR: Bytes, enc: Bytes): Promise<Bytes> {
  const dh = await ecdhShared(skR, enc);
  const eaePrk = await labelExtract(new Uint8Array(0), "eae_prk", dh);
  const kemContext = concat(enc, pkR);
  return labelExtract(eaePrk, "shared_secret", kemContext);
}

export interface HpkeCiphertext {
  enc: Bytes;
  ciphertext: Bytes;
}

/** RFC 9180 SealBase(pkR, info, aad="", pt) */
export async function hpkeSealBase(pkR: Bytes, info: Bytes, plaintext: Bytes): Promise<HpkeCiphertext> {
  const { sharedSecret, enc } = await dhkemEncap(pkR);
  const { key, baseNonce } = await keySchedule(sharedSecret, info);
  const iv = xorNonce(baseNonce, 0);
  const k = await aeadKey(key);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: fresh(iv), additionalData: new Uint8Array(0) }, k, fresh(plaintext))
  );
  return { enc, ciphertext: ct };
}

/** RFC 9180 OpenBase(skR, pkR, info, aad="", enc, ct) */
export async function hpkeOpenBase(
  skR: CryptoKey,
  pkR: Bytes,
  info: Bytes,
  enc: Bytes,
  ciphertext: Bytes
): Promise<Bytes> {
  const sharedSecret = await dhkemDecap(skR, pkR, enc);
  const { key, baseNonce } = await keySchedule(sharedSecret, info);
  const iv = xorNonce(baseNonce, 0);
  const k = await aeadKey(key);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: fresh(iv), additionalData: new Uint8Array(0) }, k, fresh(ciphertext))
  );
}

// ─── MLSMessage framing helpers ──────────────────────────────────────────────

/**
 * Wrap a raw HPKE ciphertext (enc || ct) plus the sender context into an
 * MLSMessage carrying the payload that a recipient's KeyPackage can open.
 * The wire format is mls_private_message so a strict MLS client sees the
 * application-message container, while the body remains an opaque HPKE blob
 * (the MLS group-ratchet portion is the client's job).
 */
export function frameAppMessage(enc: Bytes, ciphertext: Bytes, senderContext: Bytes): string {
  const body = concat(opaque(enc), opaque(ciphertext), opaque(senderContext));
  return toBase64(concat(toUint16(MLS10), toUint16(WIRE_FORMAT_PRIVATE_MESSAGE), body));
}

export function unframeAppMessage(content: string): { enc: Bytes; ciphertext: Bytes; senderContext: Bytes } {
  const b = fromBase64(content);
  // MLSMessage: version + wire_format
  let p = 4;
  const readOpaque = (): { v: Bytes; next: number } => {
    const r = readOpaqueAt(b, p);
    return { v: r.value, next: r.next };
  };
  const e = readOpaque();
  p = e.next;
  const c = readOpaque();
  p = c.next;
  const s = readOpaque();
  return { enc: e.v, ciphertext: c.v, senderContext: s.v };
}

// Parse a published KeyPackage MLSMessage and return the raw HPKE init_key
// (P-256 UncompressedPointRepresentation, 65 bytes) plus the declared
// ciphersuite. Returns null for anything that is not a mls_key_package wire.
export interface ParsedKeyPackage {
  version: number;
  ciphersuite: number;
  initKey: Bytes;
}

export function parseKeyPackageMessage(content: string): ParsedKeyPackage | null {
  try {
    const b = fromBase64(content);
    // MLSMessage wrapper: { uint16 version; uint16 wire_format; ... }
    const wrapVersion = readUint16At(b, 0);
    const wire = readUint16At(b, wrapVersion.next);
    if (wire.value !== WIRE_FORMAT_KEY_PACKAGE) return null;
    // KeyPackage: { ProtocolVersion version; CipherSuite cipher_suite; opaque init_key<V>; ... }
    const kpVersion = readUint16At(b, wire.next);
    const suite = readUint16At(b, kpVersion.next);
    const initKey = readOpaqueAt(b, suite.next);
    return { version: wrapVersion.value, ciphersuite: suite.value, initKey: initKey.value };
  } catch {
    return null;
  }
}

// Parse an ActivityPub KeyPackage *object* payload: { content: "<base64 MLSMessage>", ... }
// Returns the raw init_key or null when the object has no MLS payload.
export function parseKeyPackageObject(obj: { content?: string | null }): ParsedKeyPackage | null {
  return obj?.content ? parseKeyPackageMessage(obj.content) : null;
}