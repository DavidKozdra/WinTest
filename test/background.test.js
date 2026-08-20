/**
 * Tests the service worker against a mock chrome API.
 *
 * The worker is loaded by evaluating background.js in a fresh context per test,
 * so each case gets clean module state. These cover the behaviours the audit
 * flagged: per-tab zoom scope, viewport compensation, and state that survives
 * the popup closing.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");

/** Builds a mock chrome API plus a log of the calls made against it. */
function createHarness(options = {}) {
  const {
    // CSS viewport the fake browser reports, given an outer window size.
    chromeFrame = { width: 0, height: 74 },
    zoomThrows = false,
    createThrows = false,
  } = options;

  const calls = [];
  let sessionStore = {};
  let nextId = 1;
  const windows = new Map();
  const listeners = { updated: [], removed: [] };

  const viewportFor = (win) => ({
    width: Math.max(0, win.width - chromeFrame.width),
    height: Math.max(0, win.height - chromeFrame.height),
  });

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(fn) {
          chrome.__onMessage = fn;
        },
      },
    },
    storage: {
      session: {
        async get(key) {
          return sessionStore[key] !== undefined ? { [key]: sessionStore[key] } : {};
        },
        async set(obj) {
          // Structured-clone like the real API, so tests catch accidental sharing.
          Object.assign(sessionStore, JSON.parse(JSON.stringify(obj)));
        },
      },
    },
    windows: {
      async create(opts) {
        if (createThrows) throw new Error("popup blocked");
        const id = nextId++;
        const tabId = 1000 + id;
        const win = { id, width: opts.width, height: opts.height, tabId };
        windows.set(id, win);
        calls.push({ api: "windows.create", width: opts.width, height: opts.height });
        return { id, tabs: [{ id: tabId, status: "complete" }] };
      },
      async get(id) {
        const win = windows.get(id);
        if (!win) throw new Error("no such window");
        return { ...win };
      },
      async update(id, opts) {
        const win = windows.get(id);
        if (!win) throw new Error("no such window");
        Object.assign(win, opts);
        calls.push({ api: "windows.update", id, width: opts.width, height: opts.height });
        return { ...win };
      },
      async remove(id) {
        if (!windows.has(id)) throw new Error("no such window");
        windows.delete(id);
        calls.push({ api: "windows.remove", id });
      },
      onRemoved: { addListener: (fn) => listeners.removed.push(fn) },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, status: "complete" };
      },
      async setZoomSettings(tabId, settings) {
        if (zoomThrows) throw new Error("zoom settings failed");
        calls.push({ api: "tabs.setZoomSettings", tabId, scope: settings.scope });
      },
      async setZoom(tabId, zoom) {
        if (zoomThrows) throw new Error("zoom failed");
        calls.push({ api: "tabs.setZoom", tabId, zoom });
      },
      onUpdated: {
        addListener: (fn) => listeners.updated.push(fn),
        removeListener: (fn) => {
          const i = listeners.updated.indexOf(fn);
          if (i >= 0) listeners.updated.splice(i, 1);
        },
      },
    },
    scripting: {
      async executeScript({ target }) {
        const win = [...windows.values()].find((w) => w.tabId === target.tabId);
        if (!win) throw new Error("no window for tab");
        return [{ result: viewportFor(win) }];
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    Boolean,
    String,
    Number,
    parseInt,
    parseFloat,
    Error,
  });

  vm.runInContext(SOURCE, context);

  const send = (message) =>
    new Promise((resolve) => {
      chrome.__onMessage(message, {}, resolve);
    });

  return {
    send,
    calls,
    windows,
    getSession: () => sessionStore["wintest-session"],
    setSession: (value) => {
      sessionStore["wintest-session"] = value;
    },
  };
}

const CONFIG = { label: "Large Phone", width: 414, height: 896, zoom: 0.95 };

test("sets per-tab zoom scope before applying zoom", async () => {
  const h = createHarness();
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });

  const zoomCalls = h.calls.filter((c) => c.api.startsWith("tabs.setZoom"));
  assert.equal(zoomCalls[0].api, "tabs.setZoomSettings", "scope must be set first");
  assert.equal(zoomCalls[0].scope, "per-tab", "scope must be per-tab, not per-origin");
  assert.equal(zoomCalls[1].api, "tabs.setZoom");
  assert.equal(zoomCalls[1].zoom, 0.95);
});

