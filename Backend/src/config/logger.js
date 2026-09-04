const LEVELS = {
  silent: 100,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
};

const REDACTED_KEYS =
  /secret|password|authorization|cookie|api[_-]?key|token|access[_-]?code/i;

function defaultLevel(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === "test") return "silent";
  if (nodeEnv === "production") return "info";
  return "debug";
}

function previewText(value) {
  return {
    chars: String(value || "").length,
  };
}

function sanitizeValue(key, value) {
  if (REDACTED_KEYS.test(key)) return "[redacted]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (typeof value === "string" && value.length > 240) {
    return `${value.slice(0, 240)}…`;
  }
  return value;
}

function sanitizeFields(fields = {}) {
  const sanitized = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sanitized[key] = sanitizeValue(key, value);
  }
  return sanitized;
}

function createLogger({
  name = "app",
  level = process.env.NODE_TEST_CONTEXT ? "silent" : defaultLevel(),
  extra = {},
  stdout = process.stdout,
  stderr = process.stderr,
  now = () => new Date().toISOString(),
} = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(severity, event, fields = {}) {
    if ((LEVELS[severity] ?? LEVELS.info) < threshold) return;
    const line = `${JSON.stringify({
      ts: now(),
      level: severity,
      component: name,
      event,
      ...sanitizeFields(extra),
      ...sanitizeFields(fields),
    })}\n`;
    if (severity === "error") stderr.write(line);
    else stdout.write(line);
  }

  return {
    level,
    child(component, fields = {}) {
      return createLogger({
        name: component ? `${name}.${component}` : name,
        level,
        extra: { ...extra, ...fields },
        stdout,
        stderr,
        now,
      });
    },
    debug(event, fields) {
      write("debug", event, fields);
    },
    info(event, fields) {
      write("info", event, fields);
    },
    warn(event, fields) {
      write("warn", event, fields);
    },
    error(event, fields) {
      write("error", event, fields);
    },
  };
}

module.exports = {
  LEVELS,
  createLogger,
  defaultLevel,
  previewText,
};
