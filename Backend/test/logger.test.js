const assert = require("node:assert/strict");
const test = require("node:test");

const { createLogger, previewText } = require("../src/config/logger");

function captureStream() {
  let output = "";
  return {
    write(chunk) {
      output += chunk;
    },
    text() {
      return output;
    },
    lines() {
      return output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

test("logger writes JSON flow events and redacts secrets", () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const logger = createLogger({
    name: "chat",
    level: "debug",
    stdout,
    stderr,
    now: () => "2026-09-04T00:00:00.000Z",
  }).child("orchestrator", { conversationId: "conv-1" });

  logger.info("chat.products_selected", {
    fgmns: ["71103853"],
    apiKey: "should-not-appear",
  });
  logger.error("ws.chat_failed", {
    error: new Error("Bedrock timeout"),
  });
  logger.debug("document.cache_hit", { key: "tds:71103853" });

  const [info] = stdout.lines();
  const [error] = stderr.lines();
  assert.equal(info.event, "chat.products_selected");
  assert.equal(info.component, "chat.orchestrator");
  assert.equal(info.conversationId, "conv-1");
  assert.equal(info.apiKey, "[redacted]");
  assert.deepEqual(info.fgmns, ["71103853"]);
  assert.equal(error.level, "error");
  assert.equal(error.error.name, "Error");
  assert.equal(error.error.message, "Bedrock timeout");
  assert.match(stdout.text(), /document.cache_hit/);
});

test("silent logger emits nothing", () => {
  const stdout = captureStream();
  const logger = createLogger({ name: "app", level: "silent", stdout });
  logger.info("server.listening", { port: 3000 });
  assert.equal(stdout.text(), "");
});

test("message metadata never includes chat content", () => {
  const message = "Confidential formulation requirement";
  const metadata = previewText(message);

  assert.deepEqual(metadata, { chars: message.length });
  assert.doesNotMatch(JSON.stringify(metadata), /Confidential|formulation/);
});
