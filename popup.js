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
  const STATUS_LIMIT = 8;
  const ISSUE_KEY = "wintest-issues";
  const PRESETS = [
    { label: "Desktop Wide", width: 1440, height: 900, zoom: 1 },
    { label: "Laptop", width: 1366, height: 768, zoom: 1 },
    { label: "Tablet", width: 1024, height: 768, zoom: 0.95 },
    { label: "Large Phone", width: 414, height: 896, zoom: 0.95 },
    { label: "Small Phone", width: 360, height: 740, zoom: 0.9 },
    { label: "Full HD", width: 1920, height: 1080, zoom: 1 },
  ];

  let openedWindows = [];
  let statusEntries = [];
  let tabManager;

  const configForm = document.getElementById("config-form");
  const labelInput = document.getElementById("label");
  const widthInput = document.getElementById("width");
  const heightInput = document.getElementById("height");
  const zoomInput = document.getElementById("zoom");
  const notesInput = document.getElementById("notes");
  const startTestButton = document.getElementById("start-test");
  const closeTestButton = document.getElementById("close-test");
  const useTabButton = document.getElementById("use-current-tab");
  const targetUrlInput = document.getElementById("target-url");
  const presetContainer = document.getElementById("preset-buttons");
  const addDeviceSetButton = document.getElementById("add-device-set");
  const statusList = document.getElementById("status-list");
  const issueLog = document.getElementById("issue-log");

  // --- UI Init ---
  tabManager = new TabManager(".tabs", ".tab-content");
  renderPresetButtons();
  loadConfigs();
  renderIssues();
  prefillTargetUrl();
  renderStatusList();

  // --- Form Handling ---
  configForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const width = parseInt(widthInput.value, 10) || DEFAULT_WIDTH;
    const height = parseInt(heightInput.value, 10) || DEFAULT_HEIGHT;
    const zoom = parseFloat(zoomInput.value) || DEFAULT_ZOOM;

    if (width <= 0 || height <= 0 || zoom <= 0) {
      alert("Width, height, and zoom must be greater than 0.");
      return;
    }

    const formMode = configForm.dataset.mode;
    const id = formMode === "edit" ? parseInt(configForm.dataset.editId, 10) : Date.now();
    const newConfig = {
      id,
      label: labelInput.value.trim() || `${width}×${height}`,
      width,
      height,
      zoom,
      notes: notesInput.value.trim(),
    };

    saveConfig(newConfig);
    loadConfigs();
    resetForm();
  });

  document.getElementById("cancel-config")?.addEventListener("click", resetForm);

  // --- Test Controls ---
  startTestButton?.addEventListener("click", startBatchTest);
  closeTestButton?.addEventListener("click", () => closeAllWindows("Manually closed"));
  useTabButton?.addEventListener("click", () => prefillTargetUrl(true));
  addDeviceSetButton?.addEventListener("click", addPopularBreakpoints);

  // --- Helpers ---
  function loadConfigs() {
    const configs = getConfigs();
    const configList = document.getElementById("config-list");
    if (!configList) return;

    const issues = loadIssues();
    configList.innerHTML = "";

    configs.forEach((config) => {
      const item = document.createElement("div");
      item.className = "config-item";

      const issueCount = issues.filter((issue) => issue.configId === config.id).length;

      item.innerHTML = `
        <header>
          <span>${config.label}</span>
          <span>${Math.round((config.zoom || 1) * 100)}% zoom</span>
        </header>
        <p>${config.width} × ${config.height}</p>
        <p class="notes">${config.notes || "No notes yet."}</p>
        <p class="issue-count">${issueCount} noted issue${issueCount === 1 ? "" : "s"}</p>
      `;

      const actions = document.createElement("div");
      actions.className = "config-actions";

      const launchButton = document.createElement("button");
      launchButton.type = "button";
      launchButton.className = "launch-button";
      launchButton.textContent = "Launch";
      launchButton.addEventListener("click", () => launchConfig(config));

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
      reportButton.className = "delete-button";
      reportButton.textContent = "Report issue";
      reportButton.addEventListener("click", () => promptIssue(config));

      actions.append(launchButton, editButton, reportButton);
      item.appendChild(actions);
      configList.appendChild(item);
    });
  }

  function populateFormForEdit(config) {
    labelInput.value = config.label;
    widthInput.value = config.width;
    heightInput.value = config.height;
    zoomInput.value = config.zoom;
    notesInput.value = config.notes || "";
    configForm.dataset.mode = "edit";
    configForm.dataset.editId = config.id;
  }

  function resetForm() {
    labelInput.value = "";
    widthInput.value = DEFAULT_WIDTH;
    heightInput.value = DEFAULT_HEIGHT;
    zoomInput.value = DEFAULT_ZOOM;
    notesInput.value = "";
    configForm.dataset.mode = "add";
    delete configForm.dataset.editId;
  }

  function getConfigs() {
    return JSON.parse(localStorage.getItem("configs")) || [];
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

  function startBatchTest() {
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

    statusEntries = [];
    renderStatusList();
    closeAllWindows("Opening new batch");

    configs.forEach((config) => openTestWindow(targetUrl, config));
  }

  function launchConfig(config) {
    const targetUrl = getValidatedUrl();
    if (!targetUrl) {
      alert("Enter a valid HTTP(s) URL to test.");
      return;
    }
    closeAllWindows("Refreshing layout");
    openTestWindow(targetUrl, config);
  }

  function openTestWindow(url, config) {
    const width = config.width || DEFAULT_WIDTH;
    const height = config.height || DEFAULT_HEIGHT;
    const zoom = config.zoom || DEFAULT_ZOOM;
    const logLabel = config.label || `${width}×${height}`;

    logStatus(logLabel, `Launching ${width}×${height}`);
    const features = `width=${width},height=${height},resizable=yes,scrollbars=yes`;
    const newWindow = window.open(url, "_blank", features);

    if (!newWindow) {
      logStatus(logLabel, "Popup blocked or window failed to open", "error");
      return;
    }

    openedWindows.push(newWindow);

    newWindow.addEventListener("load", () => {
      try {
        newWindow.document.body.style.zoom = zoom;
        injectCloseListener(newWindow);
        logStatus(logLabel, "Ready — zoom applied", "success");
      } catch (error) {
        logStatus(logLabel, "Loaded but zoom/style injection blocked", "warn");
      }
    });
  }

  function injectCloseListener(win) {
    try {
      const script = win.document.createElement("script");
      script.textContent = `
        const bc = new BroadcastChannel("window-manager");
        bc.onmessage = (event) => {
          if (event.data === "close-all") {
            window.close();
          }
        };
      `;
      win.document.head.appendChild(script);
    } catch (error) {
      // cross-origin pages won't allow DOM access; silently ignore
    }
  }

  function closeAllWindows(reason) {
    if (!openedWindows.length) return;
    logStatus("All layouts", `${reason || "Closing windows"}`, "warn");

    const bc = new BroadcastChannel("window-manager");
    bc.postMessage("close-all");

    openedWindows.forEach((win) => {
      try {
        if (!win.closed) win.close();
      } catch (error) {
        console.warn("Close fallback failed", error);
      }
    });
    openedWindows = [];
  }

  function getValidatedUrl() {
    const input = targetUrlInput.value.trim();
    if (!input) return null;
    try {
      const parsed = new URL(input);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      if (/^(chrome|edge|about|file):/.test(parsed.href)) return null;
      return parsed.href;
    } catch (error) {
      return null;
    }
  }

  function prefillTargetUrl(force = false) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentUrl = tabs?.[0]?.url;
      if (!currentUrl) return;
      if (force || !targetUrlInput.value.trim()) {
        if (/^(chrome|edge|about|file):/.test(currentUrl)) return;
        targetUrlInput.value = currentUrl;
      }
    });
  }

  function logStatus(title, detail, state = "info") {
    statusEntries.unshift({ title, detail, state, timestamp: Date.now() });
    if (statusEntries.length > STATUS_LIMIT) statusEntries.pop();
    renderStatusList();
  }

  function renderStatusList() {
    if (!statusList) return;
    if (!statusEntries.length) {
      statusList.innerHTML = `<div class="status-entry empty">Ready to launch configurations. Enter a URL and tap "Start test".</div>`;
      return;
    }
    statusList.innerHTML = statusEntries
      .map((entry) => {
        const timeString = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `
          <div class="status-entry" data-state="${entry.state}">
            <strong>${entry.title}</strong>
            <span class="time">${timeString}</span>
            <small>${entry.detail}</small>
          </div>
        `;
      })
      .join("");
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
    notesInput.value = `Preset: ${preset.label}`;
    configForm.dataset.mode = "add";
    delete configForm.dataset.editId;
  }

  function addPopularBreakpoints() {
    const configs = getConfigs();
    PRESETS.forEach((preset) => {
      const exists = configs.some(
        (cfg) => cfg.width === preset.width && cfg.height === preset.height && cfg.zoom === preset.zoom
      );
      if (!exists) {
        const newConfig = {
          id: Date.now() + Math.random(),
          label: preset.label,
          width: preset.width,
          height: preset.height,
          zoom: preset.zoom,
          notes: "From preset"
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
    return JSON.parse(localStorage.getItem(ISSUE_KEY)) || [];
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
        const timeString = new Date(issue.timestamp).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
        return `
          <div class="issue-entry">
            <strong>${issue.configLabel}</strong>
            <p>${issue.message}</p>
            <div class="meta">${timeString}</div>
          </div>
        `;
      })
      .join("");
  }

});
