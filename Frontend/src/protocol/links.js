const ALLOWED_HOSTS = new Set([
  'www.eastman.com',
  'productcatalog.eastman.com',
  'ws.eastman.com',
])

export function safeEastmanUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.port === '' && ALLOWED_HOSTS.has(url.hostname)
      ? url.toString()
      : null
  } catch {
    return null
  }
}

