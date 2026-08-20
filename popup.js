const THEME_KEY = "wintest-theme";
const THEME_CHOICES = new Set(["auto", "light", "dark"]);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEME_CHOICES.has(stored) ? stored : "auto";
  } catch (error) {
    return "auto";
  }
}

/**
 * "auto" removes the attribute so the prefers-color-scheme block in style.css
 * takes over; light/dark pin it explicitly.
 */
function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

// Runs at parse time, before the body paints, so the popup never flashes light
// on its way to dark. DOMContentLoaded would be too late.
applyTheme(readStoredTheme());

class TabManager {
  constructor(tabContainerSelector, contentSelector, activeClass = "active") {
    this.tabButtons = document.querySelectorAll(`${tabContainerSelector} .tab-button`);
    this.tabContents = document.querySelectorAll(contentSelector);
    this.activeClass = activeClass;
    this.currentIndex = 0;
    this.init();
  }

  init() {
    if (!this.tabButtons.length || !this.tabContents.length) return;
    this.tabButtons.forEach((button, index) => {
      button.addEventListener("click", () => {
        this.currentIndex = index;
        this.activate(button.dataset.tab);
      });
    });
    const defaultTab = this.tabButtons[0]?.dataset.tab;
    if (defaultTab) this.activate(defaultTab);
  }

