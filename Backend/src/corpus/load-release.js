const { readFile } = require("node:fs/promises");
const path = require("node:path");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadActiveRelease(artifactDir) {
  const pointer = await readJson(path.join(artifactDir, "current.json"));
  const releaseDir = path.join(artifactDir, "releases", pointer.releaseId);
  const [manifest, products, report] = await Promise.all([
    readJson(path.join(releaseDir, "manifest.json")),
    readJson(path.join(releaseDir, "products.json")),
    readJson(path.join(releaseDir, "report.json")),
  ]);

  if (manifest.releaseId !== pointer.releaseId) {
    throw new Error(
      "Active corpus pointer does not match its release manifest",
    );
  }

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("Active catalog is missing products");
  }

  return {
    releaseDir,
    manifest,
    products,
    report,
  };
}

module.exports = { loadActiveRelease };
