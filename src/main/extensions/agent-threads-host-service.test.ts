import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { HostServiceProviderRegistry, type HostServiceRequest } from '@sciforge/plugin-sdk'
import type { AgentRuntimeThreadSnapshot } from '../../shared/agent-runtime-contract'
import { canonicalWorkspacePath, createWorkspaceAuthority } from './workspace-authority'
import { externalizeToolDetails, toolArtifactContent } from '../runtime/agent-runtime/jsonl-thread-page'
import {
  AGENT_THREADS_HOST_SERVICE_ID,
  AGENT_THREADS_READ_PORT,
  createAgentThreadsHostServiceResolver,
  type AgentThreadsHostServiceOptions,
  type AgentThreadsReadResult
} from './agent-threads-host-service'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '')
const CLIENT_MODULE = fileURLToPath(new URL('../../../packages/plugin-sdk/src/host-service-client.mjs', import.meta.url))
const IDENTITY = { packageName: 'ordinary-consumer', version: '1.0.0', generation: 7 }
const TOOL = { id: 'tool-1', kind: 'tool' as const, toolKind: 'command_execution' as const, detail: 'opaque tool output', meta: { untouched: { value: 4 } } }

function snapshot(): AgentRuntimeThreadSnapshot {
  return {
    id: 'host-session', runtimeId: 'codex', title: 'Host Session', updatedAt: '2026-11-03T00:00:00Z', workspace: ROOT, latestSeq: 23,
    turns: [
      { id: 'turn-1', threadId: 'host-session', status: 'completed', items: [TOOL, { id: 'assistant-1', kind: 'assistant_message', text: 'done' }] },
      { id: 'turn-empty', threadId: 'host-session', status: 'completed' },
      { id: 'turn-2', threadId: 'host-session', status: 'completed', items: [{ id: 'tool-2', kind: 'tool', detail: 'another tool' }] }
    ]
  }
}

function request(overrides: Partial<HostServiceRequest> = {}): HostServiceRequest {
  return {
    requestId: 'read-request', serviceId: AGENT_THREADS_HOST_SERVICE_ID, operation: 'read', input: {},
    owner: {
      ...IDENTITY, pluginId: 'ordinary-consumer', connectionId: 'connection', invocationId: 'invocation',
      authority: {
        caller: { audience: 'agent', callerId: 'agent-1', workspaceId: ROOT }, effect: 'read',
        ordinarySession: { runtimeId: 'codex', threadId: 'host-session' },
        originalContext: { sessionId: 'forged-context-session', workspaceRoot: '/forged' }
      }
    },
    signal: new AbortController().signal, assertCurrent: vi.fn(), ...overrides
  }
}