  activate(tabName) {
    this.tabButtons.forEach((btn) => btn.classList.remove(this.activeClass));
    this.tabContents.forEach((content) => content.classList.remove(this.activeClass));
    const targetBtn = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
    const targetContent = document.querySelector(`.tab-content.${tabName}`);
    if (targetBtn && targetContent) {
      targetBtn.classList.add(this.activeClass);
      targetContent.classList.add(this.activeClass);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_WIDTH = 1200;
  const DEFAULT_HEIGHT = 800;
  const DEFAULT_ZOOM = 1;
  const DEFAULT_DEVICE_SCALE_FACTOR = 1;
  const DEFAULT_VERIFICATION_API_URL = "https://wintest-verifier.davidkozdra.workers.dev/verify";
  const ISSUE_KEY = "wintest-issues";
  const VERIFICATION_SETTINGS_KEY = "wintest-verification-settings";
  const VERIFICATION_CLIENT_ID_KEY = "wintest-verification-client-id";
  const STATUS_STATES = new Set(["info", "warn", "success", "error"]);
  const PRESETS = [
    { label: "Desktop Wide", width: 1440, height: 900, zoom: 1, deviceScaleFactor: 1 },
    { label: "Laptop", width: 1366, height: 768, zoom: 1, deviceScaleFactor: 1 },
    { label: "Ultrawide", width: 3440, height: 1440, zoom: 1, deviceScaleFactor: 1 },
    { label: "4K UHD", width: 3840, height: 2160, zoom: 1, deviceScaleFactor: 1 },
    { label: "Tablet Retina", width: 1024, height: 768, zoom: 1, deviceScaleFactor: 2 },
    { label: "Large Phone", width: 414, height: 896, zoom: 1, deviceScaleFactor: 3 },
    { label: "Small Phone", width: 360, height: 740, zoom: 1, deviceScaleFactor: 3 },
    { label: "Full HD", width: 1920, height: 1080, zoom: 1, deviceScaleFactor: 1 },
  ];

  let tabManager;
  let statusTimer = null;
  let latestVerificationUrl = null;

  const configForm = document.getElementById("config-form");
  const labelInput = document.getElementById("label");
  const widthInput = document.getElementById("width");
  const heightInput = document.getElementById("height");
  const zoomInput = document.getElementById("zoom");
  const deviceScaleFactorInput = document.getElementById("device-scale-factor");
  const notesInput = document.getElementById("notes");
  const startTestButton = document.getElementById("start-test");
  const closeTestButton = document.getElementById("close-test");
  const useTabButton = document.getElementById("use-current-tab");
  const targetUrlInput = document.getElementById("target-url");
  const presetContainer = document.getElementById("preset-buttons");
  const addDeviceSetButton = document.getElementById("add-device-set");
  const statusList = document.getElementById("status-list");
  const issueLog = document.getElementById("issue-log");
  const verificationSettingsForm = document.getElementById("verification-settings-form");
  const customerWebhookUrlInput = document.getElementById("customer-webhook-url");
  const customerWebhookTokenInput = document.getElementById("customer-webhook-token");
  const verificationStatus = document.getElementById("verification-status");
  const verificationResult = document.getElementById("verification-result");
  const verificationPreview = document.getElementById("verification-preview");
  const verificationCaption = document.getElementById("verification-caption");
  const downloadVerification = document.getElementById("download-verification");

  tabManager = new TabManager(".tabs", ".tab-content");
  initThemeControl();
  resetForm();
  renderPresetButtons();
  loadConfigs();
  renderIssues();
  loadVerificationSettings();
  prefillTargetUrl();
  void refreshStatus();

  configForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const width = Number(widthInput.value);
    const height = Number(heightInput.value);
    const zoom = Number(zoomInput.value);
    const deviceScaleFactor = Number(deviceScaleFactorInput.value);

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !Number.isFinite(zoom) ||
      !Number.isFinite(deviceScaleFactor) ||
      width < 100 ||
      width > 7680 ||
      height < 100 ||
      height > 7680 ||
      zoom < 0.25 ||
      zoom > 5 ||
      deviceScaleFactor < 0.5 ||
      deviceScaleFactor > 4
    ) {
      alert("Use a 100–7680px viewport, 0.25–5 zoom, and 0.5–4 device pixel ratio.");
      return;
    }

    try {
      WinTestVerification.getOutputSize({ width, height, deviceScaleFactor });
    } catch (error) {
      alert(error.message);
      return;
    }

    const formMode = configForm.dataset.mode;
    const id = formMode === "edit" ? parseInt(configForm.dataset.editId, 10) : Date.now();
    const newConfig = {
      id,
      label: labelInput.value.trim() || `${width}x${height}`,
      width,
      height,
      zoom,
      deviceScaleFactor,
      notes: notesInput.value.trim(),
    };

    saveConfig(newConfig);
    loadConfigs();
    resetForm();
  });

  document.getElementById("cancel-config")?.addEventListener("click", resetForm);

  startTestButton?.addEventListener("click", () => {
    void startBatchTest();
  });
  closeTestButton?.addEventListener("click", () => {
    void closeAllWindows("Manually closed");
  });
  useTabButton?.addEventListener("click", () => prefillTargetUrl(true));
  addDeviceSetButton?.addEventListener("click", addPopularBreakpoints);
  verificationSettingsForm?.addEventListener("submit", (event) => {
    void saveVerificationSettings(event);
  });
  window.addEventListener("beforeunload", () => {
    if (latestVerificationUrl) URL.revokeObjectURL(latestVerificationUrl);
  });

  /** Wraps sendMessage so a dead service worker surfaces as a normal rejection. */
  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(payload, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  function loadConfigs() {
    const configs = getConfigs();
    const configList = document.getElementById("config-list");
    if (!configList) return;

    const issues = loadIssues();
    configList.innerHTML = "";

    if (!configs.length) {
      configList.innerHTML = `<p class="empty-note">No configurations yet. Add one from the Settings tab, or use "Add popular breakpoints".</p>`;
      return;
    }

    configs.forEach((config) => {
      const item = document.createElement("div");
      item.className = "config-item";

      const width = parseInt(config.width, 10) || DEFAULT_WIDTH;
      const height = parseInt(config.height, 10) || DEFAULT_HEIGHT;
      const zoom = parseFloat(config.zoom) || DEFAULT_ZOOM;
      const deviceScaleFactor = parseFloat(config.deviceScaleFactor) || DEFAULT_DEVICE_SCALE_FACTOR;
      const outputWidth = Math.round(width * deviceScaleFactor);
      const outputHeight = Math.round(height * deviceScaleFactor);
      const issueCount = issues.filter((issue) => issue.configId === config.id).length;
      const safeLabel = escapeHtml(config.label || `${width}x${height}`);
      const safeNotes = escapeHtml(config.notes || "No notes yet.");

      item.innerHTML = `
        <header>
          <span>${safeLabel}</span>
          <span>${Math.round(zoom * 100)}% zoom</span>
        </header>
        <p>${width} x ${height} CSS viewport · DPR ${deviceScaleFactor}</p>
        <p>${outputWidth} x ${outputHeight} external PNG</p>
        <p class="notes">${safeNotes}</p>
        <p class="issue-count">${issueCount} noted issue${issueCount === 1 ? "" : "s"}</p>
      `;

      const actions = document.createElement("div");
      actions.className = "config-actions";

      const launchButton = document.createElement("button");
      launchButton.type = "button";
      launchButton.className = "launch-button";
      launchButton.textContent = "Launch";
      launchButton.addEventListener("click", () => {
        void launchConfig(config);
      });

      const verifyButton = document.createElement("button");
      verifyButton.type = "button";
      verifyButton.className = "verify-button";
      verifyButton.textContent = "External verify";
      verifyButton.addEventListener("click", () => {
        tabManager.activate("test");
        void externalVerify(config, verifyButton);
      });

      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "edit-button";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        tabManager.activate("settings");
        populateFormForEdit(config);
      });

      const reportButton = document.createElement("button");
      reportButton.type = "button";
      reportButton.className = "report-button";
      reportButton.textContent = "Report issue";
      reportButton.addEventListener("click", () => promptIssue(config));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => deleteConfig(config));

      actions.append(launchButton, verifyButton, editButton, reportButton, deleteButton);
      item.appendChild(actions);
      configList.appendChild(item);
    });
  }

  function populateFormForEdit(config) {
    labelInput.value = config.label;
    widthInput.value = config.width;
    heightInput.value = config.height;
    zoomInput.value = config.zoom;
    deviceScaleFactorInput.value = config.deviceScaleFactor || DEFAULT_DEVICE_SCALE_FACTOR;
    notesInput.value = config.notes || "";
    configForm.dataset.mode = "edit";
    configForm.dataset.editId = config.id;
  }

  function resetForm() {
    labelInput.value = "";
    widthInput.value = DEFAULT_WIDTH;
    heightInput.value = DEFAULT_HEIGHT;
    zoomInput.value = DEFAULT_ZOOM;
    deviceScaleFactorInput.value = DEFAULT_DEVICE_SCALE_FACTOR;
    notesInput.value = "";
    configForm.dataset.mode = "add";
    delete configForm.dataset.editId;
  }

  function getConfigs() {
    return getStoredArray("configs");
  }

  function saveConfig(config) {
    const configs = getConfigs();
    const index = configs.findIndex((entry) => entry.id === config.id);
    if (index >= 0) {
      configs[index] = config;
    } else {
      configs.push(config);
    }
    localStorage.setItem("configs", JSON.stringify(configs));
  }

  function deleteConfig(config) {
    const label = config.label || `${config.width}x${config.height}`;
    if (!confirm(`Delete the "${label}" configuration?`)) return;

    const configs = getConfigs().filter((entry) => entry.id !== config.id);
    localStorage.setItem("configs", JSON.stringify(configs));

    // If the form was editing this config, drop back to add mode.
    if (configForm.dataset.mode === "edit" && String(config.id) === configForm.dataset.editId) {
      resetForm();
    }
    loadConfigs();
  }

  async function startBatchTest() {
    const targetUrl = getValidatedUrl();
    if (!targetUrl) {
      alert("Enter a valid HTTP(s) URL to test.");
      return;
    }

    const configs = getConfigs();
    if (!configs.length) {
      alert("Add at least one configuration before running a test.");
      return;
    }

    await runInServiceWorker({ type: "runTest", url: targetUrl, configs });
  }

  async function launchConfig(config) {
    const targetUrl = getValidatedUrl();
    if (!targetUrl) {
      alert("Enter a valid HTTP(s) URL to test.");
      return;
    }
    await runInServiceWorker({ type: "runTest", url: targetUrl, configs: [config] });
  }

  function loadVerificationSettings() {
    const settings = getStoredObject(VERIFICATION_SETTINGS_KEY);
    customerWebhookUrlInput.value = settings.webhookUrl || "";
    customerWebhookTokenInput.value = settings.webhookToken || "";

    if (settings.apiUrl || settings.apiToken) {
      localStorage.setItem(
        VERIFICATION_SETTINGS_KEY,
        JSON.stringify({ webhookUrl: settings.webhookUrl || "", webhookToken: settings.webhookToken || "" })
      );
    }

    if (settings.webhookUrl) {
      showVerificationStatus("Free external verification is ready, with customer webhook delivery enabled.", "info");
    }
  }

  async function saveVerificationSettings(event) {
    event.preventDefault();

    try {
      const webhookUrl = WinTestVerification.normaliseWebhookUrl(customerWebhookUrlInput.value);
      const webhookToken = customerWebhookTokenInput.value.trim();

      const settings = { webhookUrl, webhookToken };
      localStorage.setItem(VERIFICATION_SETTINGS_KEY, JSON.stringify(settings));
      customerWebhookUrlInput.value = webhookUrl;
      showVerificationStatus(
        webhookUrl ? "Webhook settings saved. Free external verification is ready." : "Webhook cleared. Free external verification is ready.",
        "success"
      );
    } catch (error) {
      showVerificationStatus(error.message, "error");
    }
  }

  async function externalVerify(config, button) {
    const targetUrl = getValidatedUrl();
    if (!targetUrl) {
      showVerificationStatus("Enter a valid HTTP(s) URL before requesting an external capture.", "error");
      return;
    }

    const settings = getStoredObject(VERIFICATION_SETTINGS_KEY);
    const previousText = button.textContent;
    try {
      const apiUrl = DEFAULT_VERIFICATION_API_URL;
      const payload = WinTestVerification.buildVerificationPayload(targetUrl, config, settings);
      const outputSize = WinTestVerification.getOutputSize(config);
      const clientId = getOrCreateVerificationClientId();
      const permissionGranted = await requestServicePermission(apiUrl);
      if (!permissionGranted) throw new Error("Permission to contact the verification Worker was not granted");

      button.disabled = true;
      button.textContent = "Rendering…";
      showVerificationStatus(
        `Cloudflare is rendering ${payload.width}×${payload.height} CSS pixels at DPR ${payload.deviceScaleFactor}…`,
        "info"
      );
      verificationResult.hidden = true;
      document.getElementById("verification-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WinTest-Client-Id": clientId,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(await readVerificationError(response));
      const contentType = response.headers.get("Content-Type") || "";
      if (!contentType.toLowerCase().includes("image/")) {
        throw new Error("The verification service returned an unexpected response");
      }

      const imageBlob = await response.blob();
      if (latestVerificationUrl) URL.revokeObjectURL(latestVerificationUrl);
      latestVerificationUrl = URL.createObjectURL(imageBlob);
      verificationPreview.src = latestVerificationUrl;
      verificationResult.hidden = false;

      const verificationId = response.headers.get("X-WinTest-Verification-Id") || "unavailable";
      const webhookStatus = response.headers.get("X-WinTest-Webhook-Status") || "skipped";
      const capturedAt = response.headers.get("X-WinTest-Captured-At") || new Date().toISOString();
      const safeName = String(payload.label || "screen")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "screen";
      const filename = `wintest-${safeName}-${outputSize.width}x${outputSize.height}.png`;
      downloadVerification.href = latestVerificationUrl;
      downloadVerification.download = filename;
      verificationCaption.textContent =
        `${payload.width}×${payload.height} CSS viewport · DPR ${payload.deviceScaleFactor} · ` +
        `${outputSize.width}×${outputSize.height} PNG · ID ${verificationId}`;

      let viewerError = null;
      try {
        const captureId = await WinTestCaptureStore.saveCapture({
          blob: imageBlob,
          capturedAt,
          deviceScaleFactor: payload.deviceScaleFactor,
          filename,
          label: payload.label,
          outputHeight: outputSize.height,
          outputWidth: outputSize.width,
          targetUrl: payload.targetUrl,
          verificationId,
          viewportHeight: payload.height,
          viewportWidth: payload.width,
          webhookStatus,
        });
        await openVerificationViewer(captureId, outputSize);
      } catch (error) {
        viewerError = error;
      }

      if (viewerError) {
        showVerificationStatus(`Capture complete, but its viewer could not open: ${viewerError.message}`, "warn");
      } else if (webhookStatus === "failed") {
        showVerificationStatus("Capture complete, but the customer webhook did not accept the PNG.", "warn");
      } else if (webhookStatus === "delivered") {
        showVerificationStatus("Capture complete and delivered to the customer webhook.", "success");
      } else {
        showVerificationStatus("Capture complete. The full-resolution PNG is ready below.", "success");
      }
    } catch (error) {
      showVerificationStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function requestServicePermission(apiUrl) {
    const parsed = new URL(apiUrl);
    const originPattern = `${parsed.protocol}//${parsed.host}/*`;
    return new Promise((resolve, reject) => {
      chrome.permissions.request({ origins: [originPattern] }, (granted) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(Boolean(granted));
      });
    });
  }

  function openVerificationViewer(captureId, outputSize) {
    const bounds = WinTestCaptureStore.calculateViewerWindow(
      outputSize.width,
      outputSize.height,
      screen.availWidth,
      screen.availHeight
    );
    const viewerUrl = chrome.runtime.getURL(`viewer.html?capture=${encodeURIComponent(captureId)}`);
    return new Promise((resolve, reject) => {
      chrome.windows.create(
        {
          focused: true,
          height: bounds.height,
          type: "popup",
          url: viewerUrl,
          width: bounds.width,
        },
        (createdWindow) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (!createdWindow) {
            reject(new Error("Chrome did not create the viewer window"));
            return;
          }
          resolve(createdWindow);
        }
      );
    });
  }

  function getOrCreateVerificationClientId() {
    const existing = localStorage.getItem(VERIFICATION_CLIENT_ID_KEY)?.trim().toLowerCase() || "";
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (uuidPattern.test(existing)) return existing;

    const clientId = crypto.randomUUID();
    localStorage.setItem(VERIFICATION_CLIENT_ID_KEY, clientId);
    return clientId;
  }

  async function readVerificationError(response) {
    try {
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data?.error) return data.error;
      }
      const message = (await response.text()).trim();
      return message || `Verification failed with HTTP ${response.status}`;
    } catch (error) {
      return `Verification failed with HTTP ${response.status}`;
    }
  }

  function showVerificationStatus(message, state = "info") {
    if (!verificationStatus) return;
    verificationStatus.dataset.state = normalizeState(state);
    verificationStatus.textContent = message;
  }

  /**
   * The service worker owns the run, so the popup only kicks it off and polls.
   * Closing the popup mid-run no longer cancels anything.
   */
  async function runInServiceWorker(message) {
    setBusy(true);
    startStatusPolling();
    try {
      const response = await sendMessage(message);
      if (!response.ok && response.error) {
        alert(response.error);
      }
    } catch (error) {
      alert(`WinTest could not reach its background service: ${error.message}`);
    } finally {
      setBusy(false);
      await refreshStatus();
      stopStatusPolling();
    }
  }

  async function closeAllWindows(reason) {
    try {
      await sendMessage({ type: "closeAll", reason });
    } catch (error) {
      alert(`WinTest could not reach its background service: ${error.message}`);
    }
    await refreshStatus();
  }

  function setBusy(isBusy) {
    if (startTestButton) startTestButton.disabled = isBusy;
    if (closeTestButton) closeTestButton.disabled = isBusy;
  }

  function startStatusPolling() {
    stopStatusPolling();
    statusTimer = setInterval(() => void refreshStatus(), 700);
  }

  function stopStatusPolling() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = null;
  }

  async function refreshStatus() {
    try {
      const state = await sendMessage({ type: "getState" });
      renderStatusList(Array.isArray(state.status) ? state.status : []);
    } catch (error) {
      renderStatusList([]);
    }
  }

  function getValidatedUrl() {
    const input = targetUrlInput.value.trim();
    if (!input) return null;
    try {
      const parsed = new URL(input);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      return parsed.href;
    } catch (error) {
      return null;
    }
  }

  function prefillTargetUrl(force = false) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return;
      const currentUrl = tabs?.[0]?.url;
      if (!currentUrl) return;
      if (force || !targetUrlInput.value.trim()) {
        if (!/^https?:\/\//i.test(currentUrl)) return;
        targetUrlInput.value = currentUrl;
      }
    });
  }

  function renderStatusList(entries) {
    if (!statusList) return;
    if (!entries.length) {
      statusList.innerHTML = `<div class="status-entry empty">Ready to launch configurations. Enter a URL and tap "Start test".</div>`;
      return;
    }
    statusList.innerHTML = entries
      .map((entry) => {
        const timeString = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `
          <div class="status-entry" data-state="${normalizeState(entry.level)}">
            <strong>${escapeHtml(entry.title)}</strong>
            <span class="time">${escapeHtml(timeString)}</span>
            <small>${escapeHtml(entry.detail)}</small>
          </div>
        `;
      })
      .join("");
  }

  function initThemeControl() {
    const segments = document.querySelectorAll("[data-theme-choice]");
    if (!segments.length) return;

    const select = (choice) => {
      applyTheme(choice);
      try {
        localStorage.setItem(THEME_KEY, choice);
      } catch (error) {
        // Storage can be unavailable; the theme still applies for this session.
      }
      segments.forEach((segment) => {
        segment.setAttribute(
          "aria-checked",
          segment.dataset.themeChoice === choice ? "true" : "false"
        );
      });
    };

    segments.forEach((segment) => {
      segment.addEventListener("click", () => select(segment.dataset.themeChoice));
    });

    select(readStoredTheme());
  }

  function renderPresetButtons() {
    if (!presetContainer) return;
    presetContainer.innerHTML = "";
    PRESETS.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = preset.label;
      button.addEventListener("click", () => applyPreset(preset));
      presetContainer.appendChild(button);
    });
  }

  function applyPreset(preset) {
    labelInput.value = preset.label;
    widthInput.value = preset.width;
    heightInput.value = preset.height;
    zoomInput.value = preset.zoom;
    deviceScaleFactorInput.value = preset.deviceScaleFactor;
    notesInput.value = `Preset: ${preset.label}`;
    configForm.dataset.mode = "add";
    delete configForm.dataset.editId;
  }

  function addPopularBreakpoints() {
    const configs = getConfigs();
    PRESETS.forEach((preset) => {
      const exists = configs.some(
        (cfg) =>
          cfg.width === preset.width &&
          cfg.height === preset.height &&
          cfg.zoom === preset.zoom &&
          (cfg.deviceScaleFactor || DEFAULT_DEVICE_SCALE_FACTOR) === preset.deviceScaleFactor
      );
      if (!exists) {
        const newConfig = {
          id: Date.now() + Math.random(),
          label: preset.label,
          width: preset.width,
          height: preset.height,
          zoom: preset.zoom,
          deviceScaleFactor: preset.deviceScaleFactor,
          notes: "From preset",
        };
        configs.push(newConfig);
      }
    });
    localStorage.setItem("configs", JSON.stringify(configs));
    loadConfigs();
  }

  function promptIssue(config) {
    const note = prompt(`What issue did you spot for ${config.label}?`);
    if (!note?.trim()) return;
    addIssue({
      configId: config.id,
      configLabel: config.label,
      message: note.trim(),
      timestamp: Date.now(),
    });
  }

  function addIssue(issue) {
    const issues = loadIssues();
    issues.unshift(issue);
    if (issues.length > 30) issues.pop();
    localStorage.setItem(ISSUE_KEY, JSON.stringify(issues));
    renderIssues();
    loadConfigs();
  }

  function loadIssues() {
    return getStoredArray(ISSUE_KEY);
  }

  function renderIssues() {
    if (!issueLog) return;
    const issues = loadIssues();
    if (!issues.length) {
      issueLog.innerHTML = `<p class="empty-note">No issues yet. Launch a configuration and tap "Report issue" to capture findings.</p>`;
      return;
    }
    issueLog.innerHTML = issues
      .map((issue) => {
        const timeString = new Date(issue.timestamp).toLocaleString([], {
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
          day: "numeric",
        });
        return `
          <div class="issue-entry">
            <strong>${escapeHtml(issue.configLabel || "Configuration")}</strong>
            <p>${escapeHtml(issue.message || "")}</p>
            <div class="meta">${escapeHtml(timeString)}</div>
          </div>
        `;
      })
      .join("");
  }

  function getStoredArray(key) {
    try {
      const rawValue = localStorage.getItem(key);
      if (!rawValue) return [];
      const parsedValue = JSON.parse(rawValue);
      return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
      return [];
    }
  }

  function getStoredObject(key) {
    try {
      const rawValue = localStorage.getItem(key);
      if (!rawValue) return {};
      const parsedValue = JSON.parse(rawValue);
      return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue) ? parsedValue : {};
    } catch (error) {
      return {};
    }
  }

  function normalizeState(state) {
    return STATUS_STATES.has(state) ? state : "info";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
});
