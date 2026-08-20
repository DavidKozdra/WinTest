const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EXT_DIR = resolveExtensionDir();
const platform = os.platform();

let chromeCmd;

if (platform === "darwin") {
  chromeCmd = `open -a "Google Chrome" --args --load-extension="${EXT_DIR}"`;
} else if (platform === "win32") {
  const chromePath = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`;
  chromeCmd = `${chromePath} --load-extension="${EXT_DIR}"`;
} else if (platform === "linux") {
  chromeCmd = `google-chrome --load-extension="${EXT_DIR}"`;
} else {
  console.error("Unsupported platform:", platform);
  process.exit(1);
}

console.log("Launching Chrome with extension from:", EXT_DIR);
exec(chromeCmd, (err, stdout, stderr) => {
  if (err) {
    console.error("Failed to launch Chrome:", err.message);
    process.exit(1);
  }
  if (stderr) console.error(stderr);
  if (stdout) console.log(stdout);
});

function resolveExtensionDir() {
  const legacyDir = path.resolve(__dirname, "extension");
  const legacyManifest = path.join(legacyDir, "manifest.json");
  const rootManifest = path.resolve(__dirname, "manifest.json");

  if (fs.existsSync(legacyManifest)) {
    return legacyDir;
  }

  if (fs.existsSync(rootManifest)) {
    return __dirname;
  }

  throw new Error("No manifest.json found in project root or ./extension");
}
