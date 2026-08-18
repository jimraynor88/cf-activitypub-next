import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyTurnstileToken } from "@/lib/turnstile";

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  throwNetwork?: boolean;
}) {
  const fn = vi.fn<typeof fetch>(async () => {
    if (response.throwNetwork) throw new Error("network down");
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const SECRET = "0xsecretsecretsecretsecret";

describe("verifyTurnstileToken", () => {
  it("rejects when no token is provided", async () => {
    const res = await verifyTurnstileToken(null, { secret: SECRET });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["missing-input-response"]);
  });

  it("rejects tokens longer than 2048 chars", async () => {
    const res = await verifyTurnstileToken("a".repeat(2049), { secret: SECRET });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["invalid-input-response"]);
  });

  it("returns success and passes secret/response/remoteip params", async () => {
    const fetchFn = mockFetch({
      json: { success: true, hostname: "example.com", action: "login", challenge_ts: "2026-01-01T00:00:00Z" },
    });
    const res = await verifyTurnstileToken("token-abc", {
      secret: SECRET,
      remoteIp: "203.0.113.7",
    });
    expect(res.success).toBe(true);
    expect(res.hostname).toBe("example.com");
    expect(res.action).toBe("login");
    const body = fetchFn.mock.calls[0][1]?.body as string;
    expect(body).toContain("secret=0xsecretsecretsecretsecret");
    expect(body).toContain("response=token-abc");
    expect(body).toContain("remoteip=203.0.113.7");
  });

  it("propagates error-codes from the API", async () => {
    mockFetch({
      json: { success: false, "error-codes": ["timeout-or-duplicate"] },
    });
    const res = await verifyTurnstileToken("token-abc", { secret: SECRET });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("rejects when the hostname does not match the expected one", async () => {
    mockFetch({ json: { success: true, hostname: "evil.com", action: "login" } });
    const res = await verifyTurnstileToken("token-abc", {
      secret: SECRET,
      expectedHostname: "example.com",
    });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["hostname-mismatch"]);
  });

  it("rejects when the action does not match the expected one", async () => {
    mockFetch({ json: { success: true, hostname: "example.com", action: "register" } });
    const res = await verifyTurnstileToken("token-abc", {
      secret: SECRET,
      expectedAction: "login",
    });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["action-mismatch"]);
  });

  it("accepts when both hostname and action match", async () => {
    mockFetch({
      json: { success: true, hostname: "example.com", action: "register", challenge_ts: "2026-01-01T00:00:00Z" },
    });
    const res = await verifyTurnstileToken("token-abc", {
      secret: SECRET,
      expectedHostname: "example.com",
      expectedAction: "register",
    });
    expect(res.success).toBe(true);
  });

  it("returns internal-error on transport failure", async () => {
    mockFetch({ throwNetwork: true });
    const res = await verifyTurnstileToken("token-abc", { secret: SECRET });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["internal-error"]);
  });

  it("returns bad-request on 4xx responses", async () => {
    mockFetch({ ok: false, status: 400, json: {} });
    const res = await verifyTurnstileToken("token-abc", { secret: SECRET });
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["bad-request"]);
  });

  it("times out and returns internal-error when Siteverify hangs", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>((_url, _opts) =>
      new Promise<Response>((_resolve, reject) => {
        // Hold the promise open; the AbortController timer must reject it.
        _opts?.signal?.addEventListener?.("abort", () => reject(new Error("aborted")));
      })
    );
    vi.stubGlobal("fetch", fetchFn);

    const promise = verifyTurnstileToken("token-abc", { secret: SECRET, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const res = await promise;
    expect(res.success).toBe(false);
    expect(res.errorCodes).toEqual(["internal-error"]);
  });

  it("retries once on transport failure when an idempotency key is set", async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => { throw new Error("network down"); })
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, hostname: "example.com", action: "login" }),
      }) as unknown as Response);
    vi.stubGlobal("fetch", fetchFn);

    const res = await verifyTurnstileToken("token-abc", {
      secret: SECRET,
      idempotencyKey: "uuid-1234",
    });
    expect(res.success).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const bodies = fetchFn.mock.calls.map((c) => c[1]?.body as string);
    expect(bodies[0]).toContain("idempotency_key=uuid-1234");
    expect(bodies[1]).toContain("idempotency_key=uuid-1234");
  });
});