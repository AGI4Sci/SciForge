import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as plugin from '../src/dsh-adapter.js'
import { artifactFixture } from './artifact-fixture.js'
import { readCommittedChain, committedStatus } from '@sciforge/domain-evidence-dag/host/committed-reader'

it.each(['success', 'throw', 'failed-result'] as const)('poll A prepares B with explicit effect scope and honest %s receipt', async mode => {
  const f = await artifactFixture(), b = { ...f.scope, threadId: 'thread-2' }, ctx = new Context(), calls: any[] = []
  let armed = false, enter!: () => void, release!: () => void, blocked = false
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const execute = (name: string, scope: typeof b, id: string) => ctx.tools.execute({ name, arguments: scope, callId: brandString<ToolCallId>(id), signal: new AbortController().signal })
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', { ...f.ports, request: async (r: any): Promise<any> => {
      calls.push(structuredClone(r))
      if (r.operation === 'committed.status') return committedStatus(await readCommittedChain(f.ports.storageRoot, process.env.EVIDENCE_BUILD_PYTHON!, r.scope, undefined, process.env.EVIDENCE_TEST_WHEEL), r.scope, async () => { throw Error('No committed snapshot in this lifecycle fixture') })
      if (r.operation === 'threads.list') return [f.scope, b]
      if (r.operation === 'threads.read') return { ...r.scope, watermark: '7', trace: structuredClone(f.trace) }
      if (r.operation === 'artifacts.commit') {
        const owner = r.input.candidates[0].metadata.evidenceThreadId
        if (armed && owner === b.threadId && !blocked) { blocked = true; enter(); await held }
        if (r.input.candidates.some((c: any) => c.metadata.evidenceThreadId !== r.scope?.threadId || c.metadata.evidenceRuntimeId !== r.scope?.runtimeId)) throw Error('THREAD_SCOPE_MISMATCH')
        if (armed && owner === b.threadId && mode === 'throw') throw Error('PIN_DENIED_B')
        if (armed && owner === b.threadId && mode === 'failed-result') return { ok: false, issue: { code: 'io-failure', message: 'PIN_DENIED_B' } }
        return f.service.commit(f.scope.workspaceRoot, r.input, f.access)
      }
      if (r.operation === 'artifacts.listEvents') return f.service.listEvents(f.scope.workspaceRoot, r.input, f.access)
      if (r.operation === 'artifacts.read') return f.service.read(f.scope.workspaceRoot, r.input, f.access)
      if (r.operation === 'sidecar.extract' || r.operation === 'sidecar.close') return f.ports.request(r)
      throw Error('unsupported ' + r.operation)
    } })
    await ctx.plugin(plugin)
    expect((await execute('evidence_dag_update', f.scope, 'seed-A')).isError).toBe(false)
    const stateFile = join(f.ports.storageRoot, 'artifact-version-lifecycle.json')
    const before = JSON.parse(await readFile(stateFile, 'utf8'))
    armed = true
    const polling = execute('evidence_dag_poll_artifact_events', f.scope, 'poll-A')
    await entered
    // Separate nonserial read and queued poll run during B's pin preparation;
    // neither may overwrite the effect scope/caller held by that operation.
    const status = await execute('evidence_dag_snapshot_status', b, 'status-B')
    expect(status.isError).toBe(false)
    const next = mode === 'success' ? execute('evidence_dag_poll_artifact_events', b, 'poll-B') : undefined
    release()
    const receipt = await polling
    if (next) expect((await next).isError).toBe(false)
    const commits = calls.filter(r => r.operation === 'artifacts.commit')
    expect(commits.some(r => r.input.candidates.some((c: any) => c.metadata.evidenceThreadId !== r.scope.threadId))).toBe(false)
    const preparedB = commits.find(r => r.input.candidates[0].metadata.evidenceThreadId === b.threadId)
    expect(preparedB.scope).toEqual(b); expect(preparedB.caller).toEqual({ callId: 'poll-A' })
    const persisted = JSON.parse(await readFile(stateFile, 'utf8'))
    if (mode === 'success') {
      expect(receipt.isError).toBe(false); expect(receipt.value).toEqual({ drained: true })
      expect(persisted.threads.map((t: any) => t.threadId).sort()).toEqual([f.scope.threadId, b.threadId].sort())
      expect(persisted.receipts.length).toBeGreaterThan(0)
    } else {
      expect(receipt.isError).toBe(true)
      expect(JSON.stringify(receipt)).toContain('PIN_DENIED_B')
      expect(receipt.value).not.toEqual({ drained: true })
      expect(persisted.workspaces).toEqual(before.workspaces)
      expect(persisted.receipts).toEqual(before.receipts)
    }
    console.log('ED04_RECEIPT', JSON.stringify({ mode, receipt, commitScopes: commits.map(r => ({ scope: r.scope, caller: r.caller, owner: r.input.candidates[0].metadata.evidenceThreadId })) }))
  } finally { release?.(); await ctx.fiber.dispose() }
})
