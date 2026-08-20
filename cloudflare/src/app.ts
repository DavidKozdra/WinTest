const MIN_VIEWPORT = 100;
const MAX_VIEWPORT = 7680;
const MAX_OUTPUT_DIMENSION = 7680;
const MAX_DELAY_SECONDS = 60;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_LABEL_LENGTH = 120;
const MAX_TOKEN_LENGTH = 2048;
const MAX_URL_LENGTH = 4096;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type, X-WinTest-Client-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "Retry-After, X-Browser-Ms-Used, X-WinTest-Verification-Id, X-WinTest-Captured-At, X-WinTest-Webhook-Status, X-WinTest-Webhook-Response, X-WinTest-Device-Pixel-Ratio, X-WinTest-Output-Width, X-WinTest-Output-Height",
  "Access-Control-Max-Age": "86400",
};

type AppEnv = {
  BROWSER: Pick<Env["BROWSER"], "quickAction">;
  VERIFY_RATE_LIMITER: Pick<Env["VERIFY_RATE_LIMITER"], "limit">;
};

type RuntimeDependencies = {
  fetch: typeof fetch;
  now: () => Date;
  randomUUID: () => string;
};

type VerificationRequest = {
  targetUrl: string;
  webhookUrl: string | null;
  webhookToken: string | null;
  label: string;
  width: number;
  height: number;
  zoom: number;
  deviceScaleFactor: number;
  delaySeconds: number;
};

export const DEFAULT_DEPENDENCIES: RuntimeDependencies = {
  fetch,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
};

export async function handleRequest(
  request: Request,
  env: AppEnv,
  dependencies: RuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<Response> {
  const requestUrl = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    return jsonResponse({ ok: true, service: "wintest-verifier" });
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/verify") {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const clientId = readClientId(request.headers.get("X-WinTest-Client-Id"));
  if (!clientId) {
    return jsonResponse({ error: "A valid WinTest installation ID is required" }, 400);
  }

  try {
    const rateLimit = await env.VERIFY_RATE_LIMITER.limit({ key: clientId });
    if (!rateLimit.success) {
      const response = jsonResponse({ error: "Free verification limit reached. Try again in one minute." }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "verification rate limiter failed", error: getErrorMessage(error) }));
    return jsonResponse({ error: "Verification service is temporarily unavailable" }, 503);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body is too large" }, 413);
  }

  let verification: VerificationRequest;
  try {
    verification = parseVerificationRequest(await request.json());
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 400);
  }

  const verificationId = dependencies.randomUUID();

  try {
    const screenshot = await env.BROWSER.quickAction("screenshot", {
      url: verification.targetUrl,
      viewport: {
        width: verification.width,
        height: verification.height,
        deviceScaleFactor: verification.deviceScaleFactor,
        hasTouch: false,
        isLandscape: verification.width > verification.height,
        isMobile: false,
      },
      screenshotOptions: {
        type: "png",
        fullPage: false,
        captureBeyondViewport: false,
      },
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 45_000,
      },
      waitForTimeout: verification.delaySeconds ? verification.delaySeconds * 1000 : undefined,
      actionTimeout: 60_000,
      bestAttempt: true,
      addStyleTag:
        verification.zoom === 1
          ? undefined
          : [{ content: `html { zoom: ${verification.zoom}; }` }],
    });

    if (!screenshot.ok || !screenshot.body) {
      const upstreamMessage = await readBoundedError(screenshot);
      console.error(
        JSON.stringify({
          message: "Browser Run screenshot failed",
          status: screenshot.status,
          verificationId,
        }),
      );
      return jsonResponse(
        { error: upstreamMessage || "Cloudflare could not capture the page" },
        screenshot.status === 429 ? 429 : 502,
      );
    }

    const capturedAt = dependencies.now().toISOString();
    const webhookResult = verification.webhookUrl
      ? await deliverWebhook(
          dependencies.fetch,
          screenshot.clone(),
          verification,
          verificationId,
          capturedAt,
        )
      : { status: "skipped", responseStatus: "" };

    console.log(
      JSON.stringify({
        message: "verification captured",
        targetHost: new URL(verification.targetUrl).hostname,
        verificationId,
        viewport: `${verification.width}x${verification.height}`,
        delaySeconds: verification.delaySeconds,
        webhookStatus: webhookResult.status,
      }),
    );

    const headers = new Headers(CORS_HEADERS);
    headers.set("Cache-Control", "no-store");
    headers.set("Content-Disposition", `inline; filename="wintest-${verification.width}x${verification.height}.png"`);
    headers.set("Content-Type", screenshot.headers.get("Content-Type") || "image/png");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-WinTest-Captured-At", capturedAt);
    const browserTimeUsed = screenshot.headers.get("X-Browser-Ms-Used");
    if (browserTimeUsed) headers.set("X-Browser-Ms-Used", browserTimeUsed);
    headers.set("X-WinTest-Device-Pixel-Ratio", String(verification.deviceScaleFactor));
    headers.set("X-WinTest-Output-Height", String(Math.round(verification.height * verification.deviceScaleFactor)));
    headers.set("X-WinTest-Output-Width", String(Math.round(verification.width * verification.deviceScaleFactor)));
    headers.set("X-WinTest-Verification-Id", verificationId);
    headers.set("X-WinTest-Webhook-Response", webhookResult.responseStatus);
    headers.set("X-WinTest-Webhook-Status", webhookResult.status);

    return new Response(screenshot.body, { status: 200, headers });
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "verification failed",
        error: getErrorMessage(error),
        verificationId,
      }),
    );
    return jsonResponse({ error: "Verification failed while rendering the page" }, 502);
  }
}

