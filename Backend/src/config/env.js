const { z } = require("zod");
const { defaultLevel } = require("./logger");

const positiveInteger = (defaultValue) =>
  z.coerce.number().int().positive().default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).optional(),
  APP_ORIGIN: z.string().url(),
  BEDROCK_API_KEY: z.string().min(20),
  BEDROCK_MODEL: z.string().min(1).default("deepseek.v3.2"),
  BEDROCK_REGION: z.string().min(1).default("ap-south-1"),
  BEDROCK_BASE_URL: z.string().url().optional(),
  BEDROCK_TIMEOUT_MS: positiveInteger(120000),
  CORPUS_ARTIFACT_DIR: z.string().min(1).default("./artifacts"),
  CHAT_MAX_MESSAGE_CHARS: positiveInteger(4000),
  CHAT_MAX_PRODUCT_TURNS: z.coerce.number().int().min(1).max(50).default(20),
  CHAT_MAX_HISTORY_TURNS: positiveInteger(10),
  CHAT_MAX_HISTORY_CHARS: positiveInteger(20000),
  DOCUMENT_FETCH_TIMEOUT_MS: positiveInteger(15000),
  DOCUMENT_CACHE_TTL_SECONDS: positiveInteger(3600),
  WS_MAX_PAYLOAD_BYTES: positiveInteger(32768),
  WS_HEARTBEAT_MS: positiveInteger(30000),
});

function parseEnv(environment = process.env) {
  const parsed = envSchema.parse(environment);
  return {
    ...parsed,
    LOG_LEVEL: parsed.LOG_LEVEL || defaultLevel(parsed.NODE_ENV),
  };
}

module.exports = { envSchema, parseEnv };
