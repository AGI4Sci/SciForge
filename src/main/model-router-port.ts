import { createServer } from 'node:net'
import {
  getModelRouterSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { isLocalModelRouterBaseUrl } from '../shared/model-router-url'

/**
 * Returns a local router URL on an available loopback port when the configured
 * endpoint is already occupied by another SciForge instance.
 */
export async function relocateModelRouterIfPortIsOccupied(
  settings: AppSettingsV1,
  options: {
    isPortAvailableImpl?: (port: number) => Promise<boolean>
    findAvailablePortImpl?: () => Promise<number>
  } = {}
): Promise<{ baseUrl: string; configuredPort: number; activePort: number } | null> {
  const modelRouter = getModelRouterSettings(settings)
  if (!modelRouter.autoStart) return null
  const baseUrl = modelRouter.baseUrl.trim()
  if (!baseUrl || !isLocalModelRouterBaseUrl(baseUrl)) return null

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  const configuredPort = Number(parsed.port)
  if (!Number.isInteger(configuredPort) || configuredPort <= 0) return null

  const isPortAvailable = options.isPortAvailableImpl ?? isLoopbackPortAvailable
  if (await isPortAvailable(configuredPort)) return null

  const findAvailablePort = options.findAvailablePortImpl ?? findAvailableLoopbackPort
  const port = await findAvailablePort()
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    configuredPort,
    activePort: port
  }
}

async function findAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const fail = (error: Error) => {
      server.removeAllListeners()
      reject(error)
    }
    server.once('error', fail)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) {
          reject(error)
        } else if (!port) {
          reject(new Error('Unable to allocate a loopback Model Router port.'))
        } else {
          resolve(port)
        }
      })
    })
  })
}

async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    const finish = (available: boolean) => {
      server.removeAllListeners()
      if (server.listening) {
        server.close(() => resolve(available))
      } else {
        resolve(available)
      }
    }
    server.once('error', () => finish(false))
    server.listen({ host: '127.0.0.1', port }, () => finish(true))
  })
}