async function deliverWebhook(
  fetchImplementation: typeof fetch,
  screenshot: Response,
  verification: VerificationRequest,
  verificationId: string,
  capturedAt: string,
): Promise<{ status: "delivered" | "failed"; responseStatus: string }> {
  if (isDiscordWebhook(verification.webhookUrl!)) {
    return deliverDiscordWebhook(fetchImplementation, screenshot, verification, verificationId, capturedAt);
  }

  const headers = new Headers({
    "Content-Type": screenshot.headers.get("Content-Type") || "image/png",
    "User-Agent": "WinTest-Verification/1.0",
    "X-WinTest-Captured-At": capturedAt,
    "X-WinTest-Device-Pixel-Ratio": String(verification.deviceScaleFactor),
    "X-WinTest-Label": encodeURIComponent(verification.label),
    "X-WinTest-Target-Url": encodeURIComponent(verification.targetUrl),
    "X-WinTest-Verification-Id": verificationId,
    "X-WinTest-Viewport-Height": String(verification.height),
    "X-WinTest-Viewport-Width": String(verification.width),
    "X-WinTest-Output-Height": String(Math.round(verification.height * verification.deviceScaleFactor)),
    "X-WinTest-Output-Width": String(Math.round(verification.width * verification.deviceScaleFactor)),
    "X-WinTest-Zoom": String(verification.zoom),
  });

  if (verification.webhookToken) {
    headers.set("Authorization", `Bearer ${verification.webhookToken}`);
  }

  try {
    const response = await fetchImplementation(verification.webhookUrl!, {
      method: "POST",
      headers,
      body: screenshot.body,
      redirect: "error",
    });
    if (response.body) await response.body.cancel();
    return {
      status: response.ok ? "delivered" : "failed",
      responseStatus: String(response.status),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "customer webhook delivery failed",
        error: getErrorMessage(error),
        verificationId,
      }),
    );
    return { status: "failed", responseStatus: "network-error" };
  }
}

async function deliverDiscordWebhook(
  fetchImplementation: typeof fetch,
  screenshot: Response,
  verification: VerificationRequest,
  verificationId: string,
  capturedAt: string,
): Promise<{ status: "delivered" | "failed"; responseStatus: string }> {
  const filename = `wintest-${verification.width}x${verification.height}.png`;
  const targetHost = new URL(verification.targetUrl).hostname;
  const payload = {
    content:
      `**WinTest external verification** — ${verification.label}\n` +
      `${verification.width}×${verification.height} CSS · DPR ${verification.deviceScaleFactor} · ` +
      `${Math.round(verification.width * verification.deviceScaleFactor)}×${Math.round(verification.height * verification.deviceScaleFactor)} PNG\n` +
      `Target: ${targetHost}`,
    allowed_mentions: { parse: [] },
    attachments: [{ id: 0, filename, description: `WinTest capture ${verificationId} at ${capturedAt}` }],
    embeds: [{ image: { url: `attachment://${filename}` } }],
  };
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", await screenshot.blob(), filename);

  const discordUrl = new URL(verification.webhookUrl!);
  if (discordUrl.hostname === "discordapp.com") discordUrl.hostname = "discord.com";
  discordUrl.searchParams.set("wait", "true");

  try {
    const response = await fetchImplementation(discordUrl, {
      method: "POST",
      headers: { "User-Agent": "DiscordBot (https://github.com/DavidKozdra/WinTest, 2.0.0)" },
      body: form,
      redirect: "error",
    });
    if (response.body) await response.body.cancel();
    return {
      status: response.ok ? "delivered" : "failed",
      responseStatus: String(response.status),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "Discord webhook delivery failed",
        error: getErrorMessage(error),
        verificationId,
      }),
    );
    return { status: "failed", responseStatus: "network-error" };
  }
}

