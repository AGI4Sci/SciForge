import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { CapabilityRegistry } from '../capabilities/registry'
import { CapabilityBroker } from '../capabilities/broker'
import { createCapabilityEvalFaultBroker } from '../capability-eval/provider-fault-harness'
import { createRuntimeCapabilityBroker } from '../runtime/agent-runtime/runtime-capability-broker'
import { createCapabilityAgentToolSurface, type CapabilityAgentToolRequestContext } from '../capabilities/agent-tools'

/**
 * BUG-025 regression: the whole Desktop discover chain, not `new
 * CapabilityRegistry()` or a typed registry. Verifies that a plugin's typed
 * contribution, registered into the application registry, is actually visible
 * through `runtimeCapabilityBroker -> createCapabilityAgentToolSurface ->
 * sciforge_discover -> sciforge_invoke` (the path the real Agent uses).
 */
const directory = resolve('test-fixtures/migration-plugins')
const temporaryDirectories: string[] = []

const context: CapabilityAgentToolRequestContext = {
  requestId: 'req-1',
  runtimeId: 'rt-1',
  threadId: 'th-1',
  turnId: 'tn-1',
  callId: 'c-1'
}

async function createService() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'sciforge-chain-'))
  temporaryDirectories.push(userDataPath)
  const service = new DevelopmentExternalPluginService({
    root: directory,
    userDataPath,
    hostApiVersion: '1.11.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([
      ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p3-mcp-bridge', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p4-agent-teams', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
    ]),
    allowedPermissionIds: new Set()
  })
  await service.initialize()
  return service
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function buildAgentSurface(registry: CapabilityRegistry) {
  const capabilityBroker = new CapabilityBroker(registry)
  const faultBroker = createCapabilityEvalFaultBroker(capabilityBroker, { rules: [] } as never)
  const runtimeBroker = createRuntimeCapabilityBroker({
    broker: faultBroker,
    managedTools: {} as never,
    assertPrincipalLease: () => undefined,
    assertOrdinarySessionAccess: (caller, session, originalContext) => {
      expect(caller.audience).toBe('agent')
      expect(caller.callerId).toBe('agent-chain-smoke')
      expect(session).toEqual({ runtimeId: context.runtimeId, threadId: context.threadId })
      expect(originalContext).toEqual(context)
      expect(originalContext).not.toBe(context)
    },
    isToolAvailable: () => true
  })
  return createCapabilityAgentToolSurface({
    broker: runtimeBroker,
    resolveCaller: () => ({ audience: 'agent', callerId: 'agent-chain-smoke' }),
    assertPrincipalLease: () => undefined
  })
}

describe('desktop Broker discover chain (BUG-025)', () => {
  it('reaches P4 workflow operations through the full agent discover/invoke chain', async () => {
    const service = await createService()
    const applicationCapabilityRegistry = new CapabilityRegistry()
    service.attachCapabilityRegistry(applicationCapabilityRegistry)
    await service.setEnabled('@sciforge/migration-p4-agent-teams', true)

    const surface = buildAgentSurface(applicationCapabilityRegistry)

    const discover = await surface.call({
      name: 'sciforge_discover',
      arguments: { capabilityId: 'agent-teams-fixture.start' },
      context
    })
    expect(discover.tool).toBe('sciforge_discover')
    const descriptor = (discover as { tool: 'sciforge_discover'; value: Array<{ operationRef: string; title: string }> }).value[0]
    expect(descriptor.title).toContain('agent-teams')

    const invoked = await surface.call({
      name: 'sciforge_invoke',
      arguments: { operationRef: descriptor.operationRef, input: { teamId: 'p4-test' } },
      context
    })
    const output = (invoked.value as unknown as { output: { teamId: string; revision: number } }).output
    expect(output.teamId).toBe('p4-test')
    expect(output.revision).toBe(0)

    await service.dispose()
  })

  it('reaches P3 managed-runtime fixtures and P2 renderer status through the chain', async () => {
    const service = await createService()
    const applicationCapabilityRegistry = new CapabilityRegistry()
    service.attachCapabilityRegistry(applicationCapabilityRegistry)
    await service.setEnabled('@sciforge/migration-p3-mcp-bridge', true)
    await service.setEnabled('@sciforge/migration-p2-better-sidebar', true)

    const surface = buildAgentSurface(applicationCapabilityRegistry)

    // P3: managed-runtime fixture discoverable via managed tags, native family
    const p3Discover = await surface.call({
      name: 'sciforge_discover',
      arguments: { tags: ['managed-mcp', 'local-fixture'] },
      context
    })
    const p3Ids = (p3Discover.value as Array<{ title: string; tags: string[] }>).map(({ title }) => title)
    expect(p3Ids.join(' ')).toMatch(/fixture_echo/)

    // P2: renderer status discoverable via renderer tags
    const p2Discover = await surface.call({
      name: 'sciforge_discover',
      arguments: { tags: ['renderer', 'ui-contribution'] },
      context
    })
    const p2Titles = (p2Discover.value as Array<{ title: string }>).map(({ title }) => title)
    expect(p2Titles.join(' ')).toMatch(/status/)

    await service.dispose()
  })
})
