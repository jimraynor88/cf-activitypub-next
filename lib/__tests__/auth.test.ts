import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LocalActor } from "@/lib/types";

// Mock crypto for auth tests
const mockCrypto = {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
    return arr;
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue("key-material"),
    deriveBits: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab)),
  },
};

beforeEach(() => {
  vi.stubGlobal("crypto", mockCrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Re-import after stubbing crypto
async function getAuthModule() {
  return await import("@/lib/auth");
}

describe("extractBearerToken", () => {
  it("extracts token from Authorization header", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer my-token" },
    });
    expect(extractBearerToken(request)).toBe("my-token");
  });

  it("returns null when no Authorization header", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com");
    expect(extractBearerToken(request)).toBeNull();
  });

  it("extracts token from auth_token cookie", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com", {
      headers: { Cookie: "auth_token=cookie-token; other=val" },
    });
    expect(extractBearerToken(request)).toBe("cookie-token");
  });

  it("Bearer takes precedence over cookie", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer bear-token",
        Cookie: "auth_token=cookie-token",
      },
    });
    expect(extractBearerToken(request)).toBe("bear-token");
  });

  it("handles Bearer with extra whitespace", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer  spaced-token  " },
    });
    expect(extractBearerToken(request)).toBe("spaced-token");
  });

  it("rejects malformed Authorization header", async () => {
    const { extractBearerToken } = await getAuthModule();
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(request)).toBeNull();
  });
});

describe("setAuthCookie", () => {
  it("returns a Set-Cookie header string", async () => {
    const { setAuthCookie } = await getAuthModule();
    const cookie = setAuthCookie("my-token");
    expect(cookie).toContain("auth_token=my-token");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=");
  });

  it("encodes the token value", async () => {
    const { setAuthCookie } = await getAuthModule();
    const cookie = setAuthCookie("token with spaces");
    expect(cookie).toContain("auth_token=token%20with%20spaces");
  });
});

describe("clearAuthCookie", () => {
  it("returns a cookie with Max-Age=0", async () => {
    const { clearAuthCookie } = await getAuthModule();
    const cookie = clearAuthCookie();
    expect(cookie).toContain("auth_token=");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("requireAuth", () => {
  it("returns null when actor exists", async () => {
    const { requireAuth } = await getAuthModule();
    const actor = { id: "1", username: "test", displayName: null, createdAt: "", role: "user" } as unknown as LocalActor;
    expect(requireAuth(actor)).toBeNull();
  });

  it("returns 401 Response when actor is null", async () => {
    const { requireAuth } = await getAuthModule();
    const res = requireAuth(null);
    expect(res?.status).toBe(401);
    expect(res?.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("generateSecureToken", () => {
  it("generates a 64-character hex token", async () => {
    const { generateSecureToken } = await getAuthModule();
    const token = generateSecureToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("produces a pbkdf2-hashed string", async () => {
    const { hashPassword } = await getAuthModule();
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("pbkdf2:")).toBe(true);
    const parts = hash.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[1]).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("verifyPassword returns true for matching password", async () => {
    const { hashPassword, verifyPassword } = await getAuthModule();
    const hash = await hashPassword("hunter2");
    const result = await verifyPassword("hunter2", hash);
    expect(result).toBe(true);
  });

  it("verifyPassword returns false for wrong password", async () => {
    const { hashPassword, verifyPassword } = await getAuthModule();
    const hash = await hashPassword("hunter2");
    // Override deriveBits to return a different value so wrong password fails
    mockCrypto.subtle.deriveBits.mockResolvedValueOnce(new Uint8Array(32).fill(0xcd));
    const result = await verifyPassword("wrong", hash);
    expect(result).toBe(false);
  });

  it("verifyPassword returns false for unknown algorithm", async () => {
    const { verifyPassword } = await getAuthModule();
    const result = await verifyPassword("hunter2", "bcrypt:...");
    expect(result).toBe(false);
  });
});
