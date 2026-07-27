import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'

describe('electron renderer dev server config', () => {
  it('keeps the privileged browser debug surface on a strict loopback file boundary', () => {
    const renderer = (config as {
      renderer?: {
        server?: {
          host?: string
          port?: number
          strictPort?: boolean
          fs?: { strict?: boolean; deny?: string[] }
        }
      }
    }).renderer

    expect(renderer?.server?.host).toBe('127.0.0.1')
    expect(renderer?.server?.port).toBe(5173)
    expect(renderer?.server?.strictPort).toBe(true)
    expect(renderer?.server?.fs?.strict).toBe(true)
    expect(renderer?.server?.fs?.deny).toEqual(expect.arrayContaining([
      '.env',
      '.env.*',
      '*.{crt,pem,key}',
      '**/.git/**'
    ]))
  })

  it('embeds the bootstrap instance identity in the renderer bundle', () => {
    const renderer = (config as { renderer?: { define?: Record<string, string> } }).renderer

    expect(renderer?.define?.__SCIFORGE_DEV_INSTANCE_ID__).toBe(JSON.stringify(process.env.SCIFORGE_DEV_INSTANCE_ID ?? ''))
  })

  it('disables renderer HMR so strict CSP does not block React refresh preamble', () => {
    const renderer = (config as { renderer?: { server?: { hmr?: unknown } } }).renderer

    expect(renderer?.server?.hmr).toBe(false)
  })

  it('keeps the same-origin browser bridge proxy wired for web parity', () => {
    const renderer = (config as {
      renderer?: {
        server?: {
          proxy?: Record<string, {
            target?: string
            changeOrigin?: boolean
            rewrite?: (path: string) => string
          }>
        }
      }
    }).renderer
    const bridgeProxy = renderer?.server?.proxy?.['/__sciforge-dev-bridge']

    expect(bridgeProxy?.target).toBe('http://127.0.0.1:5174')
    expect(bridgeProxy?.changeOrigin).toBe(true)
    expect(bridgeProxy?.rewrite?.('/__sciforge-dev-bridge/health')).toBe('/health')
  })
})