function isDiscordWebhook(value: string): boolean {
  const url = new URL(value);
  const discordHost = url.hostname === "discord.com" || url.hostname.endsWith(".discord.com") || url.hostname === "discordapp.com";
  return discordHost && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+/.test(url.pathname);
}

export function parseVerificationRequest(value: unknown): VerificationRequest {
  if (!isRecord(value)) throw new Error("Request body must be a JSON object");

  const targetUrl = validatePublicUrl(value.targetUrl, "Target URL");
  const webhookUrl =
    typeof value.webhookUrl === "string" && value.webhookUrl.trim()
      ? validatePublicUrl(value.webhookUrl, "Webhook URL", true)
      : null;
  const webhookToken = readOptionalString(value.webhookToken, "Webhook token", MAX_TOKEN_LENGTH);
  const label = readOptionalString(value.label, "Label", MAX_LABEL_LENGTH) || "External verification";
  const width = readViewportDimension(value.width, "Width");
  const height = readViewportDimension(value.height, "Height");
  const zoom = readZoom(value.zoom);
  const deviceScaleFactor = readDeviceScaleFactor(value.deviceScaleFactor);
  const delaySeconds = readDelaySeconds(value.delaySeconds);

  if (
    Math.round(width * deviceScaleFactor) > MAX_OUTPUT_DIMENSION ||
    Math.round(height * deviceScaleFactor) > MAX_OUTPUT_DIMENSION
  ) {
    throw new Error(`PNG output must be no larger than ${MAX_OUTPUT_DIMENSION} pixels on either axis`);
  }

  return { targetUrl, webhookUrl, webhookToken, label, width, height, zoom, deviceScaleFactor, delaySeconds };
}

export function validatePublicUrl(value: unknown, label: string, requireHttps = false): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_URL_LENGTH) {
    throw new Error(`${label} must be a valid URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  if (parsed.username || parsed.password) throw new Error(`${label} cannot contain credentials`);
  if (requireHttps ? parsed.protocol !== "https:" : !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use ${requireHttps ? "HTTPS" : "HTTP or HTTPS"}`);
  }
  if (isPrivateHostname(parsed.hostname)) {
    if (label === "Target URL") {
      throw new Error("Target URL is the page to screenshot and must be publicly reachable; use a public deployment or tunnel for localhost/private pages");
    }
    throw new Error(`${label} must use a public hostname`);
  }

  return parsed.href;
}

function readViewportDimension(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number`);
  }
  if (value < MIN_VIEWPORT || value > MAX_VIEWPORT) {
    throw new Error(`${label} must be between ${MIN_VIEWPORT} and ${MAX_VIEWPORT} pixels`);
  }
  return value;
}

function readZoom(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 5) {
    throw new Error("Zoom must be between 0.25 and 5");
  }
  return Math.round(value * 100) / 100;
}

function readDeviceScaleFactor(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 4) {
    throw new Error("Device pixel ratio must be between 0.5 and 4");
  }
  return Math.round(value * 100) / 100;
}

function readDelaySeconds(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_DELAY_SECONDS) {
    throw new Error(`Capture delay must be a whole number between 0 and ${MAX_DELAY_SECONDS} seconds`);
  }
  return value;
}

function readOptionalString(value: unknown, label: string, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) throw new Error(`${label} is too long`);
  return trimmed || null;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    return true;
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(host)) return true;
    const mappedIpv4 = host.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host);
  return !host.includes(".");
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function readClientId(value: string | null): string | null {
  const clientId = value?.trim().toLowerCase() || "";
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedError(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return "";
  const text = await response.text();
  return text.slice(0, 500);
}

function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