test("each window in a batch gets its own per-tab zoom", async () => {
  const h = createHarness();
  const configs = [
    { label: "A", width: 414, height: 896, zoom: 0.5 },
    { label: "B", width: 800, height: 600, zoom: 1 },
    { label: "C", width: 1440, height: 900, zoom: 2 },
  ];
  await h.send({ type: "runTest", url: "https://example.com", configs });

  const scopes = h.calls.filter((c) => c.api === "tabs.setZoomSettings");
  const zooms = h.calls.filter((c) => c.api === "tabs.setZoom");
  assert.equal(scopes.length, 3, "every tab needs its own scope call");
  assert.ok(scopes.every((c) => c.scope === "per-tab"));
  assert.deepEqual(zooms.map((c) => c.zoom), [0.5, 1, 2]);
  // Distinct tabs, so one origin's zoom cannot overwrite another's.
  assert.equal(new Set(zooms.map((c) => c.tabId)).size, 3);
});

test("compensates for browser chrome so the CSS viewport matches the config", async () => {
  const h = createHarness({ chromeFrame: { width: 0, height: 74 } });
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });

  const created = h.calls.find((c) => c.api === "windows.create");
  const updated = h.calls.find((c) => c.api === "windows.update");
  assert.deepEqual({ w: created.width, h: created.height }, { w: 414, h: 896 });
  assert.ok(updated, "must resize to compensate for the frame");
  assert.equal(updated.height, 970, "896 target + 74 frame");

  const status = h.getSession().status.find((s) => s.title === "Large Phone");
  assert.match(status.detail, /viewport 414x896/);
  assert.equal(status.level, "success");
});

test("skips the resize when the viewport already matches", async () => {
  const h = createHarness({ chromeFrame: { width: 0, height: 0 } });
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });
  assert.equal(h.calls.filter((c) => c.api === "windows.update").length, 0);
});

test("tracked windows persist in session storage, not popup memory", async () => {
  const h = createHarness();
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });

  const state = h.getSession();
  assert.equal(state.windows.length, 1);
  assert.equal(typeof state.windows[0].windowId, "number");
});

test("close all works against state a previous popup left behind", async () => {
  const h = createHarness();
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG, CONFIG] });

  // Simulate the popup being destroyed and reopened: only storage survives.
  const response = await h.send({ type: "closeAll", reason: "Manually closed" });
  assert.equal(response.closed, 2, "must close windows it did not open in this popup");
  assert.equal(h.getSession().windows.length, 0);
  assert.equal(h.windows.size, 0);
});

test("rejects non-http(s) urls", async () => {
  const h = createHarness();
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "nonsense"]) {
    const response = await h.send({ type: "runTest", url, configs: [CONFIG] });
    assert.equal(response.ok, false, `${url} must be rejected`);
  }
  assert.equal(h.calls.filter((c) => c.api === "windows.create").length, 0);
});

test("rejects an empty config list", async () => {
  const h = createHarness();
  const response = await h.send({ type: "runTest", url: "https://example.com", configs: [] });
  assert.equal(response.ok, false);
});

test("reports a warning when zoom fails but still opens the window", async () => {
  const h = createHarness({ zoomThrows: true });
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });

  const details = h.getSession().status.map((s) => s.detail).join(" | ");
  assert.match(details, /zoom could not be applied/);
  assert.equal(h.getSession().windows.length, 1, "window is still tracked");
});

test("surfaces an error when the window cannot open", async () => {
  const h = createHarness({ createThrows: true });
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });

  const status = h.getSession().status.find((s) => s.level === "error");
  assert.ok(status, "a failed launch must be reported as an error");
});

test("clamps absurd zoom values instead of passing them to chrome", async () => {
  const h = createHarness();
  await h.send({
    type: "runTest",
    url: "https://example.com",
    configs: [{ label: "Weird", width: 400, height: 400, zoom: 99 }],
  });
  const zoom = h.calls.find((c) => c.api === "tabs.setZoom");
  assert.ok(zoom.zoom <= 5, `zoom ${zoom.zoom} must be clamped to chrome's range`);
});

test("getState returns status for a freshly opened popup", async () => {
  const h = createHarness();
  await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });
  const state = await h.send({ type: "getState" });
  assert.equal(state.ok, true);
  assert.ok(state.status.length > 0);
  assert.equal(state.running, false);
});

test("tolerates corrupt session state", async () => {
  const h = createHarness();
  h.setSession({ windows: "not-an-array", status: null });
  const response = await h.send({ type: "runTest", url: "https://example.com", configs: [CONFIG] });
  assert.equal(response.ok, true);
});
