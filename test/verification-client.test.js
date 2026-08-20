const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildVerificationPayload,
  getOutputSize,
  normaliseDelaySeconds,
  normaliseWebhookUrl,
} = require("../verification-client.js");

test("builds an exact ultrawide verification payload", () => {
  const payload = buildVerificationPayload(
    "https://example.com/app",
    { label: "Ultrawide", width: 3440, height: 1440, zoom: 1, deviceScaleFactor: 1 },
    { delaySeconds: 12, webhookUrl: "https://customer.example/hooks/wintest", webhookToken: "secret" }
  );

  assert.deepEqual(payload, {
    targetUrl: "https://example.com/app",
    webhookUrl: "https://customer.example/hooks/wintest",
    webhookToken: "secret",
    label: "Ultrawide",
    width: 3440,
    height: 1440,
    zoom: 1,
    deviceScaleFactor: 1,
    delaySeconds: 12,
  });
});

test("normalizes and validates the external capture delay", () => {
  assert.equal(normaliseDelaySeconds(undefined), 0);
  assert.equal(normaliseDelaySeconds("15"), 15);
  assert.throws(() => normaliseDelaySeconds(60.5), /whole number/);
  assert.throws(() => normaliseDelaySeconds(61), /between 0 and 60/);
});

test("converts CSS viewport and DPR to true PNG pixel dimensions", () => {
  assert.deepEqual(getOutputSize({ width: 390, height: 844, deviceScaleFactor: 3 }), {
    width: 1170,
    height: 2532,
  });
  assert.deepEqual(getOutputSize({ width: 3440, height: 1440, deviceScaleFactor: 1 }), {
    width: 3440,
    height: 1440,
  });
});

test("rejects dimensions outside the supported 8K canvas", () => {
  assert.throws(
    () => buildVerificationPayload("https://example.com", { width: 9000, height: 1000 }, {}),
    /Width must be/
  );
  assert.throws(
    () => buildVerificationPayload("https://example.com", { width: 3000, height: 1000, deviceScaleFactor: 3 }, {}),
    /PNG output/
  );
});

test("requires HTTPS customer webhooks", () => {
  assert.throws(() => normaliseWebhookUrl("http://customer.example/hook"), /must use HTTPS/);
});
