import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getToken, apiFetch } from "@/lib/client-api";

beforeEach(() => {
  vi.stubGlobal("document", { cookie: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("getToken", () => {
  it("returns null when no cookie or localStorage token exists", () => {
    expect(getToken()).toBeNull();
  });

  it("returns token from auth_token cookie", () => {
    Object.defineProperty(document, "cookie", {
      value: "auth_token=abc123; other=value",
      configurable: true,
    });
    expect(getToken()).toBe("abc123");
  });

  it("decodes URI-encoded token from cookie", () => {
    Object.defineProperty(document, "cookie", {
      value: "auth_token=abc%20123",
      configurable: true,
    });
    expect(getToken()).toBe("abc 123");
  });

  it("reads token from localStorage and migrates to cookie", () => {
    localStorage.setItem("access_token", "migrated-token");
    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      configurable: true,
    });
    const token = getToken();
    expect(token).toBe("migrated-token");
    expect(localStorage.getItem("access_token")).toBeNull();
  });
});

describe("apiFetch", () => {
  it("calls fetch with credentials include", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", mockFetch);

    await apiFetch("/api/test");
    expect(mockFetch).toHaveBeenCalledWith("/api/test", { credentials: "include" });
  });

  it("merges custom options", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", mockFetch);

    await apiFetch("/api/test", { method: "POST", body: "hello" });
    expect(mockFetch).toHaveBeenCalledWith("/api/test", {
      method: "POST",
      body: "hello",
      credentials: "include",
    });
  });
});
