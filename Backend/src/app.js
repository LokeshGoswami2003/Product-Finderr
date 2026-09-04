const express = require("express");
const helmet = require("helmet");
const { createLogger } = require("./config/logger");

function createApp({
  config,
  readiness,
  logger = createLogger({ name: "http", level: config.LOG_LEVEL }),
}) {
  const app = express();
  const httpLogger = logger.child("http");
  app.disable("x-powered-by");
  if (config.NODE_ENV === "production") {
    app.set("trust proxy", "loopback");
  }
  app.use(helmet());
  app.use(express.json({ limit: config.WS_MAX_PAYLOAD_BYTES }));
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      httpLogger.info("http.request", {
        method: request.method,
        path: request.path,
        status: response.statusCode,
        ms: Date.now() - startedAt,
      });
    });
    next();
  });

  app.get("/api/health/live", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/health/ready", (_request, response) => {
    const state = readiness();
    if (!state.ready) {
      httpLogger.warn("http.not_ready", {
        reason: state.reason || "not_ready",
      });
    }
    response.status(state.ready ? 200 : 503).json(state);
  });

  app.use((request, response) => {
    httpLogger.warn("http.not_found", {
      method: request.method,
      path: request.path,
    });
    response.status(404).json({ error: "Not found" });
  });

  return app;
}

module.exports = { createApp };
