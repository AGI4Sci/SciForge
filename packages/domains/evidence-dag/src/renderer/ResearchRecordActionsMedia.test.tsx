import assert from 'node:assert/strict'
import test from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import { createResearchAuditCommand } from './evidence-dag-right-panel-contribution'
import { recordMediaReferences, ResearchRecordMedia } from './ResearchRecordMedia'
Object.assign(globalThis, { React })
const ref = { artifactId: 'artifact:1', versionId: 'artifact-version:1', contentDigest: 'a'.repeat(64), byteLength: 64, mediaType: 'image/png', availability: 'available', retention: 'snapshot', accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }

test('one-click action uses the existing global overlay and exact session scope without a new owner', () => {
  const requests: unknown[] = []
  const host = { workbench: { toggleGlobalOverlay: (input: unknown) => requests.push(input) } } as unknown as DomainRendererHost
  const command = createResearchAuditCommand(host)
  const scope = { sessionId: 's', runtimeId: 'codex', workspaceRoot: '/science' }
  assert.equal(command.isAvailable?.(scope), true)
  assert.equal(command.isAvailable?.({ sessionId: 's' }), false)
  command.execute(scope)
  assert.equal(requests.length, 1)
  const request = requests[0] as { contributionId: string; open: boolean; activation: { payload: unknown } }
  assert.equal(request.contributionId, 'evidence-dag.research-record-overlay'); assert.equal(request.open, true)
  assert.deepEqual(request.activation.payload, { recordScope: { runtimeId: 'codex', threadId: 's', workspaceRoot: '/science' } })
})

test('image extraction accepts exact version references, deduplicates them, and never treats paths or remote URLs as images', () => {
  const input = { result: { ref }, detail: JSON.stringify({ ref }), url: 'https://untrusted.invalid/image.png', image: '/science/final.png', partial: { versionId: 'guess', mediaType: 'image/png' } }
  assert.deepEqual(recordMediaReferences(input), { refs: [ref], limited: false })
  assert.equal(recordMediaReferences({ image: 'data:image/svg+xml,unsafe' }).refs.length, 0)
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  assert.equal(recordMediaReferences(cyclic).refs.length, 0)
  const many = Array.from({ length: 12 }, (_, i) => ({ ...ref, versionId: 'artifact-version:'+i }))
  assert.equal(recordMediaReferences(many).refs.length, 8); assert.equal(recordMediaReferences(many).limited, true)
})

test('unbound image view is explicit and performs no external URL fetch or inferred binding', () => {
  const html = renderToStaticMarkup(createElement(ResearchRecordMedia, { raw: { url: 'https://untrusted.invalid/image.png' }, scope: { runtimeId: 'codex', threadId: 's', workspaceRoot: '/science' }, invoker: { invoke: async () => assert.fail('not during render') } as never }))
  assert.match(html, /未提供可核对/); assert.doesNotMatch(html, /<img|src="https/)
})
