import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { BrowserWindow, WebContentsView } from 'electron'

/**
 * The package owns the embedded editor as a native child view instead of an
 * Electron `<webview>` tag, because the Host renderer deliberately does not
 * enable `webviewTag`. This mirrors the established first-party pattern used by
 * the Browser Preview domain package.
 */
const electronRuntime = (): typeof import('electron') =>
  createRequire(import.meta.url)('electron')

/** Persisted partition: the SiYuan session survives application restarts. */
export const SIYUAN_EDITOR_PARTITION = 'persist:sciforge-siyuan'

export type SiYuanViewport = Readonly<{
  x: number
  y: number
  width: number
  height: number
  visible: boolean
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
  window: BrowserWindow
  view: WebContentsView
  loadedUrl: string
  detachHostListeners: () => void
}

export type SiYuanNativeView = Readonly<{
  present: (input: Readonly<{
    hostId: number
    url: string
    viewport: SiYuanViewport
  }>) => Promise<void>
  dispose: () => void
}>

/**
 * Owns exactly one editor child view per desktop window. The view is created
 * lazily on first presentation and destroyed with its window, so the local
 * kernel and its window never outlive the surface that shows them.
 */
export function createSiYuanNativeView(options: Readonly<{
  savePath?: (fileName: string) => string
  onDownload?: (filePath: string) => void
}> = {}): SiYuanNativeView {
  let entry: EditorEntry | undefined
  const savePath = options.savePath ??
    ((fileName: string) => join(electronRuntime().app.getPath('downloads'), fileName))

  const dispose = (): void => {
    const current = entry
    entry = undefined
    if (!current) return
    current.detachHostListeners()
    if (!current.window.isDestroyed()) current.window.contentView.removeChildView(current.view)
    // The page is closed even when its window is already gone: otherwise the
    // renderer process outlives the surface that owned it.
    const page = current.view.webContents
    if (!page.isDestroyed()) page.close({ waitForBeforeUnload: false })
  }

  const attach = (hostId: number): EditorEntry => {
    const current = entry
    if (
      current &&
      current.hostId === hostId &&
      !current.window.isDestroyed() &&
      !current.view.webContents.isDestroyed()
    ) return current
    dispose()

    const runtime = electronRuntime()
    const host = runtime.webContents.fromId(hostId)
    const window = host ? runtime.BrowserWindow.fromWebContents(host) : null
    if (!host || !window || window.isDestroyed()) {
      throw new Error('内嵌思源编辑界面需要 SciForge 桌面窗口，当前环境不可用。')
    }

    const editorSession = runtime.session.fromPartition(SIYUAN_EDITOR_PARTITION, { cache: true })
    const view = new runtime.WebContentsView({
      webPreferences: {
        session: editorSession,
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

    // Keep the embedded editor inside its own surface.
    view.webContents.setWindowOpenHandler(({ url }) => {
      void view.webContents.loadURL(url)
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
      window,
      view,
      loadedUrl: '',
      detachHostListeners: () => {
        editorSession.removeListener('will-download', onWillDownload)
        host.removeListener('destroyed', destroyed)
        window.removeListener('closed', destroyed)
      }
    }
    return entry
  }

  return Object.freeze({
    async present(input) {
      const current = attach(input.hostId)
      if (current.loadedUrl !== input.url) {
        current.loadedUrl = input.url
        await current.view.webContents.loadURL(input.url)
      }
      const runtime = electronRuntime()
      // The Host renderer renders at its own zoom factor, so device-independent
      // slot coordinates must be scaled before they reach native bounds.
      const factor = runtime.webContents.fromId(current.hostId)?.getZoomFactor() ?? 1
      const content = current.window.getContentBounds()
      const x = Math.max(0, Math.min(content.width, Math.round(input.viewport.x * factor)))
      const y = Math.max(0, Math.min(content.height, Math.round(input.viewport.y * factor)))
      const width = Math.max(0, Math.min(content.width - x, Math.round(input.viewport.width * factor)))
      const height = Math.max(0, Math.min(content.height - y, Math.round(input.viewport.height * factor)))
      if (width > 0 && height > 0) current.view.setBounds({ x, y, width, height })
      current.view.setVisible(input.viewport.visible && width > 0 && height > 0)
    },
    dispose
  })
}