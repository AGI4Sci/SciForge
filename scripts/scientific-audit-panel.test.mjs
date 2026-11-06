import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { EvidenceDagRuntime } from '@sciforge/domain-evidence-dag/main'
import { EvidenceDagDeltaStore } from '@sciforge/domain-evidence-dag/main'
import { createEvidenceDagCapabilityFactory } from '@sciforge/domain-evidence-dag/main'
import { ResearchRecordPanel } from '@sciforge/domain-evidence-dag/renderer'
import { createResearchRecordPresentation } from '@sciforge/domain-evidence-dag/renderer'

test('actual Panel forwards retained missing-live figure and queries exact scientific owner before navigation', async () => {
  const browser = new Window()
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver', 'ResizeObserver']) if (browser[name]) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? browser : browser[name] })
  globalThis.React = React; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'audit-panel-')))
  const scope = { runtimeId: 'codex', threadId: 'panel-fixture', workspaceRoot: workspace }
  const ref = { artifactId: 'artifact:historical', versionId: 'artifact-version:historical', contentDigest: 'a'.repeat(64), byteLength: 4, mediaType: 'image/png', availability: 'available', retention: 'reference', accessPolicy: { visibility: 'workspace', principals: [], allowExport: false } }
  const detail = { ...scope, id: scope.threadId, watermark: '1', artifacts: [], turns: [{ id: 'turn:old', status: 'completed', messages: [], artifacts: [{ id: 'figure:old', kind: 'tool', summary: 'Old measured figure', figure: ref }] }] }
  const store = new EvidenceDagDeltaStore(join(workspace, 'deltas.json'))
  const runtime = new EvidenceDagRuntime({ userDataDir: workspace, deltaStore: store, sidecar: { configure: () => {}, endpoint: () => ({ baseUrl: 'http://127.0.0.1:1', apiKey: '' }), ensureReady: async () => {}, stop: async () => {} }, fetchImpl: async () => { throw new Error('Network prohibited') } })
  const context = { userDataDir: workspace, signal: new AbortController().signal, agentThreads: { list: async () => [detail], read: async () => structuredClone(detail) }, enablement: { isEnabled: async () => true, subscribe: () => () => {} }, capabilities: { invoke: async () => { throw new Error('External effect prohibited') } }, log: () => {} }
  await runtime.activate(context)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await runtime.records.scan()
    const nodes = async id => { const view = await runtime.records.view({ ...scope, nodeId: id }); return [...view.children, ...(await Promise.all(view.children.filter(node => !node.source).map(node => nodes(node.id)))).flat()] }
    const event = (await nodes('root')).find(node => node.source?.itemId === 'figure:old')
    assert.ok(event)
    const delta = await store.append({ scope: { ...scope, operationId: 'formal', kind: 'manual' }, requestedWatermark: '1', schemaVersion: 'evidence.delta.v1', extractorVersion: 'fixture', verifierVersion: 'fixture', idempotencyKey: 'panel-formal-delta', payload: { claims: [{ id: 'claim:panel', controls: { matched: false, condition: 'Unequal resources' } }], ref } })
    const closure = await store.seal('panel-fixture', { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim:panel'], expectedHeadDigest: delta.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
    await store.appendSidechain({ threadId: 'panel-fixture', closureDigest: closure.closureDigest, recordId: 'review:panel', recordType: 'review', idempotencyKey: 'panel-review-original', producerIdentity: 'human:fixture', payload: { targetId: 'claim:panel' } })
    detail.turns = []
    const defs = createEvidenceDagCapabilityFactory({ defineCapability: value => value, getRuntime: () => runtime }).createDefinitions()
    const calls = [], opened = []
    const invoker = { invoke: async (contract, input, options) => {
      calls.push({ action: contract.actionId, input })
      if (contract.actionId === 'artifact-versions.read') {
        assert.deepEqual(input.expectedRef, ref)
        return { ok: true, value: { ref, artifact: { kind: 'figure' }, dataBase64: 'eHl6eg==' } }
      }
      const def = defs.find(value => value.id === contract.actionId)
      assert.ok(def, contract.actionId)
      return contract.outputSchema.parse((await def.handler(def.inputSchema.parse(input), { caller: { workspaceId: options.workspaceId } })).output)
    } }
    const presentation = createResearchRecordPresentation(); presentation.inspect(event.id)
    await act(async () => root.render(React.createElement(ResearchRecordPanel, { scope, invoker, presentation, workbench: { canOpenResource: () => true, openResource: input => { opened.push(input); return true } } })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)) })
    assert.match(container.textContent, /Unequal resources/)
    assert.ok(calls.some(call => call.action === 'evidence-dag.audit-query' && call.input.subject.artifactVersionRef.contentDigest === ref.contentDigest))
    const closureButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('打开精确闭包'))
    await act(async () => closureButton.click())
    assert.equal(opened.at(-1).resource.integrity.expectedDigest, closure.closureDigest)
    const mediaTab = [...container.querySelectorAll('button')].find(button => button.textContent === '图片 / 图表')
    await act(async () => mediaTab.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    assert.match(container.textContent, /历史保留观察/)
    assert.ok(calls.some(call => call.input.expectedRef?.artifactId === ref.artifactId))
    assert.ok(container.querySelector('img'))
    const open = [...container.querySelectorAll('button')].find(button => button.textContent === '打开精确版本')
    await act(async () => open.click())
    assert.equal(opened.at(-1).resource.resourceId, ref.versionId)
    assert.equal(opened.at(-1).resource.integrity.expectedDigest, `sha256:${ref.contentDigest}`)
  } finally { await act(async () => root.unmount()); await runtime.close(); browser.close() }
})
