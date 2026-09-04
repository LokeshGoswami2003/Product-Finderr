const cheerio = require("cheerio");

const { buildProductUrls } = require("../urls/eastman");

const SCHEMA_VERSION = 1;
const PARSER_VERSION = 1;

function normalizeText(value) {
  const document = cheerio.load(`<body>${value}</body>`);
  document("script, style, noscript").remove();

  return document("body").text().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function fallbackSlug(displayName) {
  const slug = displayName
    .replace(/™|®|©/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new TypeError("A fallback slug could not be generated");
  }

  return slug;
}

function normalizeCatalog(catalog) {
  const { products } = catalog.productDetails;

  const normalizedProducts = products.map((product) => {
    const slug = fallbackSlug(product.DisplayName);
    const description = normalizeText(product.ShortDescription);

    return {
      fgmn: product.FGMN,
      displayName: normalizeText(product.DisplayName),
      description,
      documents: {
        hasTds: product.DisplayTDS,
        hasSds: product.DisplaySDS,
        hasSalesSpecification: product.DisplaySalesSpec,
      },
      links: buildProductUrls({ fgmn: product.FGMN, slug }),
    };
  });

  return { products: normalizedProducts };
}

module.exports = {
  PARSER_VERSION,
  SCHEMA_VERSION,
  fallbackSlug,
  normalizeCatalog,
  normalizeText,
};
