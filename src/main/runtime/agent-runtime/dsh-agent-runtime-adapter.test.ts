import { describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, readdir, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { TurnArtifactOutbox } from '../../services/turn-artifact-outbox'
import { TurnArtifactHandoffService } from '../../services/turn-artifact-handoff-service'
import { AgentRuntimeTraceRecorder } from '../../services/agent-runtime-trace-service'
import type { TraceEvent } from '@sciforge/full-trace'
import { createDshHostRuntimeAdapter } from './dsh-agent-runtime-adapter'
import { createAgentRuntimeHost } from './host'
import { createDomainAgentExecutionHost } from '../../domain-agent-execution'
import { defaultCodexRuntimeSettings, defaultLocalRuntimeSettings, defaultModelRouterSettings, defaultScheduleSettings, defaultSkillsSettings, defaultWorkflowSettings, defaultWriteSettings, type AppSettingsV1 } from '../../../shared/app-settings'
import { defaultDshRuntimeSettings } from '../../../shared/app-settings-dsh'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import { defaultKeyboardShortcuts } from '../../../shared/keyboard-shortcuts'
function createDefaultSettings(): AppSettingsV1 {
  return { version: 1, locale: 'en', theme: 'system', uiFontScale: 'small', activeAgentRuntime: 'codex',
    modelRouter: defaultModelRouterSettings(), agents: { sciforge: defaultLocalRuntimeSettings(), codex: defaultCodexRuntimeSettings() },
    workspaceRoot: '/tmp/workspace', log: { enabled: false, retentionDays: 7 }, notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false }, keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(), skills: defaultSkillsSettings(), schedule: defaultScheduleSettings(), workflow: defaultWorkflowSettings(), guiUpdate: { channel: 'stable' }, codePromptPrefix: '' }
}
import { z } from 'zod'
import { CapabilityBroker } from '../../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../../capabilities/registry'
import { createCapabilityAgentToolSurface } from '../../capabilities/agent-tools'
import type { AgentRuntimeToolSurface } from './agent-tool-surface'
import type { DomainRemoteCapabilityApproval } from '@sciforge/domain-sdk/remote-approval'
const leases = vi.hoisted(() => [] as { url: string; headers: readonly { name: string; value: string }[] }[])
vi.mock('./agent-runtime-mcp-tool-lease', async importOriginal => {
  const actual = await importOriginal<typeof import('./agent-runtime-mcp-tool-lease')>()
  return { ...actual, createAgentRuntimeMcpToolLease: async (options: Parameters<typeof actual.createAgentRuntimeMcpToolLease>[0]) => {
    const lease = await actual.createAgentRuntimeMcpToolLease(options)
    leases.push(lease.config)
    return lease
  } }
})

