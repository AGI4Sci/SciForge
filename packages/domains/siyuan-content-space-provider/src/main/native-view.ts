import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { CURRENT_EDITOR_DOCUMENT_SCRIPT } from './editor-document.js'

import type { BrowserWindow, WebContentsView } from 'electron'
import { currentUserProfileSchema, type CurrentUserProfile } from '@sciforge/domain-identity-access/current-user-profile'
import { attachCommentIdentityBridge, isEditorOrigin } from './comment-identity-bridge.js'
import { attachNativeAiSession, type SiYuanNativeAiAccess } from './native-ai-session.js'

/**
 * The package owns the embedded editor as a native child view instead of an
 * Electron `<webview>` tag, because the Host renderer deliberately does not
 * enable `webviewTag`. This mirrors the established first-party pattern used by
 * the Browser Preview domain package.
 */
const electronRuntime = (): typeof import('electron') =>
  createRequire(import.meta.url)('electron')

const accountKey = (profile: CurrentUserProfile): string =>
  profile.state === 'signed-in' ? `user:${profile.userId}` : profile.state

/** Browser state is local to this account and server, while documents remain shared.
 * This partitions cookies/storage; it does not grant server authorization. */
export function siyuanEditorPartition(url: string, profile: CurrentUserProfile): string {
  const digest = createHash('sha256').update(JSON.stringify([new URL(url).origin, accountKey(profile)]))
    .digest('hex')
  return `persist:sciforge-siyuan-${digest}`
}

/** The exact same account/origin jar is used for bootstrap, API reads and the editor. */
export function siyuanCloudBrowserSession(url: string, identity: CurrentUserProfile): Readonly<{ fetch: typeof fetch }> {
  const session = electronRuntime().session.fromPartition(siyuanEditorPartition(url, identity), { cache: true })
  return { fetch: (input, init) => session.fetch(input instanceof Request ? input.url : String(input), init) }
}

export type SiYuanViewport = Readonly<{
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  windowName?: string
}>

/**
 * SiYuan's frontend detects its own desktop shell and refuses to boot the
 * editor inside an Electron container. Advertising an ordinary Chrome build
 * keeps it on the browser code path it supports.
 */
export function siyuanEditorUserAgent(platform = process.platform): string {
  const chrome = process.versions.chrome ?? '120.0.0.0'
  const shell = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  if (platform === 'darwin') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${shell}`
  if (platform === 'linux') return `Mozilla/5.0 (X11; Linux x86_64) ${shell}`
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${shell}`
}

type EditorEntry = {
  hostId: number
  account: string
  origin: string
  window: BrowserWindow
  ownerWindow: BrowserWindow
  detachSurface: () => void
  view: WebContentsView
  loadedUrl: string
  reloadRevision?: number
  navigation?: Promise<void>
  presentation?: Parameters<SiYuanNativeView['present']>[0]
  detachHostListeners: () => void
}

export type SiYuanNativeView = Readonly<{
  present: (input: Readonly<{
    hostId: number
    reloadRevision?: number
    url: string
    viewport: SiYuanViewport
  }>) => Promise<void>
  currentDocument: (expectedUrl: string, signal?: AbortSignal) => Promise<string | null>
  hide: () => void
  dispose: () => void
}>

/**
 * Owns exactly one editor child view per desktop window. The view is created
 * lazily on first presentation and destroyed with its window, so the remote
 * editor page never outlives the surface that shows it.
 */
