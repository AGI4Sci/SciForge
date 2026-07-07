import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'

describe('electron renderer dev server config', () => {
  it('keeps the browser debug surface reachable through both loopback families', () => {
    const renderer = (config as { renderer?: { server?: { host?: string } } }).renderer

    expect(renderer?.server?.host).toBe('::')
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
