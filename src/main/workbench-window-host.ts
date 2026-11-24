import { BrowserWindow, screen } from 'electron'
import { isTrustedRendererUrl } from './renderer-trust'

/** Blank, unprivileged auxiliary surfaces. The owning renderer supplies their UI. */
export function attachWorkbenchWindowHost(owner: BrowserWindow, trustedRendererUrl: string): void {
  const children = new Set<BrowserWindow>()
  owner.webContents.setWindowOpenHandler(({ url, frameName, referrer }) => {
    if (url !== 'about:blank' || !/^sciforge-workbench:[a-zA-Z0-9_.:-]{1,180}$/u.test(frameName) ||
      !isTrustedRendererUrl(owner.webContents.getURL(), trustedRendererUrl) ||
      (referrer.url !== '' && !isTrustedRendererUrl(referrer.url, trustedRendererUrl))) return { action: 'deny' }
    return {
      action: 'allow', outlivesOpener: false,
      createWindow: (requested) => {
        // Preserve Electron's opener/browsing-context options, while explicitly
        // removing the Host preload and overriding all privilege-bearing settings.
        const webPreferences = { ...requested.webPreferences }
        delete webPreferences.preload
        const display = screen.getDisplayMatching({ x: requested.x ?? owner.getBounds().x + 60,
          y: requested.y ?? owner.getBounds().y + 60, width: requested.width ?? 720, height: requested.height ?? 560 }).workArea
        const width = Math.min(Math.max(360, requested.width ?? 720), display.width)
        const height = Math.min(Math.max(260, requested.height ?? 560), display.height)
        const child = new BrowserWindow({
          ...requested,
          parent: owner, width, height, minWidth: 320, minHeight: 220,
          x: Math.max(display.x, Math.min(requested.x ?? display.x + 60, display.x + display.width - width)),
          y: Math.max(display.y, Math.min(requested.y ?? display.y + 60, display.y + display.height - height)),
          title: 'SciForge', autoHideMenuBar: true, show: true,
          // Do not inherit the Host preload or its privileged IPC surface.
          webPreferences: { ...webPreferences, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
            nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true,
            session: owner.webContents.session, backgroundThrottling: false }
        })
        child.setMenu(null)
        child.webContents.on('will-navigate', event => event.preventDefault())
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        children.add(child)
        child.once('closed', () => children.delete(child))
        return child.webContents
      }
    }
  })
  owner.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
    if (mainFrame) for (const child of children) if (!child.isDestroyed()) child.close()
  })
  owner.once('closed', () => { for (const child of children) if (!child.isDestroyed()) child.destroy(); children.clear() })
}
