import assert from 'node:assert/strict'
import { z } from 'zod'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { activationFields, activationSnapshot, buildVisualGenerationRequest } from '../src/ui/unified-state.js'
import { createVisualReviewCapabilityClient } from '../src/review-ui/capability-client.js'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import { createPluginUiSdk, createSandboxCapabilityInvoker, type PluginUiHostInit } from '../src/ui/sdk.js'

const init = { capabilityIds: [] as string[] }

test('unified activation selects generation, review or immutable provenance without losing exact references', () => {
  assert.equal(activationFields(init).tab, 'generate')
  assert.deepEqual(activationFields({ ...init, activation: { revision: 2, payload: { documentId: ' doc-1 ', refreshKey: 42 } } }),
    { tab: 'review', documentId: 'doc-1', refreshKey: 42 })
  assert.deepEqual(activationFields({ ...init, activation: { revision: 1, payload: {
    resource: { resourceKind: 'scientific-plot-render-manifest', resourceId: 'artifact-version:manifest-1', integrity: { expectedDigest: 'sha256:' + 'a'.repeat(64) } }
  } } }), { tab: 'provenance', preferredManifestVersionId: 'artifact-version:manifest-1', preferredResourceDigest: 'sha256:' + 'a'.repeat(64) })
  assert.equal(activationFields({ ...init, activation: { revision: 1, payload: { tab: 'generate', documentId: 'doc-1' } } }).tab, 'generate')
})

test('activation identity ignores host metadata and cloned payload order but tracks revision and payload changes', () => {
  const host = { ...init, workspaceRoot: '/workspace', locale: 'zh', sessionId: 's-1',
    activation: { revision: 1, payload: { documentId: 'doc-1', artifact: { kind: 'image', sourcePath: 'plot.png' } } } }
  const original = activationSnapshot(host)
  assert.equal(activationSnapshot({ ...host, locale: 'en', sessionId: 's-2', capabilityIds: ['visual-review.open'],
    activation: { payload: { artifact: { sourcePath: 'plot.png', kind: 'image' }, documentId: 'doc-1' }, revision: 1 }
  }), original)
  assert.notEqual(activationSnapshot({ ...host, activation: { ...host.activation, revision: 2 } }), original)
  assert.notEqual(activationSnapshot({ ...host, activation: { revision: 1, payload: { documentId: 'doc-2' } } }), original)
  assert.notEqual(activationSnapshot({ ...host, activation: null }), original)
  assert.equal(activationSnapshot(init), activationSnapshot({ ...init, activation: null }))
})

