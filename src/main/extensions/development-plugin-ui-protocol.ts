import { pathToFileURL } from 'node:url'

export const DEVELOPMENT_PLUGIN_UI_SCHEME = 'sciforge-plugin'
export const developmentPluginUiScheme: Electron.CustomScheme = {
  scheme: DEVELOPMENT_PLUGIN_UI_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}

export type DevelopmentPluginUiAsset = Readonly<{
  pluginId: string
  generation: number
  path: string
}>

export function developmentPluginUiUrl(asset: DevelopmentPluginUiAsset): string {
  const path = asset.path.split(/[\\/]/u).map(encodeURIComponent).join('/')
  return `${DEVELOPMENT_PLUGIN_UI_SCHEME}://ui/${encodeURIComponent(asset.pluginId)}/${asset.generation}/${path}`
}

type ProtocolHandler = (request: Request) => Promise<Response>
type Backend = Readonly<{
  resolveAsset: (asset: DevelopmentPluginUiAsset) => Promise<string | undefined>
  fetchFile: (url: string, method: 'GET' | 'HEAD') => Promise<Response>
}>

/** Serves only the active generation's public UI directory; never exposes a file URL to the renderer. */
export function installDevelopmentPluginUiProtocol(
  protocol: { handle: (scheme: string, handler: ProtocolHandler) => void },
  backend: Backend
): void {
  protocol.handle(DEVELOPMENT_PLUGIN_UI_SCHEME, createDevelopmentPluginUiHandler(backend))
}

export function createDevelopmentPluginUiHandler(backend: Backend): ProtocolHandler {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    try {
      const url = new URL(request.url)
      if (url.protocol !== `${DEVELOPMENT_PLUGIN_UI_SCHEME}:` || url.host !== 'ui' || url.username || url.password) {
        return new Response(null, { status: 404 })
      }
      const [, plugin, generation, ...segments] = url.pathname.split('/')
      const path = segments.map(decodeURIComponent)
      if (!plugin || !/^[1-9]\d*$/u.test(generation) || !Number.isSafeInteger(Number(generation)) ||
        path.length === 0 || path.some((part) => !part || part === '.' || part === '..' || /[\\/\0:]/u.test(part))) {
        return new Response(null, { status: 404 })
      }
      const file = await backend.resolveAsset({
        pluginId: decodeURIComponent(plugin), generation: Number(generation), path: path.join('/')
      })
      if (!file) return new Response(null, { status: 404 })
      const response = await backend.fetchFile(pathToFileURL(file).href, request.method)
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-store')
      // Sandboxed frames have an opaque origin. ES modules and fonts need CORS even for sibling assets.
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Content-Security-Policy', [
        "default-src 'none'",
        `script-src ${DEVELOPMENT_PLUGIN_UI_SCHEME}: 'unsafe-inline'`,
        `style-src ${DEVELOPMENT_PLUGIN_UI_SCHEME}: 'unsafe-inline'`,
        `img-src ${DEVELOPMENT_PLUGIN_UI_SCHEME}: data: blob:`,
        `font-src ${DEVELOPMENT_PLUGIN_UI_SCHEME}: data:`,
        `connect-src ${DEVELOPMENT_PLUGIN_UI_SCHEME}:`,
        "base-uri 'none'", "form-action 'none'"
      ].join('; '))
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  }
}
