const assert = require("node:assert/strict");
const test = require("node:test");

const { BedrockClient, BedrockError } = require("../src/bedrock/client");

test("Bedrock client uses the OpenAI-compatible DeepSeek endpoint", async () => {
  let request;
  const client = new BedrockClient({
    apiKey: "bedrock-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hello from DeepSeek" } }],
          usage: { total_tokens: 8 },
        }),
      };
    },
  });

  const completion = await client.createChatCompletion({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(
    request.url,
    "https://bedrock-runtime.ap-south-1.amazonaws.com/openai/v1/chat/completions",
  );
  assert.equal(request.options.headers.Authorization, "Bearer bedrock-key");
  assert.equal(JSON.parse(request.options.body).model, "deepseek.v3.2");
  assert.equal(completion.choices[0].message.content, "Hello from DeepSeek");
});

test("Bedrock client reports HTTP failures as BedrockError", async () => {
  const client = new BedrockClient({
    apiKey: "bedrock-key",
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "denied" } }),
    }),
  });

  await assert.rejects(
    () =>
      client.createChatCompletion({
        messages: [{ role: "user", content: "Hello" }],
      }),
    (error) => error instanceof BedrockError && error.status === 403,
  );
});

test("Bedrock client streams text deltas", async () => {
  const encoder = new TextEncoder();
  const client = new BedrockClient({
    apiKey: "bedrock-key",
    fetchImpl: async () => ({
      ok: true,
      body: (async function* () {
        yield encoder.encode('data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n');
        yield encoder.encode('data: {"choices":[{"delta":{"content":"there"}}]}\n\n');
        yield encoder.encode("data: [DONE]\n\n");
      })(),
    }),
  });

  const deltas = [];
  const completion = await client.createChatCompletionStream({
    messages: [{ role: "user", content: "Hello" }],
    onDelta(delta) {
      deltas.push(delta);
    },
  });

  assert.deepEqual(deltas, ["Hi ", "there"]);
  assert.equal(completion.choices[0].message.content, "Hi there");
});
