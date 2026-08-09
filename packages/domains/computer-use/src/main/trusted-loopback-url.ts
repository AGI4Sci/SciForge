const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function trustedLoopbackOrigin(value: string): URL {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(host) ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Computer Use service URL must be a credential-free trusted loopback HTTP origin.'
    )
  }
  url.pathname = '/'
  return url
}

export function trustedLoopbackEndpoint(origin: URL | string, path: string): string {
  const base = typeof origin === 'string' ? trustedLoopbackOrigin(origin) : origin
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('..') || path.startsWith('//')) {
    throw new Error('Computer Use service path is invalid.')
  }
  const endpoint = new URL(path, base)
  if (endpoint.origin !== base.origin) {
    throw new Error('Computer Use service endpoint escaped the trusted origin.')
  }
  return endpoint.toString()
}
