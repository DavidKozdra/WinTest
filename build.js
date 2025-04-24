const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const outputDir = path.resolve(__dirname, "dist");
const outputFile = path.join(outputDir, "extension.zip");
const sourceDir = path.resolve(__dirname, "extension");

// Ensure the output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const output = fs.createWriteStream(outputFile);
const archive = archiver("zip", {
  zlib: { level: 9 },
});

output.on("close", () => {
  console.log(`✔ Build complete: ${archive.pointer()} total bytes written to ${outputFile}`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(sourceDir, false);
archive.finalize();
