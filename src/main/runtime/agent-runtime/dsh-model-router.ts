import { DshRuntimeError, type DshModelRouter } from '@sciforge/dsh-runtime'

/** Read only the authenticated local public alias catalog. This describes the
 * router's MCP model-input route, not DSH thread attachment capabilities. */
export async function resolveDshModelRouterInputModalities(route: DshModelRouter): Promise<DshModelRouter> {
  let base: URL
  try { base = new URL(route.baseUrl) } catch { throw new DshRuntimeError('runtime_model_route_invalid') }
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/v1' || !route.apiKey?.trim() || !route.model?.trim() || /[\r\n\0]/.test(route.apiKey + route.model)) {
    throw new DshRuntimeError('runtime_model_route_invalid')
  }
  try {
    const response = await fetch(`${base.href}/models`, {
      headers: { Authorization: `Bearer ${route.apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) throw new Error('catalog unavailable')
    const catalog: unknown = await response.json()
    const rows = catalog && typeof catalog === 'object' ? (catalog as { data?: unknown }).data : undefined
    if (!Array.isArray(rows)) throw new Error('invalid catalog')
    const model = rows.find(row => row && typeof row === 'object' && row.id === route.model)
    if (!model) throw new Error('route missing from catalog')
    const declared: unknown = model.input_modalities
    if (declared === undefined) return { ...route, inputModalities: ['text'] }
    if (!Array.isArray(declared) || declared.length === 0 || declared.some(value => value !== 'text' && value !== 'image') || new Set(declared).size !== declared.length) throw new Error('invalid modalities')
    return { ...route, inputModalities: declared }
  } catch {
    throw new DshRuntimeError('runtime_model_route_unavailable')
  }
}
