import {
  createPlaywrightCdpDriver,
  startComputerUseCdpAdapter,
  type ComputerUseCdpAdapter
} from './computer-use-cdp-adapter'
import {
  createCompositeCdpDriver,
  createElectronWebContentsCdpDriver,
  type ElectronWebContentsLike
} from './computer-use-electron-webcontents-driver'

const RETRY_INTERVAL_MS = 5_000

export type ElectronComputerUseAdapterRuntime = Readonly<{
  adapter: ComputerUseCdpAdapter
  close(): Promise<void>
}>

export async function startElectronComputerUseAdapterRuntime(options: Readonly<{
  listWebContents: () => readonly ElectronWebContentsLike[]
  serviceUrl: string
  serviceToken: string
  browserEndpoints?: readonly string[]
  fetchImpl?: typeof fetch
  retryIntervalMs?: number
}>): Promise<ElectronComputerUseAdapterRuntime> {
  const serviceUrl = normalizeLoopbackServiceUrl(options.serviceUrl)
  const serviceToken = options.serviceToken.trim()
  if (!serviceToken) throw new Error('Computer Use sidecar token is required for adapter registration.')
  const electron = createElectronWebContentsCdpDriver(options.listWebContents)
  const endpoints = options.browserEndpoints?.filter((value) => value.trim()) ?? []
  const driver = endpoints.length > 0
    ? createCompositeCdpDriver([electron, createPlaywrightCdpDriver(endpoints)])
    : electron
  const adapter = await startComputerUseCdpAdapter({ driver })
  const fetchImpl = options.fetchImpl ?? fetch
  let registered = false
  let closing = false
  let registrationInFlight: Promise<void> | null = null

  const register = (): Promise<void> => {
    if (closing || registered) return Promise.resolve()
    if (registrationInFlight) return registrationInFlight
    registrationInFlight = configureSidecar(fetchImpl, serviceUrl, serviceToken, {
      adapterUrl: adapter.url,
      adapterToken: adapter.token
    }).then(() => { registered = true }).finally(() => { registrationInFlight = null })
    return registrationInFlight
  }

  await register().catch(() => undefined)
  const timer = setInterval(() => { void register().catch(() => undefined) }, options.retryIntervalMs ?? RETRY_INTERVAL_MS)
  timer.unref()

  return Object.freeze({
    adapter,
    async close() {
      if (closing) return
      closing = true
      clearInterval(timer)
      await registrationInFlight?.catch(() => undefined)
      if (registered) {
        await configureSidecar(fetchImpl, serviceUrl, serviceToken, {
          adapterUrl: '', adapterToken: '', expectedAdapterUrl: adapter.url
        }).catch(() => undefined)
      }
      await adapter.close()
    }
  })
}

async function configureSidecar(
  fetchImpl: typeof fetch,
  serviceUrl: string,
  serviceToken: string,
  body: { adapterUrl: string; adapterToken: string; expectedAdapterUrl?: string }
): Promise<void> {
  const response = await fetchImpl(`${serviceUrl}/computer-use/backends/cdp/configure`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`Computer Use sidecar rejected adapter registration (HTTP ${response.status}).`)
}

function normalizeLoopbackServiceUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/u, '')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error('Computer Use sidecar must use a loopback HTTP(S) URL.')
  }
  if (url.username || url.password) throw new Error('Computer Use sidecar URL must not contain credentials.')
  return value
}
