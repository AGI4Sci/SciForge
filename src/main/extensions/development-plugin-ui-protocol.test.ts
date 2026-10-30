import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentPluginUiHandler, developmentPluginUiUrl } from './development-plugin-ui-protocol'

describe('development plugin UI protocol', () => {
  const asset = { pluginId: '@example/ui', generation: 3, path: 'dist/界面.html' }

  it('serves module assets with MIME, opaque-origin CORS and no stale cache', async () => {
    const resolveAsset = vi.fn(async () => '/plugins/ui/dist/界面.html')
    const fetchFile = vi.fn(async () => new Response('plugin code', { headers: { 'Content-Type': 'text/javascript' } }))
    const handle = createDevelopmentPluginUiHandler({ resolveAsset, fetchFile })
    const response = await handle(new Request(developmentPluginUiUrl(asset)))
    expect(resolveAsset).toHaveBeenCalledWith(asset)
    expect(fetchFile).toHaveBeenCalledWith(expect.stringMatching(/^file:/), 'GET')
    expect(await response.text()).toBe('plugin code')
    expect(response.headers.get('content-type')).toBe('text/javascript')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('rejects malformed identities, encoded path escapes and mutations before resolving a file', async () => {
    const resolveAsset = vi.fn(async () => undefined)
    const fetchFile = vi.fn()
    const handle = createDevelopmentPluginUiHandler({ resolveAsset, fetchFile })
    for (const url of [
      'sciforge-plugin://other/plugin/1/dist/ui.html',
      'sciforge-plugin://ui/plugin/0/dist/ui.html',
      'sciforge-plugin://ui/plugin/9007199254740992/dist/ui.html',
      'sciforge-plugin://ui/plugin/1/dist/%2e%2e%2fsecret',
      'sciforge-plugin://ui/plugin/1/dist/%5csecret',
      'sciforge-plugin://ui/plugin/1/dist/%00',
      'sciforge-plugin://ui/plugin/1/dist/%'
    ]) expect((await handle(new Request(url))).status).toBe(404)
    expect((await handle(new Request(developmentPluginUiUrl(asset), { method: 'POST' }))).status).toBe(405)
    expect(resolveAsset).not.toHaveBeenCalled()
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('does not fetch disabled, stale or missing assets', async () => {
    const fetchFile = vi.fn()
    const handle = createDevelopmentPluginUiHandler({ resolveAsset: async () => undefined, fetchFile })
    expect((await handle(new Request(developmentPluginUiUrl(asset)))).status).toBe(404)
    expect(fetchFile).not.toHaveBeenCalled()
  })
})
