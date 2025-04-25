document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_WIDTH = 1000;
  const DEFAULT_HEIGHT = 1000;
  const DEFAULT_ZOOM = 1;

  loadConfigs();

  const addConfigButton = document.getElementById("add-config");
  if (addConfigButton) {
    addConfigButton.addEventListener("click", () => {
      resetForm();
      document.getElementById("config-form").dataset.mode = "add";
    });
  }

  const configForm = document.getElementById("config-form");
  if (configForm) {
    configForm.addEventListener("submit", (event) => {
      event.preventDefault();

      let width = parseInt(document.getElementById("width").value) || DEFAULT_WIDTH;
      let height = parseInt(document.getElementById("height").value) || DEFAULT_HEIGHT;
      let zoom = parseFloat(document.getElementById("zoom").value) || DEFAULT_ZOOM;

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
        const configs = JSON.parse(localStorage.getItem("configs")) || [];

        if (configs.length === 0) {
          alert("No configurations found.");
          return;
        }

        configs.forEach((config) => {
          const width = config.width || DEFAULT_WIDTH;
          const height = config.height || DEFAULT_HEIGHT;
          const zoom = config.zoom || DEFAULT_ZOOM;

          const newWindow = window.open(currentUrl, '', `width=${width},height=${height}`);

          if (newWindow) {
            newWindow.onload = () => {
              newWindow.document.body.style.zoom = zoom;
            };
          }
        });
      });
    });
  }

  let currentSort = { field: "width", direction: 1 };

  function sortConfigs(configs, field = "width", direction = 1) {
    return [...configs].sort((a, b) => {
      if (a[field] < b[field]) return -1 * direction;
      if (a[field] > b[field]) return 1 * direction;
      return 0;
    });
  }

  function loadConfigs() {
    const configs = JSON.parse(localStorage.getItem("configs")) || [];
    const configList = document.getElementById("config-list");

    if (!configList) {
      alert("Config container not found.");
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
      editButton.addEventListener("click", () => editConfig(config));

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Delete";
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
  }

  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.dataset.tab;
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`.${tabName}`).classList.add("active");
    });
  });
});
