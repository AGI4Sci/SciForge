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
const REGISTRATION_TIMEOUT_MS = 2_000

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
  requestTimeoutMs?: number
}>): Promise<ElectronComputerUseAdapterRuntime> {
  const serviceUrl = normalizeLoopbackServiceUrl(options.serviceUrl)
  const serviceToken = options.serviceToken.trim()
  if (!serviceToken) throw new Error('Computer Use sidecar token is required for adapter registration.')
  const requestTimeoutMs = options.requestTimeoutMs ?? REGISTRATION_TIMEOUT_MS
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('Computer Use adapter registration timeout must be positive.')
  }
  const electron = createElectronWebContentsCdpDriver(options.listWebContents)
  const endpoints = options.browserEndpoints?.filter((value) => value.trim()) ?? []
  const driver = endpoints.length > 0
    ? createCompositeCdpDriver([electron, createPlaywrightCdpDriver(endpoints)])
    : electron
  const adapter = await startComputerUseCdpAdapter({ driver })
  const fetchImpl = options.fetchImpl ?? fetch
  let closing = false
  let closed = false
  let registrationInFlight: Promise<void> | null = null
  let closeInFlight: Promise<void> | null = null

  const register = (): Promise<void> => {
    if (closing) return Promise.resolve()
    if (registrationInFlight) return registrationInFlight
    registrationInFlight = configureSidecar(fetchImpl, serviceUrl, serviceToken, {
      adapterUrl: adapter.url,
      adapterToken: adapter.token
    }, requestTimeoutMs).finally(() => { registrationInFlight = null })
    return registrationInFlight
  }

  await register().catch(() => undefined)
  const timer = setInterval(() => { void register().catch(() => undefined) }, options.retryIntervalMs ?? RETRY_INTERVAL_MS)
  timer.unref()

  return Object.freeze({
    adapter,
    close() {
      if (closed) return Promise.resolve()
      if (closeInFlight) return closeInFlight
      closing = true
      clearInterval(timer)
      closeInFlight = (async () => {
        await registrationInFlight?.catch(() => undefined)
        await configureSidecar(fetchImpl, serviceUrl, serviceToken, {
          adapterUrl: '', adapterToken: '', expectedAdapterUrl: adapter.url
        }, requestTimeoutMs).catch(() => undefined)
        await adapter.close()
        closed = true
      })().finally(() => { closeInFlight = null })
      return closeInFlight
    }
  })
}
async function configureSidecar(
  fetchImpl: typeof fetch,
  serviceUrl: string,
  serviceToken: string,
  body: { adapterUrl: string; adapterToken: string; expectedAdapterUrl?: string },
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    const response = await Promise.race([
      fetchImpl(`${serviceUrl}/computer-use/backends/cdp/configure`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error('Computer Use sidecar adapter registration timed out.'))
        }, timeoutMs)
      })
    ])
    if (!response.ok) throw new Error(`Computer Use sidecar rejected adapter registration (HTTP ${response.status}).`)
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
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
