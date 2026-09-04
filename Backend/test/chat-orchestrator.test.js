const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ChatOrchestrator,
  SALES_SYSTEM_PROMPT,
  SELECTION_SYSTEM_PROMPT,
  buildDocumentPlan,
} = require("../src/chat/orchestrator");
const { parseSelectedFgmns, trimCatalog } = require("../src/chat/catalog");

const product = {
  fgmn: "71103853",
  displayName: "AdapT 100",
  description: "MDEA-based solvent for selective H2S removal.",
  documents: { hasTds: true, hasSds: true },
  links: {
    detail: "https://www.eastman.com/product",
    tds: "https://productcatalog.eastman.com/tds",
    sds: "https://ws.eastman.com/sds",
  },
};

const otherProduct = {
  fgmn: "71068692",
  displayName: "Eastman Tritan GX100",
  description: "Copolyester for heavy-gauge sheet.",
  documents: { hasTds: true, hasSds: true },
  links: {
    detail: "https://www.eastman.com/tritan",
    tds: "https://productcatalog.eastman.com/tds-tritan",
    sds: "https://ws.eastman.com/sds-tritan",
  },
};

function completion(content, usage = { total_tokens: 10 }) {
  return { choices: [{ message: { content } }], usage };
}

test("selected FGMNs are limited to known catalog identifiers", () => {
  assert.deepEqual(
    parseSelectedFgmns('{"fgmns":["71103853","99999999"]}', ["71103853"]),
    ["71103853"],
  );
  assert.deepEqual(
    parseSelectedFgmns("The best match is 71103853.", ["71103853", "71068692"]),
    ["71103853"],
  );
});

test("chat orchestration asks the model for FGMNs, fetches documents, then answers", async () => {
  const requests = [];
  const orchestrator = new ChatOrchestrator({
    products: [product, otherProduct],
    documentClient: {
      enrichProduct: async (selected, plan) => {
        assert.deepEqual(plan, { includeTds: true, includeSds: false });
        assert.equal(selected.fgmn, "71103853");
        return [
          {
            type: "tds",
            status: "available",
            label: "Technical data sheet",
            text: "Density: 1.04 g/cm3",
            source: { id: "tds:71103853", url: product.links.tds },
          },
        ];
      },
    },
    modelClient: {
      createChatCompletion: async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return completion('{"fgmns":["71103853"]}', { total_tokens: 12 });
        }
        return completion("AdapT 100 matches the supplied evidence.", {
          total_tokens: 30,
        });
      },
    },
  });

  const answer = await orchestrator.answer({
    message: "Tell me about AdapT 100",
    history: [],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].messages[0].content, SELECTION_SYSTEM_PROMPT);
  assert.match(requests[0].messages.at(-1).content, /PRODUCT_CATALOG_JSON/);
  assert.match(requests[0].messages.at(-1).content, /71103853/);
  assert.match(requests[0].messages.at(-1).content, /71068692/);
  assert.equal(requests[1].messages[0].content, SALES_SYSTEM_PROMPT);
  assert.match(requests[1].messages.at(-1).content, /Density: 1\.04 g\/cm3/);
  assert.match(answer.text, /AdapT 100/);
  assert.deepEqual(
    answer.retrieval.results[0].sources.map((source) => source.id),
    ["product:71103853", "tds:71103853", "sds:71103853"],
  );
  assert.deepEqual(answer.usage, {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 42,
  });
});

test("chat orchestration answers social messages without model or document calls", async () => {
  const orchestrator = new ChatOrchestrator({
    products: [product],
    documentClient: {
      enrichProduct: async () =>
        assert.fail("must not fetch greeting documents"),
    },
    modelClient: {
      createChatCompletion: async () =>
        assert.fail("must not call the model for greetings"),
    },
  });

  const answer = await orchestrator.answer({
    message: "Hello there, how are you?",
  });

  assert.equal(answer.kind, "social");
  assert.match(answer.text, /Eastman product assistant/i);
  assert.deepEqual(answer.retrieval.results, []);
});

test("follow-up questions reuse history and recent FGMNs", async () => {
  const requests = [];
  const orchestrator = new ChatOrchestrator({
    products: [product, otherProduct],
    documentClient: { enrichProduct: async () => [] },
    modelClient: {
      createChatCompletion: async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return completion('{"fgmns":["71103853"]}');
        }
        return completion("Its flash point is listed on the TDS.");
      },
    },
  });
  const history = [
    { role: "user", content: "Tell me about AdapT 100" },
    { role: "assistant", content: "AdapT 100 is a shortlisted option." },
  ];

  await orchestrator.answer({
    message: "What about its technical properties?",
    history,
    retrievalContext: {
      recentProductFgmns: ["71103853"],
      lastProductRequest: "Tell me about AdapT 100",
    },
  });

  assert.deepEqual(requests[0].messages.slice(1, 3), history);
  assert.match(
    requests[0].messages.at(-1).content,
    /RECENT_PRODUCT_FGMNS_JSON/,
  );
  assert.match(requests[0].messages.at(-1).content, /71103853/);
  assert.deepEqual(requests[1].messages.slice(1, 3), history);
});

test("a later product search can select a different catalog item", async () => {
  const requests = [];
  const orchestrator = new ChatOrchestrator({
    products: [product, otherProduct],
    documentClient: {
      enrichProduct: async (selected) => {
        assert.equal(selected.fgmn, "71068692");
        return [];
      },
    },
    modelClient: {
      createChatCompletion: async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          return completion('{"fgmns":["71068692"]}');
        }
        return completion("Tritan GX100 is the better next look.");
      },
    },
  });

  const answer = await orchestrator.answer({
    message: "Now show me a copolyester for heavy-gauge sheet",
    history: [
      { role: "user", content: "Tell me about AdapT 100" },
      { role: "assistant", content: "AdapT 100 is a shortlisted option." },
    ],
    retrievalContext: { recentProductFgmns: ["71103853"] },
  });

  assert.equal(answer.retrieval.results[0].product.fgmn, "71068692");
  assert.match(requests[1].messages.at(-1).content, /71068692/);
});

test("document enrichment fetches TDS text and leaves SDS as a link", () => {
  assert.deepEqual(buildDocumentPlan("Find a coating resin"), {
    includeTds: true,
    includeSds: false,
  });
  assert.deepEqual(buildDocumentPlan("Need the SDS for India"), {
    includeTds: true,
    includeSds: false,
  });
});

test("trimmed catalog keeps only the fields needed for demo prompting", () => {
  assert.deepEqual(trimCatalog([product]), [
    {
      fgmn: "71103853",
      name: "AdapT 100",
      description: "MDEA-based solvent for selective H2S removal.",
    },
  ]);
});
