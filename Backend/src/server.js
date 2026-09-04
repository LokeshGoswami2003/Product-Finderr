const http = require("node:http");
const path = require("node:path");

const { createApp } = require("./app");
const { ConversationStore } = require("./chat/conversation-store");
const { BedrockClient } = require("./bedrock/client");
const { ChatOrchestrator } = require("./chat/orchestrator");
const { loadActiveRelease } = require("./corpus/load-release");
const { parseEnv } = require("./config/env");
const { createLogger } = require("./config/logger");
const {
  EastmanDocumentClient,
} = require("./documents/eastman-document-client");
const { attachChatWebSocket } = require("./websocket/chat-server");

function createGenerationClient(config, logger) {
  return new BedrockClient({
    apiKey: config.BEDROCK_API_KEY,
    model: config.BEDROCK_MODEL,
    region: config.BEDROCK_REGION,
    baseUrl: config.BEDROCK_BASE_URL,
    timeoutMs: config.BEDROCK_TIMEOUT_MS,
    logger,
  });
}

async function createServer({
  config = parseEnv(),
  modelClient,
  logger = createLogger({ name: "server", level: config.LOG_LEVEL }),
} = {}) {
  const conversationStore = new ConversationStore({
    maxProductTurns: config.CHAT_MAX_PRODUCT_TURNS,
    maxHistoryTurns: config.CHAT_MAX_HISTORY_TURNS,
    maxHistoryChars: config.CHAT_MAX_HISTORY_CHARS,
  });
  let corpus;
  let readinessError = null;
  try {
    corpus = await loadActiveRelease(path.resolve(config.CORPUS_ARTIFACT_DIR));
    logger.info("corpus.loaded", {
      releaseId: corpus.manifest.releaseId,
      productCount: corpus.products.length,
      corpusStatus: corpus.report.status,
    });
  } catch (error) {
    readinessError = error;
    logger.error("corpus.load_failed", {
      artifactDir: config.CORPUS_ARTIFACT_DIR,
      error,
    });
  }

  const readiness = () => ({
    ready: Boolean(corpus),
    status: corpus ? "ready" : "not_ready",
    corpusVersion: corpus?.manifest.releaseId || null,
    corpusStatus: corpus?.report.status || null,
    ...(readinessError ? { reason: "corpus_unavailable" } : {}),
  });
  const app = createApp({
    config,
    readiness,
    logger,
  });
  const server = http.createServer(app);

  if (corpus) {
    const client = modelClient || createGenerationClient(config, logger);
    const documentClient = new EastmanDocumentClient({
      timeoutMs: config.DOCUMENT_FETCH_TIMEOUT_MS,
      cacheTtlMs: config.DOCUMENT_CACHE_TTL_SECONDS * 1000,
      logger,
    });
    const orchestrator = new ChatOrchestrator({
      products: corpus.products,
      documentClient,
      modelClient: client,
      logger,
    });
    attachChatWebSocket({
      server,
      config,
      orchestrator,
      corpusVersion: corpus.manifest.releaseId,
      conversationStore,
      logger,
    });
  }

  return { app, server, readiness, conversationStore };
}

async function start() {
  const config = parseEnv();
  const logger = createLogger({ name: "server", level: config.LOG_LEVEL });
  logger.info("server.starting", {
    env: config.NODE_ENV,
    port: config.PORT,
    origin: config.APP_ORIGIN,
    model: config.BEDROCK_MODEL,
    region: config.BEDROCK_REGION,
  });
  const { server } = await createServer({ config, logger });
  server.listen(config.PORT, "127.0.0.1", () => {
    logger.info("server.listening", {
      host: "127.0.0.1",
      port: config.PORT,
    });
  });
}

module.exports = { createGenerationClient, createServer, start };
