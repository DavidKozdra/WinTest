const assert = require("node:assert/strict");
const { test } = require("node:test");

const { calculateViewerWindow, createCaptureId } = require("../verification-store.js");

test("sizes the capture viewer to the available physical window area", () => {
  assert.deepEqual(calculateViewerWindow(3440, 1440, 1920, 1080), {
    width: 1856,
    height: 1016,
  });
  assert.deepEqual(calculateViewerWindow(390, 844, 1920, 1080), {
    width: 520,
    height: 994,
  });
});

test("creates sortable capture IDs", () => {
  assert.equal(
    createCaptureId(123, "12345678-1234-4123-8123-123456789abc"),
    "0000000000123-12345678-1234-4123-8123-123456789abc"
  );
});
