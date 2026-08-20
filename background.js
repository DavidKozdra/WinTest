/**
 * WinTest service worker.
 *
 * Owns launching, tracking and closing test windows. The popup is only a view:
 * Chrome tears it down whenever focus moves, so any state kept there is lost
 * mid-batch. Window ids live in chrome.storage.session instead, which survives
 * the popup closing and is cleared when the browser restarts (stale ids are
 * useless after a restart anyway).
 */

const SESSION_KEY = "wintest-session";
const STATUS_LIMIT = 40;

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const DEFAULT_ZOOM = 1;

chrome.runtime.onInstalled.addListener(() => {
  console.log("WinTest installed");
});

/** Serialises state mutations so concurrent messages cannot clobber each other. */
let stateChain = Promise.resolve();

function withState(mutator) {
  const result = stateChain.then(async () => {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const state = normaliseState(stored[SESSION_KEY]);
    const output = await mutator(state);
    await chrome.storage.session.set({ [SESSION_KEY]: state });
    return output;
  });
  // Keep the chain alive even if this link rejects.
  stateChain = result.catch(() => {});
  return result;
}

function normaliseState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    windows: Array.isArray(state.windows) ? state.windows : [],
    status: Array.isArray(state.status) ? state.status : [],
    running: Boolean(state.running),
  };
}

function pushStatus(state, title, detail, level = "info") {
  state.status.unshift({ title, detail, level, timestamp: Date.now() });
  if (state.status.length > STATUS_LIMIT) state.status.length = STATUS_LIMIT;
}

function normaliseConfig(config) {
  const width = parseInt(config?.width, 10) || DEFAULT_WIDTH;
  const height = parseInt(config?.height, 10) || DEFAULT_HEIGHT;
  const zoom = parseFloat(config?.zoom) || DEFAULT_ZOOM;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    zoom: Math.max(0.25, Math.min(5, zoom)),
    label: config?.label || `${width}x${height}`,
  };
}

function isTestableUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Reads the tab's real CSS viewport so we can correct for browser chrome. */
async function measureViewport(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  const measured = result?.result;
  if (!measured || !measured.width || !measured.height) {
    throw new Error("Viewport measurement unavailable");
  }
  return measured;
}

/**
 * Chrome's window width/height include the frame, so a 414x896 window yields a
 * smaller CSS viewport. Measure the real viewport, then grow the outer window by
 * the difference. Zoom is applied first because it changes the CSS pixel count:
 * innerWidth is in CSS pixels, so the same frame at 0.9 zoom reports a larger
 * viewport, and compensating before zoom would leave the window the wrong size.
 */
async function fitViewport(windowId, tabId, target) {
  const first = await measureViewport(tabId);
  const deltaWidth = target.width - first.width;
  const deltaHeight = target.height - first.height;

  if (deltaWidth === 0 && deltaHeight === 0) return first;

  const current = await chrome.windows.get(windowId);
  await chrome.windows.update(windowId, {
    width: Math.max(50, (current.width ?? target.width) + deltaWidth),
    height: Math.max(50, (current.height ?? target.height) + deltaHeight),
  });

  // One correction pass is enough in practice; re-measure to report the truth
  // rather than assume the update landed exactly (it can be clamped by screen size).
  try {
    return await measureViewport(tabId);
  } catch {
    return first;
  }
}

/** Waits for the tab to be ready enough to script and measure. */
function waitForTab(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      fn(arg);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish(resolve);
      }
    };

    const timer = setTimeout(
      () => finish(reject, new Error("Timed out waiting for the page to load")),
      timeoutMs
    );

    chrome.tabs.onUpdated.addListener(onUpdated);

    // The tab may already be complete before the listener attached.
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") finish(resolve);
      },
      (error) => finish(reject, error)
    );
  });
}

