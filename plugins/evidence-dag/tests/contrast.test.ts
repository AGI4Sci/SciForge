import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { EvidenceDagRuntime } from '../../../packages/domains/evidence-dag/src/main/runtime.js'
import { evidenceTraceFromThread } from '../../../packages/domains/evidence-dag/src/main/artifacts.js'
import { artifactFixture } from './artifact-fixture.js'
import { workerOptions } from './worker-fixture.js'
it('compares shared receipt contracts, exposes native extraction differences, and detects a receipt mutation', async () => {
  expect(existsSync(new URL('../src/static-adapter.ts', import.meta.url)), 'static contrast adapter must exist').toBe(true)
  const opts = await workerOptions()
  const plugin = await import(pathToFileURL(join(opts.release, 'main.mjs')).href) as typeof import('../src/dsh-adapter.js')
  const { createStaticEvidenceAdapter } = await import('../src/static-adapter.js')
  const f = await artifactFixture()
  // userDataDir is a Host-owned prerequisite; Evidence may only create its own child.
  await mkdir(join(f.root, 'native'))
  const detail = { id: f.scope.threadId, runtimeId: f.scope.runtimeId, workspaceRoot: f.scope.workspaceRoot, watermark: '7', artifacts: f.trace, turns: [] }
  const ports = { ...f.ports, request: async (r: any) => r.operation === 'threads.read' ? { ...f.scope, watermark: '7', trace: evidenceTraceFromThread(detail) } : f.ports.request(r) }
  const native = new EvidenceDagRuntime({ userDataDir: join(f.root, 'native'), sidecar: { configure: () => {}, endpoint: () => ({ baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic' }), ensureReady: async () => {}, stop: async () => {} }, artifactVersionCommitPort: { commit: (input) => f.service.commit(f.scope.workspaceRoot, input, f.access) }, artifactVersionReadPort: { read: (input) => f.service.read(f.scope.workspaceRoot, input, f.access) }, artifactVersionEventListPort: { listEvents: (input) => f.service.listEvents(f.scope.workspaceRoot, input, f.access) } })
  const ctx = new Context()
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-26T06:00:00.000Z'))
  const adapter = createStaticEvidenceAdapter({ ...ports, storageRoot: join(f.root, 'static') })
  try {
    await native.activate({ userDataDir: join(f.root, 'native'), signal: new AbortController().signal, environment: {}, appRoot: f.root, agentThreads: { list: async () => [], read: async () => detail }, enablement: { isEnabled: async () => true, subscribe: () => () => {} }, log: () => {} } as any)
    await adapter.start()
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', ports)
    await ctx.plugin(plugin)
    const original = await native.update(f.scope)
    const stat = await adapter.update(f.scope)
    const runtime = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: f.scope, callId: brandString<ToolCallId>('compiled-c1'), signal: new AbortController().signal })
    expect(runtime.isError).toBe(false)
    const { url: _url, ...reference } = original
    // Static adapter and built DSH share the canonical extractor. The legacy
    // native runtime does not: compare its shared contract, not graph identity.
    expect(runtime.value).toEqual(stat)
    const shared = (receipt: typeof stat) => ({
      threadId: receipt.threadId, itemCount: receipt.itemCount, idempotent: receipt.idempotent,
      committed: receipt.status.committed, pending: receipt.status.pending,
      freshness: receipt.status.freshness, coverage: receipt.status.coverage,
      watermark: receipt.status.authoritativeHead?.committedWatermark,
      sequence: receipt.status.authoritativeHead?.sequence,
    })
    expect(shared(stat)).toEqual(shared(reference))
    expect(reference.status.provisional?.lastGood?.claims).toEqual([])
    expect(stat.status.provisional?.lastGood?.claims).toHaveLength(1)
    expect((stat.status.provisional?.lastGood?.claims as unknown[])[0]).toMatchObject({ type: 'claim', content: 'Synthetic claim.', trace_refs: ['claim-1'] })
    expect(stat.deltaDigest).not.toBe(reference.deltaDigest)
    const assertBoundReceipt = (receipt: typeof stat) => {
      expect(receipt.deltaDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(receipt.status.authoritativeHead?.headDigest).toBe(receipt.deltaDigest)
      expect(receipt.status.appliedHeadDigest).toBe(receipt.deltaDigest)
      expect(receipt.status.desiredHeadDigest).toBe(receipt.deltaDigest)
    }
    assertBoundReceipt(reference); assertBoundReceipt(stat)
    expect(() => assertBoundReceipt({ ...stat, deltaDigest: 'sha256:' + '0'.repeat(64) })).toThrow()
    await expect(adapter.update({ ...f.scope, threadId: '' })).rejects.toThrow()
    const bad = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: { ...f.scope, threadId: '' }, callId: brandString<ToolCallId>('compiled-c2'), signal: new AbortController().signal })
    expect(bad.isError).toBe(true)
  } finally { await ctx.fiber.dispose(); await adapter.close(); await native.close(); vi.useRealTimers() }
})
