// RFC 9420 (MLS) wire serialization helpers. These are pure encoding
// primitives, implemented from the RFC so the KeyPackage we emit can be
// ingested by a real MLS library. No third-party crypto is required.

export type Bytes = Uint8Array;

export const MLS10 = 1; // ProtocolVersion: mls10
export const CIPHERSUITE_P256 = 0x0002; // MLS_128_DHKEMP256_AES128GCM_SHA256_P256
export const WIRE_FORMAT_KEY_PACKAGE = 0x0005; // mls_key_package
export const CREDENTIAL_BASIC = 0x0001;
export const LEAF_SOURCE_KEY_PACKAGE = 0x01;

// Section 2.1.2 / Section 17.1: variable-size integer vector lengths
// (minimum encoding; prefixes 00=1B, 01=2B, 10=4B).
export function writeVarint(value: number): Bytes {
  if (value < 64) return Uint8Array.from([value]);
  if (value < 16384) return Uint8Array.from([0x40 | ((value >> 8) & 0x3f), value & 0xff]);
  if (value < 1073741824) {
    return Uint8Array.from([0x80 | ((value >> 24) & 0x3f), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  }
  throw new Error("vector too large");
}

// opaque<V>: length-prefixed bytes
export function opaque(data: Bytes): Bytes {
  return concat(writeVarint(data.length), data);
}

// vector<V>: length-prefixed sequence of encoded elements
export function vector(elements: Bytes[]): Bytes {
  const body = concat(...elements);
  return concat(writeVarint(body.length), body);
}

export function toUint16(value: number): Bytes {
  return Uint8Array.from([(value >> 8) & 0xff, value & 0xff]);
}

export function toUint8(value: number): Bytes {
  return Uint8Array.from([value & 0xff]);
}

export function toUint64(value: bigint): Bytes {
  const out = new Uint8Array(8);
  const mask = BigInt(0xff);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & mask);
    v = v >> BigInt(8);
  }
  return out;
}

export function concat(...parts: Bytes[]): Bytes {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function encodeText(text: string): Bytes {
  return new TextEncoder().encode(text);
}

export function toBase64(bytes: Bytes): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Bytes {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// RFC 9420 §5.3: basic credential = { uint16 credential_type=1; opaque identity<V> }
export function encodeBasicCredential(identity: Bytes): Bytes {
  return concat(toUint16(CREDENTIAL_BASIC), opaque(identity));
}

// RFC 9420 §7.2: Capabilities = five uint16 vectors
export function encodeCapabilities(opts: {
  versions: number[];
  cipherSuites: number[];
  extensions: number[];
  proposals: number[];
  credentials: number[];
}): Bytes {
  const u16vec = (vals: number[]) => vector(vals.map(toUint16));
  return concat(
    u16vec(opts.versions),
    u16vec(opts.cipherSuites),
    u16vec(opts.extensions),
    u16vec(opts.proposals),
    u16vec(opts.credentials)
  );
}

// RFC 9420 §17: Extension = { uint16 extension_type; opaque extension_data<V> }
export function encodeExtension(type: number, data: Bytes): Bytes {
  return concat(toUint16(type), opaque(data));
}

// RFC 9420 §10: MLSMessage wrapper. KeyPackage is carried with
// wire_format 0x0005 (mls_key_package).
export function wrapMlsMessage(keyPackageBytes: Bytes): Bytes {
  return concat(toUint16(MLS10), toUint16(WIRE_FORMAT_KEY_PACKAGE), keyPackageBytes);
}