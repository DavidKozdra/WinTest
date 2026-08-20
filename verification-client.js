(function exposeVerificationClient(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WinTestVerification = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MIN_SIZE = 100;
  const MAX_SIZE = 7680;
  const MAX_OUTPUT_SIZE = 7680;
  const MAX_DELAY_SECONDS = 60;

  function normaliseWebhookUrl(value) {
    if (!String(value || "").trim()) return "";
    const parsed = parseUrl(value, "Customer webhook URL");
    if (parsed.protocol !== "https:") throw new Error("Customer webhook URL must use HTTPS");
    if (parsed.username || parsed.password) throw new Error("Customer webhook URL cannot contain credentials");
    return parsed.href;
  }

  function buildVerificationPayload(targetUrl, config, settings) {
    const target = parseUrl(targetUrl, "Target URL");
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Target URL must use HTTP or HTTPS");
    }

    const width = readDimension(config?.width, "Width");
    const height = readDimension(config?.height, "Height");
    const zoom = readNumber(config?.zoom, 1, 0.25, 5, "Zoom");
    const deviceScaleFactor = readNumber(config?.deviceScaleFactor, 1, 0.5, 4, "Device pixel ratio");
    const delaySeconds = normaliseDelaySeconds(settings?.delaySeconds);
    assertOutputSize(width, height, deviceScaleFactor);

    return {
      targetUrl: target.href,
      webhookUrl: normaliseWebhookUrl(settings?.webhookUrl),
      webhookToken: String(settings?.webhookToken || "").trim(),
      label: String(config?.label || `${width}x${height}`).trim().slice(0, 120),
      width,
      height,
      zoom,
      deviceScaleFactor,
      delaySeconds,
    };
  }

  function normaliseDelaySeconds(value) {
    const parsed = value === undefined || value === null || value === "" ? 0 : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_DELAY_SECONDS) {
      throw new Error(`Capture delay must be a whole number between 0 and ${MAX_DELAY_SECONDS} seconds`);
    }
    return parsed;
  }

  function getOutputSize(config) {
    const width = readDimension(config?.width, "Width");
    const height = readDimension(config?.height, "Height");
    const dpr = readNumber(config?.deviceScaleFactor, 1, 0.5, 4, "Device pixel ratio");
    assertOutputSize(width, height, dpr);
    return {
      width: Math.round(width * dpr),
      height: Math.round(height * dpr),
    };
  }

  function assertOutputSize(width, height, dpr) {
    const outputWidth = Math.round(width * dpr);
    const outputHeight = Math.round(height * dpr);
    if (outputWidth > MAX_OUTPUT_SIZE || outputHeight > MAX_OUTPUT_SIZE) {
      throw new Error(`PNG output must be no larger than ${MAX_OUTPUT_SIZE} pixels on either axis`);
    }
  }

  function readDimension(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_SIZE || parsed > MAX_SIZE) {
      throw new Error(`${label} must be a whole number between ${MIN_SIZE} and ${MAX_SIZE}`);
    }
    return parsed;
  }

  function readNumber(value, fallback, minimum, maximum, label) {
    const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error(`${label} must be between ${minimum} and ${maximum}`);
    }
    return Math.round(parsed * 100) / 100;
  }

  function parseUrl(value, label) {
    try {
      return new URL(String(value || "").trim());
    } catch {
      throw new Error(`${label} must be a valid URL`);
    }
  }

  return {
    buildVerificationPayload,
    getOutputSize,
    normaliseDelaySeconds,
    normaliseWebhookUrl,
  };
});