describe('DSH Host bridge with a real ACP fixture child', () => {
  it('persists minimal thread ownership across cold reopen and keeps it hidden with no MCP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-cold-'))
    const settings = createDefaultSettings()
    const surface = { tools: vi.fn(() => []), call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() }
    const make = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url)), '--fixture-defaults', '--fixture-minimal'], stateDirectory: root,
      safetyPatch: 'derived', verifyDeployment: async () => {}, toolSurface: surface })
    let adapter = make()
    try {
      const thread = await adapter.startThread({ settings }, { runtimeId: 'dsh', workspace: root, contextProfile: 'minimal', allowedTools: [] })
      expect(thread.workspace).toBe(root)
      expect(await readdir(join(root, 'minimal', 'empty-workspace'))).toEqual([])
      await adapter.close(); adapter = make()
      await expect(adapter.readThreadPage({ settings }, { runtimeId: 'dsh', threadId: thread.id })).resolves.toMatchObject({ turns: [] })
      await expect(adapter.listThreads({ settings }, { runtimeId: 'dsh', threadId: thread.id })).resolves.toEqual([expect.objectContaining({ workspace: root })])
      expect(() => adapter.startTurn({ settings }, { runtimeId: 'dsh', threadId: thread.id, text: 'wrong' })).toThrow('does not match thread')
      await adapter.resumeSession!({ settings }, { runtimeId: 'dsh', sessionId: thread.id })
      const count = leases.length
      const handle = await adapter.startTurn({ settings }, { runtimeId: 'dsh', threadId: thread.id, contextProfile: 'minimal', mode: 'agent', allowedTools: [], text: 'supplied only' })
      await vi.waitFor(async () => expect((await adapter.readThreadPage({ settings }, { runtimeId: 'dsh', threadId: thread.id })).turns).toContainEqual(expect.objectContaining({ id: handle.turnId, status: 'completed' })))
      expect(leases.length).toBe(count)
      expect(surface.tools).not.toHaveBeenCalled()
      expect(await adapter.listThreads({ settings }, { runtimeId: 'dsh' })).not.toContainEqual(expect.objectContaining({ id: thread.id }))
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('releases minimal turn ownership after completion for consecutive turns and a different thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-consecutive-'))
    const context = { settings: createDefaultSettings() }
    const surface = { tools: vi.fn(() => []), call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url)), '--fixture-defaults', '--fixture-minimal'],
      stateDirectory: root, safetyPatch: 'derived', verifyDeployment: async () => {}, toolSurface: surface })
    try {
      const input = { runtimeId: 'dsh' as const, workspace: root, contextProfile: 'minimal' as const, allowedTools: [] }
      const first = await adapter.startThread(context, input)
      const second = await adapter.startThread(context, input)
      expect(second.id).not.toBe(first.id)
      const count = leases.length
      const completed: string[] = []
      for (const [threadId, text] of [[first.id, 'first'], [first.id, 'second'], [second.id, 'third']]) {
        const handle = await adapter.startTurn(context, { ...input, threadId, mode: 'agent', text })
        completed.push(handle.turnId)
        await vi.waitFor(async () => expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId })).turns)
          .toContainEqual(expect.objectContaining({ id: handle.turnId, status: 'completed', items: expect.arrayContaining([expect.objectContaining({ kind: 'assistant_message', text: 'hello' })]) })))
      }
      expect(new Set(completed).size).toBe(3)
      expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: first.id })).turns.map(turn => turn.id)).toEqual(completed.slice(0, 2))
      expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: second.id })).turns.map(turn => turn.id)).toEqual(completed.slice(2))
      expect(leases.length).toBe(count)
      expect(surface.tools).not.toHaveBeenCalled()
      expect(surface.call).not.toHaveBeenCalled()
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('releases minimal turn ownership after an actual ACP failure so the same thread can retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-retry-'))
    const context = { settings: createDefaultSettings() }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url)), '--fixture-defaults', '--fixture-minimal'],
      stateDirectory: root, safetyPatch: 'derived', verifyDeployment: async () => {},
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    try {
      const input = { runtimeId: 'dsh' as const, contextProfile: 'minimal' as const, allowedTools: [] }
      const thread = await adapter.startThread(context, { ...input, workspace: root })
      const failed = await adapter.startTurn(context, { ...input, threadId: thread.id, mode: 'agent', text: 'badreply' })
      await vi.waitFor(async () => expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).turns)
        .toContainEqual(expect.objectContaining({ id: failed.turnId, status: 'failed' })))
      const retry = await adapter.startTurn(context, { ...input, threadId: thread.id, mode: 'agent', text: 'retry' })
      expect(retry.turnId).not.toBe(failed.turnId)
      await vi.waitFor(async () => expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).turns)
        .toEqual([expect.objectContaining({ id: failed.turnId, status: 'failed' }), expect.objectContaining({ id: retry.turnId, status: 'completed' })]))
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('routes minimal synthetic work lifecycle events to live subscribers and the same durable journal after cold reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-synthetic-'))
    const context = { settings: createDefaultSettings() }
    const make = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url)), '--fixture-defaults', '--fixture-minimal'],
      stateDirectory: root, safetyPatch: 'derived', verifyDeployment: async () => {},
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    let adapter = make()
    const live = new AbortController()
    const replay = new AbortController()
    try {
      const thread = await adapter.startThread(context, { runtimeId: 'dsh', workspace: root, contextProfile: 'minimal', allowedTools: [] })
      const event: AgentRuntimeEvent = { runtimeId: 'dsh', threadId: thread.id, kind: 'work_lifecycle', workId: 'minimal-work', state: 'needs_continuation', reason: 'continuation_waiting_for_user', createdAt: new Date().toISOString() }
      const received: AgentRuntimeEvent[] = []
      const consuming = (async () => {
        for await (const item of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, signal: live.signal })) {
          received.push(item)
          if (item.kind === 'work_lifecycle') live.abort()
        }
      })()
      const published = await adapter.publishSyntheticEvent!(context, event)
      await consuming
      expect(published).toMatchObject({ ...event, seq: expect.any(Number) })
      expect(received).toEqual([published])
      const directory = join(root, 'minimal', 'host-history')
      const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'))
      expect(files).toHaveLength(1)
      const journal = join(directory, files[0]!)
      const before = await readFile(journal, 'utf8')
      expect(before.trim().split('\n').map(line => JSON.parse(line)).filter(record => record.event?.kind === 'work_lifecycle'))
        .toEqual([expect.objectContaining({ threadId: thread.id, event: published })])
      await adapter.close(); adapter = make()
      expect(await readFile(journal, 'utf8')).toBe(before)
      const replayed: AgentRuntimeEvent[] = []
      for await (const item of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, sinceSeq: 0, signal: replay.signal })) {
        replayed.push(item)
        if (item.kind === 'work_lifecycle') replay.abort()
      }
      expect(replayed).toEqual([published])
      expect((await adapter.readThreadStatus(context, { runtimeId: 'dsh', threadId: thread.id })).latestSeq).toBe(published?.seq)
      // work_lifecycle has no turn projection; assert its canonical journal and replay instead.
      expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).turns).toEqual([])
    } finally { live.abort(); replay.abort(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('executes the canonical hidden domain discussion request through Host and ACP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-domain-'))
    const settings = createDefaultSettings(); settings.activeAgentRuntime = 'dsh'
    const surface = { tools: vi.fn(() => []), call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url)), '--fixture-defaults', '--fixture-minimal'], stateDirectory: root,
      safetyPatch: 'derived', verifyDeployment: async () => {}, toolSurface: surface })
    const host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter] })
    const execution = createDomainAgentExecutionHost({ runtime: host, defaultRuntimeId: () => 'dsh', runtimeReadiness: () => ({ state: 'ready', runtimeId: 'dsh', capabilityTags: [] }), pollIntervalMs: 10 })
    try {
      const result = await execution.run({ runtimeId: 'dsh', workspaceRoot: root, prompt: 'supplied only', contextProfile: 'minimal', allowedTools: [], interaction: 'background', mode: 'agent', metadata: { source: 'plugin-discussion' } })
      expect(result.state).toBe('completed')
      expect(surface.tools).not.toHaveBeenCalled()
      expect((await host.listThreads({ runtimeId: 'dsh' })).every(thread => thread.id === 'saved-session')).toBe(true)
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('minimal profiles reject implicit tools and cannot cross an ordinary thread boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-minimal-contract-'))
    const settings = createDefaultSettings()
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))], stateDirectory: root,
      verifyDeployment: async () => {}, toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    try {
      expect(adapter.contextProfiles).toEqual(['minimal'])
      await expect(adapter.startThread({ settings }, { runtimeId: 'dsh', workspace: root, contextProfile: 'minimal' })).rejects.toThrow('explicit empty tool allowlist')
      await expect(adapter.startThread({ settings }, { runtimeId: 'dsh', workspace: root, contextProfile: 'minimal', allowedTools: ['write'] })).rejects.toThrow('explicit empty tool allowlist')
      const ordinary = await adapter.startThread({ settings }, { runtimeId: 'dsh', workspace: root })
      expect(() => adapter.startTurn({ settings }, { runtimeId: 'dsh', threadId: ordinary.id, contextProfile: 'minimal', allowedTools: [], text: 'supplied only' })).toThrow('does not match thread')
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('discovers the held session through public Host lists after consecutive real ACP turns and a cold reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-held-discovery-'))
    const settings = createDefaultSettings()
    settings.activeAgentRuntime = 'dsh'
    const makeAdapter = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      // This ACP child returns sessions: [] from session/list, without a mock.
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url)), '--history-updates'],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    let adapter = makeAdapter()
    let host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter] })
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root, title: 'Persisted conversation' })
      for (const text of ['first', 'second']) {
        const turn = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text })
        await vi.waitFor(async () => expect((await adapter.readThreadPage({ settings }, { runtimeId: 'dsh', threadId: thread.id })).turns)
          .toContainEqual(expect.objectContaining({ id: turn.turnId, status: 'completed' })))
        expect(await host.listThreads({ runtimeId: 'dsh', limit: 1 })).toEqual([thread])
        expect(await host.listThreads({ limit: 1 })).toEqual([thread])
      }
      host.dispose(); await adapter.close()
      adapter = makeAdapter()
      host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter] })
      expect(await host.listThreads({ runtimeId: 'dsh' })).toEqual([thread])
      expect((await adapter.readThreadPage({ settings }, { runtimeId: 'dsh', threadId: thread.id })).turns).toHaveLength(2)
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it.each([false, true])('deletes a Host conversation and keeps it deleted after restart (active=%s)', async active => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-delete-'))
    const settings = createDefaultSettings()
    const makeAdapter = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000, cancelTimeoutMs: 50,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    let adapter = makeAdapter()
    let host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter] })
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      const input = { runtimeId: 'dsh' as const, threadId: thread.id }
      if (active) await host.startTurn({ ...input, text: 'hang' })
      await expect(host.deleteThread(input)).resolves.toBeUndefined()
      await expect(adapter.listThreads({ settings }, input)).resolves.toEqual([])
      await expect(host.listThreads({ runtimeId: 'dsh' })).resolves.toEqual([])
      await expect(adapter.readThreadPage({ settings }, input)).rejects.toThrow('runtime_thread_not_found')
      host.dispose(); await adapter.close()
      adapter = makeAdapter()
      host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter] })
      await expect(adapter.listThreads({ settings }, input)).resolves.toEqual([])
      await expect(host.listThreads({ runtimeId: 'dsh' })).resolves.toEqual([])
      await expect(adapter.startTurn({ settings }, { ...input, text: 'must not resurrect' })).rejects.toThrow('runtime_thread_not_found')
      await expect(host.deleteThread(input)).resolves.toBeUndefined()
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('passes workspace references through ACP and lets a rejected turn be retried', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-retry-references-'))
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url)), '--echo-prompt'],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    const handoff = new TurnArtifactHandoffService({ outbox: new TurnArtifactOutbox(root), consumers: [],
      materialize: intent => host.materializeCompletedTurnArtifact(intent) })
    const host = createAgentRuntimeHost({ settings: () => createDefaultSettings(), adapters: [adapter], turnArtifacts: handoff })
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      await expect(host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'invalid mode', mode: 'plan' })).rejects.toThrow('runtime_unsupported')
      expect(await handoff.pendingStarts()).toEqual([])
      await expect(handoff.flushThread('dsh', thread.id)).resolves.toBeUndefined()
      const handle = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'Read the paper',
        fileReferences: [{ path: 'papers/article.pdf', relativePath: 'papers/article.pdf', name: 'article.pdf' }] })
      await vi.waitFor(async () => {
        const snapshot = await host.readThreadSnapshot({ runtimeId: 'dsh', threadId: thread.id })
        const turn = snapshot.turns?.find(turn => turn.id === handle.turnId)
        expect(turn?.status).toBe('completed')
        expect(turn?.items?.find(item => item.kind === 'assistant_message')?.text).toContain('"path":"papers/article.pdf"')
      })
    } finally { host.dispose(); handoff.close(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it.runIf(process.platform === 'win32')('probes and connects through a real command shim in a path with spaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh cmd shim '))
    const executable = join(root, 'dsh.cmd')
    const fixture = fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))
    await writeFile(executable, `@"${process.execPath}" "${fixture}" %*\r\n`)
    const adapter = createDshHostRuntimeAdapter({ executable, stateDirectory: root,
      verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    try {
      const context = { settings: createDefaultSettings() }
      expect(await adapter.probe(context)).toMatchObject({ available: true })
      expect(await adapter.startThread(context, { runtimeId: 'dsh', workspace: root })).toMatchObject({ runtimeId: 'dsh' })
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('runs the required before-turn read under the durable owner and never bypasses its rejection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-before-turn-'))
    const settings = createDefaultSettings()
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    const handoff = new TurnArtifactHandoffService({ outbox: new TurnArtifactOutbox(root), consumers: [],
      materialize: async () => { throw new Error('No accepted provider turn should materialize') } })
    const host = createAgentRuntimeHost({ settings: () => settings, adapters: [adapter], turnArtifacts: handoff })
    const dispatch = vi.spyOn(adapter, 'startTurn')
    const boundaryRead = vi.fn(async (event: { threadId: string }) => {
      expect(await host.readThreadSnapshot({ runtimeId: 'dsh', threadId: event.threadId })).toMatchObject({ turns: [], latestSeq: 0 })
      throw new Error('intentional before-turn policy rejection')
    })
    host.subscribeRequiredBeforeTurn(boundaryRead)
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      await expect(host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'must not dispatch' })).rejects.toThrow('intentional before-turn policy rejection')
      expect(boundaryRead).toHaveBeenCalledOnce()
      expect(dispatch).not.toHaveBeenCalled()
    } finally { host.dispose(); handoff.close(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('persists only completed structured ACP edits through paging, external details and cold reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-edit-projection-'))
    const context = { settings: createDefaultSettings() }
    const makeAdapter = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('../../../../packages/workers/dsh-runtime/test/fixture.mjs', import.meta.url))],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    let adapter = makeAdapter()
    let host = createAgentRuntimeHost({ settings: () => context.settings, adapters: [adapter] })
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      const handle = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'structured-edits' })
      await vi.waitFor(async () => expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).turns)
        .toContainEqual(expect.objectContaining({ id: handle.turnId, status: 'completed' })))
      const input = { runtimeId: 'dsh' as const, threadId: thread.id, limit: 1 }
      const page = await adapter.readThreadPage(context, input)
      const edits = page.turns.flatMap(turn => turn.items ?? []).filter(item => item.kind === 'tool' && item.toolKind === 'file_change')
      expect(edits).toHaveLength(1)
      const edit = edits[0]!
      expect(edit).toMatchObject({ id: 'native-edit', status: 'completed', meta: {
        authoritativeExecutionReceipt: false, factSource: 'runtime_lifecycle', acpSessionId: thread.id, acpContentType: 'diff'
      } })
      expect(edit.kind === 'tool' && edit.detailArtifact).toBeTruthy()
      if (edit.kind !== 'tool' || !edit.detailArtifact) throw new Error('missing externalized diff')
      const artifact = { runtimeId: 'dsh' as const, threadId: thread.id, ref: edit.detailArtifact.ref, size: edit.detailArtifact.size, offset: 0, maxBytes: 65_536 }
      const original = await adapter.readToolArtifact(context, artifact)
      expect(JSON.parse(original.content).changes[0].diff).toContain('-before\n+after\n')
      expect(JSON.parse(original.content).changes[0].diff.endsWith('+large detail\n')).toBe(true)
      const other = await host.startThread({ runtimeId: 'dsh', workspace: root })
      await expect(adapter.readToolArtifact(context, { ...artifact, threadId: other.id })).rejects.toThrow()
      host.dispose(); await adapter.close()
      adapter = makeAdapter()
      host = createAgentRuntimeHost({ settings: () => context.settings, adapters: [adapter] })
      expect(await adapter.readThreadPage(context, input)).toEqual(page)
      expect(await adapter.readToolArtifact(context, artifact)).toEqual(original)
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('reads a genuinely enrolled empty thread before turn and preserves accepted history across cold Host readback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-history-'))
    const context = { settings: createDefaultSettings() }
    const makeAdapter = () => createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url)), '--history-updates'],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    let adapter = makeAdapter()
    const trace = new AgentRuntimeTraceRecorder({
      append: async input => input as unknown as TraceEvent,
      appendMany: async inputs => inputs as unknown as TraceEvent[], sanitizeTextChunks: chunks => [...chunks]
    })
    let host = createAgentRuntimeHost({ settings: () => context.settings, adapters: [adapter], services: { trace } })
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      await expect(host.readThreadSnapshot({ runtimeId: 'dsh', threadId: thread.id })).resolves.toMatchObject({
        id: thread.id, workspace: root, latestSeq: 0, turns: []
      })
      const handle = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'Host context\n\npersist this actual input', displayText: 'persist this actual input' })
      await vi.waitFor(async () => {
        const snapshot = await host.readThreadSnapshot({ runtimeId: 'dsh', threadId: thread.id })
        expect(snapshot.turns).toEqual([expect.objectContaining({ id: handle.turnId, status: 'completed',
          items: expect.arrayContaining([
            expect.objectContaining({ kind: 'user_message', text: 'persist this actual input' }),
            expect.objectContaining({ kind: 'assistant_message', text: 'fixture answer one + two' })
          ]) })])
      })
      expect(host.eventCaptureFailures()).toEqual([])
      const before = await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })
      const replayController = new AbortController()
      const replayed: import('../../../shared/agent-runtime-contract').AgentRuntimeEvent[] = []
      for await (const event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, sinceSeq: 0, signal: replayController.signal })) {
        replayed.push(event)
        if (event.seq === before.latestSeq) { replayController.abort(); break }
      }
      expect(replayed.map(event => event.seq)).toEqual(Array.from({ length: before.latestSeq! }, (_, i) => i + 1))
      host.dispose(); await adapter.close()
      adapter = makeAdapter()
      host = createAgentRuntimeHost({ settings: () => context.settings, adapters: [adapter] })
      // The fixture's ACP list is empty. Canonical ordinary discovery still
      // restores the persisted conversation before any exact-id history read.
      await expect(host.listThreads({ runtimeId: 'dsh' })).resolves.toEqual([
        expect.objectContaining({ id: thread.id, title: thread.title, workspace: root })
      ])
      const after = await host.readThreadSnapshot({ runtimeId: 'dsh', threadId: thread.id })
      expect(after).toMatchObject({ id: thread.id, workspace: root, latestSeq: before.latestSeq,
        turns: [expect.objectContaining({ id: handle.turnId, status: 'completed', items: expect.arrayContaining([
          expect.objectContaining({ kind: 'user_message', text: 'persist this actual input' })
        ]) })] })
      expect(await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).toEqual(before)
      await expect(host.readThreadSnapshot({ runtimeId: 'dsh', threadId: 'not-enrolled' })).rejects.toThrow()
      await expect(adapter.readThreadPage(context, { runtimeId: 'codex', threadId: thread.id })).rejects.toThrow()
      const resumed = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'continue after restart' })
      await vi.waitFor(async () => {
        const snapshot = await host.readThreadSnapshot({ runtimeId: 'dsh', threadId: thread.id })
        expect(snapshot.turns?.find(turn => turn.id === resumed.turnId)?.status).toBe('completed')
      })
      const journals = await readdir(join(root, 'host-history'))
      expect(journals).toHaveLength(1)
      await appendFile(join(root, 'host-history', journals[0]!), '{truncated-record\n')
      await expect(adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).rejects.toThrow()
      await expect(adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'must not send after corruption' })).rejects.toThrow()
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('runs consecutive turns with Host trace capture and replays a nonzero cursor without duplicate delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-trace-roundtrip-'))
    const context = { settings: createDefaultSettings() }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url)), '--history-updates'],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    const captured: unknown[] = []
    const trace = new AgentRuntimeTraceRecorder({ append: async input => {
      captured.push(input.payload.event); return input as unknown as TraceEvent
    }, appendMany: async inputs => {
      captured.push(...inputs.map(input => input.payload.event)); return inputs as unknown as TraceEvent[]
    }, sanitizeTextChunks: chunks => [...chunks] })
    const host = createAgentRuntimeHost({ settings: () => context.settings, adapters: [adapter], services: { trace } })
    const controller = new AbortController()
    try {
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      expect((await adapter.capabilities(context)).events.replayable).toBe(true)
      const first = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'one' })
      await vi.waitFor(async () => expect((await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })).turns)
        .toContainEqual(expect.objectContaining({ id: first.turnId, status: 'completed' })))
      expect(host.eventCaptureFailures()).toEqual([])
      const cursor = (await adapter.readThreadStatus(context, { runtimeId: 'dsh', threadId: thread.id })).latestSeq!
      const replay = adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, sinceSeq: cursor, signal: controller.signal })
      const received: number[] = []
      const collecting = (async () => { for await (const event of replay) {
        received.push(event.seq!)
        if (event.kind === 'turn_lifecycle' && event.state === 'completed') { controller.abort(); break }
      } })()
      const second = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'two' })
      await collecting
      const page = await adapter.readThreadPage(context, { runtimeId: 'dsh', threadId: thread.id })
      expect(page.turns.map(turn => turn.id)).toEqual([first.turnId, second.turnId])
      expect(page.turns.every(turn => turn.status === 'completed')).toBe(true)
      expect(received).toEqual(Array.from({ length: page.latestSeq! - cursor }, (_, index) => cursor + index + 1))
      const durableEvents: unknown[] = []
      for await (const event of adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id, sinceSeq: 0 })) {
        durableEvents.push(event)
        if (event.seq === page.latestSeq) break
      }
      // Wait for Host capture and buffered delta flush, not just journal completion.
      await vi.waitFor(() => {
        expect(captured).toHaveLength(durableEvents.length)
        expect(captured).toEqual(expect.arrayContaining(durableEvents))
      })
      expect(host.eventCaptureFailures()).toEqual([])
    } finally { controller.abort(); host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('forwards native ACP approval through the package neutral resolveApproval contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-native-approval-'))
    const context = { settings: createDefaultSettings() }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() } })
    try {
      const thread = await adapter.startThread(context, { runtimeId: 'dsh', workspace: root })
      const events: import('../../../shared/agent-runtime-contract').AgentRuntimeEvent[] = []
      const stream = adapter.subscribeEvents(context, { runtimeId: 'dsh', threadId: thread.id })
      const collecting = (async () => { for await (const event of stream) events.push(event) })()
      await adapter.startTurn(context, { runtimeId: 'dsh', threadId: thread.id, text: 'approval' })
      await vi.waitFor(() => expect(events.some(e => e.kind === 'approval_requested')).toBe(true))
      const approval = events.find(e => e.kind === 'approval_requested')!
      if (approval.kind !== 'approval_requested') throw new Error('missing approval')
      await adapter.resolveApproval!(context, { runtimeId: 'dsh', threadId: thread.id, approvalId: approval.approvalId, decision: 'allowed' })
      await vi.waitFor(() => expect(events.some(e => e.kind === 'turn_lifecycle' && e.state === 'completed')).toBe(true))
      await adapter.close()
      await collecting
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('reports the negotiated resume capability and fails closed instead of inventing resume support', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-no-resume-'))
    const surface: AgentRuntimeToolSurface = { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: identity => { host.principalForToolRequest(identity as never) } }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath, executableArgs: [fileURLToPath(new URL('./fixtures/dsh-persistent-acp.mjs', import.meta.url)), '--no-resume'], stateDirectory: root, verifyDeployment: async () => {}, toolSurface: surface })
    const host = createAgentRuntimeHost({ settings: async () => createDefaultSettings(), adapters: [adapter] })
    try {
      expect(await adapter.probe({ settings: createDefaultSettings() })).toMatchObject({ available: true })
      expect((await adapter.capabilities({ settings: createDefaultSettings() })).controls.resumeSession).toBe(false)
      expect((await adapter.capabilities({ settings: createDefaultSettings() })).turnControls).toEqual({
        model: 'session',
        reasoningLevel: 'unsupported',
        reasoningOff: false,
        serviceTier: 'unsupported'
      })
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      await expect(host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'first' })).rejects.toThrow('runtime_unsupported')
      const trace = (await readFile(join(root, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      expect(trace.filter(e => e.method === 'session/new')).toHaveLength(1)
      expect(trace.filter(e => e.method === 'session/resume')).toHaveLength(0)
      expect(surface.call).not.toHaveBeenCalled()
    } finally { host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it.each([false, true])('preserves one persistent session across complete, rebind, cancel and new exact-turn authority (consume=%s)', async consume => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-persistent-'))
    let host: ReturnType<typeof createAgentRuntimeHost>
    const calls: string[] = []
    const identities: { turnId?: string }[] = []
    let releaseProvider!: () => void
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve })
    let lateProviderSettled = false
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'test.read', version: '1', title: 'Read', description: 'Read fixture', audiences: ['agent'], scope: 'global', effect: 'read', approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' }, inputSchema: z.object({ value: z.string() }), outputSchema: z.object({ ok: z.boolean() }),
      handler: async input => { calls.push(input.value); if (input.value === 'cancel-tool') { await providerGate; lateProviderSettled = true }; return { output: { ok: true } } }
    })]))
    const capabilityTools = createCapabilityAgentToolSurface({ broker, resolveCaller: context => {
      host.principalForToolRequest(context as never); identities.push(context)
      return { audience: 'agent', callerId: 'persistent-fixture', workspaceId: root, approvals: [] }
    } })
    const surface: AgentRuntimeToolSurface = { tools: () => capabilityTools.tools(), call: (request, options) => capabilityTools.call(request, options), abortTurn: vi.fn((identity, reason) => capabilityTools.abortTurn(identity, reason)), assertPrincipalLease: identity => { host.principalForToolRequest(identity as never) } }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath, executableArgs: [fileURLToPath(new URL('./fixtures/dsh-persistent-acp.mjs', import.meta.url))], stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000, toolSurface: surface })
    host = createAgentRuntimeHost({ settings: async () => createDefaultSettings(), adapters: [adapter] })
    leases.length = 0
    const trace = async () => (await readFile(join(root, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const complete = async (text: string, afterStart?: (turnId: string) => Promise<void> | void) => {
      const handle = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text })
      await afterStart?.(handle.turnId)
      await vi.waitFor(async () => expect((await trace()).some(e => e.completed === text)).toBe(true))
      // Lifecycle cleanup must not depend on whether the observer consumes.
      await vi.waitFor(() => expect(surface.abortTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId: handle.turnId }), expect.anything()))
      return handle
    }
    const events: unknown[] = []
    const subscription = new AbortController()
    let consuming: Promise<void> | undefined
    let thread: Awaited<ReturnType<typeof host.startThread>>
    try {
      await host.connect('dsh'); thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      if (consume) consuming = (async () => { for await (const event of host.subscribeEvents({ runtimeId: 'dsh', threadId: thread.id, signal: subscription.signal })) events.push(event) })()
      const first = await complete('first')
      const old = leases[0]!
      await expect(fetch(old.url, { signal: AbortSignal.timeout(300) })).rejects.toThrow()
      const second = await complete('second')
      await expect(fetch(old.url, { headers: Object.fromEntries(old.headers.map(h => [h.name, h.value])), signal: AbortSignal.timeout(300) })).rejects.toThrow()
      expect(second.threadId).toBe(first.threadId); expect(second.turnId).not.toBe(first.turnId)
      expect(leases[1]!.headers).not.toEqual(old.headers)
      expect(identities.some(i => i.turnId === first.turnId)).toBe(true)
      expect(identities.some(i => i.turnId === second.turnId)).toBe(true)
      const cancelled = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'cancel-tool' })
      await vi.waitFor(() => expect(calls).toContain('cancel-tool'))
      await host.interruptTurn({ ...cancelled, runtimeId: 'dsh' })
      expect(lateProviderSettled).toBe(false)
      const cancelledEndpoint = leases[2]!
      await expect(fetch(cancelledEndpoint.url, { headers: Object.fromEntries(cancelledEndpoint.headers.map(h => [h.name, h.value])), signal: AbortSignal.timeout(300) })).rejects.toThrow()
      await complete('after-cancel', async turnId => {
        releaseProvider()
        await vi.waitFor(async () => expect((await trace()).some(e => e.lateResponse)).toBe(true))
        // The new prompt cannot complete until this real filesystem barrier is
        // released. A late old response must not settle/revoke its authority.
        expect((await host.readThreadStatus({ runtimeId: 'dsh', threadId: thread.id })).status).toBe('running')
        expect(surface.abortTurn).not.toHaveBeenCalledWith(expect.objectContaining({ turnId }), expect.anything())
        await writeFile(join(root, 'release-after-cancel'), '')
      })
      expect(lateProviderSettled).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(calls).toEqual(['first', 'second', 'cancel-tool', 'after-cancel'])
      expect(surface.abortTurn).toHaveBeenCalledTimes(4)
      const records = await trace()
      expect(records.filter(e => e.method === 'session/new')).toHaveLength(1)
      expect(records.filter(e => e.method === 'session/resume')).toHaveLength(1)
      expect(records.filter(e => e.method === 'session/close')).toHaveLength(1)
      expect(records.filter(e => e.clientConnected)).toHaveLength(1)
      expect(records.filter(e => e.lateResponse)).toHaveLength(1)
      expect(records.findIndex(e => e.lateResponse)).toBeLessThan(records.findIndex(e => e.completed === 'after-cancel'))
      expect(new Set(records.filter(e => e.method === 'session/prompt').map(e => e.pid)).size).toBe(1)
      expect(records.filter(e => e.completed).map(e => e.history)).toEqual([['first'], ['first', 'second'], ['first', 'second', 'after-cancel']])
      expect(new Set(records.filter(e => e.completed).map(e => e.endpoint)).size).toBe(1)
      if (process.env.DSH_PERSISTENT_EVIDENCE_DIRECTORY) {
        const output = process.env.DSH_PERSISTENT_EVIDENCE_DIRECTORY
        await mkdir(output, { recursive: true })
        // Trace contains protocol IDs/URLs and counters, never bearer headers.
        await writeFile(join(output, `consume-${consume}.json`), JSON.stringify({ records, calls, identities: identities.map(i => ({ turnId: i.turnId })), abortCalls: vi.mocked(surface.abortTurn!).mock.calls.length }, null, 2))
      }
    } finally { releaseProvider(); subscription.abort(); await consuming; host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  }, 15000)

  it.each(['interrupt', 'close'] as const)('uses Host accepted identity and revokes the MCP endpoint on %s', async lifecycle => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-host-'))
    let host: ReturnType<typeof createAgentRuntimeHost>
    const surface: AgentRuntimeToolSurface = {
      tools: () => [{ type: 'function', name: 'sciforge_discover', description: 'Host discovery', inputSchema: { type: 'object' } }],
      assertPrincipalLease: (identity) => { host.principalForToolRequest(identity as never) },
      call: vi.fn(async () => ({ tool: 'sciforge_discover', value: { operations: [] } })),
      abortTurn: vi.fn()
    }
    leases.length = 0
    const adapter = createDshHostRuntimeAdapter({
      executable: process.execPath,
      executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))],
      stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: surface
    })
    host = createAgentRuntimeHost({ settings: async () => createDefaultSettings(), adapters: [adapter] })
    const client = new Client({ name: 'host-test', version: '1' })
    try {
      await host.connect('dsh')

      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      const handle = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'hang' })

      expect(leases).toHaveLength(1)
      const endpoint = leases[0]!
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: Object.fromEntries(endpoint.headers.map(h => [h.name,h.value])) } }))
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(['sciforge_discover'])
      await client.callTool({ name: 'sciforge_discover', arguments: {} })
      expect(surface.call).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ runtimeId: 'dsh', threadId: thread.id, turnId: handle.turnId, workspaceId: root }) }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
      if (lifecycle === 'interrupt') await host.interruptTurn({ runtimeId: 'dsh', threadId: thread.id, turnId: handle.turnId })
      else await host.close()
      await client.close()
      await expect(fetch(endpoint.url, { signal: AbortSignal.timeout(300) })).rejects.toThrow()
      expect(surface.abortTurn).toHaveBeenCalled()
      await expect(adapter.steerTurn({ settings: createDefaultSettings() }, { runtimeId: 'dsh', threadId: thread.id, turnId: handle.turnId, text: 'no' })).rejects.toThrow('unsupported')
    } finally { await client.close(); host.dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('routes MCP discovery/invocation through the real Broker and neutral Host approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-broker-'))
    let host: ReturnType<typeof createAgentRuntimeHost>
    const handler = vi.fn(async () => ({ output: { ok: true } }))
    const broker = new CapabilityBroker(new CapabilityRegistry([defineCapability({
      id: 'test.publish', version: '1', title: 'Publish', description: 'Controlled write', audiences: ['agent'], scope: 'global', effect: 'external-write', approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' }, inputSchema: z.object({ value: z.string() }).strict(), outputSchema: z.object({ ok: z.boolean() }).strict(), handler
    })]))
    const capabilityTools = createCapabilityAgentToolSurface({ broker,
      resolveCaller: context => { host.principalForToolRequest(context as never); return { audience: 'agent', callerId: 'dsh-fixture', workspaceId: root, approvals: [] } },
      requestApproval: request => host.requestCapabilityApproval(request),
      cancelApprovalTurn: (identity, reason) => host.cancelCapabilityApprovalTurn(identity, reason)
    })
    const surface: AgentRuntimeToolSurface = { tools: () => capabilityTools.tools(), call: (request, options) => capabilityTools.call(request, options), abortTurn: (identity, reason) => capabilityTools.abortTurn(identity, reason), assertPrincipalLease: identity => { host.principalForToolRequest(identity as never) } }
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath, executableArgs: [fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))], stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000, toolSurface: surface })
    host = createAgentRuntimeHost({ settings: async () => createDefaultSettings(), adapters: [adapter] })
    const approvals: DomainRemoteCapabilityApproval[] = []
    host.subscribeRemoteCapabilityApprovals(approval => { if (approval.state === 'pending') approvals.push(approval) })
    const client = new Client({ name: 'broker-test', version: '1' })
    try {
      await host.connect('dsh')
      const thread = await host.startThread({ runtimeId: 'dsh', workspace: root })
      const turn = await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'hang' })
      const endpoint = leases.at(-1)!
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: Object.fromEntries(endpoint.headers.map(h => [h.name, h.value])) } }))
      const discovery = await client.callTool({ name: 'sciforge_discover', arguments: {} })
      const text = (discovery.content as { type: string; text?: string }[]).find(item => item.type === 'text')!.text!
      const operationRef = text.match(/op_[A-Za-z0-9_-]{20,}/u)?.[0]
      expect(operationRef).toBeTruthy()
      const invocation = client.callTool({ name: 'sciforge_invoke', arguments: { operationRef, input: { value: 'approved' } } })
      await vi.waitFor(() => expect(approvals).toHaveLength(1))
      expect(handler).not.toHaveBeenCalled()
      await expect(host.resolveApproval({ runtimeId: 'codex', threadId: thread.id, approvalId: approvals[0]!.approvalId, decision: 'allowed' })).rejects.toThrow('does not belong')
      await host.resolveApproval({ runtimeId: 'dsh', threadId: thread.id, approvalId: approvals[0]!.approvalId, decision: 'allowed' })
      expect((await invocation).isError).not.toBe(true)
      expect(handler).toHaveBeenCalledTimes(1)
      const pending = client.callTool({ name: 'sciforge_invoke', arguments: { operationRef, input: { value: 'cancelled' } } }).catch(error => error)
      await vi.waitFor(() => expect(approvals).toHaveLength(2))
      await host.interruptTurn({ runtimeId: 'dsh', threadId: thread.id, turnId: turn.turnId })
      await pending
      expect(handler).toHaveBeenCalledTimes(1)
      await expect(host.resolveApproval({ runtimeId: 'dsh', threadId: thread.id, approvalId: approvals[1]!.approvalId, decision: 'allowed' })).rejects.toThrow()
    } finally { await client.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
  })
})

