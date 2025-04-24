document.addEventListener("DOMContentLoaded", () => {
    // Load existing configurations
    loadConfigs();
  
    // Add new configuration
    const addConfigButton = document.getElementById("add-config");
    if (addConfigButton) {
      addConfigButton.addEventListener("click", () => {
        resetForm();
        document.getElementById("config-form").dataset.mode = "add";
      });
    }
  
    // Save configuration (add or edit)
    const configForm = document.getElementById("config-form");
    if (configForm) {
      configForm.addEventListener("submit", (event) => {
        event.preventDefault();
  
        const width = parseInt(document.getElementById("width").value);
        const height = parseInt(document.getElementById("height").value);
        const zoom = parseFloat(document.getElementById("zoom").value);
  
        const config = {
          id: Date.now(),
          width,
          height,
          zoom,
        };
  
        const mode = document.getElementById("config-form").dataset.mode;
  
        if (mode === "edit") {
          config.id = parseInt(document.getElementById("config-form").dataset.editId);
          saveConfig(config);
        } else {
          saveConfig(config);
        }
  
        loadConfigs(); // Reload the list of configurations
        resetForm();   // Reset the form after saving
      });
    }
  
    // Cancel the configuration edit
    const cancelConfigButton = document.getElementById("cancel-config");
    if (cancelConfigButton) {
      cancelConfigButton.addEventListener("click", resetForm);
    }
  
    // Start Test button to run all configs
    const startTestButton = document.getElementById("start-test");
    if (startTestButton) {
      startTestButton.addEventListener("click", () => {
        // Get the current tab's URL
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentUrl = tabs[0].url; // Get the current URL
  
          // Fetch saved configurations from localStorage
          const configs = JSON.parse(localStorage.getItem("configs")) || [];
          if (configs.length == 0) {
            alert("NO CONFIGS")
          }
          // Open new windows for each saved config with the current URL
          configs.forEach((config) => {
            const newWindow = window.open(currentUrl, '', `width=${config.width},height=${config.height}`);
  
            if (newWindow) {
              // Wait until the window is loaded to apply zoom
              newWindow.onload = () => {
                // Apply zoom after the window content is loaded
                newWindow.document.body.style.zoom = config.zoom; // Apply zoom
              };
            }
          });
        });
      });
    }
  
    // Load and display configurations from localStorage
    function loadConfigs() {
      const configs = JSON.parse(localStorage.getItem("configs")) || [];

      
      const configList = document.getElementById("config-list");
      if (configList) {
        configList.innerHTML = ""; // Clear the list
  
        configs.forEach((config) => {
          const configElement = document.createElement("div");
          configElement.classList.add("config-item");
          configElement.innerHTML = `
            <strong>Width:</strong> ${config.width}<br>
            <strong>Height:</strong> ${config.height}<br>
            <strong>Zoom:</strong> ${config.zoom * 100}%<br>
          `;
  
          // Edit button
          const editButton = document.createElement("button");
          editButton.textContent = "Edit";
          editButton.addEventListener("click", () => editConfig(config));
  
          // Delete button
          const deleteButton = document.createElement("button");
          deleteButton.textContent = "Delete";
          deleteButton.addEventListener("click", () => deleteConfig(config.id));
  
          configElement.appendChild(editButton);
          configElement.appendChild(deleteButton);
          configList.appendChild(configElement);
        });
      }else {
        alert("Sorry no configs ")
      }
    }
  
    // Edit an existing configuration
    function editConfig(config) {
      document.getElementById("width").value = config.width;
      document.getElementById("height").value = config.height;
      document.getElementById("zoom").value = config.zoom;
      document.getElementById("config-form").dataset.mode = "edit";
      document.getElementById("config-form").dataset.editId = config.id;
    }
  
    // Save a configuration to localStorage
    function saveConfig(config) {
      const configs = JSON.parse(localStorage.getItem("configs")) || [];
  
      // If the config already exists, update it
      const existingIndex = configs.findIndex((c) => c.id === config.id);
      if (existingIndex >= 0) {
        configs[existingIndex] = config;
      } else {
        configs.push(config);
      }
  
      localStorage.setItem("configs", JSON.stringify(configs));
    }
  
    // Delete a configuration from localStorage
    function deleteConfig(id) {
      const configs = JSON.parse(localStorage.getItem("configs")) || [];
      const updatedConfigs = configs.filter((config) => config.id !== id);
  
      localStorage.setItem("configs", JSON.stringify(updatedConfigs));
      loadConfigs(); // Refresh the list after deletion
    }
  
    // Reset the form (used for both cancel and initial add)
    function resetForm() {
      document.getElementById("width").value = "";
      document.getElementById("height").value = "";
      document.getElementById("zoom").value = "";
      document.getElementById("config-form").dataset.mode = "add";
    }
  
    // Tab switching functionality
    const tabButtons = document.querySelectorAll(".tab-button");
    tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const tabName = button.dataset.tab;
  
        // Deactivate all buttons and hide all tab contents
        tabButtons.forEach((btn) => btn.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
  
        // Activate clicked button and show the corresponding tab content
        button.classList.add("active");
        document.querySelector(`.${tabName}`).classList.add("active");
      });
    });
  });
  