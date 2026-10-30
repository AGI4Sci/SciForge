import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, WebContentsView } from 'electron'
import { browserInputFixture } from '../tests/browser-input-fixture'
import { createBrowserPreviewService } from './service'
import { browserPageStateSchema } from './contract'
import { measureNativeBrowserViewport } from './renderer/native-viewport-layout'

export async function runNativeBrowserTests(): Promise<void> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-native-browser-'))
  app.setPath('userData', userDataDir)
  await app.whenReady()
  const server = createServer((request, response) => {
    if (request.url === '/download.txt') {
      const payload = 'SciForge native browser download ✓\n'
      response.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="fixture.txt"',
        'content-length': Buffer.byteLength(payload),
      })
      response.end(payload)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(browserInputFixture)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const window = new BrowserWindow({ width: 1000, height: 800, show: true, webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('data:text/html,<title>Native browser integration test</title>')
  // Execute the production slot measurement in a real layout engine.
  const layout = await window.webContents.executeJavaScript(`(() => {
    const measure = ${measureNativeBrowserViewport.toString()};
    document.body.style.margin = '0';
    document.body.innerHTML = '<div id="slot" style="position:absolute;left:20px;top:60px;width:800px;height:600px"></div>';
    const slot = document.querySelector('#slot');
    const initial = measure(slot, true);
    const inactive = measure(slot, false);
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;z-index:100;background:white';
    document.body.append(cover);
    const covered = measure(slot, true);
    cover.remove();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'position:fixed;left:80px;top:100px;width:20px;height:20px;z-index:100';
    document.body.append(menu);
    const occluded = measure(slot, true);
    menu.remove();
    slot.style.opacity = '0';
    const transparent = measure(slot, true);
    slot.style.opacity = '1';
    return { initial, inactive, covered, occluded, transparent, restored: measure(slot, true) };
  })()`)
  assert.deepEqual(layout.initial, { x: 20, y: 60, width: 800, height: 600, visible: true })
  assert.equal(layout.inactive.visible, false)
  assert.equal(layout.covered.visible, false, 'host routes and fullscreen siblings obscure native slots')
  assert.equal(layout.occluded.visible, false, 'even a small menu between hit-test points obscures the slot')
  assert.equal(layout.transparent.visible, false)
  assert.equal(layout.restored.visible, true)
  let hostId: number | undefined = window.webContents.id
  const service = createBrowserPreviewService({ userDataDir, currentWebContentsId: () => hostId })
  const caller = { audience: 'ui' as const, callerId: 'window:' + hostId, workspaceId: 'native-browser-test' }
  const agent = { ...caller, audience: 'agent' as const, callerId: 'agent:input-test' }
  const surface = 'input-test'
  const pause = () => new Promise(resolve => setTimeout(resolve, 80))
  try {
    await service.open({ sessionId: 'input-test', surfaceId: surface, url: `http://127.0.0.1:${address.port}/` }, caller)
    await pause()
    const first = await service.snapshot(surface, caller)
    assert.equal(first.status, 'ready', first.error ?? undefined)
    assert.equal(window.contentView.children.length, 1)
    const view = window.contentView.children[0] as WebContentsView
    const page = view.webContents
    await service.present(surface, { x: 20, y: 60, width: 800, height: 600, visible: true }, caller)
    assert.deepEqual(view.getBounds(), { x: 20, y: 60, width: 800, height: 600 })
    assert.equal(view.getVisible(), true)
    assert.equal(await page.executeJavaScript('typeof require'), 'undefined')
    assert.equal(await page.executeJavaScript('typeof process'), 'undefined')
    app.focus({ steal: true })
    window.focus()
    page.focus()
    await pause()
    const mouse = async (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, y: number, extra: Record<string, unknown> = {}) => {
      page.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, ...extra })
      await pause()
    }
    const state = async () => JSON.parse((await service.snapshot(surface, caller)).title)
    await mouse('mouseMove', 30, 90)
    assert.equal(await page.executeJavaScript('innerWidth'), 800, 'showing a hidden view applies its new viewport before native input')
    assert.equal((await state()).hover, true)
    await mouse('mouseMove', 21, 32)
    assert.equal((await state()).hover, false)
    await mouse('mouseDown', 21, 32)
    for (let x = 40; x <= 180; x += 20) await mouse('mouseMove', x, 32)
    await mouse('mouseUp', 180, 32)
    assert.ok((await state()).selection.length > 8, 'native left drag selects real text')
    assert.equal((await state()).buttons, 0)
    await mouse('mouseDown', 35, 90, { clickCount: 2, modifiers: ['shift'] })
    await mouse('mouseUp', 35, 90, { clickCount: 2, modifiers: ['shift'] })
    assert.equal((await state()).double, 1)
    assert.equal((await state()).shift, true)
    await mouse('mouseDown', 35, 90, { button: 'right' })
    await mouse('mouseUp', 35, 90, { button: 'right' })
    assert.equal((await state()).context, 1)
    await mouse('mouseDown', 35, 145)
    await mouse('mouseUp', 35, 145)
    await page.insertText('原生中文 a+')
    await pause()
    assert.equal((await state()).value, '原生中文 a+')
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['shift'] })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['shift'] })
    page.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    page.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
    await pause()
    assert.equal((await state()).value, '原生中文 a')
    let observation = browserPageStateSchema.parse(await service.snapshot(surface, agent))
    assert.match(observation.ariaSnapshot, /原生中文 a/u)
    assert.match(observation.ariaSnapshot, /table row 1: \["Name","Statu(?:s)?"\]/u)
    assert.match(observation.ariaSnapshot, /table row 2: \["Alice","Done"\]/u)
    assert.doesNotMatch(observation.ariaSnapshot, /fixture-secret|fixture-password|fixture-otp/u)
    assert.equal(await page.executeJavaScript('typeof globalThis.__sciforgePage'), 'undefined', 'untrusted page cannot forge opaque targets')
    const inputRef = observation.ariaSnapshot.match(/input "Editor"[^\n]*\[ref=(target_\w+)\]/u)?.[1]
    assert.ok(inputRef, observation.ariaSnapshot)
    await service.fill(surface, { targetRef: inputRef, text: '代理和用户共用页面' }, agent)
    await pause()
    assert.equal((await state()).value, '代理和用户共用页面')
    const downloaded = await service.download(surface, {
      url: `http://127.0.0.1:${address.port}/download.txt`,
      fileName: 'agent-download.txt',
    }, agent)
    assert.equal(downloaded.ok, true)
    assert.equal(downloaded.fileName, 'agent-download.txt')
    assert.equal(downloaded.url, `http://127.0.0.1:${address.port}/download.txt`)
    assert.equal(await readFile(downloaded.path, 'utf8'), 'SciForge native browser download ✓\n')
    assert.equal(downloaded.bytes, Buffer.byteLength('SciForge native browser download ✓\n'))
    assert.equal(window.contentView.children.length, 1, 'agent does not create a second browser')
    assert.equal('screenshotDataUrl' in observation, false)
    await assert.rejects(service.snapshot(surface, { ...agent, workspaceId: 'other-workspace' }))
    hostId = undefined
    await assert.rejects(service.present(surface, { x: 0, y: 0, width: 800, height: 600, visible: true }, caller))
    hostId = window.webContents.id
    await service.present(surface, { x: 0, y: 0, width: 0, height: 0, visible: false }, caller)
    assert.equal(view.getVisible(), false)
    window.webContents.setZoomFactor(1.25)
    await service.present(surface, { x: 20, y: 60, width: 400, height: 300, visible: true }, caller)
    assert.deepEqual(view.getBounds(), { x: 25, y: 75, width: 500, height: 375 })
    await service.open({ sessionId: 'input-test', surfaceId: surface, url: `http://127.0.0.1:${address.port}/` }, caller)
    assert.equal(await service.closeSession(surface, caller), false)
    assert.equal(await service.closeSession(surface, caller), true)
    assert.equal(window.contentView.children.length, 1, 'closing the panel releases presentation without destroying the page')
    assert.equal(view.getVisible(), false)
    await pause()
    assert.equal(page.isDestroyed(), false, 'history, scroll and in-progress edits remain in the retained native page')
    await service.open({ sessionId: 'input-test', surfaceId: surface, url: `http://127.0.0.1:${address.port}/` }, caller)
    assert.equal(page.isDestroyed(), false)
    assert.equal(await service.snapshot(surface, caller).then(state => state.url), `http://127.0.0.1:${address.port}/`)
    hostId = undefined
    await service.open({ sessionId: 'input-test', surfaceId: surface, url: 'https://example.com' }, caller)
    observation = await service.snapshot(surface, caller)
    assert.equal(observation.status, 'error')
    assert.match(observation.error!, /desktop window/u)
    console.log('Native browser integration passed: shared page, hover, drag, double/right click, Unicode editing, agent fill, isolation, zoom, visibility, leases and teardown.')
  } finally {
    await service.close()
    window.destroy()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(userDataDir, { recursive: true, force: true })
  }
}
