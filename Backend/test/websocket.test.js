const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { WebSocket } = require("ws");

const {
  attachChatWebSocket,
  classifyChatError,
  validateEventLimits,
} = require("../src/websocket/chat-server");

const config = {
  APP_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "silent",
  CHAT_MAX_MESSAGE_CHARS: 4000,
  CHAT_MAX_PRODUCT_TURNS: 3,
  CHAT_MAX_HISTORY_TURNS: 10,
  CHAT_MAX_HISTORY_CHARS: 20000,
  WS_MAX_PAYLOAD_BYTES: 32768,
  WS_HEARTBEAT_MS: 30000,
};

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server, webSocketServer) {
  for (const client of webSocketServer.clients) client.terminate();
  await new Promise((resolve) => webSocketServer.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}

test("WebSocket emits the complete protocol lifecycle", async (context) => {
  const server = http.createServer();
  const webSocketServer = attachChatWebSocket({
    server,
    config,
    corpusVersion: "release-1",
    orchestrator: {
      answer: async ({ onProgress, onDelta }) => {
        onProgress("grounding");
        onProgress("generating");
        onDelta("Grounded ");
        onDelta("answer");
        return {
          text: "Grounded answer",
          usage: { total_tokens: 10 },
          retrieval: {
            results: [
              {
                product: {
                  fgmn: "71103853",
                  displayName: "AdapT 100",
                  documents: {},
                  links: {},
                },
                sources: [{ id: "product:71103853", title: "AdapT 100" }],
              },
            ],
          },
        };
      },
    },
  });
  context.after(() => close(server, webSocketServer));
  const port = await listen(server);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
    origin: config.APP_ORIGIN,
  });
  const events = [];

  await new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (event.type === "connection.ready") {
        socket.send(
          JSON.stringify({
            type: "chat.request",
            requestId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
            message: "AdapT 100",
            region: null,
          }),
        );
      }
      if (event.type === "answer.done") resolve();
    });
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "connection.ready",
      "conversation.snapshot",
      "chat.accepted",
      "chat.progress",
      "chat.progress",
      "chat.progress",
      "answer.delta",
      "answer.delta",
      "answer.sources",
      "answer.products",
      "answer.done",
    ],
  );
  assert.equal(events[0].protocolVersion, 2);
  assert.deepEqual(
    events
      .filter((event) => event.type === "answer.delta")
      .map((event) => event.delta),
    ["Grounded ", "answer"],
  );
  socket.close();
});

test("WebSocket rejects upgrades from a different origin", async (context) => {
  const server = http.createServer();
  const webSocketServer = attachChatWebSocket({
    server,
    config,
    corpusVersion: "release-1",
    orchestrator: { answer: async () => assert.fail("must not be called") },
  });
  context.after(() => close(server, webSocketServer));
  const port = await listen(server);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
    origin: "https://attacker.example",
  });

  const statusCode = await new Promise((resolve) => {
    socket.on("unexpected-response", (_request, response) =>
      resolve(response.statusCode),
    );
  });
  assert.equal(statusCode, 403);
});

test("WebSocket request limits bound current messages", () => {
  const baseEvent = {
    type: "chat.request",
    message: "request",
  };
  assert.equal(validateEventLimits(baseEvent, config), true);
  assert.equal(
    validateEventLimits(
      { ...baseEvent, message: "x".repeat(config.CHAT_MAX_MESSAGE_CHARS + 1) },
      config,
    ),
    false,
  );
});

test("WebSocket classifies Bedrock failures as model errors", () => {
  assert.equal(classifyChatError({ name: "BedrockError" }), "model_error");
  assert.equal(
    classifyChatError(new Error("document fetch failed")),
    "chat_error",
  );
});

test("conversation context and the fourth product request return a handoff", async (context) => {
  const server = http.createServer();
  const calls = [];
  const product = {
    fgmn: "71103853",
    displayName: "AdapT 100",
    documents: { hasTds: true, hasSds: true },
    links: {
      detail:
        "https://www.eastman.com/en/products/product-detail/71103853/adapt-100",
    },
  };
  const webSocketServer = attachChatWebSocket({
    server,
    config,
    corpusVersion: "release-1",
    orchestrator: {
      answer: async (request) => {
        calls.push(request);
        if (request.intent) {
          return {
            text: request.intent.response,
            retrieval: { outcome: "social", results: [] },
            usage: null,
          };
        }
        return {
          text: `Grounded answer ${calls.length}`,
          usage: { total_tokens: 10 },
          retrieval: {
            results: [
              {
                product,
                sources: [
                  {
                    id: "product:71103853",
                    title: "AdapT 100",
                    url: product.links.detail,
                  },
                ],
              },
            ],
          },
        };
      },
    },
  });
  context.after(() => close(server, webSocketServer));
  const port = await listen(server);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/chat`, {
    origin: config.APP_ORIGIN,
  });
  const messages = [
    "Tell me about AdapT 100",
    "Hello there",
    "What about its technical properties?",
    "Tell me more about it",
    "Find another suitable product",
  ];
  const doneEvents = [];
  const sourceEvents = [];
  let snapshot;
  let nextMessage = 0;

  await new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === "conversation.snapshot" && !snapshot) {
        snapshot = event;
        const message = messages[nextMessage];
        nextMessage += 1;
        socket.send(
          JSON.stringify({
            type: "chat.request",
            requestId: randomUUID(),
            message,
            region: null,
          }),
        );
      }
      if (event.type === "answer.sources") sourceEvents.push(event);
      if (event.type === "answer.done") {
        doneEvents.push(event);
        if (nextMessage < messages.length) {
          const message = messages[nextMessage];
          nextMessage += 1;
          socket.send(
            JSON.stringify({
              type: "chat.request",
              requestId: randomUUID(),
              message,
              region: null,
            }),
          );
        } else {
          resolve();
        }
      }
    });
  });

  assert.equal(snapshot.quota.usedProductTurns, 0);
  assert.equal(snapshot.messages.length, 0);
  assert.equal(
    doneEvents[1].quota.usedProductTurns,
    1,
    "a greeting must not use quota",
  );
  assert.equal(doneEvents.at(-1).stopReason, "handoff");
  assert.equal(doneEvents.at(-1).quota.limitReached, true);
  assert.ok(
    sourceEvents.at(-1).sources[0].url.includes("/contact-us/product-inquiry"),
  );
  assert.equal(
    calls.length,
    4,
    "the fourth product request must bypass orchestration",
  );

  const contextualCall = calls.find(
    (call) => call.message === "What about its technical properties?",
  );
  assert.deepEqual(contextualCall.retrievalContext.recentProductFgmns, [
    "71103853",
  ]);
  assert.ok(
    contextualCall.history.some(
      (entry) => entry.content === "Grounded answer 1",
    ),
  );
  socket.close();
});
