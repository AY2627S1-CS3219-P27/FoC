import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function stubResponse(status: number, headers: Record<string, string> = {}) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status, headers })));
}

describe("api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports how long a rate-limited caller must wait", async () => {
    stubResponse(429, { "Retry-After": "37" });

    expect((await api("POST", "/api/x")).retryAfterSeconds).toBe(37);
  });

  it.each([
    ["is missing", {}],
    ["is not a number of seconds", { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }],
  ])("leaves the wait undefined when the header %s", async (_name, headers) => {
    stubResponse(429, headers);

    expect((await api("POST", "/api/x")).retryAfterSeconds).toBeUndefined();
  });
});
