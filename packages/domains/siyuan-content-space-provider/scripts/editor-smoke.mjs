import assert from 'node:assert/strict'
import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))

// Server mode only: this smoke needs a real SiYuan service to talk to.
const serviceUrl = (process.env.SIYUAN_SMOKE_URL ?? process.env.SIYUAN_BASE_URL ?? '').trim()
if (!serviceUrl) {
  throw new Error('Set SIYUAN_SMOKE_URL (or SIYUAN_BASE_URL) to a reachable SiYuan service before running editor:smoke.')
}
const origin = new URL(serviceUrl).origin
const token = process.env.SIYUAN_API_TOKEN?.trim() || ''

const profile = await mkdtemp(join(tmpdir(), 'sciforge-siyuan-ui-'))
let application
try {
  application = await _electron.launch({ executablePath: require('electron'),
    args: [root, `--user-data-dir=${profile}`, '--hidden'], cwd: root,
    env: { ...process.env, SIYUAN_BASE_URL: serviceUrl, SCIFORGE_DEV_BROWSER_BRIDGE: '0', SCIFORGE_ELECTRON_SMOKE: '1' },
    timeout: 60_000 })
  const page = await application.firstWindow()
  // The first-run overlay belongs to the Host and may legitimately be absent.
  await page.getByRole('button', { name: 'Close', exact: true }).first()
    .click({ timeout: 5_000 }).catch(() => undefined)
  await page.getByText('思源笔记', { exact: true }).first().click({ timeout: 30_000 })

  // The embedded editor is a native child view owned by the package main
  // process, not a DOM tag, so it is discovered from the main process by the
  // service origin it loads.
  const editor = await (async () => {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      const found = await application.evaluate(({ webContents }, expected) => {
        const guest = webContents.getAllWebContents()
          .find((value) => value.getURL().startsWith(expected))
        return guest ? { id: guest.id, url: guest.getURL() } : null
      }, origin)
      if (found) return found
      await new Promise((done) => setTimeout(done, 500))
    }
    throw new Error(`The package never attached an editor view for ${origin}. Is the service reachable?`)
  })()

  const editorText = await (async () => {
    const deadline = Date.now() + 60_000
    // Match on known SiYuan surfaces instead of a length threshold: an
    // access-code deployment renders a short unlock page, not the editor shell.
    const ready = /欢迎使用思源|新建文档|解锁访问|访问授权|workspace/u
    while (Date.now() < deadline) {
      const text = await application.evaluate(({ webContents }, id) => {
        const guest = webContents.fromId(id)
        return guest ? guest.executeJavaScript('document.body ? document.body.innerText : ""') : ''
      }, editor.id).catch(() => '')
      if (typeof text === 'string' && ready.test(text)) return text
      await new Promise((done) => setTimeout(done, 500))
    }
    throw new Error('The SiYuan editor view stayed empty.')
  })()
  // A service that enforces an access code legitimately lands on SiYuan's own
  // unlock page, so that surface counts too: this smoke proves the view loads and
  // is presented, not that the operator is already signed in.
  assert.match(editorText, /欢迎使用思源|新建文档|解锁访问|访问授权/u)

  // The native view must be attached, sized and clamped inside the window: this
  // is the presentation logic that no DOM assertion can observe.
  const layout = await application.evaluate(({ webContents, BrowserWindow }, id) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) return null
    const view = (window.contentView.children ?? [])
      .find((child) => child.webContents && child.webContents.id === id)
    if (!view) return { attached: false }
    return {
      attached: true,
      bounds: view.getBounds(),
      content: window.getContentBounds(),
      visible: typeof view.getVisible === 'function' ? view.getVisible() : null
    }
  }, editor.id)
  assert.ok(layout, 'No desktop window was available to present the editor into.')
  assert.equal(layout.attached, true, 'The editor must be attached as a native child view.')
  assert.ok(layout.bounds.width > 0 && layout.bounds.height > 0, 'The editor slot must not be empty.')
  assert.ok(
    layout.bounds.x + layout.bounds.width <= layout.content.width + 1 &&
    layout.bounds.y + layout.bounds.height <= layout.content.height + 1,
    'The editor view must stay inside the window content bounds.'
  )
  // Presenting means actually visible to the user. A loaded but hidden view used
  // to pass every other assertion while the page showed its loading overlay
  // forever, which is exactly what this guards against.
  assert.equal(layout.visible, true, 'The editor view must be visible, not merely attached.')
  await page.getByRole('status').waitFor({ state: 'detached', timeout: 60_000 })
    .catch(() => { throw new Error('The page kept its loading overlay after the editor was presented.') })

  await page.screenshot({ path: join(profile, 'editor.png') })

  // The page owns its own configuration; saving closes the panel and persists
  // only the service address.
  await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 30_000 })
  const panel = page.getByRole('dialog', { name: '思源笔记设置' })
  await panel.waitFor({ state: 'visible', timeout: 30_000 })
  await panel.getByRole('textbox').fill(serviceUrl)
  await panel.getByRole('button', { name: '保存设置', exact: true }).click()
  await panel.waitFor({ state: 'hidden', timeout: 30_000 })
  const persisted = await page.evaluate(() => localStorage.getItem('sciforge.siyuan.editor'))
  assert.match(persisted ?? '', new RegExp(serviceUrl.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))

  let write = 'skipped'
  if (token) {
    const saved = await page.evaluate(async () => {
      const input = { title: 'Electron task summary', notebookName: 'SciForge 工作总结',
        path: `/SciForge/Electron task summary ${Date.now()}`, markdown: '# 本轮总结\n\nElectron Broker 写入验证。' }
      const first = await window.sciforge.capabilities.invoke({ request: {
        actionId: 'siyuan.document.create', invocationId: 'summary-smoke-first', input
      } })
      const second = await window.sciforge.capabilities.invoke({ request: {
        actionId: 'siyuan.document.create', invocationId: 'summary-smoke-reconcile', input
      } })
      return { first: first.output, second: second.output }
    })
    assert.equal(saved.first.id, saved.second.id)
    const summary = await fetch(`${origin}/api/export/exportMdContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
      body: JSON.stringify({ id: saved.first.id })
    }).then((response) => response.json())
    assert.equal(summary.code, 0)
    assert.match(summary.data.content, /Electron Broker 写入验证/u)
    write = 'ok'
  }

  console.log(JSON.stringify({ service: origin, editor: 'ok', nativeView: 'ok',
    settings: 'ok', write, deduplication: write === 'ok' ? 'ok' : 'skipped', profile }))
} finally {
  await application?.close()
}