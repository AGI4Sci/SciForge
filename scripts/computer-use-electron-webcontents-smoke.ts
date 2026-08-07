import { app, BrowserWindow, webContents } from 'electron'
import { startComputerUseCdpAdapter } from '../src/main/services/computer-use-cdp-adapter'
import { createElectronWebContentsCdpDriver } from '../src/main/services/computer-use-electron-webcontents-driver'

app.commandLine.appendSwitch('disable-gpu')

async function call(
  url: string,
  token: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const payload = await response.json() as Record<string, unknown>
  if (!response.ok || payload.ok !== true) {
    const error = payload.error as Record<string, unknown> | undefined
    throw new Error(`Adapter call failed at ${path}: ${String(error?.code ?? response.status)} ${String(error?.message ?? '')}`)
  }
  return payload.data as Record<string, unknown>
}

async function main(): Promise<void> {
  await app.whenReady()
  const windows = Array.from({ length: 3 }, (_, index) => new BrowserWindow({
    width: 420,
    height: 260,
    x: 80 + index * 90,
    y: 80 + index * 70,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true }
  }))
  let adapter: Awaited<ReturnType<typeof startComputerUseCdpAdapter>> | null = null
  try {
    await Promise.all(windows.map(async (window, index) => {
      const label = `surface-${index + 1}`
      await window.loadURL(`data:text/html,${encodeURIComponent(`<!doctype html><title>${label}</title><input id="entry" autofocus><div>${label}</div>`)}`)
      await window.webContents.executeJavaScript("document.querySelector('#entry').focus()")
    }))
    const ownedIds = new Set(windows.map((window) => window.webContents.id))
    const driver = createElectronWebContentsCdpDriver(() => webContents.getAllWebContents().filter((contents) => (
      ownedIds.has(contents.id) && !contents.isDestroyed()
    )))
    adapter = await startComputerUseCdpAdapter({ driver })
    const capabilities = await call(adapter.url, adapter.token, '/v1/capabilities')
    if (!(capabilities.supportedTargetKinds as unknown[])?.includes('electron-webcontents')) {
      throw new Error('Electron target kind was not reported.')
    }
    const listed = await call(adapter.url, adapter.token, '/v1/targets')
    const targets = listed.targets as Array<Record<string, unknown>>
    if (targets.length !== 3) throw new Error(`Expected 3 Electron targets, got ${targets.length}.`)

    const windowIndexByContentsId = new Map(windows.map((window, index) => [window.webContents.id, index]))
    const handles = await Promise.all(targets.map(async (target, index) => {
      const locator = target.locator as Record<string, unknown>
      const windowIndex = windowIndexByContentsId.get(Number(locator.webContentsId))
      if (windowIndex === undefined) throw new Error('Adapter returned a target outside the test-owned set.')
      const opened = await call(adapter!.url, adapter!.token, '/v1/handles/open', {
        requestId: `electron-smoke-${index + 1}`, target
      })
      const observed = await call(adapter!.url, adapter!.token, '/v1/observe', {
        handleId: opened.handleId
      })
      if (typeof observed.imageBase64 !== 'string' || observed.imageBase64.length < 100) {
        throw new Error('Electron target screenshot was empty.')
      }
      const acted = await call(adapter!.url, adapter!.token, '/v1/action', {
        handleId: opened.handleId,
        expectedRevision: observed.revision,
        action: { action: 'type', text: `isolated-${windowIndex + 1}` }
      })
      const verification = acted.verification as Record<string, unknown>
      if (verification.status !== 'verified') throw new Error('Electron type readback was not verified.')
      return String(opened.handleId)
    }))

    const values = await Promise.all(windows.map((window) => window.webContents.executeJavaScript(
      "document.querySelector('#entry').value"
    )))
    if (JSON.stringify(values) !== JSON.stringify(['isolated-1', 'isolated-2', 'isolated-3'])) {
      throw new Error(`Electron target input crossed: ${JSON.stringify(values)}`)
    }
    await Promise.all(handles.map((handleId) => call(adapter!.url, adapter!.token, '/v1/handles/close', { handleId })))
    if (windows.some((window) => window.isDestroyed())) throw new Error('Closing an attached handle destroyed a window.')
    if (windows.some((window) => window.webContents.debugger.isAttached())) {
      throw new Error('Electron debugger remained attached after handle cleanup.')
    }
    const finalCapabilities = await call(adapter.url, adapter.token, '/v1/capabilities')
    if (finalCapabilities.activeHandleCount !== 0) throw new Error('Electron Adapter handle leaked.')
    process.stdout.write(JSON.stringify({ ok: true, targets: 3, values, activeHandleCount: 0 }))
  } finally {
    await adapter?.close().catch(() => undefined)
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    app.quit()
  }
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  app.exit(1)
})
