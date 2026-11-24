import type { Session, WebContents } from 'electron'
import type { DomainMainTextReasoner } from '@sciforge/domain-sdk/host'
import { boundedText, createNativeAi, type NativeAiSettings } from './native-ai.js'
import { isEditorOrigin } from './comment-identity-bridge.js'
import { forwardNativeRequest } from './native-network.js'

export type SiYuanNativeAiAccess = Readonly<{
  textReasoner: () => Promise<DomainMainTextReasoner | null>
  readBlock: (id: string, signal: AbortSignal, origin: string) => Promise<string>
}>
type Owner = Readonly<{ page: WebContents; authorized: () => boolean; access: SiYuanNativeAiAccess }>
type Binding = { owners: Set<Owner>; detach: () => void }
const bindings = new WeakMap<Session, Binding>()
const actions = new Set(['/api/ai/editor/lsActions', '/api/ai/editor/saveAction', '/api/ai/editor/removeAction'])

function pathOf(value: string): string {
  try { return decodeURIComponent(new URL(value).pathname).replace(/[/]+/gu, '/') } catch { return '' }
}
const unsafeMethod = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
const aiPath = (path: string) => path === '/api/setting/setAI' || path.startsWith('/api/ai/')
const failure = (msg: string, status = 400) => Response.json({ code: -1, msg }, { status })

/** A virtual, key-free display config. It is never saved to the shared server. */
export function localAiConfig(ai: Record<string, unknown>): Record<string, unknown> {
  const editing = ai.editing && typeof ai.editing === 'object' ? ai.editing : {}
  return { ...ai, editing: { ...editing, modelId: 'sciforge-local-text' }, providers: [{
    id: 'sciforge-local', displayName: 'SciForge 本机模型', enabled: true, apiKey: '', baseURL: '',
    protocol: 'openai', requestTimeout: 180, models: [{ id: 'sciforge-local-text',
      name: 'sciforge-local-text', displayName: 'SciForge 本机模型', enabled: true }]
  }] }
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback
}

/** The package's private account session is the interception boundary. Standard
 * requests retain its cookies; only native AI computation uses the local router.
 * Multiple windows of the same account share one handler, with reference cleanup. */
export function attachNativeAiSession(session: Session, url: string, owner: Owner): () => void {
  let binding = bindings.get(session)
  if (!binding) {
    const owners = new Set<Owner>()
    const origin = new URL(url).origin
    const scheme = new URL(url).protocol.slice(0, -1)
    const live = (item: Owner) => !item.page.isDestroyed() &&
      isEditorOrigin(item.page.mainFrame.url, origin)
    const authorized = () => [...owners].some(item => live(item) && item.authorized())
    const active = () => {
      const item = [...owners].find(item => live(item) && item.authorized())
      if (!item) throw new Error('No active cloud notes account')
      return item.access
    }
    let settings: NativeAiSettings = { maxHistoryMessages: 7, temperature: 1, maxCompletionTokens: 0 }
    const ai = createNativeAi({ authorized, settings: () => settings,
      textReasoner: () => active().textReasoner(),
      readBlock: (id, signal) => active().readBlock(id, signal, origin) })

    // protocol.handle has no sender frame. Gate model requests here, where
    // Electron supplies the actual WebContents and WebFrameMain identity.
    session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const path = pathOf(details.url)
      const source = [...owners].some(item => live(item) && details.webContentsId === item.page.id &&
        details.frame === item.page.mainFrame)
      // Only an owning page may cause us to restore a missing browser Origin.
      // Main-process session.fetch requests have no owning WebContents.
      if (isEditorOrigin(details.url, origin) && unsafeMethod(details.method ?? 'GET') &&
          (details.webContentsId ?? -1) > 0 && !source) { callback({ cancel: true }); return }
      if (!aiPath(path) || (actions.has(path) && isEditorOrigin(details.url, origin))) { callback({}); return }
      callback(source && isEditorOrigin(details.url, origin) ? {} : { cancel: true })
    })
    const forward = (request: Request): Promise<Response> => forwardNativeRequest(session, request, origin)
    session.protocol.handle(scheme, async request => {
      const path = pathOf(request.url)
      if (aiPath(path)) {
        if (!isEditorOrigin(request.url, origin)) return failure('此页面不能调用 SciForge 本机模型。', 403)
        if (path === '/api/ai/editor/chat' && request.method === 'POST') return ai.handle(request)
        if (actions.has(path) && request.method === 'POST') {
          return forward(request)
        }
        return failure(path === '/api/setting/setAI' ?
          'AI 模型由本机 SciForge 管理，请在 File → Settings 中配置；无需在云笔记填写 API Key。' :
          '目前已接通原生 AI 写作和文本编辑；此 AI 功能暂未接入 SciForge 本机模型。')
      }
      const response = await forward(request)
      if (path !== '/api/system/getConf' || !isEditorOrigin(request.url, origin) || !response.ok) return response
      try {
        const payload = JSON.parse(await boundedText(response.body, 8_000_000))
        const conf = payload?.data?.conf
        if (conf?.ai && typeof conf.ai === 'object') {
          const editing = conf.ai.editing ?? {}
          settings = { maxHistoryMessages: Math.floor(boundedNumber(editing.maxHistoryMessages, 7, 32)),
            temperature: boundedNumber(editing.temperature, 1, 2),
            maxCompletionTokens: Math.floor(boundedNumber(editing.maxCompletionTokens, 0, 32768)) }
          conf.ai = localAiConfig(conf.ai)
        }
        const headers = new Headers(response.headers)
        for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) headers.delete(name)
        headers.set('Cache-Control', 'no-store')
        return Response.json(payload, { status: response.status, headers })
      } catch { return failure('无法读取云笔记配置，请重新加载。', 502) }
    })
    binding = { owners, detach: () => {
      ai.dispose()
      session.webRequest.onBeforeRequest(null)
      session.protocol.unhandle(scheme)
      bindings.delete(session)
    } }
    bindings.set(session, binding)
  }
  binding.owners.add(owner)
  let detached = false
  return () => {
    if (detached) return
    detached = true
    binding.owners.delete(owner)
    if (!binding.owners.size) binding.detach()
  }
}
