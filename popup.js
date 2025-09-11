document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_WIDTH = 1000;
  const DEFAULT_HEIGHT = 1000;
  const DEFAULT_ZOOM = 1;

  let openedWindows = []; // store references to all opened windows
  let tabManager; // for tab control

  loadConfigs();

  // --- FORM HANDLING ---
  const configForm = document.getElementById("config-form");
  if (configForm) {
    configForm.addEventListener("submit", (event) => {
      event.preventDefault();

      let width = parseInt(document.getElementById("width").value) || DEFAULT_WIDTH;
      let height = parseInt(document.getElementById("height").value) || DEFAULT_HEIGHT;
      let zoom = parseFloat(document.getElementById("zoom").value) || DEFAULT_ZOOM;

      if (width <= 0 || height <= 0 || zoom <= 0) {
        alert("Invalid config values. Width, height, and zoom must be greater than 0.");
        return;
      }

      const config = {
        id: Date.now(),
        width,
        height,
        zoom,
      };

      const mode = configForm.dataset.mode;
      if (mode === "edit") {
        config.id = parseInt(configForm.dataset.editId);
      }
      saveConfig(config);

      loadConfigs();
      resetForm();
    });
  }

  const cancelConfigButton = document.getElementById("cancel-config");
  if (cancelConfigButton) {
    cancelConfigButton.addEventListener("click", resetForm);
  }

  const startTestButton = document.getElementById("start-test");
  if (startTestButton) {
    startTestButton.addEventListener("click", () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length || !tabs[0] || !tabs[0].url) {
          alert("Unable to access the current tab URL. Make sure it's a regular webpage.");
          return;
        }

        const currentUrl = tabs[0].url;

        // prevent restricted pages (like chrome://, about:, edge://, file://)
        if (/^(chrome|about|edge|file):\/\//.test(currentUrl)) {
          alert("This tab cannot be opened in a new window (restricted URL).");
          return;
        }

        const configs = JSON.parse(localStorage.getItem("configs")) || [];

        if (configs.length === 0) {
          alert("No configurations found. Please add one first.");
          return;
        }

        // close previously opened windows before opening new ones
        closeAllWindows();

        configs.forEach((config) => {
          const width = config.width || DEFAULT_WIDTH;
          const height = config.height || DEFAULT_HEIGHT;
          const zoom = config.zoom || DEFAULT_ZOOM;

          const newWindow = window.open(currentUrl, "_blank", `width=${width},height=${height}`);
          if (newWindow) {
            openedWindows.push(newWindow);

            newWindow.onload = () => {
              try {
                newWindow.document.body.style.zoom = zoom;

                // Inject BroadcastChannel listener into the child window
                const script = newWindow.document.createElement("script");
                script.textContent = `
                  const bc = new BroadcastChannel("window-manager");
                  bc.onmessage = (event) => {
                    if (event.data === "close-all") {
                      window.close();
                    }
                  };
                `;
                newWindow.document.head.appendChild(script);
              } catch (e) {
                console.warn("Could not inject event listener into child window:", e);
              }
            };
          } else {
            alert("Failed to open a new window. Check your browser settings (pop-ups may be blocked).");
          }
        });
      });
    });
  }

  const closeAllButton = document.getElementById("close-test");
  if (closeAllButton) {
    closeAllButton.addEventListener("click", () => {
      closeAllWindows();
    });
  }

  /** Closes all opened windows via event broadcast */
  function closeAllWindows() {
    const bc = new BroadcastChannel("window-manager");
    bc.postMessage("close-all");

    // fallback attempt (if broadcast fails)
    openedWindows.forEach((w) => {
      try {
        if (!w.closed) w.close();
      } catch (e) {
        console.warn("Fallback close failed:", e);
      }
    });
    openedWindows = [];
  }

  /** Sort configs (future use) */
  function sortConfigs(configs, field = "width", direction = 1) {
    return [...configs].sort((a, b) => {
      if (a[field] < b[field]) return -1 * direction;
      if (a[field] > b[field]) return 1 * direction;
      return 0;
    });
  }

  /** Load configs into UI */
  function loadConfigs() {
    const configs = JSON.parse(localStorage.getItem("configs")) || [];
    const configList = document.getElementById("config-list");

    if (!configList) {
      console.error("Config container not found.");
      return;
    }

    configList.innerHTML = "";

    configs.forEach((config) => {
      const configElement = document.createElement("div");
      configElement.classList.add("config-item");
      configElement.innerHTML = `
        <strong>Width:</strong> ${config.width}<br>
        <strong>Height:</strong> ${config.height}<br>
        <strong>Zoom:</strong> ${config.zoom * 100}%<br>
      `;

      const editButton = document.createElement("button");
      editButton.textContent = "Edit";
      editButton.classList.add("edit-button");

      editButton.addEventListener("click", () => {
        tabManager.activate("settings");
        editConfig(config);
      });

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
      deleteButton.classList.add("delete-button");
      deleteButton.addEventListener("click", () => deleteConfig(config.id));

      configElement.appendChild(editButton);
      configElement.appendChild(deleteButton);
      configList.appendChild(configElement);
    });
  }

  function editConfig(config) {
    document.getElementById("width").value = config.width;
    document.getElementById("height").value = config.height;
    document.getElementById("zoom").value = config.zoom;
    const form = document.getElementById("config-form");
    form.dataset.mode = "edit";
    form.dataset.editId = config.id;
    tabManager.activate("settings");
  }

  function saveConfig(config) {
    const configs = JSON.parse(localStorage.getItem("configs")) || [];
    const existingIndex = configs.findIndex((c) => c.id === config.id);

    if (existingIndex >= 0) {
      configs[existingIndex] = config;
    } else {
      configs.push(config);
    }

    localStorage.setItem("configs", JSON.stringify(configs));
  }

  function deleteConfig(id) {
    const configs = JSON.parse(localStorage.getItem("configs")) || [];
    const updatedConfigs = configs.filter((config) => config.id !== id);
    localStorage.setItem("configs", JSON.stringify(updatedConfigs));
    loadConfigs();
  }

  function resetForm() {
    document.getElementById("width").value = DEFAULT_WIDTH;
    document.getElementById("height").value = DEFAULT_HEIGHT;
    document.getElementById("zoom").value = DEFAULT_ZOOM;
    const form = document.getElementById("config-form");
    form.dataset.mode = "add";
    delete form.dataset.editId;
  }

  // --- NEW TAB SYSTEM ---
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

      // Activate first tab by default
      const defaultTab = this.tabButtons[0]?.dataset.tab;
      if (defaultTab) this.activate(defaultTab);
    }

    activate(tabName) {
      // Deactivate all
      this.tabButtons.forEach((btn) => btn.classList.remove(this.activeClass));
      this.tabContents.forEach((content) => content.classList.remove(this.activeClass));

      // Activate selected
      const targetBtn = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
      const targetContent = document.querySelector(`.tab-content.${tabName}`);

      if (targetBtn && targetContent) {
        targetBtn.classList.add(this.activeClass);
        targetContent.classList.add(this.activeClass);
      } else {
        console.error(`Tab "${tabName}" not found.`);
      }
    }

    next() {
      this.currentIndex = (this.currentIndex + 1) % this.tabButtons.length;
      this.activate(this.tabButtons[this.currentIndex].dataset.tab);
    }

    prev() {
      this.currentIndex = (this.currentIndex - 1 + this.tabButtons.length) % this.tabButtons.length;
      this.activate(this.tabButtons[this.currentIndex].dataset.tab);
    }
  }

  // Initialize TabManager
  tabManager = new TabManager(".tabs", ".tab-content");
});
