import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDomainMainRuntimeLifecycleContribution } from '@sciforge/domain-sdk/host'
import { artifactVersionCommitResultV1Schema } from '@sciforge/domain-artifact-versions/contract'
import { createDomainMainEntry, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import { createDomainHostServiceResolver, type EvidenceDomainHostServiceOptions } from '@sciforge/domain-evidence-dag/host-services'
import type { HostServiceRequest, PluginAdapterContract } from '@sciforge/plugin-sdk'
import { createInstalledDomainHostServiceResolution } from '../modules/installed-domain-main'
import { createAgentThreadsHostServiceResolver } from './agent-threads-host-service'
import { createReadGrantedHostServicePorts, mergeHostServiceResolutions, type HostServiceResolution } from './host-service-resolution'
import type { AgentRuntimeThreadSnapshot } from '../../shared/agent-runtime-contract'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import type { CapabilityInvocationResult } from '../../shared/capability-broker'
import { projectAgentRuntimeThreadSnapshot } from '../runtime/agent-runtime/thread-wire-projection'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { canonicalWorkspacePath, createWorkspaceAuthority } from './workspace-authority'
import { createVisualCaptureHostServiceResolver } from './visual-capture-host-service'
import { composeNativeExecutionHostServices } from './native-execution-composition'

// Execute the actual startup block, including creation of the package resolver
// before the Runtime Host is available. Electron and its UI protocol stay inert.
const sourceText = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const source = ts.createSourceFile('index.ts', sourceText, ts.ScriptTarget.Latest, true)
let startup: ts.IfStatement | undefined
let installedStartup: ts.IfStatement | undefined
let installedOptions: ts.VariableStatement | undefined
const installedGrantBindings: ts.VariableStatement[] = []
let authority: ts.VariableStatement | undefined
function visit(node: ts.Node): void {
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'developmentPluginOptions') startup = node
  if (ts.isIfStatement(node) && node.expression.getText(source) === 'developmentPlugins === undefined && dshRuntimeVersion !== undefined') installedStartup = node
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'installedHostServiceOptions')) installedOptions = node
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ['readInstalledContractPorts', 'readInstalledGrantedPorts'].includes(declaration.name.getText(source)))) installedGrantBindings.push(node)
  if (ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'workspaceAuthority')) authority = node
  ts.forEachChild(node, visit)
}
visit(source)
if (!startup) throw new Error('Production development plugin composition not found.')
if (!authority) throw new Error('Production workspace authority composition not found.')
if (!installedOptions) throw new Error('Production shared Host service options not found.')
const compiled = ts.transpileModule(`let developmentPlugins; ${authority.getText(source)}; ${installedOptions.getText(source)}; ${startup.getText(source)}; return developmentPlugins;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText
if (!installedStartup || !installedOptions) throw new Error('Production installed plugin composition not found.')
const installedCompiled = ts.transpileModule(`let developmentPlugins; ${installedGrantBindings.map(node => node.getText(source)).join(';')}; ${authority.getText(source)}; ${installedOptions.getText(source)}; ${installedStartup.getText(source)}; return developmentPlugins;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

const roots: string[] = []
const services: DevelopmentExternalPluginService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(broker?: CapabilityBroker, mode: 'development' | 'installed' = 'development', packaged = false) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'sciforge-plugin-composition-'))
  roots.push(root)
  let options: EvidenceDomainHostServiceOptions | undefined
  let resolution: HostServiceResolution | undefined
  let readAgentSnapshot: ((input: { runtimeId: string; threadId: string; signal: AbortSignal }) => Promise<AgentRuntimeThreadSnapshot>) | undefined
  const agentRuntimeHostRef: { current: unknown } = { current: null }
  const contracts = new Map<string, PluginAdapterContract>([['example-plugin@1.0.0', {
    approved: true, hostApiRange: '^1.0.0', permissions: [],
    dshAuthorization: { packageName: 'example-plugin', packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', ports: ['visual-capture.read', 'visual-capture.capture'] }
  }]])
  const bindings = {
    developmentPluginOptions: { root, userDataPath: root, hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts, allowedPermissionIds: new Set() },
    installedPluginOptions: { root, userDataPath: root, hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts, allowedPermissionIds: new Set() },
    installedAdapterContracts: contracts,
    dshRuntimeVersion: '0.2.0-rc.2',
    pluginDependencyRoot: undefined,
    pluginRuntimeEnv: undefined,
    installedPluginRoot: root,
    dshPluginPolicy: { approved: [] },
    join,
    existsSync,
    __dirname: join(root, 'out/main'),
    createReadGrantedHostServicePorts,
    composeNativeExecutionHostServices: (input: Parameters<typeof composeNativeExecutionHostServices>[0]) => {
      resolution = composeNativeExecutionHostServices(input)
      return resolution
    },
    mergeHostServiceResolutions: (...inputs: (ReturnType<typeof mergeHostServiceResolutions> | ReturnType<typeof createAgentThreadsHostServiceResolver>)[]) => {
      resolution = mergeHostServiceResolutions(...inputs)
      return resolution
    },
    createAgentThreadsHostServiceResolver: (input: Parameters<typeof createAgentThreadsHostServiceResolver>[0]) => {
      readAgentSnapshot = input.readSnapshot
      return createAgentThreadsHostServiceResolver(input)
    },
    createVisualCaptureHostServiceResolver,
    visibleContextService: { boundSurface: vi.fn(), registeredTargetRef: vi.fn(), resolveRegisteredTarget: vi.fn(), currentRegisteredTargetSnapshot: vi.fn() },
    registeredTargetVisualCapture: { captureRegisteredTarget: vi.fn() },
    visualCaptureInstanceId: 'test-instance',
    agentRuntimeHostRef,
    capabilityBrokerForDomainServices: broker,
    pluginDshConfigs: {},
    pluginContractPins: {},
    authorizeHostService: (input: { packageName: string; version: string; serviceId: string }) =>
      input.serviceId === 'artifact-versions.workspace' && input.packageName === '@sciforge/plugin-scientific-plotting' && input.version === '0.2.2',
    createInstalledDomainHostServiceResolution: (input: EvidenceDomainHostServiceOptions) => {
      options = input
      return createInstalledDomainHostServiceResolution(input)
    },
    app: { isPackaged: packaged, getPath: () => root, getAppPath: () => root, once: vi.fn() },
    process: { env: {}, resourcesPath: join(root, 'resources') },
    store: { load: vi.fn(async () => ({ workspaceRoot: root, write: { workspaces: [] as string[] } })) },
    workspaceHostSessions: { list: () => [] },
    createWorkspaceAuthority,
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
  const service = new Function(...Object.keys(bindings), mode === 'development' ? compiled : installedCompiled)(...Object.values(bindings))
  if (!(service instanceof DevelopmentExternalPluginService)) throw new Error('Production plugin service was not composed.')
  services.push(service)
  if (!resolution || !readAgentSnapshot) throw new Error('Production Host services were not composed.')
  if (!options) throw new Error('Production Host service options were not composed.')
  return { root, options, resolution, readAgentSnapshot, contracts, service, agentRuntimeHostRef }
}

function request(operation: string, input: unknown, workspaceRoot: string, overrides: Partial<HostServiceRequest> = {}): HostServiceRequest {
  const identity = { pluginId: '@sciforge/plugin-evidence-dag', version: '1.0.0', profileId: workspaceRoot }
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
  const provider = resolver.resolve('@sciforge/plugin-evidence-dag', '1.0.0', 1)?.evidenceDagPorts
  if (!provider) throw new Error('Package-owned Host service was not resolved.')
  return async (operation: string, input: unknown, overrides: Partial<HostServiceRequest> = {}) => provider.operations[operation](request(operation, input, root, overrides))
}

describe('production development plugin composition', () => {
  it.each([
    ['development', false], ['development', true], ['installed', false], ['installed', true]
  ] as const)('composes real agentThreads and domain services in %s startup (packaged=%s)', async (mode, packaged) => {
    const f = await fixture(undefined, mode, packaged)
    const identity = { packageName: 'ordinary-consumer', version: '1.0.0', generation: 7 }
    const contract: PluginAdapterContract = {
      approved: true, hostApiRange: '^1', permissions: [],
      dshAuthorization: { packageName: identity.packageName, packageVersion: identity.version, dshRuntimeVersion: '0.2.0-rc.2', ports: ['agent-threads.read', 'artifacts.read'] }
    }
    f.contracts.set(`${identity.packageName}@${identity.version}`, contract)
    expect(f.resolution.resolveHostServiceProviders(identity.packageName, identity.version, identity.generation)).toMatchObject({
      'artifact-versions': { operations: { read: expect.any(Function) } },
      agentThreads: { operations: { read: expect.any(Function) } }
    })
    const client = f.resolution.resolveHostServiceClients(identity.packageName, identity.version, identity.generation).find(client => client.serviceId === 'agentThreads')
    expect(client).toEqual({
      serviceId: 'agentThreads', exportName: 'createHostServiceClient', config: { serviceId: 'agentThreads' },
      modulePath: packaged ? join(f.root, 'resources/extensions/host-service-client.mjs') : join(f.root, 'packages/plugin-sdk/src/host-service-client.mjs')
    })
    expect(f.resolution.hostServiceIds).toContain('agentThreads')
    const provider = f.resolution.resolveHostServiceProviders(identity.packageName, identity.version, identity.generation)!.agentThreads
    const base = request('read', {}, f.root)
    const req: HostServiceRequest = {
      ...base, serviceId: 'agentThreads', input: {},
      owner: { ...base.owner, ...identity, authority: { ...base.owner.authority, effect: 'read' } }
    }
    await expect(provider.operations.read(req)).rejects.toThrow('not ready for extension invocation')
    const snapshot: AgentRuntimeThreadSnapshot = {
      id: 'thread-1', runtimeId: 'codex', workspace: f.root, latestSeq: 41,
      title: 'Live thread', updatedAt: '2026-11-03T00:00:00Z',
      turns: [{ id: 'turn-1', threadId: 'thread-1', status: 'completed', items: [{ id: 'tool-1', kind: 'tool', detail: 'actual Host result', meta: { receipt: { exitCode: 0 } } }] }]
    }
    const readThreadSnapshot = vi.fn(async () => snapshot)
    f.agentRuntimeHostRef.current = { readThreadSnapshot }
    await expect(provider.operations.read(req)).resolves.toMatchObject({
      sessionId: 'thread-1', runtimeId: 'codex', workspaceRoot: canonicalWorkspacePath(f.root), watermark: '41', artifacts: snapshot.turns[0].items
    })
    expect(readThreadSnapshot).toHaveBeenCalledExactlyOnceWith({ runtimeId: 'codex', threadId: 'thread-1' })
    const getter = vi.spyOn(f.service, 'approvedHostServicePorts')
    f.contracts.set(`${identity.packageName}@${identity.version}`, { ...contract, approved: false })
    expect(f.resolution.resolveHostServiceProviders(identity.packageName, identity.version, identity.generation)).toBeUndefined()
    expect(f.resolution.resolveHostServiceClients(identity.packageName, identity.version, identity.generation)).toEqual([])
    await expect(provider.operations.read(req)).rejects.toThrow(/not authorized/)
    expect(getter).toHaveBeenCalledWith(identity.packageName, identity.version)
  })

  it.each([
    ['development', false], ['development', true], ['installed', false], ['installed', true]
  ] as const)('composes native clients with existing services in %s startup (packaged=%s)', async (mode, packaged) => {
    const f = await fixture(undefined, mode, packaged)
    const identity = { packageName: 'example-plugin', version: '1.0.0' }
    const contract = f.contracts.get('example-plugin@1.0.0')!
    f.contracts.set('example-plugin@1.0.0', {
      ...contract,
      dshAuthorization: { ...contract.dshAuthorization!, hostServices: ['nativeExecution'] }
    })
    const providers = f.resolution.resolveHostServiceProviders(identity.packageName, identity.version, 1)
    expect(providers).toHaveProperty('nativeExecution')
    expect(providers).toHaveProperty('visualCapture')
    expect(f.resolution.resolveHostServiceClients(identity.packageName, identity.version, 1)).toContainEqual(expect.objectContaining({
      serviceId: 'nativeExecution', exportName: 'createNativeExecutionClients',
      provides: ['workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'approval', 'commands'],
      modulePath: packaged ? join(f.root, 'resources/extensions/native-execution-client.mjs') : join(f.root, 'packages/plugin-sdk/src/native-execution-client.mjs')
    }))
    f.contracts.set('example-plugin@1.0.0', { ...contract, approved: false })
    expect(f.resolution.resolveHostServiceProviders(identity.packageName, identity.version, 1)).toBeUndefined()
    expect(f.resolution.resolveHostServiceClients(identity.packageName, identity.version, 1)).toEqual([])
  })

  it.each(['development', 'installed'] as const)('fences the %s production snapshot callback before and after the Host read', async mode => {
    const f = await fixture(undefined, mode)
    const controller = new AbortController()
    const snapshot: AgentRuntimeThreadSnapshot = { id: 'thread-1', runtimeId: 'codex', title: 'Cancelled session', updatedAt: '2026-11-03T00:00:00.000Z', turns: [], latestSeq: 0 }
    const readThreadSnapshot = vi.fn(async () => { controller.abort(new Error('cancelled in flight')); return snapshot })
    f.agentRuntimeHostRef.current = { readThreadSnapshot }
    await expect(f.readAgentSnapshot({ runtimeId: 'codex', threadId: 'thread-1', signal: controller.signal })).rejects.toThrow('cancelled in flight')
    expect(readThreadSnapshot).toHaveBeenCalledTimes(1)
    readThreadSnapshot.mockClear()
    await expect(f.readAgentSnapshot({ runtimeId: 'codex', threadId: 'thread-1', signal: controller.signal })).rejects.toThrow('cancelled in flight')
    expect(readThreadSnapshot).not.toHaveBeenCalled()
  })

  it('merges the controlled visual service with existing providers and rechecks exact approved grants', async () => {
    const { resolution, contracts } = await fixture()
    expect(resolution.hostServiceIds).toContain('visualCapture')
    expect(resolution.hostServiceIds).toContain('evidenceDagPorts')
    expect(resolution.resolveHostServiceProviders('example-plugin', '1.0.0', 1)?.visualCapture).toBeDefined()
    expect(resolution.resolveHostServiceClients('example-plugin', '1.0.0', 1)).toContainEqual(expect.objectContaining({
      serviceId: 'visualCapture', modulePath: expect.stringContaining(join('packages', 'plugin-sdk', 'src', 'host-service-client.mjs'))
    }))
    expect(resolution.resolveHostServiceProviders('example-plugin', '2.0.0', 1)).toBeUndefined()
    const contract = contracts.get('example-plugin@1.0.0')!
    contracts.set('example-plugin@1.0.0', { ...contract, approved: false })
    expect(resolution.resolveHostServiceProviders('example-plugin', '1.0.0', 1)).toBeUndefined()
  })

  it.each([false, true])('composes installed visual services with exact grants (packaged=%s)', async packaged => {
    const f = await fixture(undefined, 'installed', packaged)
    expect(f.resolution.hostServiceIds).toContain('visualCapture')
    expect(f.resolution.resolveHostServiceClients('example-plugin', '1.0.0', 1)).toContainEqual(expect.objectContaining({
      serviceId: 'visualCapture',
      modulePath: packaged ? join(f.root, 'resources/extensions/host-service-client.mjs') : join(f.root, 'packages/plugin-sdk/src/host-service-client.mjs')
    }))
    expect(f.resolution.resolveHostServiceClients('example-plugin', '2.0.0', 1)).toEqual([])
    const contract = f.contracts.get('example-plugin@1.0.0')!
    f.contracts.set('example-plugin@1.0.0', { ...contract, approved: false })
    expect(f.resolution.resolveHostServiceProviders('example-plugin', '1.0.0', 1)).toBeUndefined()
  })

  it('rejects duplicate Host service owners rather than replacing existing services', () => {
    const provider = { authorize: () => undefined, operations: { read: async () => ({}) } }
    const resolution = { hostServiceIds: ['neutral'], resolveHostServiceProviders: () => ({ neutral: provider }), resolveHostServiceClients: () => [] }
    expect(() => mergeHostServiceResolutions(resolution, resolution).resolveHostServiceProviders('example-plugin', '1.0.0', 1))
      .toThrow('Conflicting Host service provider: neutral')
  })

  it('does not admit ports from unapproved, foreign-package or mismatched-version contracts', () => {
    const contracts = new Map<string, PluginAdapterContract>()
    const ports = (packageName: string, version: string) => createReadGrantedHostServicePorts(() => contracts)({ packageName, version })
    const contract: PluginAdapterContract = { approved: true, hostApiRange: '^1.0.0', permissions: [],
      dshAuthorization: { packageName: 'neutral-plugin', packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2', ports: ['visual-capture.read'] } }
    contracts.set('neutral-plugin', contract)
    expect(ports('neutral-plugin', '1.0.0')).toEqual(['visual-capture.read'])
    expect(ports('neutral-plugin', '2.0.0')).toBeUndefined()
    contracts.set('neutral-plugin@1.0.0', { ...contract, approved: false })
    expect(ports('neutral-plugin', '1.0.0')).toBeUndefined()
    contracts.set('neutral-plugin@1.0.0', { ...contract, dshAuthorization: { ...contract.dshAuthorization!, packageName: 'foreign-plugin' } })
    expect(ports('neutral-plugin', '1.0.0')).toBeUndefined()
  })
  it('composes before Runtime Host publication and reads the published Host at invocation', async () => {
    const { root, options, agentRuntimeHostRef } = await fixture()
    const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: root }
    const context = { caller: {}, signal: new AbortController().signal, assertCurrent() {}, ordinarySession: { runtimeId: 'codex', threadId: 'thread-1' } }
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
    const context = { caller: {}, signal: abort.signal, assertCurrent() {}, ordinarySession: { runtimeId: 'codex', threadId: 'thread-1' } }
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
