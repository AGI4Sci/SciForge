import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const root = resolve('test-fixtures/migration-plugins/p2-better-sidebar')
const fixtureManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const renderer = await import(pathToFileURL(resolve(root, 'dist/renderer.mjs')).href)

class FakeSandboxRegistrar {
  #generation = 0
  #panels = new Map()
  #tabs = new Map()
  #sessionTabs = new Map()

  beginGeneration(generation) {
    if (!Number.isInteger(generation) || generation <= this.#generation) {
      throw new Error(`generation ${generation} is not newer than ${this.#generation}`)
    }
    this.#generation = generation
    this.#panels.clear()
    this.#tabs.clear()
    this.#sessionTabs.clear()
  }

  registerPanel(panel, generation) {
    this.#assertCurrent(generation)
    if (this.#panels.has(panel.id)) throw new Error(`panel ${panel.id} is already registered`)
    this.#panels.set(panel.id, { ...panel, generation })
    return () => {
      const current = this.#panels.get(panel.id)
      if (current?.generation === generation) this.#panels.delete(panel.id)
    }
  }

  registerTab(tab, generation) {
    this.#assertCurrent(generation)
    if (this.#tabs.has(tab.id)) throw new Error(`tab ${tab.id} is already registered`)
    this.#tabs.set(tab.id, { ...tab, generation })
    return () => {
      const current = this.#tabs.get(tab.id)
      if (current?.generation === generation) this.#tabs.delete(tab.id)
    }
  }

  switchTab(sessionId, tabId) {
    if (!this.#tabs.has(tabId)) throw new Error(`tab ${tabId} is unavailable`)
    this.#sessionTabs.set(sessionId, tabId)
  }

  render(sessionId) {
    const panel = this.#panels.get('better-sidebar.workbench-right-panel')
    if (!panel) throw new Error('Better Sidebar panel is not registered')
    return panel.render({
      sessionId,
      activeTabId: this.#sessionTabs.get(sessionId)
    })
  }

  tabIds() { return [...this.#tabs.keys()] }
  panelIds() { return [...this.#panels.keys()] }
  #assertCurrent(generation) {
    if (generation !== this.#generation) throw new Error(`stale generation ${generation}`)
  }
}

test('P2 renderer fixture is dynamic and excluded from static trusted composition', async () => {
  const staticRenderer = await readFile(resolve('src/renderer/src/domain-modules/installed-domain-renderer.ts'), 'utf8')
  const staticPackages = await readFile(resolve('src/shared/installed-domain-packages.ts'), 'utf8')
  assert.doesNotMatch(staticRenderer, /migration-p2-better-sidebar|sciforge\.better-sidebar/)
  assert.doesNotMatch(staticPackages, /migration-p2-better-sidebar|sciforge\.better-sidebar/)
  assert.equal(typeof fixtureManifest.dsh.bundle.patch, 'string')
  assert.equal(fixtureManifest.dsh.client.platform, 'desktop')
  assert.equal(fixtureManifest.exports['./client'], './dist/renderer.mjs')
  await readFile(resolve(root, 'dist/renderer.mjs'), 'utf8')
})

test('P2 renderer registers panel/tabs, switches per session, and disposes all contributions', () => {
  const registrar = new FakeSandboxRegistrar()
  registrar.beginGeneration(1)
  const dispose = renderer.activateRenderer(registrar, 1)
  assert.deepEqual(registrar.panelIds(), ['better-sidebar.workbench-right-panel'])
  assert.deepEqual(registrar.tabIds(), ['explorer', 'changes', 'tasks', 'sidechat'])
  assert.deepEqual(registrar.render('session-a'), {
    sessionId: 'session-a',
    tabs: ['explorer', 'changes', 'tasks', 'sidechat'],
    activeTabId: 'explorer'
  })
  registrar.switchTab('session-a', 'changes')
  assert.equal(registrar.render('session-a').activeTabId, 'changes')
  assert.equal(registrar.render('session-b').activeTabId, 'explorer')
  dispose()
  dispose()
  assert.deepEqual(registrar.panelIds(), [])
  assert.deepEqual(registrar.tabIds(), [])
  assert.throws(() => registrar.render('session-a'), /not registered/)
})

test('P2 renderer rejects stale registrations and reloads exactly once per generation', () => {
  const registrar = new FakeSandboxRegistrar()
  registrar.beginGeneration(1)
  const disposeFirst = renderer.activateRenderer(registrar, 1)
  disposeFirst()
  registrar.beginGeneration(2)
  assert.throws(
    () => registrar.registerTab({ id: 'stale', title: 'Stale', order: 99 }, 1),
    /stale generation/
  )
  const disposeSecond = renderer.activateRenderer(registrar, 2)
  assert.deepEqual(registrar.panelIds(), ['better-sidebar.workbench-right-panel'])
  assert.deepEqual(registrar.tabIds(), ['explorer', 'changes', 'tasks', 'sidechat'])
  assert.throws(() => renderer.activateRenderer(registrar, 2), /already registered/)
  disposeSecond()
  assert.deepEqual(registrar.panelIds(), [])
  assert.deepEqual(registrar.tabIds(), [])
})
