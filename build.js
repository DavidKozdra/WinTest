const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const outputDir = path.resolve(__dirname, "dist");
const outputFile = path.join(outputDir, "extension.zip");
const sourceDir = resolveExtensionDir();

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const output = fs.createWriteStream(outputFile);
const archive = archiver("zip", {
  zlib: { level: 9 },
});

output.on("close", () => {
  console.log(`Build complete: ${archive.pointer()} total bytes written to ${outputFile}`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);

// Allowlist, not a denylist: the store package should contain only what the
// extension loads at runtime. Screenshots, build scripts and node_modules have
// no business in the upload, and the unscaled 1MB source icon was most of the
// old 2.3MB zip.
const RELEASE_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "verification-store.js",
  "verification-client.js",
  "style.css",
  "viewer.html",
  "viewer.css",
  "viewer.js",
];

const RELEASE_DIRS = ["icons"];

for (const file of RELEASE_FILES) {
  const fullPath = path.join(sourceDir, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required release file: ${file}`);
  }
  archive.file(fullPath, { name: file });
}

for (const dir of RELEASE_DIRS) {
  const fullPath = path.join(sourceDir, dir);
  if (fs.existsSync(fullPath)) {
    archive.directory(fullPath, dir);
  }
}

archive.finalize();

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
