import { describe, expect, it, vi } from "vitest";

import { handleRequest, parseVerificationRequest, validatePublicUrl } from "../src/app";

const CLIENT_ID = "12345678-1234-4123-8123-123456789abc";
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function makeEnv(
  quickAction: (action: string, payload: unknown) => Promise<Response>,
  limit = vi.fn(async () => ({ success: true })),
) {
  return {
    BROWSER: { quickAction },
    VERIFY_RATE_LIMITER: { limit },
  };
}

function makeRequest(body: Record<string, unknown>, clientId = CLIENT_ID) {
  return new Request("https://verifier.example/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WinTest-Client-Id": clientId,
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  targetUrl: "https://example.com/dashboard",
  webhookUrl: "",
  webhookToken: "",
  label: "Phone QA",
  width: 390,
  height: 844,
  zoom: 1,
  deviceScaleFactor: 1,
};

describe("request validation", () => {
  it("normalizes public URLs and viewport data", () => {
    expect(parseVerificationRequest(validBody)).toEqual({
      targetUrl: "https://example.com/dashboard",
      webhookUrl: null,
      webhookToken: null,
      label: "Phone QA",
      width: 390,
      height: 844,
      zoom: 1,
      deviceScaleFactor: 1,
    });
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://192.168.1.2",
    "http://[::1]",
  ])("rejects a non-public target: %s", (url) => {
    expect(() => validatePublicUrl(url, "Target URL")).toThrow("Target URL is the page to screenshot");
  });

  it("rejects non-HTTP target protocols", () => {
    expect(() => validatePublicUrl("file:///tmp/app.html", "Target URL")).toThrow("HTTP or HTTPS");
  });

  it("requires HTTPS for customer webhooks", () => {
    expect(() => parseVerificationRequest({ ...validBody, webhookUrl: "http://hooks.example.com/capture" })).toThrow(
      "Webhook URL must use HTTPS",
    );
  });

  it("rejects oversized high-DPR PNG output", () => {
    expect(() =>
      parseVerificationRequest({ ...validBody, width: 3000, deviceScaleFactor: 3 }),
    ).toThrow("PNG output must be no larger than 7680 pixels");
  });
});

describe("verification endpoint", () => {
  it("requires an anonymous installation ID", async () => {
    const response = await handleRequest(
      makeRequest(validBody, ""),
      makeEnv(vi.fn()),
      { fetch: vi.fn(), now: () => new Date(0), randomUUID: () => "verify-1" },
    );

    expect(response.status).toBe(400);
  });

  it("enforces the free per-install rate limit before rendering", async () => {
    const quickAction = vi.fn();
    const limiter = vi.fn(async () => ({ success: false }));
    const response = await handleRequest(
      makeRequest(validBody),
      makeEnv(quickAction, limiter),
      { fetch: vi.fn(), now: () => new Date(0), randomUUID: () => "verify-1" },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(limiter).toHaveBeenCalledWith({ key: CLIENT_ID });
    expect(quickAction).not.toHaveBeenCalled();
  });

  it("returns the exact viewport screenshot", async () => {
    const quickAction = vi.fn(async () => new Response(PNG_BYTES, { headers: { "Content-Type": "image/png" } }));
    const response = await handleRequest(
      makeRequest(validBody),
      makeEnv(quickAction),
      { fetch: vi.fn(), now: () => new Date("2026-08-20T12:00:00Z"), randomUUID: () => "verify-1" },
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
    expect(response.headers.get("X-WinTest-Webhook-Status")).toBe("skipped");
    expect(response.headers.get("X-WinTest-Output-Width")).toBe("390");
    expect(quickAction).toHaveBeenCalledWith(
      "screenshot",
      expect.objectContaining({ viewport: expect.objectContaining({ width: 390, height: 844 }) }),
    );
  });

  it("sends the PNG and metadata to the customer webhook", async () => {
    const quickAction = vi.fn(async () => new Response(PNG_BYTES, { headers: { "Content-Type": "image/png" } }));
    const webhookFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toBeInstanceOf(Headers);
      const headers = init?.headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer customer-secret");
      expect(headers.get("X-WinTest-Viewport-Width")).toBe("390");
      expect(headers.get("X-WinTest-Device-Pixel-Ratio")).toBe("1");
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(PNG_BYTES);
      return new Response(null, { status: 204 });
    });

    const response = await handleRequest(
      makeRequest({
        ...validBody,
        webhookUrl: "https://hooks.example.com/capture",
        webhookToken: "customer-secret",
      }),
      makeEnv(quickAction),
      { fetch: webhookFetch, now: () => new Date("2026-08-20T12:00:00Z"), randomUUID: () => "verify-2" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WinTest-Webhook-Status")).toBe("delivered");
    expect(response.headers.get("X-WinTest-Webhook-Response")).toBe("204");
    expect(webhookFetch).toHaveBeenCalledOnce();
  });

  it("uploads screenshots to Discord as a multipart file attachment", async () => {
    const quickAction = vi.fn(async () => new Response(PNG_BYTES, { headers: { "Content-Type": "image/png" } }));
    const webhookFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("discord.com");
      expect(url.searchParams.get("wait")).toBe("true");
      expect(new Headers(init?.headers).get("User-Agent")).toContain("DavidKozdra/WinTest");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(init?.body).toBeInstanceOf(FormData);

      const form = init?.body as FormData;
      const payload = JSON.parse(String(form.get("payload_json")));
      expect(payload.content).toContain("390×844 CSS");
      expect(payload.allowed_mentions).toEqual({ parse: [] });
      const file = form.get("files[0]");
      expect(file).toBeInstanceOf(Blob);
      expect(new Uint8Array(await (file as Blob).arrayBuffer())).toEqual(PNG_BYTES);
      return new Response(null, { status: 204 });
    });

    const response = await handleRequest(
      makeRequest({
        ...validBody,
        webhookUrl: "https://discord.com/api/webhooks/123456789/example_webhook_token",
        webhookToken: "must-not-be-forwarded-to-discord",
      }),
      makeEnv(quickAction),
      { fetch: webhookFetch, now: () => new Date("2026-08-20T12:00:00Z"), randomUUID: () => "verify-discord" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WinTest-Webhook-Status")).toBe("delivered");
    expect(webhookFetch).toHaveBeenCalledOnce();
  });

  it("returns the screenshot while reporting a webhook failure", async () => {
    const response = await handleRequest(
      makeRequest({ ...validBody, webhookUrl: "https://hooks.example.com/capture" }),
      makeEnv(async () => new Response(PNG_BYTES, { headers: { "Content-Type": "image/png" } })),
      {
        fetch: vi.fn(async () => new Response("unavailable", { status: 503 })),
        now: () => new Date(0),
        randomUUID: () => "verify-3",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-WinTest-Webhook-Status")).toBe("failed");
    expect(response.headers.get("X-WinTest-Webhook-Response")).toBe("503");
  });
});
