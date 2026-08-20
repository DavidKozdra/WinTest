const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

// Patch and minor carry into the next place once they reach this value.
const VERSION_ROLLOVER = 40;

const outputDir = path.resolve(__dirname, "dist");
const outputFile = path.join(outputDir, "extension.zip");
const sourceDir = resolveExtensionDir();

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

/**
 * Bumps the version in package.json and mirrors it into manifest.json.
 *
 * Counts like an odometer: patch increments until it reaches VERSION_ROLLOVER,
 * then carries into minor and resets to 0; minor does the same into major.
 *
 * Done in-process rather than by shelling out to `npm version patch`, which
 * refuses to run when the git working tree is dirty, creates a commit and tag
 * on every build, and only knows about package.json - leaving manifest.json,
 * the version Chrome actually reads, to drift out of sync.
 */
function bumpPatchVersion() {
  const packagePath = path.join(__dirname, "package.json");
  const manifestPath = path.join(__dirname, "manifest.json");

  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const parts = String(pkg.version ?? "").split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Cannot bump malformed version in package.json: ${pkg.version}`);
  }

  const [major, minor, patch] = parts;
  let next;
  if (patch < VERSION_ROLLOVER) {
    next = `${major}.${minor}.${patch + 1}`;
  } else if (minor < VERSION_ROLLOVER) {
    next = `${major}.${minor + 1}.0`;
  } else {
    next = `${major + 1}.0.0`;
  }

  pkg.version = next;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  // Chrome reads this one, so it must not drift from package.json.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const previous = manifest.version;
  manifest.version = next;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Version bumped to ${next}${previous !== next ? ` (manifest was ${previous})` : ""}`);
  return next;
}

const version = bumpPatchVersion();

const output = fs.createWriteStream(outputFile);
const archive = archiver("zip", {
  zlib: { level: 9 },
});

output.on("close", () => {
  console.log(`Build complete: v${version}, ${archive.pointer()} total bytes written to ${outputFile}`);
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

