import assert from "node:assert/strict";
import test from "node:test";

import { chatReducer, initialChatState } from "../src/state/chat.js";
import { safeEastmanUrl } from "../src/protocol/links.js";

test("chat reducer accumulates answer deltas and structured results", () => {
  let state = chatReducer(initialChatState, {
    type: "request.started",
    requestId: "request-1",
    message: "Find a product",
  });
  state = chatReducer(state, {
    type: "answer.delta",
    requestId: "request-1",
    delta: "First ",
  });
  state = chatReducer(state, {
    type: "answer.delta",
    requestId: "request-1",
    delta: "answer.",
  });
  state = chatReducer(state, {
    type: "answer.products",
    requestId: "request-1",
    products: [{ fgmn: "71103853" }],
  });

  assert.equal(state.messages[1].content, "First answer.");
  assert.equal(state.messages[1].products[0].fgmn, "71103853");
});

test("clearing chat removes conversation and active request state", () => {
  const active = chatReducer(initialChatState, {
    type: "request.started",
    requestId: "request-1",
    message: "Find a product",
  });
  assert.deepEqual(
    chatReducer(active, { type: "chat.clear" }),
    initialChatState,
  );
});

test("server snapshots restore conversation context and answer completion updates quota", () => {
  const quota = {
    maxProductTurns: 3,
    usedProductTurns: 2,
    remainingProductTurns: 1,
    limitReached: false,
  };
  let state = chatReducer(initialChatState, {
    type: "conversation.snapshot",
    messages: [
      { id: "request-1", role: "user", content: "Tell me about AdapT 100" },
      { id: "answer:request-1", role: "assistant", content: "Grounded answer" },
    ],
    quota,
  });

  assert.equal(state.messages[1].content, "Grounded answer");
  assert.equal(state.quota.remainingProductTurns, 1);

  state = chatReducer(state, {
    type: "answer.done",
    quota: {
      ...quota,
      usedProductTurns: 3,
      remainingProductTurns: 0,
      limitReached: true,
    },
  });
  assert.equal(state.quota.limitReached, true);
});

test("source links allow only approved Eastman HTTPS hosts", () => {
  assert.ok(
    safeEastmanUrl("https://www.eastman.com/en/products/product-finder"),
  );
  assert.equal(safeEastmanUrl("http://www.eastman.com/product"), null);
  assert.equal(
    safeEastmanUrl("https://www.eastman.com.example.test/product"),
    null,
  );
});
