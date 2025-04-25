chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension Installed");
  });
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "open-url") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs.length || !tabs[0].url) {
          alert("Cannot access the current tab URL. Make sure you're on a regular webpage.");
          return;
        }
      
        const currentUrl = tabs[0].url;
      
        const configs = JSON.parse(localStorage.getItem("configs")) || [];
        if (configs.length === 0) {
          alert("No configurations found.");
          return;
        }
      
        configs.forEach((config) => {
          const width = config.width || 1000;
          const height = config.height || 1000;
          const zoom = config.zoom || 1;
      
          const newWindow = window.open(currentUrl, '', `width=${width},height=${height}`);
          if (newWindow) {
            newWindow.onload = () => {
              newWindow.document.body.style.zoom = zoom;
            };
          }
        });
      });
      
    }
  });
  