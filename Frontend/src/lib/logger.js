const enabled = import.meta.env.DEV;

export function log(component, event, fields = {}) {
  if (!enabled) return;
  console.info(`[${component}] ${event}`, fields);
}

export function logError(component, event, fields = {}) {
  if (!enabled) return;
  console.error(`[${component}] ${event}`, fields);
}
