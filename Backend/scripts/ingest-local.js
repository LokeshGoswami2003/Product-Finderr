const path = require("node:path");

const { buildCatalogRelease } = require("../src/corpus/artifacts");

async function main() {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  const sourcePath = path.resolve(
    process.argv[2] || path.join(repositoryRoot, "productfinder.json"),
  );
  const artifactDir = path.resolve(
    process.argv[3] || path.join(repositoryRoot, "artifacts"),
  );

  const { manifest, report } = await buildCatalogRelease({
    sourcePath,
    artifactDir,
    expectedProductCount: 979,
  });

  process.stdout.write(
    `Created catalog release ${manifest.releaseId}: ${report.productCount} products.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Ingestion failed: ${error.message}\n`);
  process.exitCode = 1;
});