function fixture(overrides: Partial<AgentThreadsHostServiceOptions> = {}) {
  const readSnapshot = vi.fn(async () => snapshot())
  let ports: readonly string[] = [AGENT_THREADS_READ_PORT]
  const readGrantedPorts = vi.fn(() => ports)
  const resolver = createAgentThreadsHostServiceResolver({
    readSnapshot, readGrantedPorts,
    authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [ROOT] }),
    hostServiceClientModule: CLIENT_MODULE, ...overrides
  })
  const providers = resolver.resolve(IDENTITY.packageName, IDENTITY.version, IDENTITY.generation)!
  const provider = providers[AGENT_THREADS_HOST_SERVICE_ID]!
  return { resolver, provider, registry: new HostServiceProviderRegistry(providers), readSnapshot, readGrantedPorts, revoke: () => { ports = [] } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function authorityRequest(authority: Record<string, unknown>): HostServiceRequest {
  const base = request()
  return { ...base, owner: { ...base.owner, authority: { ...base.owner.authority, ...authority } } }
}

describe('generic agentThreads Host service', () => {
  it.each([{}, { sessionId: '' }, { sessionId: 'host-session', runtimeId: 'codex' }])('reads only the current real Host snapshot for %j', async input => {
    const f = fixture()
    const req = request({ input })
    const result = await f.registry.dispatch(req) as AgentThreadsReadResult
    expect(f.readSnapshot).toHaveBeenCalledExactlyOnceWith({ runtimeId: 'codex', threadId: 'host-session', signal: req.signal })
    expect(result).toMatchObject({ sessionId: 'host-session', runtimeId: 'codex', workspaceRoot: canonicalWorkspacePath(ROOT), watermark: '23' })
    expect(result.artifacts).toEqual([TOOL, { id: 'assistant-1', kind: 'assistant_message', text: 'done' }, { id: 'tool-2', kind: 'tool', detail: 'another tool' }])
    expect(result.turns.map(turn => [turn.id, turn.artifacts.length])).toEqual([['turn-1', 2], ['turn-empty', 0], ['turn-2', 1]])
    expect(result.artifacts[0]).not.toBe(TOOL)
    expect(req.assertCurrent).toHaveBeenCalled()
  })

  it('hydrates five large canonical file changes and other tool artifacts without changing the durable snapshot', async () => {
    const originals = Array.from({ length: 5 }, (_, index) => ({
      id: `change-${index}`, kind: 'tool' as const, toolKind: 'file_change' as const,
      detail: JSON.stringify({ path: `file-${index}.txt`, patch: '+actual data\n'.repeat(14000) }),
      meta: { origin: 'host', structuredContent: { path: `file-${index}.txt`, patch: '+actual data\n'.repeat(14000) } }
    }))
    const plain = { id: 'plain', kind: 'tool' as const, toolKind: 'command_execution' as const, detail: 'plain text\n'.repeat(18000) }
    const source = [...originals, plain]
    const compact = snapshot()
    compact.turns[0].items = externalizeToolDetails({ runtimeId: 'codex', threadId: 'host-session', items: source })
    const before = JSON.stringify(compact)
    const readArtifact = vi.fn(async input => {
      const index = compact.turns[0].items!.findIndex(item => item.detailArtifact?.ref === input.ref)
      return { ...input, content: toolArtifactContent(source[index].detail, 'meta' in source[index] ? source[index].meta : undefined)! }
    })
    const f = fixture({ readSnapshot: async () => compact, readArtifact })
    const req = request()
    const result = await f.registry.dispatch(req) as AgentThreadsReadResult
    expect(readArtifact).toHaveBeenCalledTimes(6)
    for (const [index, original] of source.entries()) {
      expect(readArtifact).toHaveBeenNthCalledWith(index + 1, { ...compact.turns[0].items![index].detailArtifact, signal: req.signal })
      expect(result.artifacts[index].detail).toBe(original.detail)
      expect(result.turns[0].artifacts[index]).toEqual(result.artifacts[index])
    }
    for (const [index, original] of originals.entries()) expect(result.artifacts[index].meta).toEqual(original.meta)
    expect(JSON.stringify(compact)).toBe(before)
  })

  it.each(['snapshot', 'artifact-1', 'artifact-2'] as const)('rejects workspace revocation while awaiting %s and stops later reads', async phase => {
    const entered = deferred<void>()
    const release = deferred<void>()
    let authorized = true
    const authorizeWorkspace = vi.fn(async () => authorized)
    const compact = snapshot()
    compact.turns[0].items = externalizeToolDetails({ runtimeId: 'codex', threadId: 'host-session', items: [
      { ...TOOL, detail: 'x'.repeat(20000) }, { ...TOOL, id: 'next', detail: 'y'.repeat(20000) },
      { ...TOOL, id: 'last', detail: 'z'.repeat(20000) }
    ] })
    let artifactReads = 0
    const readArtifact = vi.fn(async input => {
      artifactReads++
      if (phase === `artifact-${artifactReads}`) { entered.resolve(); await release.promise }
      return { ...input, content: 'private canonical detail' }
    })
    const f = fixture({ authorizeWorkspace, readArtifact, readSnapshot: async () => {
      if (phase === 'snapshot') { entered.resolve(); await release.promise }
      return compact
    } })
    const pending = f.registry.dispatch(request())
    const rejected = expect(pending).rejects.toThrow(/workspace is not authorized/)
    await entered.promise
    authorized = false
    release.resolve()
    await rejected
    expect(readArtifact).toHaveBeenCalledTimes(phase === 'snapshot' ? 0 : Number(phase.slice(-1)))
  })

  it.each(['workspace', 'cancel', 'stale', 'port', 'generation', 'healthy'] as const)('fences %s during the final asynchronous workspace authorization', async action => {
    const entered = deferred<void>()
    const release = deferred<void>()
    const controller = new AbortController()
    let authorized = true
    let current = true
    let projected = false
    const value = snapshot()
    // Projection reads title only after the snapshot boundary authorization.
    Object.defineProperty(value, 'title', { enumerable: true, get: () => { projected = true; return 'Host Session' } })
    const authorizeWorkspace = vi.fn(async () => {
      if (projected) { entered.resolve(); await release.promise }
      return authorized
    })
    const f = fixture({ authorizeWorkspace, readSnapshot: async () => value })
    const req = request({ signal: controller.signal, assertCurrent: () => { if (!current) throw new Error('stale') } })
    const pending = Promise.resolve(f.provider.operations.read(req))
    const outcome = action === 'healthy'
      ? expect(pending).resolves.toMatchObject({ sessionId: 'host-session', workspaceRoot: canonicalWorkspacePath(ROOT) })
      : expect(pending).rejects.toThrow(action === 'workspace' ? /workspace is not authorized/ : /cancelled|stale|not authorized/)
    // The original implementation returns without a final authorizer; do not hang on its missing gate.
    await Promise.race([entered.promise, pending.then(() => undefined, () => undefined)])
    if (action === 'workspace') authorized = false
    if (action === 'cancel') controller.abort(new Error('cancelled'))
    if (action === 'stale') current = false
    if (action === 'port') f.revoke()
    if (action === 'generation') (req.owner as { generation: number }).generation++
    release.resolve()
    await outcome
    expect(authorizeWorkspace).toHaveBeenCalledTimes(3)
  })

  it('retains the initial caller and scope across reads and authorizer input mutation', async () => {
    const req = request({ input: { sessionId: 'host-session', runtimeId: 'codex' } })
    const seen: unknown[] = []
    const authorizeWorkspace = vi.fn(async input => {
      seen.push({ caller: { ...input.caller }, workspaceId: input.workspaceId })
      input.caller.workspaceId = '/authorizer-mutated'
      input.caller.callerId = 'authorizer-mutated'
      return true
    })
    const f = fixture({ authorizeWorkspace, readSnapshot: async () => {
      Object.assign(req.owner.authority.caller!, { workspaceId: '/request-mutated', callerId: 'request-mutated' })
      Object.assign(req.owner.authority.ordinarySession!, { runtimeId: 'claude', threadId: 'foreign' })
      Object.assign(req.input as object, { sessionId: 'foreign', runtimeId: 'claude' })
      return snapshot()
    } })
    await expect(f.provider.operations.read(req)).resolves.toMatchObject({ sessionId: 'host-session', runtimeId: 'codex', workspaceRoot: canonicalWorkspacePath(ROOT) })
    expect(seen).toEqual(Array.from({ length: 3 }, () => ({
      caller: { audience: 'agent', callerId: 'agent-1', workspaceId: ROOT }, workspaceId: ROOT
    })))
  })

  it.each(['reference', 'response', 'missing-reader', 'read-error'] as const)('fails closed for an invalid artifact %s', async mode => {
    const compact = snapshot()
    compact.turns[0].items = externalizeToolDetails({ runtimeId: 'codex', threadId: 'host-session', items: [{ ...TOOL, detail: 'x'.repeat(20000) }] })
    if (mode === 'reference') compact.turns[0].items[0].detailArtifact!.threadId = 'foreign'
    const readArtifact = vi.fn(async input => {
      if (mode === 'read-error') throw new Error('artifact unavailable')
      return { ...input, ...(mode === 'response' ? { runtimeId: 'claude' as const } : {}), content: 'full' }
    })
    const f = fixture({ readSnapshot: async () => compact, ...(mode === 'missing-reader' ? {} : { readArtifact }) })
    await expect(f.registry.dispatch(request())).rejects.toThrow(/artifact/)
    if (mode === 'reference' || mode === 'missing-reader') expect(readArtifact).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'stale', 'revoke'] as const)('fences %s during artifact hydration and stops later reads', async action => {
    const controller = new AbortController()
    let current = true
    const compact = snapshot()
    compact.turns[0].items = externalizeToolDetails({ runtimeId: 'codex', threadId: 'host-session', items: [
      { ...TOOL, detail: 'x'.repeat(20000) }, { ...TOOL, id: 'next', detail: 'y'.repeat(20000) }
    ] })
    const readArtifact = vi.fn(async input => {
      if (action === 'cancel') controller.abort(new Error('cancelled'))
      if (action === 'stale') current = false
      if (action === 'revoke') f.revoke()
      return { ...input, content: 'full' }
    })
    const f = fixture({ readSnapshot: async () => compact, readArtifact })
    await expect(f.registry.dispatch(request({ signal: controller.signal, assertCurrent: () => { if (!current) throw new Error('stale') } }))).rejects.toThrow()
    expect(readArtifact).toHaveBeenCalledTimes(1)
  })

  it.each([
    undefined, null, [], 'session', 5, { workspaceRoot: ROOT }, { sessionDetail: {} }, { profile: 'default' },
    { sessionId: 4 }, { runtimeId: null }, { runtimeId: '' }, { sessionId: undefined }, { sessionId: ' host-session' },
    { runtimeId: 'codex ' }, new Date(), Object.create({ sessionId: 'host-session' }),
    Object.defineProperty({}, 'sessionId', { get: () => 'host-session', enumerable: true }),
    Object.defineProperty({}, 'sessionId', { value: 'host-session', enumerable: false }),
    { [Symbol('hidden')]: 'extra' }
  ])('rejects non-selector or non-data request %j before snapshot reads', async input => {
    const f = fixture()
    await expect(f.registry.dispatch(request({ input }))).rejects.toThrow(/plain data|only sessionId/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each([{ sessionId: 'another-session-same-workspace' }, { runtimeId: 'claude' }, { sessionId: 'synthetic-dsh-session' }])('rejects foreign selector %j without lookup', async input => {
    const f = fixture()
    await expect(f.registry.dispatch(request({ input }))).rejects.toThrow(/another session or runtime/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    { caller: { audience: 'ui', callerId: 'ui', workspaceId: ROOT } },
    { caller: { audience: 'agent', workspaceId: ROOT } },
    { effect: 'compute' }, { effect: 'workspace-write' }, { ordinarySession: undefined },
    { ordinarySession: { runtimeId: 'codex', sessionId: 'host-session' } },
    { ordinarySession: { runtimeId: '', threadId: 'host-session' } }
  ])('rejects unauthenticated or non-read authority %j', async authority => {
    const f = fixture()
    await expect(f.registry.dispatch(authorityRequest(authority))).rejects.toThrow(/authenticated agent read/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['', 'relative-root', ROOT + '-foreign'])('rejects untrusted caller workspace %s', async workspaceId => {
    const f = fixture()
    await expect(f.registry.dispatch(authorityRequest({ caller: { audience: 'agent', callerId: 'agent-1', workspaceId } }))).rejects.toThrow(/workspace is not authorized/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['', ROOT + '-foreign', undefined])('rejects absent or mismatched snapshot workspace %s', async workspace => {
    const f = fixture({ readSnapshot: async () => ({ ...snapshot(), workspace }) })
    await expect(f.registry.dispatch(request())).rejects.toThrow(/snapshot workspace/)
  })

  it.each([{ id: 'another-session-same-workspace' }, { runtimeId: 'claude' as const }])('rejects a Host snapshot with another identity %j', async patch => {
    const f = fixture({ readSnapshot: async () => ({ ...snapshot(), ...patch }) })
    await expect(f.registry.dispatch(request())).rejects.toThrow(/scope mismatch/)
  })

  it('supports the same canonical root expressed with a trailing separator', async () => {
    const f = fixture({ readSnapshot: async () => ({ ...snapshot(), workspace: ROOT + '/' }) })
    await expect(f.registry.dispatch(request())).resolves.toMatchObject({ workspaceRoot: canonicalWorkspacePath(ROOT) })
  })

  it('rejects opaque non-JSON artifacts instead of silently truncating them', async () => {
    const f = fixture({ readSnapshot: async () => {
      const value = snapshot()
      value.turns[0].items![0] = { ...TOOL, meta: { unsafe: () => 'lost' } }
      return value
    } })
    await expect(f.registry.dispatch(request())).rejects.toThrow(/lossless acyclic plain JSON/)
  })

  it('requires the live lease even for direct operation calls', async () => {
    const f = fixture()
    await expect(f.provider.operations.read(request({ assertCurrent: undefined }))).rejects.toThrow(/live Host authority lease/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['packageName', 'version', 'generation'] as const)('binds the exact owner %s even outside registry dispatch', async field => {
    const f = fixture()
    const req = request()
    await expect(f.provider.operations.read({ ...req, owner: { ...req.owner, [field]: field === 'generation' ? 8 : 'foreign' } })).rejects.toThrow(/not authorized/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['serviceId', 'operation'] as const)('rejects another %s on direct operation calls', async field => {
    const f = fixture()
    await expect(f.provider.operations.read(request({ [field]: 'unavailable' }))).rejects.toThrow(/unavailable/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it('does not grant based on the plugin or package name', () => {
    const resolver = createAgentThreadsHostServiceResolver({
      readSnapshot: async () => snapshot(), readGrantedPorts: () => ['artifacts.read'],
      authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [ROOT] }), hostServiceClientModule: CLIENT_MODULE
    })
    expect(resolver.resolve('change-inspector', '1.0.0', 1)).toBeUndefined()
    expect(resolver.resolveClients('change-inspector', '1.0.0', 1)).toEqual([])
  })

  it('provides generic clients for any granted identity and rejects a revoked port', async () => {
    const f = fixture()
    expect(f.resolver.resolveClients('any-other-plugin', '99.0.0', 12)).toEqual([{
      serviceId: 'agentThreads', modulePath: CLIENT_MODULE, exportName: 'createHostServiceClient', config: { serviceId: 'agentThreads' }
    }])
    expect(f.resolver.serviceIds).toEqual(['agentThreads'])
    f.revoke()
    expect(f.resolver.resolve(IDENTITY.packageName, IDENTITY.version, IDENTITY.generation)).toBeUndefined()
    expect(f.resolver.resolveClients(IDENTITY.packageName, IDENTITY.version, IDENTITY.generation)).toEqual([])
    await expect(f.registry.dispatch(request())).rejects.toThrow(/not authorized/)
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it('passes exact identity to the Host grant resolver', () => {
    const f = fixture()
    expect(f.readGrantedPorts).toHaveBeenCalledWith(IDENTITY)
  })

  it.each(['', './client.mjs', ' /absolute/client.mjs'])('rejects an invalid client module path %s', hostServiceClientModule => {
    expect(() => fixture({ hostServiceClientModule })).toThrow(/absolute Host service client/)
  })

  it('observes cancellation before reading', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(f.registry.dispatch(request({ signal: controller.signal }))).rejects.toThrow('cancelled')
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'stale', 'revoke'] as const)('fences %s during workspace authorization before reading', async action => {
    const controller = new AbortController()
    let current = true
    const f = fixture({ authorizeWorkspace: async () => {
      if (action === 'cancel') controller.abort(new Error('cancelled'))
      if (action === 'stale') current = false
      if (action === 'revoke') f.revoke()
      return true
    } })
    await expect(f.registry.dispatch(request({ signal: controller.signal, assertCurrent: () => { if (!current) throw new Error('stale') } }))).rejects.toThrow()
    expect(f.readSnapshot).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'stale', 'revoke'] as const)('fences %s after snapshot read before returning data', async action => {
    const controller = new AbortController()
    let current = true
    const f = fixture({ readSnapshot: async () => {
      if (action === 'cancel') controller.abort(new Error('cancelled'))
      if (action === 'stale') current = false
      if (action === 'revoke') f.revoke()
      return snapshot()
    } })
    await expect(f.registry.dispatch(request({ signal: controller.signal, assertCurrent: () => { if (!current) throw new Error('stale') } }))).rejects.toThrow()
  })
})
