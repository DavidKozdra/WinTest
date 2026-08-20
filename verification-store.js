(function exposeCaptureStore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WinTestCaptureStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DATABASE_NAME = "wintest-captures";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "captures";
  const MAX_SAVED_CAPTURES = 5;

  function createCaptureId(now = Date.now(), uuid = crypto.randomUUID()) {
    return `${String(now).padStart(13, "0")}-${uuid}`;
  }

  function calculateViewerWindow(outputWidth, outputHeight, availableWidth, availableHeight) {
    const maximumWidth = Math.max(480, Math.floor(availableWidth) - 64);
    const maximumHeight = Math.max(420, Math.floor(availableHeight) - 64);
    return {
      width: Math.min(maximumWidth, Math.max(520, Math.floor(outputWidth) + 32)),
      height: Math.min(maximumHeight, Math.max(460, Math.floor(outputHeight) + 150)),
    };
  }

  async function saveCapture(capture) {
    if (!(capture?.blob instanceof Blob)) throw new Error("Capture image is missing");
    const record = {
      ...capture,
      id: capture.id || createCaptureId(),
      savedAt: Number.isFinite(capture.savedAt) ? capture.savedAt : Date.now(),
    };
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        store.put(record);
        const keysRequest = store.getAllKeys();
        keysRequest.onsuccess = () => {
          const excess = keysRequest.result.length - MAX_SAVED_CAPTURES;
          if (excess > 0) keysRequest.result.slice(0, excess).forEach((key) => store.delete(key));
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not save capture"));
        transaction.onabort = () => reject(transaction.error || new Error("Capture save was cancelled"));
      });
      return record.id;
    } finally {
      database.close();
    }
  }

  async function readCapture(id) {
    if (!id) return null;
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read capture"));
      });
    } finally {
      database.close();
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open capture storage"));
      request.onblocked = () => reject(new Error("Capture storage is busy; close older WinTest viewers and try again"));
    });
  }

  return { calculateViewerWindow, createCaptureId, readCapture, saveCapture };
});