async function openTestWindow(url, rawConfig, state) {
  const config = normaliseConfig(rawConfig);

  let created;
  try {
    created = await chrome.windows.create({
      url,
      type: "popup",
      width: config.width,
      height: config.height,
      focused: false,
    });
  } catch (error) {
    pushStatus(state, config.label, `Could not open window: ${error.message}`, "error");
    return;
  }

  const tabId = created?.tabs?.[0]?.id;
  if (typeof created?.id !== "number" || typeof tabId !== "number") {
    pushStatus(state, config.label, "Window opened, but it could not be tracked", "warn");
    return;
  }

  state.windows.push({
    windowId: created.id,
    tabId,
    label: config.label,
    width: config.width,
    height: config.height,
    zoom: config.zoom,
  });

  try {
    await waitForTab(tabId);
  } catch (error) {
    pushStatus(state, config.label, `Opened, but the page did not finish loading`, "warn");
    return;
  }

  // Per-tab zoom scope. Chrome's default is per-origin, so launching several
  // sizes of the same site would otherwise make every window share whichever
  // zoom was applied last.
  let zoomApplied = false;
  try {
    await chrome.tabs.setZoomSettings(tabId, { scope: "per-tab", mode: "automatic" });
    await chrome.tabs.setZoom(tabId, config.zoom);
    zoomApplied = true;
  } catch (error) {
    pushStatus(state, config.label, `Opened, but zoom could not be applied`, "warn");
  }

  try {
    const viewport = await fitViewport(created.id, tabId, config);
    const exact = viewport.width === config.width && viewport.height === config.height;
    const zoomNote = zoomApplied ? `${Math.round(config.zoom * 100)}% zoom` : "zoom failed";
    pushStatus(
      state,
      config.label,
      exact
        ? `Ready - viewport ${viewport.width}x${viewport.height}, ${zoomNote}`
        : `Ready - viewport ${viewport.width}x${viewport.height} (asked ${config.width}x${config.height}), ${zoomNote}`,
      exact ? "success" : "warn"
    );
  } catch (error) {
    pushStatus(state, config.label, `Opened, but the viewport could not be measured`, "warn");
  }
}

async function closeTrackedWindows(state, reason) {
  const tracked = [...state.windows];
  state.windows = [];
  if (!tracked.length) return 0;

  let closed = 0;
  await Promise.all(
    tracked.map(async (entry) => {
      try {
        await chrome.windows.remove(entry.windowId);
        closed += 1;
      } catch {
        // Already gone - the user closed it by hand.
      }
    })
  );

  pushStatus(state, "All layouts", `${reason} - closed ${closed} window(s)`, "info");
  return closed;
}

/** Drop windows the user closed manually so "Close all" counts stay honest. */
chrome.windows.onRemoved.addListener((windowId) => {
  void withState((state) => {
    state.windows = state.windows.filter((entry) => entry.windowId !== windowId);
  });
});

const handlers = {
  async getState() {
    return withState((state) => ({
      windows: state.windows,
      status: state.status,
      running: state.running,
    }));
  },

  async clearStatus() {
    return withState((state) => {
      state.status = [];
      return { ok: true };
    });
  },

  async closeAll({ reason } = {}) {
    return withState(async (state) => {
      const closed = await closeTrackedWindows(state, reason || "Closed");
      return { closed };
    });
  },

  async runTest({ url, configs } = {}) {
    if (!isTestableUrl(url)) {
      return { ok: false, error: "Enter a valid http(s) URL to test." };
    }
    const list = Array.isArray(configs) ? configs.filter(Boolean) : [];
    if (!list.length) {
      return { ok: false, error: "Add at least one configuration before running a test." };
    }

    const claimed = await withState((state) => {
      if (state.running) return false;
      state.running = true;
      state.status = [];
      return true;
    });
    if (!claimed) {
      return { ok: false, error: "A test is already running." };
    }

    try {
      await withState(async (state) => {
        await closeTrackedWindows(state, "Starting new batch");
        pushStatus(state, "Batch", `Launching ${list.length} layout(s)`, "info");
      });

      // Sequential: each window is measured and resized, and doing that
      // concurrently makes the measurements fight over focus and screen space.
      for (const config of list) {
        await withState((state) => openTestWindow(url, config, state));
      }

      await withState((state) => pushStatus(state, "Batch", "All layouts launched", "success"));
      return { ok: true };
    } finally {
      await withState((state) => {
        state.running = false;
      });
    }
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true; // keep the channel open for the async response
});
