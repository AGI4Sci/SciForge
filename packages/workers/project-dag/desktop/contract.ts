export const PROJECT_DAG_SERVICE_URL_ENV = 'SCIFORGE_PROJECT_DAG_SERVICE_URL'
export const PROJECT_DAG_API_KEY_ENV = 'SCIFORGE_PROJECT_DAG_API_KEY'
export const DEFAULT_PROJECT_DAG_SERVICE_URL = 'http://127.0.0.1:3898'

export function normalizeProjectDagServiceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function projectDagServiceUrlFromEnv(env: Record<string, string | undefined>): string {
  return normalizeProjectDagServiceUrl(env[PROJECT_DAG_SERVICE_URL_ENV])
}

export function projectDagApiKeyFromEnv(env: Record<string, string | undefined>): string {
  return (env[PROJECT_DAG_API_KEY_ENV] ?? '').trim()
}

/**
 * Browser deep link into the bundled project-dag web UI.
 * `view` picks the pane (home | goals | graph | compile | report | time);
 * `embed` asks the UI to use compact chrome for an app-side panel.
 */
export function projectDagUiUrl(input: {
  serviceUrl?: string
  apiKey?: string | null
  view?: 'home' | 'goals' | 'graph' | 'compile' | 'report' | 'time'
  embed?: boolean
}): string {
  const base = normalizeProjectDagServiceUrl(input.serviceUrl) || DEFAULT_PROJECT_DAG_SERVICE_URL
  const url = new URL(`${base}/`)
  if (input.view) url.searchParams.set('view', input.view)
  if (input.embed) url.searchParams.set('embed', '1')
  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    const hash = new URLSearchParams()
    hash.set('token', apiKey)
    url.hash = hash.toString()
  }
  return url.toString()
}
