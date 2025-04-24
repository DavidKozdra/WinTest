const { exec } = require("child_process");
const path = require("path");
const os = require("os");

const EXT_DIR = path.resolve(__dirname, "extension");

// Detect platform
const platform = os.platform();

let chromeCmd;

if (platform === "darwin") {
  // macOS
  chromeCmd = `open -a "Google Chrome" --args --load-extension="${EXT_DIR}"`;
} else if (platform === "win32") {
  // Windows
  const chromePath = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`;
  chromeCmd = `${chromePath} --load-extension="${EXT_DIR}"`;
} else if (platform === "linux") {
  // Linux
  chromeCmd = `google-chrome --load-extension="${EXT_DIR}"`;
} else {
  console.error("❌ Unsupported platform:", platform);
  process.exit(1);
}

console.log("🚀 Launching Chrome with extension from:", EXT_DIR);
exec(chromeCmd, (err, stdout, stderr) => {
  if (err) {
    console.error("❌ Failed to launch Chrome:", err.message);
    process.exit(1);
  }
  if (stderr) console.error(stderr);
  if (stdout) console.log(stdout);
});
