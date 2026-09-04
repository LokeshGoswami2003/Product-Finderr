const { createHash } = require("node:crypto");
const { mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");

const { catalogSchema } = require("./catalog-schema");
const {
  PARSER_VERSION,
  SCHEMA_VERSION,
  normalizeCatalog,
} = require("./normalize");
const { validateEastmanUrl } = require("../urls/eastman");

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validateNormalizedCatalog(normalized, expectedProductCount) {
  if (normalized.products.length !== expectedProductCount) {
    throw new Error(
      `Catalog contains ${normalized.products.length} products; expected ${expectedProductCount}`,
    );
  }

  const identifiers = new Set(
    normalized.products.map((product) => product.fgmn),
  );
  if (identifiers.size !== normalized.products.length) {
    throw new Error("Normalized products contain duplicate FGMNs");
  }

  for (const product of normalized.products) {
    for (const url of Object.values(product.links)) {
      if (!validateEastmanUrl(url)) {
        throw new Error(
          `Product ${product.fgmn} contains a non-allowlisted URL`,
        );
      }
    }
  }
}

async function buildCatalogRelease({
  sourcePath,
  artifactDir,
  now = new Date(),
  expectedProductCount,
}) {
  const sourceBytes = await readFile(sourcePath);
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const catalog = catalogSchema.parse(JSON.parse(sourceBytes.toString("utf8")));
  const productCount =
    expectedProductCount ?? catalog.productDetails.labels.totalCount;
  const createdAt = now.toISOString();
  const normalized = normalizeCatalog(catalog);

  validateNormalizedCatalog(normalized, productCount);

  const releaseId = `${createdAt.replace(/[-:.]/g, "")}-${sourceHash.slice(0, 8)}`;
  const releasesDir = path.join(artifactDir, "releases");
  const releaseDir = path.join(releasesDir, releaseId);
  const temporaryDir = `${releaseDir}.tmp`;

  await mkdir(releasesDir, { recursive: true });
  await rm(temporaryDir, { recursive: true, force: true });
  await mkdir(temporaryDir);

  try {
    const report = {
      status: "ready",
      productCount: normalized.products.length,
    };
    const manifest = {
      releaseId,
      createdAt,
      schemaVersion: SCHEMA_VERSION,
      parserVersion: PARSER_VERSION,
      source: {
        path: path.basename(sourcePath),
        sha256: sourceHash,
      },
      files: {
        products: "products.json",
        report: "report.json",
      },
    };

    await Promise.all([
      writeJson(path.join(temporaryDir, "manifest.json"), manifest),
      writeJson(path.join(temporaryDir, "products.json"), normalized.products),
      writeJson(path.join(temporaryDir, "report.json"), report),
    ]);

    await rename(temporaryDir, releaseDir);

    const pointerPath = path.join(artifactDir, "current.json");
    const temporaryPointerPath = `${pointerPath}.tmp`;
    await writeJson(temporaryPointerPath, { releaseId });
    await rename(temporaryPointerPath, pointerPath);

    return { manifest, releaseDir, report };
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { buildCatalogRelease, validateNormalizedCatalog };
