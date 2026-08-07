import {
  createPlaywrightCdpDriver,
  startComputerUseCdpAdapter
} from './services/computer-use-cdp-adapter'

const endpoints = (process.env.SCIFORGE_CUA_CDP_ENDPOINTS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const token = (process.env.SCIFORGE_CUA_CDP_ADAPTER_TOKEN ?? '').trim()
const port = Number(process.env.SCIFORGE_CUA_CDP_ADAPTER_PORT ?? 0)

if (!token) {
  console.error('[computer-use-cdp-adapter] SCIFORGE_CUA_CDP_ADAPTER_TOKEN is required')
  process.exit(1)
}

async function main(): Promise<void> {
  try {
    const adapter = await startComputerUseCdpAdapter({
      driver: createPlaywrightCdpDriver(endpoints),
      token,
      port: Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 0
    })
    // Ordinary logs intentionally contain no token, adapter/browser endpoint,
    // page URL, target metadata, or action input.
    console.error('[computer-use-cdp-adapter] listening')
    const stop = (): void => { void adapter.close().finally(() => process.exit(0)) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  } catch {
    console.error('[computer-use-cdp-adapter] startup failed')
    process.exit(1)
  }
}

void main()
