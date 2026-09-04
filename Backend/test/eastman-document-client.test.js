const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EastmanDocumentClient,
  extractHtmlText,
} = require("../src/documents/eastman-document-client");

const product = {
  fgmn: "71103853",
  displayName: "AdapT 100",
  documents: { hasTds: true, hasSds: true },
  links: {
    tds: "https://productcatalog.eastman.com/tds/ProdDatasheet.aspx?product=71103853",
    sds: "https://ws.eastman.com/ProductCatalogApps/PageControllers/MSDSAll_PC.aspx?Product=71103853",
  },
};

test("document helpers preserve useful TDS structure", () => {
  assert.equal(
    extractHtmlText(
      "<body><h1>Technical Data</h1><p>Density: 1.04 g/cm3</p></body>",
    ),
    "Technical Data\nDensity: 1.04 g/cm3",
  );
});

test("document enrichment fetches TDS HTML and skips SDS PDF collection", async () => {
  const calls = [];
  const client = new EastmanDocumentClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(
        "<body><h1>AdapT 100</h1><p>Density: 1.04 g/cm3</p></body>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });

  const documents = await client.enrichProduct(
    product,
    { includeTds: true, includeSds: true },
    "What are the properties and handling requirements in India?",
  );

  assert.deepEqual(
    documents.map(({ type, status }) => [type, status]),
    [["tds", "available"]],
  );
  assert.match(documents[0].text, /1\.04 g\/cm3/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /ProdDatasheet/);
});

test("document enrichment continues without TDS text when the endpoint fails", async () => {
  const client = new EastmanDocumentClient({
    fetchImpl: async () => new Response("Unavailable", { status: 503 }),
  });

  const documents = await client.enrichProduct(
    product,
    { includeTds: true, includeSds: false },
    "Tell me about AdapT 100",
  );

  assert.deepEqual(documents, []);
});