test('generation submits to the canonical managed discovery and invocation path, never another scheduler', () => {
  const request = buildVisualGenerationRequest({ instruction: 'Measured x-y data', sessionId: 'session-1' })
  assert.match(request, /sciforge_discover\(\{ providerFamily: "managed-mcp", text: "visual_generate"/u)
  assert.match(request, /includeSchema: true/u)
  assert.match(request, /sciforge_invoke/u)
  assert.match(request, /execution\.stages/u)
  assert.match(request, /confirmation/u)
  assert.match(request, /session-1/u)
  assert.throws(() => buildVisualGenerationRequest({ instruction: ' ', sessionId: 'session-1' }))
})

test('sandbox preserves confirmation request and JSON transport; fake sources and wrong response types are ignored', async () => {
  const messages: Record<string, unknown>[] = []
  const listeners = new Set<(event: { source: unknown; data: unknown }) => void>()
  const target = { postMessage: (message: Record<string, unknown>) => messages.push(message) }
  const fakeWindow = {
    parent: target,
    addEventListener: (_: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.delete(listener),
    setTimeout,
    clearTimeout
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  const emit = (data: unknown, source: unknown = target): void => { for (const listener of listeners) listener({ source, data }) }
  try {
    const sdk = createPluginUiSdk()
    assert.equal(messages[0]?.type, 'ready')
    emit({ type: 'host.init', workspaceRoot: '/workspace', sessionId: 's-1', capabilityIds: ['review.accept', 4] })
    assert.deepEqual((await sdk.ready).capabilityIds, ['review.accept'])
    const updates: PluginUiHostInit[] = []
    const unsubscribe = sdk.subscribeInit((host) => updates.push(host))
    emit({ type: 'host.init', workspaceRoot: '/workspace', sessionId: 's-2', locale: 'en', capabilityIds: ['review.read', null] })
    assert.deepEqual(updates[0]?.capabilityIds, ['review.accept'])
    assert.deepEqual(updates[1]?.capabilityIds, ['review.read'])
    assert.equal(updates[1]?.sessionId, 's-2')
    emit({ type: 'host.init', capabilities: ['obsolete-field'] })
    assert.deepEqual(updates[2]?.capabilityIds, [])
    unsubscribe()
    const invoker = createSandboxCapabilityInvoker(sdk)
    const contract = { actionId: 'review.accept', effect: 'destructive' as const,
      inputSchema: z.unknown(), outputSchema: z.unknown() }
    const result = invoker.invoke(contract, { revisionId: 'r-1' }, { workspaceId: '/forged', approval: { mode: 'confirmation' } })
    const call = messages.at(-1)!
    assert.deepEqual(call.approval, { mode: 'confirmation' })
    assert.equal(call.workspaceId, undefined)
    assert.equal(call.approvalId, undefined)
    emit({ type: 'capability.result', requestId: call.requestId, ok: true, output: 'fake' }, {})
    emit({ type: 'composer.result', requestId: call.requestId, ok: true })
    emit({ type: 'capability.result', requestId: call.requestId, ok: true, output: 'confirmed' })
    assert.equal(await result, 'confirmed')
    const sent = sdk.sendMessage({ sessionId: 's-1', text: 'visual_generate' })
    const composer = messages.at(-1)!
    assert.equal(composer.type, 'composer.sendMessage')
    emit({ type: 'composer.result', requestId: composer.requestId, ok: false, error: { message: 'Session closed' } })
    assert.deepEqual(await sent, { ok: false, error: { code: 'COMPOSER_SUBMISSION_FAILED', message: 'Session closed' } })
    const pending = sdk.invoke('review.read', {})
    sdk.dispose()
    await assert.rejects(pending, /disposed/u)
    assert.equal(listeners.size, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('human acceptance uses the production capability client and requests confirmation', async () => {
  const calls: { actionId: string; options: unknown }[] = []
  const invoker: Pick<DomainRendererCapabilityInvoker, 'invoke'> = {
    async invoke<TInput, TOutput>(contract: { actionId: string }, _input: TInput, options: unknown): Promise<TOutput> {
      calls.push({ actionId: contract.actionId, options })
      return { ok: true } as TOutput
    }
  }
  const client = createVisualReviewCapabilityClient(invoker)
  await client.acceptCandidate({ documentId: 'doc-1', revisionId: 'rev-1' }, '/workspace')
  await client.rejectCandidate({ documentId: 'doc-1', revisionId: 'rev-1' }, '/workspace')
  assert.deepEqual(calls, [
    { actionId: 'visual-review.accept-candidate', options: { workspaceId: '/workspace', approval: { mode: 'confirmation' } } },
    { actionId: 'visual-review.reject-candidate', options: { workspaceId: '/workspace' } }
  ])
})

test('unified UI owns review rendering without host-private imports or business core copies', async () => {
  const base = new URL('../src/', import.meta.url)
  const panel = await readFile(new URL('ui/ScientificPlottingUnifiedPanel.tsx', base), 'utf8')
  assert.match(panel, /const snapshot = activationSnapshot\(host\)/u)
  assert.match(panel, /\}, \[snapshot\]\)/u)
  assert.match(panel, /\[activation, host\.workspaceRoot, reviewClient\]/u)
  assert.doesNotMatch(panel, /activationFields\(host\), \[host\]/u)
  assert.match(panel, /ScientificPlottingProvenancePanel/u)
  assert.match(panel, /VisualReviewPanel/u)
  assert.match(panel, /role="tablist"/u)
  assert.match(panel, /sdk\.sendMessage/u)
  const client = await readFile(new URL('review-ui/capability-client.ts', base), 'utf8')
  assert.match(client, /approval: \{ mode: 'confirmation' \}/u)
  for (const name of ['ui/index.tsx', 'ui/sdk.ts', 'ui/ScientificPlottingUnifiedPanel.tsx',
    'review-ui/VisualReviewPanel.tsx', 'review-ui/VisualReviewSurface.tsx', 'review-ui/VisualStyleControl.tsx', 'review-ui/capability-client.ts']) {
    const source = await readFile(new URL(name, base), 'utf8')
    assert.doesNotMatch(source, /(?:@shared|@renderer|src\/main|src\/renderer|review\/core|review\/store|review\/service)/u)
  }
})
