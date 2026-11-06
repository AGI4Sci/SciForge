import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { register } from 'node:module'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createReviewOperations } from '../src/review-adapter/index.js'
import { REVIEW_TOOL_CAPABILITIES, visualReviewTools } from '../src/review-adapter/tools.js'
import { createFakeArtifactPort, renderPng, tempRoot } from './review-fixtures.js'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { scientificPlottingMessages } from '../src/renderer/scientific-plotting-messages.js'
import type { PluginUiHostInit, PluginUiSdk } from '../src/ui/sdk.js'
import type { VisualDocument } from '../src/review/types.js'

// Import react-dom only after installing the DOM so its production input event
// support detection follows the same path as the browser bundle.
const window = new Window()
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, HTMLInputElement: window.HTMLInputElement, Event: window.Event,
  IS_REACT_ACT_ENVIRONMENT: true })) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
register(`data:text/javascript,${encodeURIComponent(`
  export async function load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
    return nextLoad(url, context)
  }
`)}`, import.meta.url)
const { createRoot } = await import('react-dom/client')
const { ScientificPlottingUnifiedPanel } = await import('../src/ui/ScientificPlottingUnifiedPanel.js')
const { VisualReviewPanel } = await import('../src/review-ui/VisualReviewPanel.js')
const { createVisualReviewCapabilityClient } = await import('../src/review-ui/capability-client.js')
after(async () => {
  await window.happyDOM.close()
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

const timestamp = '2026-11-03T00:00:00.000Z'
const hash = 'a'.repeat(64)
function existingDocument(documentId: string): VisualDocument {
  return {
    schemaVersion: 1, documentId, canvas: { width: 320, height: 240, background: '#fff' },
    artifact: { id: 'source', kind: 'image', sourcePath: '/workspace/source.png', sourceHash: hash,
      workingCopyPath: '/workspace/source.png', workingCopyHash: hash, width: 320, height: 240 },
    annotations: [], nodes: [], truthLocks: [], styleProfileRef: null,
    revisions: [{ id: 'candidate-1', status: 'candidate', basedOnHash: hash, artifactPath: '/workspace/candidate.png',
      artifactHash: hash, width: 320, height: 240, summary: 'Existing candidate', createdAt: timestamp,
      reviewEvidence: { tool: 'image_generation_review_candidate', ok: true, status: 'publication_ready',
        reviewedArtifactPath: '/workspace/candidate.png', reviewedArtifactHash: hash, reviewedAt: timestamp,
        score: { overall: 1, dimensions: 1, nonEmpty: 1, background: 1, semantic: 1, warnings: [] },
        semantic: { pass: true, needsContext: false, summary: 'Ready', violations: [], repairInstructions: [] },
        repairable: false, warnings: [] } }],
    activeCandidateRevisionId: 'candidate-1', acceptedRevisionId: null, createdAt: timestamp, updatedAt: timestamp
  }
}
function opened(documentId: string) {
  return { ok: true, status: 'opened', workspaceRoot: '/workspace', document: existingDocument(documentId),
    paths: { documentDir: '/workspace/review', documentPath: '/workspace/review/document.json',
      assetsDir: '/workspace/review/assets', revisionsDir: '/workspace/review/revisions',
      backupsDir: '/workspace/review/backups', reviewPacketsDir: '/workspace/review/packets' } }
}

type Call = { actionId: string; input: unknown; options: unknown }
async function mount(locale = 'en', initialOverrides: Partial<PluginUiHostInit> = {}) {
  let host: PluginUiHostInit = { workspaceRoot: '/workspace', sessionId: 'session-1', locale,
    capabilityIds: [], ...initialOverrides }
  const listeners = new Set<(host: PluginUiHostInit) => void>()
  const calls: Call[] = []
  let failure: Error | null = null
  let malformed = false
  let picked = false
  const sdk: PluginUiSdk = {
    ready: Promise.resolve(host),
    async invoke(actionId, input, options) {
      calls.push({ actionId, input, options })
      if (actionId === 'visual-review.read-document') {
        if (failure) throw failure
        if (malformed) return { ok: true }
        return opened((input as { documentId: string }).documentId)
      }
      if (actionId === 'visual-review.read-image') return { ok: true, dataUrl: 'data:image/png;base64,AA==' }
      if (actionId === 'visual-review.open') return opened((input as { documentId: string }).documentId)
      if (actionId === 'visual-review.accept-candidate') throw new Error('Confirmation declined by user')
      // The unchanged provenance view may request its independent capability.
      throw new Error(`Unavailable in this UI test: ${actionId}`)
    },
    async pickFile() { picked = true; return { canceled: false, path: '/workspace/picked.png' } },
    async sendMessage() { return { ok: true } },
    subscribeInit(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    collapse() {}, dispose() {}
  }
  const i18n = i18next.createInstance()
  await i18n.init({ lng: locale, fallbackLng: 'en', defaultNS: 'common',
    resources: { en: { common: scientificPlottingMessages.en }, zh: { common: scientificPlottingMessages.zh } },
    interpolation: { escapeValue: false } })
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  await act(async () => { root.render(createElement(I18nextProvider, { i18n },
    createElement(ScientificPlottingUnifiedPanel, { sdk, initialHost: host }))) })
  const button = (label: string) => {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
    assert.ok(found, `Missing button: ${label}`)
    return found
  }
  const click = async (label: string) => { await act(async () => { button(label).click() }) }
  const enter = async (value: string) => {
    const input = container.querySelector('#plot-existing-document-id')
    assert.ok(input instanceof window.HTMLInputElement)
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  }
  return { container, calls, button, click, enter,
    get picked() { return picked },
    fail(error: Error | null) { failure = error }, malformed() { malformed = true },
    async update(overrides: Partial<PluginUiHostInit>) {
      host = { ...host, ...overrides }
      await act(async () => {
        await i18n.changeLanguage(host.locale ?? 'en')
        for (const listener of listeners) listener(host)
      })
    },
    async cleanup() { await act(async () => { root.unmount() }); container.remove() }
  }
}

test('all stored annotation targets survive real panel display, edit, save, readback and packet export', async () => {
  const workspaceRoot = await tempRoot('review-ui-targets-')
  const port = createFakeArtifactPort()
  const tools = new Map(visualReviewTools(createReviewOperations({
    invoke: async (contract: { actionId: string }, input: unknown) => contract.actionId.endsWith('.commit')
      ? port.commit(input as never, workspaceRoot) : port.read(input as never, workspaceRoot)
  } as never)).map(tool => [REVIEW_TOOL_CAPABILITIES[tool.name as keyof typeof REVIEW_TOOL_CAPABILITIES], tool]))
  const execute = async (actionId: string, input: unknown) => tools.get(actionId as typeof REVIEW_TOOL_CAPABILITIES[keyof typeof REVIEW_TOOL_CAPABILITIES])!.execute({
    ...(input as Record<string, unknown>), workspaceRoot
  }) as any
  const documentId = 'target-roundtrip'
  await mkdir(join(workspaceRoot, 'images'))
  await writeFile(join(workspaceRoot, 'images/source.png'), await renderPng())
  const opened = await execute('visual-review.open', { documentId,
    artifact: { kind: 'image', sourcePath: 'images/source.png', width: 96, height: 64 } })
  const rootId = opened.document.nodes[0].id
  const geometries = [
    { kind: 'box', bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 } },
    { kind: 'arrow', from: { x: 0.1, y: 0.1 }, to: { x: 0.6, y: 0.6 } },
    { kind: 'freehand', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }] },
    { kind: 'pin', point: { x: 0.5, y: 0.5 } }
  ]
  await execute('visual-review.save-annotations', { documentId, annotations: geometries.map((geometry, index) => ({
    id: `note-${index}`, geometry, instruction: `Target ${index}`, targetNodeIds: [rootId], status: 'open'
  })) })
  const client = createVisualReviewCapabilityClient({ invoke: async (contract: { actionId: string; outputSchema: { parse: (value: unknown) => unknown } }, input: unknown) => {
    const result = await execute(contract.actionId, input)
    return contract.outputSchema.parse(result)
  } } as never)
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let exported: any
  try {
    await act(async () => { root.render(createElement(VisualReviewPanel, {
      workspaceRoot, sessionId: 'session', documentId, client, onCollapse() {},
      workbench: { async sendMessage() {
        const packet = await execute('visual-review.export-review-packet', { documentId })
        exported = JSON.parse(await readFile(packet.packetPath, 'utf8'))
        return { ok: true }
      } }
    })) })
    for (let attempt = 0; attempt < 100 && !container.querySelector('.visual-review-surface'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    const inputs = [...container.querySelectorAll('textarea')]
    assert.equal(inputs.length, 4, container.textContent ?? '')
    assert.deepEqual(inputs.map(input => input.value), ['Target 0', 'Target 1', 'Target 2', 'Target 3'])
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(inputs[0], 'Edited target')
      inputs[0].dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    const generate = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '生成修改版')
    assert.ok(generate)
    await act(async () => { generate.click() })
    for (let attempt = 0; attempt < 100 && !exported; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    assert.ok(exported, container.textContent ?? '')
    const saved = await execute('visual-review.read-document', { documentId })
    assert.equal(saved.document.annotations[0].instruction, 'Edited target')
    assert.deepEqual(saved.document.annotations.map((a: any) => a.targetNodeIds), geometries.map(() => [rootId]))
    assert.deepEqual(exported.annotations.map((a: any) => a.targetNodeIds), geometries.map(() => [rootId]))
    assert.deepEqual(saved.document.annotations.map((a: any) => a.geometry), geometries)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('existing review validates trimmed public document input and loads the real candidate surface without opening a new document', async () => {
  const ui = await mount()
  try {
    await ui.click('Review & revise')
    assert.equal(ui.container.querySelector('label[for="plot-existing-document-id"]')?.textContent, 'Review document ID')
    assert.equal(ui.button('Open existing review').disabled, true)
    for (const value of ['   ', 'x'.repeat(121)]) {
      await ui.enter(value)
      assert.equal(ui.button('Open existing review').disabled, true)
      await ui.click('Open existing review')
    }
    assert.equal(ui.calls.some((call) => call.actionId.startsWith('visual-review.')), false)
    await ui.enter('  existing-doc  ')
    assert.equal(ui.button('Open existing review').disabled, false)
    await ui.click('Open existing review')
    const reads = ui.calls.filter((call) => call.actionId === 'visual-review.read-document')
    assert.equal(reads.length, 2, 'Entry validation and actual VisualReviewPanel both use the real client')
    assert.deepEqual(reads.map((call) => call.input), [{ documentId: 'existing-doc' }, { documentId: 'existing-doc' }])
    assert.ok(ui.container.querySelector('.visual-review-surface'))
    assert.ok(ui.button('接受并替换'))
    assert.ok(ui.container.querySelector('img[src="data:image/png;base64,AA=="]'))
    assert.equal(ui.calls.some((call) => call.actionId === 'visual-review.open'), false)
    assert.equal(ui.picked, false)
    assert.equal(ui.calls.some((call) => call.actionId === 'visual-review.accept-candidate'), false)
    await ui.click('接受并替换')
    const accept = ui.calls.find((call) => call.actionId === 'visual-review.accept-candidate')
    assert.deepEqual(accept, { actionId: 'visual-review.accept-candidate',
      input: { documentId: 'existing-doc', revisionId: 'candidate-1' }, options: { approval: { mode: 'confirmation' } } })
    assert.match(ui.container.textContent ?? '', /Confirmation declined by user/u)
    assert.ok(ui.button('接受并替换'), 'Declined confirmation keeps the existing candidate')
  } finally { await ui.cleanup() }
})

test('failed existing-document reads do not mount a review or create a document; malformed outputs fail closed', async () => {
  const ui = await mount('zh')
  try {
    await ui.click('审改')
    assert.equal(ui.container.querySelector('label[for="plot-existing-document-id"]')?.textContent, '审改文档 ID')
    await ui.enter('missing-doc')
    ui.fail(new Error('Document does not exist'))
    await ui.click('打开已有审改文档')
    assert.match(ui.container.querySelector('[role="status"]')?.textContent ?? '', /Document does not exist/u)
    assert.equal(ui.container.querySelector('.visual-review-surface'), null)
    assert.equal(ui.calls.filter((call) => call.actionId === 'visual-review.read-document').length, 1)
    assert.equal(ui.calls.some((call) => call.actionId === 'visual-review.open'), false)
    assert.equal(ui.button('打开已有审改文档').disabled, false)
    ui.fail(null)
    ui.malformed()
    await ui.click('打开已有审改文档')
    assert.ok(ui.container.querySelector('[role="status"]'))
    assert.equal(ui.container.querySelector('.visual-review-surface'), null)
  } finally { await ui.cleanup() }
})

test('loaded review and typed document survive session/locale/capability context changes; activation remains canonical', async () => {
  const ui = await mount()
  try {
    await ui.click('Review & revise')
    await ui.enter('existing-doc')
    await ui.click('Open existing review')
    const surface = ui.container.querySelector('.visual-review-surface')
    const readCount = ui.calls.filter((call) => call.actionId === 'visual-review.read-document').length
    await ui.update({ sessionId: 'session-2', locale: 'zh', capabilityIds: ['visual-review.read-document'], activation: null })
    assert.equal(ui.container.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '审改')
    assert.equal(ui.container.querySelector('.visual-review-surface'), surface, 'No review remount on metadata updates')
    assert.equal(ui.container.querySelector('input')?.value, 'existing-doc')
    assert.equal(ui.calls.filter((call) => call.actionId === 'visual-review.read-document').length, readCount)
    await ui.update({ activation: { revision: 1, payload: { documentId: 'activated-doc' } } })
    assert.deepEqual(ui.calls.filter((call) => call.actionId === 'visual-review.read-document').at(-1)?.input,
      { documentId: 'activated-doc' })
    assert.ok(ui.button('接受并替换'))
    await ui.click('打开图片审改')
    assert.equal(ui.picked, true)
    const imageOpen = ui.calls.find((call) => call.actionId === 'visual-review.open')
    assert.match((imageOpen?.input as { documentId: string }).documentId, /^visual-/u)
    assert.deepEqual((imageOpen?.input as { artifact: unknown }).artifact, { kind: 'image', sourcePath: '/workspace/picked.png' })
  } finally { await ui.cleanup() }
})

test('existing-review button is workspace gated and failed reads preserve the currently loaded review', async () => {
  const ui = await mount('en', { workspaceRoot: undefined })
  try {
    await ui.click('Review & revise')
    await ui.enter('existing-doc')
    assert.equal(ui.button('Open existing review').disabled, true)
    await ui.update({ workspaceRoot: '/workspace' })
    await ui.click('Open existing review')
    const surface = ui.container.querySelector('.visual-review-surface')
    await ui.enter('missing-doc')
    ui.fail(new Error('Document does not exist'))
    await ui.click('Open existing review')
    assert.equal(ui.container.querySelector('.visual-review-surface'), surface)
    assert.ok(ui.button('接受并替换'))
    assert.match(ui.container.querySelector('[role="status"]')?.textContent ?? '', /Document does not exist/u)
  } finally { await ui.cleanup() }
})
