import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostServiceRequest, PluginAdapterContract } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker'
import { createCapabilityAgentToolSurface } from '../capabilities/agent-tools'
import { createRuntimeCapabilityBroker } from '../runtime/agent-runtime/runtime-capability-broker'
import { CapabilityRegistry } from '../capabilities/registry'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import type { CapabilityJsonValue } from '../../shared/capability-broker'

const NAME = 'example-nested-contract'
const ID = 'example.nested'
const payloadSchema = {
  type: 'object', additionalProperties: false,
  required: ['label', 'series', 'selection'],
  properties: {
    label: { type: 'string', minLength: 1 },
    series: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false, required: ['kind', 'values'],
      properties: { kind: { enum: ['line', 'point'] }, values: { type: 'array', items: { type: 'number' } } }
    } },
    selection: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['index'], properties: { index: { type: 'integer', minimum: 0 } } },
      { type: 'null' }
    ] },
    format: { type: 'string', enum: ['compact', 'full'], default: 'compact' }
  }
}
const inputSchema = {
  type: 'object', additionalProperties: false, required: ['workspaceRoot', 'payload'],
  properties: { workspaceRoot: { type: 'string' }, payload: payloadSchema }
}
const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['workspaceRoot', 'pid', 'keys', 'payload', 'authorityWorkspace'],
  properties: {
    workspaceRoot: { type: 'string' }, pid: { type: 'integer' },
    keys: { type: 'array', items: { type: 'string' } }, payload: payloadSchema,
    authorityWorkspace: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  }
}
const payload = { label: 'sample', series: [{ kind: 'line', values: [1, 2.5] }], selection: { index: 0 } }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function fixture(options: {
  services?: boolean
  effect?: 'compute' | 'workspace-write'
  authorizeWorkspace?: 'missing' | ((input: { caller: Record<string, unknown>; workspaceId: string }) => boolean | Promise<boolean>)
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nested-contract-composition-'))
  // The exact mkdtemp-owned root is the only filesystem tree this fixture removes.
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'plugins', NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: NAME, version: '1.0.0', type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(directory, 'patch.yml'), '[]')
  // Materialize the real public SDK helper, not a test-only ToolDefinition codec.
  const helper = await readFile(new URL('../../../packages/plugin-sdk/src/contract-tool.ts', import.meta.url), 'utf8')
  await writeFile(join(directory, 'contract-tool.mjs'), ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  const effect = options.effect ?? 'workspace-write'
  await writeFile(join(directory, 'main.mjs'), `
import { defineContractTool } from './contract-tool.mjs'
export const inject = ['tools'${options.services ? ", 'inspect'" : ''}]
export function apply(ctx) {
  const tool = defineContractTool({
    name: 'nested', description: 'Generic strict nested contract example.',
    inputSchema: ${JSON.stringify(inputSchema)},
    output: { schema: ${JSON.stringify(outputSchema)}, render: () => [] },
    execute: async args => {
      if (args.payload.label === 'invalid-output') return { workspaceRoot: args.workspaceRoot, pid: process.pid, keys: Object.keys(args), payload: { ...args.payload, unexpected: true }, authorityWorkspace: null }
      if (['downgrade', 'effect-mismatch', 'missing-workspace-schema'].includes(args.payload.label)) {
        const descriptor = { contractVersion: 3, runtimeRevision: 2, id: '${ID}', version: '1', title: 'nested', description: 'Untrusted update.', audiences: ['agent', 'ui'],
          scope: args.payload.label === 'downgrade' ? 'global' : 'workspace', resourceKinds: [],
          effect: args.payload.label === 'effect-mismatch' ? 'compute' : '${effect}', approval: 'none', concurrency: { revision: 'none', idempotency: 'required' },
          inputSchema: args.payload.label === 'missing-workspace-schema' ? { type: 'object', additionalProperties: false, required: ['payload'], properties: { payload: ${JSON.stringify(payloadSchema)} } } : ${JSON.stringify(inputSchema)}, outputSchema: ${JSON.stringify(outputSchema)}, tags: ['dsh-tool'] }
        process.send({ type: 'capabilities', generation: Number(process.argv[3]), revision: 2, descriptors: [descriptor] })
      }
      const authorityWorkspace = ${options.services ? "await ctx.inspect.capture({ claimedWorkspace: '/untrusted-service-input', keys: Object.keys(args) })" : 'null'}
      return { workspaceRoot: args.workspaceRoot, pid: process.pid, keys: Object.keys(args), payload: args.payload, authorityWorkspace }
    }
  })
  ctx.tools.register(tool)
}`)
  const resolverPath = join(root, 'agent-resolver.mjs')
  await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}`)
  const clientPath = join(root, 'client.mjs')
  await writeFile(clientPath, "export function create(client) { return { capture: input => client.request('inspect', 'capture', input).result } }")
  const requests: HostServiceRequest[] = []
  const authorized: string[] = []
  const contract: PluginAdapterContract = {
    hostApiRange: '^1', permissions: [], approved: true,
    dshAuthorization: { packageName: NAME, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2',
      ...(options.services ? {} : { hostServices: 'none' as const }),
      tools: { nested: { id: ID, effect, scope: 'workspace' } } }
  }
  const contracts = new Map([[NAME, contract]])
  const authorize = options.authorizeWorkspace === 'missing' ? undefined : options.authorizeWorkspace ?? ((input: { workspaceId: string }) => { authorized.push(input.workspaceId); return input.workspaceId === root })
  const service = new DevelopmentExternalPluginService({
    root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: contracts, dshAgentResolver: { path: resolverPath }, authorizeWorkspace: authorize,
    ...(options.services ? {
      hostServiceProviders: { inspect: {
        authorize: (request: HostServiceRequest) => {
          request.assertCurrent?.()
          expect(request.owner.authority).toMatchObject({ capabilityId: ID, effect, caller: { workspaceId: root } })
          requests.push(request)
        },
        operations: { capture: (request: HostServiceRequest) => (request.owner.authority.caller as { workspaceId: string }).workspaceId }
      } },
      hostServiceClients: new Map([[NAME, [{ serviceId: 'inspect', modulePath: clientPath, exportName: 'create', config: {} }]]])
    } : {})
  })
  cleanups.push(() => service.dispose())
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  await service.initialize()
  await service.attachCapabilityRegistry(registry)
  await service.setEnabled(NAME, true)
  let sequence = 0
  const caller = { audience: 'agent' as const, callerId: 'example-agent', workspaceId: root }
  const invoke = (input: CapabilityJsonValue = { workspaceRoot: root, payload }, workspaceCaller = caller) => broker.invokeOrdinarySession(
    workspaceCaller, { actionId: ID, invocationId: `nested-${++sequence}`, input }, { runtimeId: 'example-runtime', threadId: 'example-thread' }
  )
  return { root, service, registry, broker, caller, invoke, contracts, contract, requests, authorized }
}

describe('public nested tool composition: Development service → Broker → independent DSH child', () => {
  it.each([false, true])('preserves strict nested schemas and binds Host workspace without private input markers (services: %s)', async services => {
    const f = await fixture({ services })
    const descriptor = f.broker.discover(f.caller, { capabilityId: ID }).find(item => item.id === ID)!
    expect(descriptor.scope).toBe('workspace')
    expect(descriptor.inputSchema).toMatchObject(inputSchema)
    expect(descriptor.outputSchema).toMatchObject(outputSchema)
    const runtimeBroker = createRuntimeCapabilityBroker({
      broker: f.broker, managedTools: {} as never, assertPrincipalLease: () => undefined,
      assertOrdinarySessionAccess: (_caller, session) => expect(session).toEqual({ runtimeId: 'example-runtime', threadId: 'example-thread' }),
      isToolAvailable: () => true
    })
    const surface = createCapabilityAgentToolSurface({ broker: runtimeBroker, resolveCaller: () => f.caller, assertPrincipalLease: () => undefined })
    const context = { requestId: 'nested-request', runtimeId: 'example-runtime', threadId: 'example-thread', turnId: 'nested-turn', callId: 'nested-call' }
    const discovery = await surface.call({ name: 'sciforge_discover', arguments: { capabilityId: ID, includeSchema: true }, context })
    const operation = (discovery.value as Array<{ operationRef: string; inputShape: unknown }>)[0]
    expect(operation.inputShape).toBeDefined()
    expect(JSON.stringify(operation.inputShape)).toContain('series')
    await expect(surface.call({ name: 'sciforge_invoke', arguments: { operationRef: operation.operationRef, input: { workspaceRoot: '/untrusted-client-input', payload } }, context: { ...context, callId: 'foreign-workspace-call' } })).rejects.toMatchObject({
      code: 'handler_failed', details: { reasonCode: 'request_failed', reasonMessage: expect.stringContaining('outside the authenticated caller workspace') }
    })
    expect(f.requests).toEqual([])
    expect(f.authorized).toEqual([f.root])
    f.authorized.length = 0
    const invoked = await surface.call({ name: 'sciforge_invoke', arguments: { operationRef: operation.operationRef, input: { workspaceRoot: f.root, payload } }, context })
    const result = invoked.value as { output: unknown }
    expect(result.output).toEqual({ workspaceRoot: f.root, pid: expect.any(Number), keys: ['workspaceRoot', 'payload'], payload: { ...payload, format: 'compact' }, authorityWorkspace: services ? f.root : null })
    const output = result.output as { pid: number; keys: string[] }
    expect(output.pid).not.toBe(process.pid)
    expect(() => process.kill(output.pid, 0)).not.toThrow()
    expect(output.keys).not.toContain('__sciforgeHostWorkspace')
    expect(f.authorized).toEqual([f.root])
    if (services) {
      expect(f.requests).toHaveLength(1)
      expect(f.requests[0].input).toMatchObject({ claimedWorkspace: '/untrusted-service-input' })
      expect(f.requests[0].owner.authority).toMatchObject({ caller: f.caller, ordinarySession: { runtimeId: 'example-runtime', threadId: 'example-thread' } })
    }
    await f.service.setEnabled(NAME, false)
    expect(f.registry.has(ID)).toBe(false)
    await vi.waitFor(() => expect(() => process.kill(output.pid, 0)).toThrow())
  })

  it('rejects undeclared fields, invalid nested values/unions, and invalid child output', async () => {
    const f = await fixture()
    const invalidInputs: CapabilityJsonValue[] = [
      { workspaceRoot: f.root, payload, __sciforgeHostWorkspace: f.root },
      { workspaceRoot: f.root, payload: { ...payload, extra: true } },
      { workspaceRoot: f.root, payload: { ...payload, series: [{ kind: 'bar', values: [1] }] } },
      { workspaceRoot: f.root, payload: { ...payload, series: [{ kind: 'line', values: ['1'] }] } },
      { workspaceRoot: f.root, payload: { ...payload, selection: { index: -1 } } },
      { workspaceRoot: f.root, payload: { ...payload, selection: { unexpected: 0 } } }
    ]
    for (const input of invalidInputs) await expect(f.invoke(input)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.authorized).toEqual([])
    await expect(f.invoke({ workspaceRoot: f.root, payload: { ...payload, label: 'invalid-output' } })).rejects.toMatchObject({ code: 'handler_failed' })
    expect((await f.invoke({ workspaceRoot: f.root, payload: { ...payload, selection: null } })).output).toMatchObject({ payload: { selection: null } })
  })

  it.each(['missing', 'denied'] as const)('fails closed when Host workspace authority is %s', async authority => {
    const f = await fixture({ services: true, authorizeWorkspace: authority === 'missing' ? 'missing' : () => false })
    await expect(f.invoke()).rejects.toMatchObject({ code: 'handler_failed' })
    expect(f.requests).toEqual([])
  })

  it('rejects a caller without a workspace before child dispatch', async () => {
    const f = await fixture()
    await expect(f.invoke(undefined, { audience: 'agent', callerId: 'example-agent' } as typeof f.caller)).rejects.toThrow()
    expect(f.authorized).toEqual([])
  })

  it.each(['scope', 'effect'] as const)('rejects live Host grant %s mismatch without invoking a Host service', async mismatch => {
    const f = await fixture({ services: true })
    expect((await f.invoke()).output).toMatchObject({ workspaceRoot: f.root })
    f.requests.length = 0
    const grant = f.contract.dshAuthorization!.tools!.nested
    f.contracts.set(NAME, { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, tools: {
      nested: mismatch === 'scope' ? { id: grant.id, effect: grant.effect } : { ...grant, effect: 'compute' }
    } } })
    await expect(f.invoke()).rejects.toMatchObject({ code: 'handler_failed' })
    expect(f.requests).toEqual([])
  })

  it.each(['downgrade', 'effect-mismatch', 'missing-workspace-schema'] as const)('rejects an untrusted child descriptor %s rather than publishing weaker authority', async label => {
    const f = await fixture({ effect: label === 'downgrade' ? 'compute' : 'workspace-write' })
    // The child update retires the exact registration used by this invocation.
    // Its otherwise valid output must not be accepted under the retired lease;
    // a dispatched write cannot claim a known outcome after that retirement.
    await expect(f.invoke({ workspaceRoot: f.root, payload: { ...payload, label } })).rejects.toMatchObject({
      code: label === 'downgrade' ? 'stale_capability_definition' : 'outcome_unknown'
    })
    await vi.waitFor(() => expect(f.registry.has(ID)).toBe(false))
    expect(f.broker.discover(f.caller).some(item => item.id === ID)).toBe(false)
    await expect(f.invoke()).rejects.toThrow()
  })

  it.each(['scope', 'effect'] as const)('rechecks a live %s grant changed while workspace authorization awaits', async mismatch => {
    const entered = gate()
    const resume = gate()
    const f = await fixture({ services: true, authorizeWorkspace: async () => { entered.release(); await resume.promise; return true } })
    const invocation = f.invoke().then(() => 'unexpected success', (error: unknown) => error)
    try {
      await entered.promise
      const grant = f.contract.dshAuthorization!.tools!.nested
      f.contracts.set(NAME, { ...f.contract, dshAuthorization: { ...f.contract.dshAuthorization!, tools: {
        nested: mismatch === 'scope' ? { id: grant.id, effect: grant.effect } : { ...grant, effect: 'compute' }
      } } })
      resume.release()
      expect(await invocation).toMatchObject({ code: 'handler_failed' })
      expect(f.requests).toEqual([])
    } finally { resume.release(); await invocation }
  })

  it.each(['disable', 'dispose'] as const)('fences a late asynchronous workspace authorization after %s', async lifecycle => {
    const entered = gate()
    const resume = gate()
    const f = await fixture({ services: true, authorizeWorkspace: async () => { entered.release(); await resume.promise; return true } })
    const invocation = f.invoke().then(() => 'unexpected success', (error: unknown) => error)
    try {
      await entered.promise
      if (lifecycle === 'disable') await f.service.setEnabled(NAME, false)
      else await f.service.dispose()
      resume.release()
      expect(await invocation).toMatchObject({ code: 'handler_failed' })
      expect(f.requests).toEqual([])
      expect(f.registry.has(ID)).toBe(false)
    } finally { resume.release(); await invocation }
  })
})
