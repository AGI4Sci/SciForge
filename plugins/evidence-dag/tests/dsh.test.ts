import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { syntheticWorkerOwner } from './worker-fixture.js'
const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/synthetic-workspace' }
async function plugin() {
  expect(existsSync(new URL('../src/dsh-adapter.ts', import.meta.url)), 'real DSH apply entry must exist').toBe(true)
  return import('../src/dsh-adapter.js')
}
it('registers through official Context and Tools, invokes update, and removes tools on dispose', async () => {
  const entry = await plugin()
  expect(Object.hasOwn(entry, 'activate')).toBe(false)
  expect(Object.hasOwn(entry, 'getCapabilityDefinitions')).toBe(false)
  const storageRoot = await mkdtemp(join(tmpdir(), 'evidence-dsh-'))
  const calls: any[] = []
  const extractor = syntheticWorkerOwner('a')
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', {
      storageRoot, identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'test' },
      request: async (r: any) => {
        calls.push(r)
        if (r.operation === 'threads.read') return { ...scope, watermark: '7', trace: [{ id: 'a', text: 'evidence' }] }
        if (r.operation === 'sidecar.extract') return extractor.request('extract', r.input)
        if (r.operation === 'sidecar.close') { await extractor.close(); return { exited: true } }
        throw new Error(`Unsupported synthetic operation ${r.operation}`)
      },
      cancel: async () => ({ cancelled: true, quiescent: true }),
    })
    const fork = await ctx.plugin(entry)
    const result = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: scope, callId: brandString<ToolCallId>('c1'), signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(z.object({ deltaDigest: z.string() }).parse(result.value).deltaDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(calls.filter(r => r.operation === 'sidecar.extract')).toHaveLength(1)
    expect(calls.find(r => r.operation === 'sidecar.extract')).toMatchObject({ scope, caller: { callId: 'c1' }, input: { threadId: 'codex:thread-1', targetWatermark: '7', workspaceRoot: scope.workspaceRoot } })
    const bad = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: { ...scope, threadId: 3 }, callId: brandString<ToolCallId>('c2'), signal: new AbortController().signal })
    expect(bad.isError).toBe(true)
    await fork.dispose()
    expect(calls.filter(r => r.operation === 'sidecar.close')).toHaveLength(1)
    const removed = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: scope, callId: brandString<ToolCallId>('c3'), signal: new AbortController().signal })
    expect(removed.isError).toBe(true)
  } finally { await ctx.fiber.dispose() }
})
