const MAX_SELECTED_PRODUCTS = 3;

function trimCatalogProduct(product) {
  return {
    fgmn: product.fgmn,
    name: product.displayName,
    description: product.description,
  };
}

function trimCatalog(products) {
  return products.map(trimCatalogProduct);
}

function indexProducts(products) {
  return new Map(products.map((product) => [String(product.fgmn), product]));
}

function extractJsonObject(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("The model returned no JSON");
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The model response did not contain a JSON object");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function collectCandidateFgmns(parsed) {
  if (Array.isArray(parsed?.fgmns)) return parsed.fgmns;
  if (Array.isArray(parsed?.FGMNs)) return parsed.FGMNs;
  if (Array.isArray(parsed?.products)) {
    return parsed.products.map((item) =>
      typeof item === "string" || typeof item === "number"
        ? item
        : item?.fgmn || item?.FGMN,
    );
  }
  return [];
}

function parseSelectedFgmns(
  text,
  knownFgmns,
  maxProducts = MAX_SELECTED_PRODUCTS,
) {
  const known = new Set([...knownFgmns].map((fgmn) => String(fgmn)));
  let parsed;
  try {
    parsed = extractJsonObject(text);
  } catch {
    parsed = null;
  }

  const selected = [];
  const seen = new Set();
  const pushKnown = (value) => {
    const fgmn = String(value || "").trim();
    if (!known.has(fgmn) || seen.has(fgmn) || selected.length >= maxProducts) {
      return;
    }
    seen.add(fgmn);
    selected.push(fgmn);
  };

  for (const value of collectCandidateFgmns(parsed || {})) {
    pushKnown(value);
  }

  if (selected.length === 0) {
    const fallback = String(text || "").match(/\b\d{7,10}\b/g) || [];
    for (const value of fallback) pushKnown(value);
  }

  return selected;
}

function productSource(product) {
  return {
    id: `product:${product.fgmn}`,
    title: product.displayName,
    url: product.links?.detail,
    fgmn: product.fgmn,
  };
}

function documentLinkSources(product) {
  const sources = [];
  if (product.documents?.hasTds && product.links?.tds) {
    sources.push({
      id: `tds:${product.fgmn}`,
      title: `${product.displayName} — Technical data sheet`,
      url: product.links.tds,
      fgmn: product.fgmn,
    });
  }
  if (product.documents?.hasSds && product.links?.sds) {
    sources.push({
      id: `sds:${product.fgmn}`,
      title: `${product.displayName} — Safety data sheet`,
      url: product.links.sds,
      fgmn: product.fgmn,
    });
  }
  return sources;
}

module.exports = {
  MAX_SELECTED_PRODUCTS,
  documentLinkSources,
  indexProducts,
  parseSelectedFgmns,
  productSource,
  trimCatalog,
};
