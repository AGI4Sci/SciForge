import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDomainMainRuntimeLifecycleContribution } from '@sciforge/domain-sdk/host'
import { artifactVersionCommitResultV1Schema } from '@sciforge/domain-artifact-versions/contract'
import { createDomainMainEntry, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import { createDomainHostServiceResolver, type EvidenceDomainHostServiceOptions } from '@sciforge/domain-evidence-dag/host-services'
import type { HostServiceRequest } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import type { CapabilityInvocationResult } from '../../shared/capability-broker'
import { projectAgentRuntimeThreadSnapshot } from '../runtime/agent-runtime/thread-wire-projection'
import { DevelopmentExternalPluginService } from './development-external-plugins'

// Execute the actual startup block, including creation of the package resolver
// before the Runtime Host is available. Electron and its UI protocol stay inert.
const sourceText = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true)
let startup: ts.IfStatement | undefined
function visit(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'developmentPluginOptions') startup = node
  ts.forEachChild(node, visit)
}
visit(source)
if (!startup) throw new Error('Production development plugin composition not found.')
const compiled = ts.transpileModule(`let developmentPlugins; ${startup.getText(source)}; return developmentPlugins;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

const roots: string[] = []
const services: DevelopmentExternalPluginService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(broker?: CapabilityBroker) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'sciforge-plugin-composition-'))
  roots.push(root)
  let options: EvidenceDomainHostServiceOptions | undefined
  const agentRuntimeHostRef: { current: unknown } = { current: null }
  const bindings = {
    developmentPluginOptions: { root, userDataPath: root, hostApiVersion: '1.0.0', allowedPermissionIds: new Set() },
    agentRuntimeHostRef,
    capabilityBrokerForDomainServices: broker,
    createInstalledDomainHostServiceResolution: (input: EvidenceDomainHostServiceOptions) => {
      options = input
      const resolver = createDomainHostServiceResolver(input)
      return { resolveHostServiceProviders: resolver.resolve, resolveHostServiceClients: resolver.resolveClients, hostServiceIds: resolver.serviceIds }
    },
    app: { getPath: () => root, once: vi.fn() },
    process: { env: {} },
    store: { load: vi.fn() },
    createEvidenceModelReasoner: () => vi.fn(),
    projectAgentRuntimeThreadSnapshot,
    DevelopmentExternalPluginService,
    HOST_BUSINESS_INVOKE_TIMEOUT_MS: 1_000,
    installDevelopmentPluginUiProtocol: vi.fn(),
    protocol: {},
    net: {},
    logInfo: vi.fn(),
    logWarn: vi.fn()
  }
  const service = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings))
  if (!(service instanceof DevelopmentExternalPluginService)) throw new Error('Production plugin service was not composed.')
  services.push(service)
  if (!options) throw new Error('Production Host service options were not composed.')
  return { root, options, agentRuntimeHostRef }
}

function request(operation: string, input: unknown, workspaceRoot: string, overrides: Partial<HostServiceRequest> = {}): HostServiceRequest {
  const identity = { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: workspaceRoot }
  const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot }
  return {
    requestId: 'host-request-1', serviceId: 'evidenceDagPorts', operation,
    owner: { ...identity, connectionId: 'connection-1', packageName: identity.pluginId, generation: 1, invocationId: 'outer-invocation', authority: {
      caller: { audience: 'agent', callerId: 'canonical-agent', workspaceId: workspaceRoot },
      ordinarySession: { runtimeId: scope.runtimeId, threadId: scope.threadId },
      originalContext: { runtimeId: scope.runtimeId, threadId: scope.threadId, callId: 'original-call' },
      effect: 'workspace-write'
    } },
    input: { protocol: 'sciforge-evidence-ports.v1', requestId: 'request-1', identity, operation, scope, input },
    signal: new AbortController().signal, assertCurrent: vi.fn(),
    ...overrides
  }
}

function providerFor(options: EvidenceDomainHostServiceOptions, root: string) {
  const resolver = createDomainHostServiceResolver({
    ...options,
    environment: { SCIFORGE_EVIDENCE_PYTHON: '/unused/python', SCIFORGE_EVIDENCE_WHEEL_PATH: '/unused/wheel', SCIFORGE_EVIDENCE_WHEEL_SHA256: '0'.repeat(64), SCIFORGE_EVIDENCE_CLIENT_MODULE: '/unused/client' }
  })
  const provider = resolver.resolve('sciforge-evidence-dag', '1.0.0', 1)?.evidenceDagPorts
  if (!provider) throw new Error('Package-owned Host service was not resolved.')
  return async (operation: string, input: unknown, overrides: Partial<HostServiceRequest> = {}) => provider.operations[operation](request(operation, input, root, overrides))
}

describe('production development plugin composition', () => {
  it('composes before Runtime Host publication and reads the published Host at invocation', async () => {
    const { root, options, agentRuntimeHostRef } = await fixture()
    const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: root }
    const context = { caller: {}, signal: new AbortController().signal, assertCurrent() {} }
    await expect(options.threads.read(scope, context)).rejects.toThrow('not ready for extension invocation')
    agentRuntimeHostRef.current = {
      readThreadSnapshot: vi.fn(async () => ({ id: scope.threadId, runtimeId: scope.runtimeId, workspace: root, latestSeq: 0, turns: [] })),
      listThreads: vi.fn(async () => [{ id: scope.threadId, runtimeId: scope.runtimeId, workspace: root }, { id: 'foreign-thread', runtimeId: scope.runtimeId, workspace: root }])
    }
    await expect(options.threads.read(scope, context)).resolves.toMatchObject({ ...scope, trace: [] })
    await expect(options.threads.list(scope, context)).resolves.toEqual([scope])
  })

  it('routes package-owned artifact contracts through the real Broker with caller, Session and idempotency intact', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry)
    const invoke = vi.spyOn(broker, 'invokeOrdinarySession')
    const { root, options } = await fixture(broker)
    const entry = createDomainMainEntry<ArtifactVersionsCapabilityOptions>({
      getUserDataDir: () => root,
      defineCapability: options => options
    })
    const lifecycle = entry.contributions.find(contribution => contribution.kind === 'main.runtime-lifecycle')?.value
    const factory = entry.contributions.find(contribution => contribution.kind === 'main.capability-factory')?.value
    if (!isDomainMainRuntimeLifecycleContribution(lifecycle) || !factory || !('createDefinitions' in factory)) {
      throw new Error('Artifact Versions main contributions are incomplete.')
    }
    for (const { audiences, tags, ...definition } of factory.createDefinitions()) {
      registry.register(defineCapability({ ...definition, audiences: [...audiences], tags: [...tags] }))
    }
    const unexpected = () => { throw new Error('Unexpected Artifact Versions Host callback.') }
    const deactivate = await lifecycle.activate({
      userDataDir: root, appRoot: root, environment: {},
      owner: { moduleId: entry.definition.module.id, moduleVersion: entry.definition.module.version },
      signal: new AbortController().signal,
      agentThreads: { list: async () => [], read: async () => unexpected(), subscribeMessages: async function* () {}, hasActiveTurns: () => false },
      capabilities: { invoke: async () => unexpected(), createApprovedBatch: unexpected },
      modelAccess: { textReasoner: async () => unexpected() },
      executionEvents: { publish: async () => unexpected() },
      enablement: { isEnabled: () => true, subscribe: () => unexpected },
      workflowExecutionReceipts: [], log: () => {}
    })
    try {
      const call = providerFor(options, root)
      const input = { idempotencyKey: ' evidence-commit-1 ', candidates: [{ candidateId: 'figure', expectedCurrentVersionId: null, kind: 'figure', intent: 'rerun', content: { mode: 'snapshot', dataBase64: 'YQ==' }, accessPolicy: { visibility: 'restricted', principals: ['canonical-agent'], allowExport: false } }] }
      const first = await call('artifacts.commit', input)
      expect(first).toMatchObject({ ok: true })
      const second = await call('artifacts.commit', input)
      expect(second).toEqual(first)
      const invocationId = `evidence-artifacts:${createHash('sha256').update(input.idempotencyKey).digest('hex')}`
      expect(invoke.mock.calls[0]).toMatchObject([
        { audience: 'agent', callerId: 'canonical-agent', workspaceId: root },
        { input: { ...input, idempotencyKey: input.idempotencyKey.trim() }, invocationId },
        { runtimeId: 'codex', threadId: 'thread-1' },
        { context: { runtimeId: 'codex', threadId: 'thread-1', callId: 'original-call' } }
      ])
      const receipt = artifactVersionCommitResultV1Schema.parse(first)
      if (!receipt.ok) throw new Error(receipt.issue.message)
      await expect(call('artifacts.listEvents', { afterSequence: 0, limit: 100 })).resolves.toMatchObject({ ok: true, value: { events: expect.any(Array) } })
      await expect(call('artifacts.read', { versionId: receipt.value.versions[0].version.versionId })).resolves.toMatchObject({ ok: true, value: { dataBase64: 'YQ==' } })
      const before = invoke.mock.calls.length
      await expect(call('artifacts.commit', { ...input, unexpected: true })).rejects.toThrow()
      expect(invoke).toHaveBeenCalledTimes(before)
      await expect(call('artifacts.commit', { ...input, candidates: [{ ...input.candidates[0], content: { mode: 'snapshot', dataBase64: 'Yg==' } }] })).rejects.toThrow(/idempotency|different/i)
      const owner = request('artifacts.read', {}, root).owner
      await expect(call('artifacts.read', { versionId: receipt.value.versions[0].version.versionId }, { owner: { ...owner, authority: { ...owner.authority, caller: { audience: 'agent', callerId: 'foreign-agent', workspaceId: root } } } })).resolves.toMatchObject({ ok: false })
      await expect(call('artifacts.commit', input, { owner: { ...owner, authority: { ...owner.authority, effect: 'read' } } })).rejects.toThrow(/not authorized by capability effect/)
      await expect(call('artifacts.read', { versionId: receipt.value.versions[0].version.versionId }, { owner: { ...owner, authority: { ...owner.authority, originalContext: { runtimeId: 'codex', threadId: 'foreign-thread' } } } })).rejects.toThrow(/does not match the authenticated Session/)
    } finally {
      if (typeof deactivate === 'function') await deactivate()
    }
  })

  it('rejects stale or aborted callbacks before dispatch and fences results after dispatch', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry)
    const result: CapabilityInvocationResult = { actionId: 'neutral.read', output: {}, changed: false, replayed: false, completedAt: '2026-10-20T00:00:00Z' }
    const invoke = vi.spyOn(broker, 'invokeOrdinarySession').mockResolvedValue(result)
    const { options } = await fixture(broker)
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    const context = { caller: {}, signal: abort.signal, assertCurrent() {} }
    await expect(options.capabilities.invoke({ actionId: 'neutral.read', input: {} }, context)).rejects.toThrow('cancelled')
    expect(invoke).not.toHaveBeenCalled()
    const active = new AbortController()
    let current = true
    invoke.mockImplementation(async () => { current = false; return result })
    await expect(options.capabilities.invoke({ actionId: 'neutral.read', input: {} }, { ...context, signal: active.signal, assertCurrent() { if (!current) throw new Error('principal changed') } })).rejects.toThrow('principal changed')
    current = true
    invoke.mockImplementation(async () => { active.abort(new Error('cancelled in flight')); return result })
    await expect(options.capabilities.invoke({ actionId: 'neutral.read', input: {} }, { ...context, signal: active.signal })).rejects.toThrow('cancelled in flight')
  })
})