describe('DSH command execution under the Host approval chain', () => {
  const fixture = fileURLToPath(new URL('./fixtures/dsh-acp.mjs', import.meta.url))
  const toolSurface = (): AgentRuntimeToolSurface => ({ tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() })
  const settingsWith = (commandExecution: boolean): AppSettingsV1 => ({
    ...createDefaultSettings(),
    agents: { ...createDefaultSettings().agents, dsh: { ...defaultDshRuntimeSettings(), commandExecution } }
  })
  const readProof = (workspace: string) => readFile(join(workspace, 'dsh-shell-proof.txt'), 'utf8').catch(() => '')
  const untilProof = async (workspace: string, expected: string): Promise<void> => {
    const deadline = Date.now() + 5000
    let seen = ''
    while (Date.now() < deadline) {
      seen = await readProof(workspace)
      if (seen === expected) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`shell proof never became ${JSON.stringify(expected)} (last: ${JSON.stringify(seen)})`)
  }

  it('reports the shell capability exactly as the switch is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-shell-capability-'))
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath,
      executableArgs: [fixture], stateDirectory: root, verifyDeployment: async () => {}, requestTimeoutMs: 2000,
      toolSurface: toolSurface() })
    try {
      // Switch off: the default unsupported state stands unchanged.
      expect((await adapter.capabilities({ settings: createDefaultSettings() })).tools.commandExecution)
        .toEqual({ available: false, reason: 'unsupported' })
      // Switch on: the matrix reports the shell the deployment enables.
      expect((await adapter.capabilities({ settings: settingsWith(true) })).tools.commandExecution)
        .toEqual({ available: true })
    } finally { await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('runs an approved shell command in the workspace and lands its output on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-shell-allow-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    // The Host resolver derives this mode from the same predicate the capability
    // matrix reads, so the enabled deployment and the reported matrix agree.
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath, executableArgs: [fixture],
      stateDirectory: root, commandExecution: true, verifyDeployment: async () => {},
      requestTimeoutMs: 4000, approvalTimeoutMs: 4000, toolSurface: toolSurface() })
    const host = createAgentRuntimeHost({ settings: () => settingsWith(true), adapters: [adapter] })
    const published: DomainRemoteCapabilityApproval[] = []
    const dispose = host.subscribeRemoteCapabilityApprovals(approval => { if (approval.state === 'pending') published.push(approval) })
    const abort = new AbortController()
    try {
      await host.connect('dsh')
      const thread = await host.startThread({ runtimeId: 'dsh', workspace })
      const events: AgentRuntimeEvent[] = []
      const stream = (async () => {
        for await (const event of host.subscribeEvents({ runtimeId: 'dsh', threadId: thread.id, signal: abort.signal })) events.push(event)
      })()
      await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'shell:approved-marker' })
      await vi.waitFor(() => expect(published).toHaveLength(1))
      // The ACP tool kind reaches the Host's canonical command-execution descriptor.
      expect(published[0]).toMatchObject({ runtimeId: 'dsh', actionId: 'runtime.command-execution',
        safeSummary: '命令执行', effect: 'destructive', remoteEligible: true })
      const approval = published[0]!
      // Nothing runs while the request is pending.
      expect(await readProof(workspace)).toBe('')
      expect(await host.decideRemoteCapabilityApproval({ approvalId: approval.approvalId,
        runtimeId: approval.runtimeId, threadId: approval.threadId, turnId: approval.turnId,
        capabilityRequestId: approval.capabilityRequestId, decisionId: 'allow-decision', decision: 'allow_once' })).toBe('applied')
      await untilProof(workspace, 'approved-marker')
      await vi.waitFor(() => expect(events.some(event => event.kind === 'approval_resolved' && event.decision === 'allowed')).toBe(true))
      await vi.waitFor(() => expect(events.some(event => event.kind === 'assistant_delta' && event.text.includes('shell ran: approved-marker'))).toBe(true))
      abort.abort()
      await stream
    } finally { host.dispose(); dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('denies the shell command without side effects and reports the denial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-shell-deny-'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const adapter = createDshHostRuntimeAdapter({ executable: process.execPath, executableArgs: [fixture],
      stateDirectory: root, commandExecution: true, verifyDeployment: async () => {},
      requestTimeoutMs: 4000, approvalTimeoutMs: 4000, toolSurface: toolSurface() })
    const host = createAgentRuntimeHost({ settings: () => settingsWith(true), adapters: [adapter] })
    const published: DomainRemoteCapabilityApproval[] = []
    const dispose = host.subscribeRemoteCapabilityApprovals(approval => { if (approval.state === 'pending') published.push(approval) })
    const abort = new AbortController()
    try {
      await host.connect('dsh')
      const thread = await host.startThread({ runtimeId: 'dsh', workspace })
      const events: AgentRuntimeEvent[] = []
      const stream = (async () => {
        for await (const event of host.subscribeEvents({ runtimeId: 'dsh', threadId: thread.id, signal: abort.signal })) events.push(event)
      })()
      await host.startTurn({ runtimeId: 'dsh', threadId: thread.id, text: 'shell:denied-marker' })
      await vi.waitFor(() => expect(published).toHaveLength(1))
      const approval = published[0]!
      expect(await host.decideRemoteCapabilityApproval({ approvalId: approval.approvalId,
        runtimeId: approval.runtimeId, threadId: approval.threadId, turnId: approval.turnId,
        capabilityRequestId: approval.capabilityRequestId, decisionId: 'deny-decision', decision: 'deny_once' })).toBe('applied')
      await vi.waitFor(() => expect(events.some(event => event.kind === 'approval_resolved' && event.decision === 'denied')).toBe(true))
      await vi.waitFor(() => expect(events.some(event => event.kind === 'assistant_delta' && event.text.includes('shell denied'))).toBe(true))
      // The denied command left no trace in the workspace.
      expect(await readProof(workspace)).toBe('')
      expect(await readdir(workspace)).toEqual([])
      abort.abort()
      await stream
    } finally { host.dispose(); dispose(); await adapter.close(); await rm(root, { recursive: true, force: true }) }
  })
})
