const cheerio = require("cheerio");

const { createLogger } = require("../config/logger");
const { assertEastmanUrl } = require("../urls/eastman");

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 10_000;

function normalizeText(value) {
  return value
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHtmlText(html) {
  const document = cheerio.load(html);
  document("script, style, noscript").remove();
  document("br").replaceWith("\n");
  document("p, div, li, tr, h1, h2, h3, h4, h5, h6").each((_index, element) => {
    document(element).append("\n");
  });
  return normalizeText(document("body").text());
}

function relevantExcerpt(text, query, maxChars = MAX_DOCUMENT_TEXT_CHARS) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;

  const queryTerms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4),
  );
  const blocks = normalized.split(/\n{2,}/).filter(Boolean);
  const selected = new Set(blocks.slice(0, 3));
  const scored = blocks
    .map((block, index) => ({
      block,
      index,
      score: [...queryTerms].reduce(
        (score, term) => score + (block.toLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );

  let length = [...selected].reduce(
    (total, block) => total + block.length + 2,
    0,
  );
  for (const { block } of scored) {
    if (selected.has(block) || length + block.length + 2 > maxChars) continue;
    selected.add(block);
    length += block.length + 2;
  }

  return blocks
    .filter((block) => selected.has(block))
    .join("\n\n")
    .slice(0, maxChars);
}

function documentSource(product, type, title) {
  return {
    id: `${type}:${product.fgmn}`,
    title,
    url: product.links[type],
    fgmn: product.fgmn,
  };
}

function classifyDocumentError(error) {
  if (error?.name === "TimeoutError") return "request-timeout";
  if (error?.name === "AbortError") return "request-aborted";
  return "fetch-failed";
}

class EastmanDocumentClient {
  constructor({
    fetchImpl = fetch,
    timeoutMs = 15_000,
    cacheTtlMs = 60 * 60 * 1000,
    logger = createLogger({ name: "documents" }),
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.logger = logger.child("documents");
  }

  async fetchResponse(url, options = {}, signal) {
    assertEastmanUrl(url);
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const response = await this.fetchImpl(url, {
      ...options,
      signal: combinedSignal,
    });

    if (!response.ok) {
      throw new Error(
        `Eastman document endpoint returned HTTP ${response.status}`,
      );
    }
    return response;
  }

  async readText(response, maxBytes) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(
        "Eastman document response exceeds the configured size limit",
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(
        "Eastman document response exceeds the configured size limit",
      );
    }
    return text;
  }

  cached(key, loader) {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug("document.cache_hit", { key });
      return cached.promise;
    }

    const promise = loader().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, promise });
    return promise;
  }

  async fetchTds(product, query, signal) {
    this.logger.info("document.fetch_started", {
      type: "tds",
      fgmn: product.fgmn,
      name: product.displayName,
    });
    const fullText = await this.cached(`tds:${product.fgmn}`, async () => {
      const response = await this.fetchResponse(product.links.tds, {}, signal);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error("Eastman TDS endpoint did not return HTML");
      }
      const html = await this.readText(response, MAX_HTML_BYTES);
      const text = extractHtmlText(html);
      if (!text) throw new Error("Eastman TDS did not contain readable text");
      return text;
    });

    const document = {
      type: "tds",
      status: "available",
      label: "Technical data sheet",
      text: relevantExcerpt(fullText, query),
      source: documentSource(
        product,
        "tds",
        `${product.displayName} — Technical data sheet`,
      ),
    };
    this.logger.info("document.fetch_completed", {
      type: "tds",
      fgmn: product.fgmn,
      chars: document.text.length,
    });
    return document;
  }

  async enrichProduct(product, plan, query, signal) {
    this.logger.info("document.enrich_started", {
      fgmn: product.fgmn,
      name: product.displayName,
      includeTds: Boolean(plan.includeTds),
      includeSds: Boolean(plan.includeSds),
    });
    const documents = [];
    const requests = [];

    if (plan.includeTds) {
      if (product.documents.hasTds) {
        requests.push(
          this.fetchTds(product, query, signal)
            .then((document) => documents.push(document))
            .catch((error) => {
              if (signal?.aborted) throw error;
              const reason = classifyDocumentError(error);
              this.logger.warn("document.fetch_failed", {
                type: "tds",
                fgmn: product.fgmn,
                reason,
                error,
              });
            }),
        );
      } else {
        this.logger.info("document.skipped", {
          type: "tds",
          fgmn: product.fgmn,
          reason: "not-listed",
        });
      }
    }

    if (plan.includeSds) {
      this.logger.info("document.skipped", {
        type: "sds",
        fgmn: product.fgmn,
        reason: "link-only",
      });
    }

    await Promise.all(requests);
    documents.sort((left, right) => left.type.localeCompare(right.type));
    this.logger.info("document.enrich_completed", {
      fgmn: product.fgmn,
      documents: documents.map((document) => ({
        type: document.type,
        status: document.status,
        reason: document.reason || null,
      })),
    });
    return documents;
  }
}

module.exports = {
  EastmanDocumentClient,
  extractHtmlText,
  relevantExcerpt,
};