export function createSiYuanNativeView(options: Readonly<{
  savePath?: (fileName: string) => string
  onDownload?: (filePath: string) => void
  preloadPath?: string
  readIdentity?: () => CurrentUserProfile
  nativeAi?: SiYuanNativeAiAccess
}> = {}): SiYuanNativeView {
  let entry: EditorEntry | undefined
  const readIdentity = (): CurrentUserProfile => {
    try { return currentUserProfileSchema.parse(options.readIdentity?.() ?? { state: 'unavailable' }) }
    catch { return { state: 'unavailable' } }
  }
  const savePath = options.savePath ??
    ((fileName: string) => join(electronRuntime().app.getPath('downloads'), fileName))

  const dispose = (): void => {
    const current = entry
    entry = undefined
    if (!current) return
    current.detachHostListeners()
    current.detachSurface()
    if (!current.window.isDestroyed()) current.window.contentView.removeChildView(current.view)
    // The page is closed even when its window is already gone: otherwise the
    // renderer process outlives the surface that owned it.
    const page = current.view.webContents
    if (!page.isDestroyed()) page.close({ waitForBeforeUnload: false })
  }

  const attach = (hostId: number, url: string): EditorEntry => {
    const identity = readIdentity()
    const account = accountKey(identity)
    const origin = new URL(url).origin
    const current = entry
    if (
      current &&
      current.hostId === hostId &&
      current.account === account && current.origin === origin &&
      !current.ownerWindow.isDestroyed() &&
      !current.view.webContents.isDestroyed()
    ) return current
    dispose()

    const runtime = electronRuntime()
    const host = runtime.webContents.fromId(hostId)
    const window = host ? runtime.BrowserWindow.fromWebContents(host) : null
    if (!host || !window || window.isDestroyed()) {
      throw new Error('内嵌思源编辑界面需要 SciForge 桌面窗口，当前环境不可用。')
    }

    const editorSession = runtime.session.fromPartition(siyuanEditorPartition(url, identity), { cache: true })
    const view = new runtime.WebContentsView({
      webPreferences: {
        session: editorSession,
        ...(options.preloadPath ? { preload: options.preloadPath } : {}),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false
      }
    })
    view.webContents.setUserAgent(siyuanEditorUserAgent())
    view.setVisible(false)
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    window.contentView.addChildView(view)

    // SiYuan writes exports into its own workspace temp directory, so the
    // package decides the final location: the operating system download folder.
    const onWillDownload = (_event: Electron.Event, item: Electron.DownloadItem): void => {
      const fileName = item.getFilename().replace(/[\\/:*?"<>|\r\n]/gu, '_') || 'siyuan-export'
      const filePath = savePath(fileName)
      item.setSavePath(filePath)
      item.once('done', (_doneEvent, state) => {
        if (state === 'completed') options.onDownload?.(filePath)
      })
    }
    editorSession.on('will-download', onWillDownload)

    const detachIdentity = attachCommentIdentityBridge(view.webContents,
      () => entry?.view === view ? entry.loadedUrl : '', () => {
        const profile = readIdentity()
        return accountKey(profile) === account ? profile : { state: 'unavailable' }
      })
    const detachAi = options.nativeAi ? attachNativeAiSession(editorSession, url, {
      page: view.webContents, access: options.nativeAi, authorized: () => {
        const profile = readIdentity()
        return entry?.view === view && profile.state === 'signed-in' && accountKey(profile) === account
      }
    }) : () => undefined
    // Account changes fence the old page immediately at every identity read,
    // and retire it even while the renderer slot is inactive or unchanged.
    const identityTimer = setInterval(() => {
      if (entry?.view !== view || accountKey(readIdentity()) === account) return
      const presentation = entry.presentation
      dispose()
      // A brief account change between renderer polls must not leave the slot
      // referring to a closed page. Reuse the canonical presentation path.
      if (presentation) void present(presentation).catch(() => undefined)
    }, 500)
    identityTimer.unref?.()
    // Remote navigation must never carry the identity bridge to another origin.
    const willNavigate = (event: Electron.Event, url: string): void => {
      if (!isEditorOrigin(url, entry?.loadedUrl ?? '')) event.preventDefault()
    }
    view.webContents.on('will-navigate', willNavigate)
    view.webContents.on('will-redirect', willNavigate)
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isEditorOrigin(url, entry?.loadedUrl ?? '')) void view.webContents.loadURL(url)
      return { action: 'deny' }
    })

    const destroyed = (): void => {
      editorSession.removeListener('will-download', onWillDownload)
      if (entry?.view === view) dispose()
    }
    host.once('destroyed', destroyed)
    window.once('closed', destroyed)

    entry = {
      hostId,
      account,
      origin,
      window,
      ownerWindow: window,
      detachSurface: () => undefined,
      view,
      loadedUrl: '',
      detachHostListeners: () => {
        clearInterval(identityTimer)
        detachIdentity()
        detachAi()
        view.webContents.removeListener('will-navigate', willNavigate)
        view.webContents.removeListener('will-redirect', willNavigate)
        editorSession.removeListener('will-download', onWillDownload)
        host.removeListener('destroyed', destroyed)
        window.removeListener('closed', destroyed)
      }
    }
    return entry
  }

  async function present(input: Parameters<SiYuanNativeView['present']>[0]): Promise<void> {
    const current = attach(input.hostId, input.url)
    const surface = input.viewport.windowName
      ? current.ownerWindow.getChildWindows().find(child => !child.isDestroyed() &&
          child.webContents.mainFrame.name === input.viewport.windowName)
      : current.ownerWindow
    if (!surface) throw new Error('云笔记窗口已关闭，请重新打开。')
    if (surface !== current.window) {
      current.detachSurface()
      current.view.setVisible(false)
      if (!current.window.isDestroyed()) current.window.contentView.removeChildView(current.view)
      surface.contentView.addChildView(current.view)
      current.window = surface
      const restore = (): void => {
        if (entry !== current || current.ownerWindow.isDestroyed()) return
        current.view.setVisible(false)
        if (!surface.isDestroyed()) surface.contentView.removeChildView(current.view)
        current.ownerWindow.contentView.addChildView(current.view)
        current.window = current.ownerWindow
        current.detachSurface = () => undefined
        current.presentation = { ...input, viewport: { ...input.viewport, windowName: undefined, visible: false } }
      }
      if (surface !== current.ownerWindow) surface.once('close', restore)
      current.detachSurface = () => surface.removeListener('close', restore)
    }
    current.presentation = input
    // Give the native page its real viewport before navigation starts.
    const runtime = electronRuntime()
    // The Host renderer renders at its own zoom factor, so device-independent
    // slot coordinates must be scaled before they reach native bounds.
    const factor = current.window === current.ownerWindow
      ? runtime.webContents.fromId(current.hostId)?.getZoomFactor() ?? 1
      : current.window.webContents.getZoomFactor()
    const content = current.window.getContentBounds()
    const x = Math.max(0, Math.min(content.width, Math.round(input.viewport.x * factor)))
    const y = Math.max(0, Math.min(content.height, Math.round(input.viewport.y * factor)))
    const width = Math.max(0, Math.min(content.width - x, Math.round(input.viewport.width * factor)))
    const height = Math.max(0, Math.min(content.height - y, Math.round(input.viewport.height * factor)))
    if (width > 0 && height > 0) current.view.setBounds({ x, y, width, height })
    current.view.setVisible(input.viewport.visible && width > 0 && height > 0)
    const refresh = input.reloadRevision !== undefined && current.reloadRevision !== undefined && input.reloadRevision !== current.reloadRevision
    current.reloadRevision = input.reloadRevision
    if (current.loadedUrl !== input.url || refresh) {
      const target = refresh && isEditorOrigin(current.view.webContents.mainFrame.url, input.url) ? current.view.webContents.mainFrame.url : input.url
      current.loadedUrl = input.url
      current.navigation = current.view.webContents.loadURL(target)
    }
    const navigation = current.navigation
    try { await navigation }
    catch (error) {
      if (entry !== current || current.loadedUrl !== input.url || current.navigation !== navigation) return
      current.loadedUrl = ''
      current.navigation = undefined
      current.view.setVisible(false)
      throw error
    }
    // A delayed navigation must not restore a retired account or supersede
    // a newer viewport (for example a hide request while the page loads).
    if (entry !== current || current.view.webContents.isDestroyed() ||
        current.presentation !== input) return
    if (accountKey(readIdentity()) !== current.account) {
      current.view.setVisible(false)
      return
    }
  }
  const hide = (): void => {
    if (!entry) return
    entry.view.setVisible(false)
    if (entry.presentation) entry.presentation = { ...entry.presentation, viewport: { ...entry.presentation.viewport, visible: false } }
  }
  const currentDocument = async (expectedUrl: string, signal?: AbortSignal): Promise<string | null> => {
    const current = entry
    const isCurrent = () => Boolean(current && entry === current && !signal?.aborted &&
      current.presentation?.viewport.visible && current.loadedUrl === expectedUrl.replace(/\/$/u, '') + '/' && !current.view.webContents.isDestroyed() &&
      accountKey(readIdentity()) === current.account && new URL(expectedUrl).origin === current.origin &&
      isEditorOrigin(current.view.webContents.mainFrame.url, expectedUrl))
    if (!current || !isCurrent()) return null
    // Read only the active editor's block ID. Content always uses the structured
    // space-authorized resource API, never DOM text or recent-file history.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const id = await Promise.race([
        current.view.webContents.executeJavaScript(CURRENT_EDITOR_DOCUMENT_SCRIPT),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 500) })
      ])
      return isCurrent() && typeof id === 'string' && /^\d{14}-[a-z0-9]{7}$/u.test(id) ? id : null
    } catch { return null } finally { clearTimeout(timer) }
  }
  return Object.freeze({ present, currentDocument, hide, dispose })
}
