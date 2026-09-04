const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("./fixtures/adapt-100.json");
const { parseEnv } = require("../src/config/env");
const { parseClientEvent } = require("../src/protocol/client-events");
const { buildProductUrls, validateEastmanUrl } = require("../src/urls/eastman");

const validEnv = {
  APP_ORIGIN: "http://localhost:5173",
  BEDROCK_API_KEY: "b".repeat(20),
};

test("environment schema applies safe defaults", () => {
  const env = parseEnv(validEnv);

  assert.equal(env.PORT, 3000);
  assert.equal(env.LOG_LEVEL, "debug");
  assert.equal(env.BEDROCK_MODEL, "deepseek.v3.2");
  assert.equal(env.BEDROCK_REGION, "ap-south-1");
  assert.equal(env.BEDROCK_TIMEOUT_MS, 120000);
  assert.equal(env.CHAT_MAX_PRODUCT_TURNS, 20);
});

test("environment schema defaults LOG_LEVEL from NODE_ENV", () => {
  assert.equal(parseEnv({ ...validEnv, NODE_ENV: "test" }).LOG_LEVEL, "silent");
  assert.equal(
    parseEnv({ ...validEnv, NODE_ENV: "production" }).LOG_LEVEL,
    "info",
  );
});

test("environment schema rejects a missing Bedrock API key", () => {
  const { BEDROCK_API_KEY, ...withoutBedrockKey } = validEnv;

  assert.throws(() => parseEnv(withoutBedrockKey), /BEDROCK_API_KEY/i);
});

test("client protocol parses chat requests and rejects unknown fields", () => {
  const event = parseClientEvent({
    type: "chat.request",
    requestId: "d9428888-122b-11e1-b85c-61cd3cbb3210",
    message: "Compare products",
  });

  assert.equal(event.region, null);
  assert.throws(() => parseClientEvent({ ...event, unexpected: true }));
  assert.throws(() => parseClientEvent({ ...event, history: [] }));
  assert.deepEqual(parseClientEvent({ type: "chat.clear" }), {
    type: "chat.clear",
  });
});

test("Eastman URL builders produce allowlisted HTTPS links", () => {
  const urls = buildProductUrls(fixture);

  for (const url of Object.values(urls)) {
    assert.equal(validateEastmanUrl(url), true);
  }
  assert.match(urls.detail, /71000122\/adapt-100$/);
  assert.equal(new URL(urls.sds).searchParams.get("Product"), fixture.fgmn);
});

test("Eastman URL validation rejects lookalike and non-HTTPS links", () => {
  assert.equal(
    validateEastmanUrl("https://www.eastman.com.example.test/product"),
    false,
  );
  assert.equal(validateEastmanUrl("http://www.eastman.com/product"), false);
});
