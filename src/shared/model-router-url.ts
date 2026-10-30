const KNOWN_MODEL_ROUTER_ENDPOINT_PATHS = [
  'chat/completions',
  'responses',
  'messages'
] as const

export function buildModelRouterApiUrl(baseUrl: string, path: string): string {
  const apiPath = path.trim().replace(/^\/+/u, '').replace(/\/+$/u, '')
  if (!apiPath) return ''
  const root = normalizeLocalModelRouterBaseUrl(baseUrl)
  if (!root) throw new Error('Model Router base URL must be a local http://127.0.0.1, http://localhost, or http://[::1] URL.')
  return root.endsWith('/v1') ? `${root}/${apiPath}` : `${root}/v1/${apiPath}`
}

export function buildModelRouterResponsesUrl(baseUrl: string): string {
  return buildModelRouterApiUrl(baseUrl, 'responses')
}

export function normalizeLocalModelRouterBaseUrl(baseUrl: string, fallback = ''): string {
  const normalized = normalizeModelRouterBaseUrl(baseUrl)
  if (isLocalModelRouterBaseUrl(normalized)) return normalized
  const normalizedFallback = normalizeModelRouterBaseUrl(fallback)
  return isLocalModelRouterBaseUrl(normalizedFallback) ? normalizedFallback : ''
}

export function normalizeModelRouterBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/u, '')
  if (!normalized) return ''
  const root = stripKnownModelRouterEndpointPath(normalized)
  return root.endsWith('/v1') ? root : `${root}/v1`
}

export function isLocalModelRouterBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'http:' &&
      (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]')
  } catch {
    return false
  }
}

function stripKnownModelRouterEndpointPath(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  for (const path of KNOWN_MODEL_ROUTER_ENDPOINT_PATHS) {
    if (lower.endsWith(`/${path}`)) {
      return baseUrl.slice(0, -path.length).replace(/\/+$/u, '')
    }
  }
  return baseUrl
}
