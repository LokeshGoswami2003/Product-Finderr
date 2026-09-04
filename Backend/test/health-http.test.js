const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");

const { createApp } = require("../src/app");

const config = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  APP_ORIGIN: "http://localhost:5173",
  WS_MAX_PAYLOAD_BYTES: 32768,
};

test("health routes distinguish liveness and readiness", async () => {
  const app = createApp({
    config,
    readiness: () => ({ ready: false, status: "not_ready" }),
  });

  await request(app).get("/api/health/live").expect(200, { status: "ok" });
  await request(app)
    .get("/api/health/ready")
    .expect(503, { ready: false, status: "not_ready" });
});

test("production trusts only the loopback reverse proxy", () => {
  const app = createApp({
    config: { ...config, NODE_ENV: "production" },
    readiness: () => ({ ready: true, status: "ready" }),
  });

  assert.equal(app.get("trust proxy"), "loopback");
});
