import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const require = createRequire(import.meta.url)
const profile = await mkdtemp(join(tmpdir(), 'sciforge-page-dock-'))
// A local read-only fixture exercises the real native editor without touching
// an operator's SiYuan server, account, credentials or documents.
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<!doctype html><html><body><h1>欢迎使用思源 · 停靠测试</h1><input id="draft" aria-label="Draft"></body></html>')
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
const env = { ...process.env, SIYUAN_BASE_URL: origin, SIYUAN_API_TOKEN: '', SCIFORGE_DEV_BROWSER_BRIDGE: '0' }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
let application
let page
const launch = () => _electron.launch({ executablePath: require('electron'), args: [root, `--user-data-dir=${profile}`, '--hidden'], cwd: root, env, timeout: 60_000 })
async function waitFor(check, label) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
try {
  application = await launch()
  page = await application.firstWindow()
  page.setDefaultTimeout(30_000)
  await page.waitForFunction(() => Boolean(window.sciforge), { timeout: 30_000 })
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.evaluate(async () => {
    await window.sciforge.capabilities.invoke({ request: { actionId: 'identity.local.create-account', invocationId: crypto.randomUUID(), input: { username: 'dock_smoke' } } })
  })
  const setup = page.locator('[aria-labelledby="initial-setup-title"]')
  await page.addLocatorHandler(setup, () => setup.getByRole('button', { name: /关闭|Close/i }).first().click())
  await page.getByText('思源笔记', { exact: true }).first().click({ timeout: 30_000 })
  const notes = page.locator('[data-dock-page="siyuan-content-space.main-area"]')
  const team = page.locator('[data-dock-page="collaboration.workbench-main-area"]')
  const native = () => application.evaluate(({ BrowserWindow }, expected) => {
    const host = BrowserWindow.getAllWindows()[0]
    const view = host.contentView.children.find(child => child.webContents?.getURL().startsWith(expected))
    return view ? { id: view.webContents.id, bounds: view.getBounds(), visible: view.getVisible(), zoom: host.webContents.getZoomFactor() } : null
  }, origin)
  await waitFor(async () => (await native())?.visible, 'native editor visible')
  const initialId = (await native()).id
  await application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value="retained draft"'), initialId)
  const assertNative = async () => {
    await waitFor(async () => {
      const view = await native(), slot = await notes.locator('[data-siyuan-editor-slot]').boundingBox()
      return view?.visible && slot && ['x', 'y', 'width', 'height'].every(key => Math.abs(view.bounds[key] - slot[key] * view.zoom) <= 2)
    }, 'native view follows the editor slot')
    assert.equal((await native()).id, initialId, 'Moving or switching tabs must preserve the native editor instance')
    assert.equal(await application.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('document.querySelector("#draft").value'), initialId), 'retained draft')
  }
  assert.equal(await notes.getAttribute('data-dock-position'), 'right')
  for (const position of ['left', 'bottom', 'main', 'right']) {
    console.log(`Checking dock position: ${position}`)
    await notes.locator('select').selectOption(position)
    await assertNative()
  }
  const separator = page.locator('.workbench-page-dock-separator.is-right')
  const before = (await native()).bounds.width
  const box = await separator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  await waitFor(async () => (await native()).bounds.width > before + 40, 'pointer resizing')
  await assertNative()
  await page.getByText(/^(协作|Collaboration)$/).first().click()
  await team.locator('select').selectOption('right')
  await waitFor(async () => !(await native())?.visible, 'native editor hidden behind another tab')
  await team.getByRole('tab', { name: '思源笔记', exact: true }).click()
  await assertNative()
  await page.screenshot({ path: join(profile, 'same-edge-tabs.png') })
  await notes.locator('select').selectOption('bottom')
  await assertNative()
  await page.screenshot({ path: join(profile, 'separate-edges.png') })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sciforge.layout.pageDocks.v1')))
  assert.equal(saved.pages['siyuan-content-space.main-area'].position, 'bottom')
  await application.close()
  application = await launch()
  page = await application.firstWindow()
  page.setDefaultTimeout(30_000)
  const restoredSetup = page.locator('[aria-labelledby="initial-setup-title"]')
  await page.addLocatorHandler(restoredSetup, () => restoredSetup.getByRole('button', { name: /关闭|Close/i }).first().click())
  const restoredNotes = page.locator('[data-dock-page="siyuan-content-space.main-area"]')
  const restoredTeam = page.locator('[data-dock-page="collaboration.workbench-main-area"]')
  await restoredNotes.getByRole('tab', { name: '思源笔记', exact: true }).click()
  assert.equal(await restoredNotes.getAttribute('data-dock-position'), 'bottom')
  assert.equal(await restoredTeam.getAttribute('data-dock-position'), 'right')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await waitFor(async () => (await native())?.visible, 'native editor visible after app restart')
  await page.screenshot({ path: join(profile, 'narrow.png') })
  console.log(JSON.stringify({ passed: true, checks: ['default right dock', 'all four positions', 'native bounds', 'pointer resize', 'shared-edge tabs', 'draft retention', 'separate edges', 'application restart persistence'], profile }))
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(profile, 'failure.png') }).catch(() => undefined)
    const diagnostics = await page.evaluate(() => ({ docks: Array.from(document.querySelectorAll('[data-dock-page]')).map(element => ({ id: element.dataset.dockPage, position: element.dataset.dockPosition, hidden: element.hidden, bounds: element.getBoundingClientRect().toJSON() })), slot: document.querySelector('[data-siyuan-editor-slot]')?.getBoundingClientRect().toJSON() })).catch(() => null)
    await writeFile(join(profile, 'failure.json'), JSON.stringify(diagnostics, null, 2))
    console.error(JSON.stringify({ profile, diagnostics }))
  }
  throw error
} finally {
  await application?.close()
  fixture.close()
}
