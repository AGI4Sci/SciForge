import { z } from 'zod'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { siyuanServiceConfigureRequestSchema } from '../editor-contract.js'
import { normalizeSiYuanServiceUrl } from '../service-url.js'
import { SiYuanError } from './client.js'
import { createSiYuanTokenStore } from './secrets.js'

const configurationSchema = z.object({ url: z.string().nullable(), mode: z.enum(['managed', 'custom']).default('managed') }).strict()
const normalize = (value: string): string => {
  try { return normalizeSiYuanServiceUrl(value) } catch { throw new SiYuanError('invalid_configuration') }
}

/** Main-process durable configuration; no editor mount or renderer storage is needed. */
export function createSiYuanServiceConfiguration(host: DomainMainHost) {
  const environmentUrl = process.env.SIYUAN_BASE_URL?.trim() || undefined
  const environmentToken = process.env.SIYUAN_API_TOKEN?.trim() || undefined
  let queue: Promise<unknown> = Promise.resolve()
  const read = async () => {
    try {
      const snapshot = await host.packageSettings?.read()
      const settings = snapshot?.value == null ? { url: null, mode: 'managed' as const } : configurationSchema.parse(snapshot.value)
      const saved = settings.url
      const candidate = saved || environmentUrl
      const url = candidate ? normalize(candidate) : null
      return { mode: settings.mode, url, urlSource: saved ? 'configured' as const : environmentUrl ? 'environment' as const : 'none' as const }
    } catch (error) {
      if (error instanceof SiYuanError) throw error
      throw new SiYuanError('configuration_unavailable')
    }
  }
  const status = async () => {
    await queue
    const config = await read()
    const storedToken = config.mode === 'custom' && config.url ? await createSiYuanTokenStore(host.packageSecrets, config.url).read() : undefined
    // An installation credential must never be forwarded to another service.
    let useEnvironmentToken = false
    try { useEnvironmentToken = config.mode === 'custom' && !!config.url && !!environmentUrl && config.url === normalize(environmentUrl) }
    catch { /* A shadowed invalid installation URL cannot override a valid saved address. */ }
    return { ...config, token: storedToken ? 'stored' as const : useEnvironmentToken && environmentToken ? 'environment' as const : 'none' as const,
      tokenStorage: host.packageSecrets ? 'available' as const : 'unavailable' as const,
      secret: storedToken ?? (useEnvironmentToken ? environmentToken : undefined) }
  }
  return {
    async endpoint() {
      const value = await status()
      if (value.mode !== 'custom') throw new SiYuanError('space_required')
      if (!value.url) throw new SiYuanError('not_configured')
      return { baseUrl: value.url, ...(value.secret ? { token: value.secret } : {}) }
    },
    async status() {
      const { secret: _secret, ...value } = await status()
      return value
    },
    configure(raw: unknown) {
      const request = siyuanServiceConfigureRequestSchema.parse(raw)
      const task = queue.then(async () => {
        const url = request.url === undefined ? undefined : request.url.trim() ? normalize(request.url.trim()) : null
        const token = request.token === undefined || request.token === null ? request.token : request.token.trim()
        if (token !== undefined && token !== null && (!token || /[\r\n]/u.test(token))) throw new SiYuanError('invalid_input')
        if ((url !== undefined || request.mode !== undefined) && !host.packageSettings) throw new SiYuanError('configuration_unavailable')
        const target = url === undefined ? (await read()).url : url ?? (environmentUrl ? normalize(environmentUrl) : null)
        if (token !== undefined && !target) throw new SiYuanError('not_configured')
        if (token !== undefined) {
          const store = createSiYuanTokenStore(host.packageSecrets, target!)
          if (token === null) await store.clear()
          else await store.write(token)
        }
        if (url !== undefined || request.mode !== undefined) {
          try {
            const snapshot = await host.packageSettings!.read()
            const previous = snapshot.value == null ? { url: null, mode: 'managed' as const } : configurationSchema.parse(snapshot.value)
            await host.packageSettings!.write({ url: url === undefined ? previous.url : url, mode: request.mode ?? (url !== undefined ? 'custom' : previous.mode) }, snapshot.revision)
          } catch { throw new SiYuanError('configuration_unavailable') }
        }
      })
      queue = task.catch(() => undefined)
      return task
    }
  }
}
