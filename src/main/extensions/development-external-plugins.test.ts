import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { CapabilityRegistry } from '../capabilities/registry'
import { domainExtensionListResultSchema } from '../ipc/app-ipc-schemas'

const temporaryDirectories: string[] = []
const root = resolve('test-fixtures/migration-plugins')
const candidateRoot = join(root, '.candidates')

async function createCandidate(fixture: string, prefix: string): Promise<string> {
  await mkdir(candidateRoot, { recursive: true })
  const candidate = await mkdtemp(join(candidateRoot, prefix))
  temporaryDirectories.push(candidate)
  await cp(resolve(`test-fixtures/migration-plugins/${fixture}`), candidate, { recursive: true })
  return candidate
}

async function createService(): Promise<DevelopmentExternalPluginService> {
  const userDataPath = await mkdtemp(join(tmpdir(), 'sciforge-pr1-external-'))
  temporaryDirectories.push(userDataPath)
  const service = new DevelopmentExternalPluginService({
    root,
    userDataPath,
    hostApiVersion: '1.11.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([
      ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p3-mcp-bridge', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p4-agent-teams', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/pr1-incompatible-fixture', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/pr1-activation-failure-fixture', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p5-ws-scope', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
    ]),
    allowedPermissionIds: new Set()
  })
  await service.initialize()
  return service
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('development external plugin service', () => {
  it('projects DSH package names into IPC-safe module and publisher IDs', async () => {
    const service = await createService()
    const summaries = await service.list()
    expect(() => domainExtensionListResultSchema.parse(summaries)).not.toThrow()
    await service.dispose()
  })

  it('projects compatibility and fails closed on activation errors', async () => {
    const service = await createService()
    const initial = await service.list()
    expect(initial.find(({ packageName }) => packageName === '@sciforge/pr1-incompatible-fixture')).toMatchObject({
      status: 'invalid',
      activationState: 'discovered'
    })
    await expect(service.setEnabled('@sciforge/pr1-incompatible-fixture', true)).rejects.toThrow('requires DSH runtime')
    await expect(service.setEnabled('@sciforge/pr1-activation-failure-fixture', true)).rejects.toThrow('activation failed')
    expect((await service.list()).find(({ packageName }) =>
      packageName === '@sciforge/pr1-activation-failure-fixture')).toMatchObject({
        status: 'invalid',
        activationState: 'failed'
      })
    await service.dispose()
  })

  it('persists enabled intent and reactivates after restart', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'sciforge-pr1-restart-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
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
    const first = await create()
    expect(await first.setEnabled('@sciforge/migration-p1-unitverse', true)).toMatchObject({
      status: 'active',
      activationState: 'active'
    })
    await first.dispose()

    const restarted = await create()
    const registry = new CapabilityRegistry()
    await restarted.attachCapabilityRegistry(registry)
    expect((await restarted.list()).find(({ packageName }) =>
      packageName === '@sciforge/migration-p1-unitverse')).toMatchObject({
      status: 'active',
      activationState: 'active'
    })
    expect(registry.discover(
      { audience: 'agent', callerId: 'startup-smoke' },
      { text: 'unitverse' }
    ).map(({ id }) => id)).toContain('unitverse.convert')
    expect(await restarted.setEnabled('@sciforge/migration-p1-unitverse', false)).toMatchObject({
      status: 'disabled',
      activationState: 'disposed'
    })
    await restarted.dispose()
  })

  it('registers and unregisters a P1 capability through the dynamic host boundary', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    expect(registry.has('unitverse.convert')).toBe(false)
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)
    const definition = registry.require('unitverse.convert')
    const result = await definition.handler(
      { value: 5, from: 'ft', to: 'cm' },
      {} as never
    )
    expect(result.output).toMatchObject({ result: 152.4 })
    await service.setEnabled('@sciforge/migration-p1-unitverse', false)
    expect(registry.has('unitverse.convert')).toBe(false)
    await service.dispose()
  })

  it('binds a workspace-scoped extension input to the caller workspace', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p5-ws-scope', true)
    const definition = registry.require('fixture.ws.echo')
    const caller = { caller: { workspaceId: '/caller/workspace' } } as never
    const rebound = await definition.handler({ workspaceRoot: '/foreign/path' }, caller)
    expect(rebound.output).toEqual({ workspaceRoot: '/caller/workspace' })
    const matching = await definition.handler({ workspaceRoot: '/caller/workspace' }, caller)
    expect(matching.output).toEqual({ workspaceRoot: '/caller/workspace' })
    await service.setEnabled('@sciforge/migration-p5-ws-scope', false)
    await service.dispose()
  })

  it('registers typed P2/P3/P4 adapters and keeps each discover contract separate', async () => {
    const service = await createService()
    await service.setEnabled('@sciforge/migration-p2-better-sidebar', true)
    await service.setEnabled('@sciforge/migration-p3-mcp-bridge', true)
    await service.setEnabled('@sciforge/migration-p4-agent-teams', true)

    expect(service.rendererContributions().map(({ id }) => id)).toContain('better-sidebar.workbench-right-panel')
    const managed = service.managedRuntimeContributions()[0]
    expect(await managed.discover()).toEqual(['fixture_echo', 'fixture_delayed_echo', 'fixture_bounded_output'])
    expect(await managed.invoke('fixture_echo', { message: 'hello-p3' })).toEqual({ text: 'hello-p3' })
    const workflow = service.workflowContributions()[0]
    const initial = await workflow.start({ teamId: 'startup-p4' }) as { revision: number }
    expect(initial.revision).toBe(0)
    expect((await workflow.status({ teamId: 'startup-p4' }) as { teamId: string }).teamId).toBe('startup-p4')
    await workflow.cancel({ teamId: 'startup-p4', expectedRevision: 0 })
    await service.dispose()
  })

  it('publishes the active P2 iframe entry and updates it on a live candidate apply', async () => {
    const service = await createService()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    const pkg = '@sciforge/migration-p2-better-sidebar'
    await service.setEnabled(pkg, true)
    const initial = await service.rendererContributionDescriptors()
    expect(initial).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pluginId: pkg,
        contributionId: 'better-sidebar.workbench-right-panel',
        generation: expect.any(Number),
        version: '0.1.0',
        entryUrl: expect.stringMatching(/^sciforge-plugin:\/\/ui\//),
        stateVersion: 1
      })
    ]))
    const original = initial.find(({ pluginId }) => pluginId === pkg)!
    const oldAsset = { pluginId: pkg, generation: original.generation, path: 'dist/renderer.html' }
    const initialFile = await service.rendererAssetPath(oldAsset)
    expect(await readFile(initialFile!, 'utf8')).toContain('Better Sidebar')
    expect(await service.rendererAssetPath({ ...oldAsset, path: 'package.json' })).toBeUndefined()
    expect(await service.rendererAssetPath({ ...oldAsset, path: '../package.json' })).toBeUndefined()
    expect(await service.rendererAssetPath({ ...oldAsset, pluginId: '@unknown/ui' })).toBeUndefined()

    const candidate = await createCandidate('p2-better-sidebar', 'p2-ui-live-')
    const packagePath = join(candidate, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.2.0'
    await writeFile(packagePath, JSON.stringify(manifest))
    await writeFile(join(candidate, 'dist', 'renderer.html'), '<!doctype html><html><body>Better Sidebar v2</body></html>')
    await service.checkCandidate(pkg, candidate)
    await service.applyCandidate(pkg)

    const updated = await service.rendererContributionDescriptors()
    expect(updated).toEqual(expect.arrayContaining([
      expect.objectContaining({ pluginId: pkg, version: '0.2.0', entryUrl: expect.stringMatching(/^sciforge-plugin:\/\/ui\//) })
    ]))
    expect(updated.find(({ pluginId }) => pluginId === pkg)?.generation)
      .toBeGreaterThan(initial.find(({ pluginId }) => pluginId === pkg)?.generation ?? 0)
    expect(await service.rendererAssetPath(oldAsset)).toBeUndefined()
    const updatedAsset = { ...oldAsset, generation: updated.find(({ pluginId }) => pluginId === pkg)!.generation }
    expect(await readFile((await service.rendererAssetPath(updatedAsset))!, 'utf8')).toContain('Better Sidebar v2')
    await service.rollback(pkg)
    const rolledBack = (await service.rendererContributionDescriptors()).find(({ pluginId }) => pluginId === pkg)!
    expect(await readFile((await service.rendererAssetPath({ ...oldAsset, generation: rolledBack.generation }))!, 'utf8')).toContain('Ping host')
    expect(await service.rendererAssetPath(updatedAsset)).toBeUndefined()
    await service.setEnabled(pkg, false)
    expect(await service.rendererAssetPath({ ...oldAsset, generation: rolledBack.generation })).toBeUndefined()
    await service.dispose()
  })

  it('registers P4 workflow operations into the Broker and keeps dispose host-controlled', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p4-agent-teams', true)

    expect(registry.has('agent-teams-fixture.start')).toBe(true)
    expect(registry.has('agent-teams-fixture.status')).toBe(true)
    expect(registry.has('agent-teams-fixture.advance')).toBe(true)
    expect(registry.has('agent-teams-fixture.cancel')).toBe(true)
    expect(registry.has('agent-teams-fixture.dispose')).toBe(true)

    const discovered = registry.discover({ audience: 'agent', callerId: 'workflow-smoke' }, { tags: ['workflow'] })
    const ids = discovered.map(({ id }) => id)
    expect(ids).toContain('agent-teams-fixture.start')
    expect(ids).toContain('agent-teams-fixture.advance')

    // dispose is not invokable from an ordinary agent audience (fail-closed)
    const dispose = registry.require('agent-teams-fixture.dispose')
    await expect(dispose.handler(
      {},
      { caller: { audience: 'agent', callerId: 'agent-caller' } } as never,
    )).rejects.toThrow(/host-controlled/i)

    await service.dispose()
  })

  it('executes the P4 workflow lifecycle and fails closed on stale/cancelled paths', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p4-agent-teams', true)

    const start = registry.require('agent-teams-fixture.start')
    const advance = registry.require('agent-teams-fixture.advance')
    const status = registry.require('agent-teams-fixture.status')
    const cancel = registry.require('agent-teams-fixture.cancel')
    const callerAgent = { caller: { audience: 'agent', callerId: 'agent-caller' } } as never
    type WorkflowResult = { output: { revision: number; teamId: string; status?: string; tasks?: Array<{ id: string; status: string }> } }

    // success path: start → status → advance → status
    let result = await start.handler({ teamId: 'p4-test' }, callerAgent) as WorkflowResult
    expect(result.output.revision).toBe(0)
    expect(result.output.teamId).toBe('p4-test')
    result = await advance.handler({ teamId: 'p4-test', expectedRevision: 0 }, callerAgent) as typeof result
    expect(result.output.revision).toBe(1)
    result = await status.handler({ teamId: 'p4-test' }, callerAgent) as typeof result
    expect(result.output.teamId).toBe('p4-test')

    // cancel path
    await start.handler({ teamId: 'p4-cancel' }, callerAgent)
    result = await cancel.handler({ teamId: 'p4-cancel', expectedRevision: 0 }, callerAgent) as typeof result
    expect(result.output.status).toBe('cancelled')

    // injected failure path: prepare fails, synthesize stays blocked, downstream not scheduled
    await start.handler({ teamId: 'p4-fail', failTaskId: 'fixture.prepare' }, callerAgent)
    result = await advance.handler({ teamId: 'p4-fail', expectedRevision: 0 }, callerAgent) as typeof result
    expect(result.output.status).toBe('failed')
    expect(result.output.tasks?.find((t: { id: string }) => t.id === 'fixture.prepare')?.status).toBe('failed')
    expect(result.output.tasks?.find((t: { id: string }) => t.id === 'fixture.synthesize')?.status).toBe('blocked')

    // stale revision is fail-closed
    await expect(advance.handler({ teamId: 'p4-cancel', expectedRevision: 99 }, callerAgent)).rejects.toThrow()

    await service.dispose()
  })

  it('hot-replaces P1 to a staged version without restarting the host', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)

    const pkg = '@sciforge/migration-p1-unitverse'
    const beforeSummary = (await service.list()).find(({ packageName }) => packageName === pkg)!

    const candidate = await createCandidate('p1-unitverse', 'p1-candidate-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.1.1'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

    const after = await service.replacePlugin('@sciforge/migration-p1-unitverse', candidate)
    expect(after.version).toBe('0.1.1')
    expect(after.generation).toBeGreaterThan(beforeSummary.generation ?? 0)
    expect(after.canRollback).toBe(true)
    expect(after.status).toBe('active')

    // new generation still serves unitverse.convert (152.4 cm)
    const definition = registry.require('unitverse.convert')
    const result = await definition.handler({ value: 5, from: 'ft', to: 'cm' }, {} as never)
    expect(result.output).toMatchObject({ result: 152.4 })

    await service.dispose()
  })

  it('keeps the previous version and reports invalid when candidate hot-replacement fails', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)

    const pkg = '@sciforge/migration-p1-unitverse'
    const candidate = await createCandidate('p1-unitverse', 'p1-bad-candidate-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.1.2'
    // Entry exists (passes identity+entry validation) but its activate() throws:
    // exercises the apply-time rollback (previous kept + invalid), not the check-time reject.
    candidatePkg.exports = { '.': './bad.mjs' }
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))
    await writeFile(join(candidate, 'bad.mjs'), "export function activate(){ throw new Error('candidate activation boom') }\n")

    await expect(service.replacePlugin('@sciforge/migration-p1-unitverse', candidate)).rejects.toThrow()

    const summary = (await service.list()).find(({ packageName }) => packageName === pkg)!
    // fail-closed: previous effective version retained, status invalid + diagnostic
    expect(summary.version).toBe('0.1.0')
    expect(summary.status).toBe('invalid')
    expect(summary.diagnostic).toBeTruthy()

    // the OLD capability still serves unitverse.convert (rollback kept old runtime + contributions live)
    const definition = registry.require('unitverse.convert')
    const result = await definition.handler({ value: 5, from: 'ft', to: 'cm' }, {} as never)
    expect(result.output).toMatchObject({ result: 152.4 })

    await service.dispose()
  })

  it('keeps a checked candidate across a host restart without auto-applying it', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-cand-restart-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }
    const pkg = '@sciforge/migration-p1-unitverse'

    const first = await create()
    await first.setEnabled(pkg, true)
    const candidate = await createCandidate('p1-unitverse', 'p1-cand-keep-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.3.0'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))
    await first.checkCandidate(pkg, candidate)
    expect((await first.list()).find(({ packageName }) => packageName === pkg)!.candidateVersion).toBe('0.3.0')
    await first.dispose()

    // candidate is NOT auto-applied on restart — it remains a pending checked candidate.
    const second = await create()
    const summary = (await second.list()).find(({ packageName }) => packageName === pkg)!
    expect(summary.candidateVersion).toBe('0.3.0')
    expect(summary.version).toBe('0.1.0')          // running version unchanged
    expect(summary.restartRequired).toBe(false)
    await second.dispose()
  })

  it('rejects a checked candidate whose staged bytes changed across a host restart', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-cand-integrity-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }
    const pkg = '@sciforge/migration-p1-unitverse'
    const first = await create()
    await first.attachCapabilityRegistry(new CapabilityRegistry())
    await first.setEnabled(pkg, true)
    const candidate = await createCandidate('p1-unitverse', 'p1-integrity-cand-')
    const manifestPath = join(candidate, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = '0.6.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await first.checkCandidate(pkg, candidate)
    const statePath = join(userDataPath, 'extensions', 'development-external-state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      candidates: Record<string, { stagedDirectory: string; integrity: string }>
    }
    const persisted = state.candidates[pkg]
    expect(persisted.integrity).toMatch(/^sha256-[0-9a-f]{64}$/u)
    await first.dispose()

    await writeFile(join(persisted.stagedDirectory, 'dist', 'main.js'), 'export function activate() { return undefined }\n')

    const restarted = await create()
    await restarted.attachCapabilityRegistry(new CapabilityRegistry())
    await expect(restarted.applyCandidate(pkg)).rejects.toThrow(/integrity changed/i)
    expect((await restarted.list()).find(({ packageName }) => packageName === pkg)).toMatchObject({
      version: '0.1.0',
      candidateVersion: '0.6.0'
    })
    await restarted.dispose()
  })

  it('does not apply a checked candidate after the plugin is disabled', async () => {
    const service = await createService()
    service.attachCapabilityRegistry(new CapabilityRegistry())
    const pkg = '@sciforge/migration-p1-unitverse'
    await service.setEnabled(pkg, true)
    const candidate = await createCandidate('p1-unitverse', 'p1-disabled-cand-')
    const manifestPath = join(candidate, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = '0.7.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await service.checkCandidate(pkg, candidate)
    await service.setEnabled(pkg, false)
    await expect(service.applyCandidate(pkg)).rejects.toThrow(/not enabled and active/i)
    expect((await service.list()).find(({ packageName }) => packageName === pkg)).toMatchObject({
      status: 'disabled',
      candidateVersion: '0.7.0'
    })
    await service.dispose()
  })

  it('does not resurrect an applied or cancelled candidate after a host restart', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-noresurrect-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }
    const pkg = '@sciforge/migration-p1-unitverse'
    const stageCandidate = async (version: string) => {
      const candidate = await createCandidate('p1-unitverse', `p1-nr-${version}-`)
      const candidatePkgPath = join(candidate, 'package.json')
      const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
      candidatePkg.version = version
      await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))
      return candidate
    }

    // apply one candidate, cancel another, then restart
    const first = await create()
    await first.setEnabled(pkg, true)
    const appliedCandidate = await stageCandidate('0.4.0')
    await first.checkCandidate(pkg, appliedCandidate)
    await first.applyCandidate(pkg)
    const cancelledCandidate = await stageCandidate('0.5.0')
    await first.checkCandidate(pkg, cancelledCandidate)
    await first.cancelCandidate(pkg)
    await first.dispose()

    const second = await create()
    const summary = (await second.list()).find(({ packageName }) => packageName === pkg)!
    expect(summary.version).toBe('0.4.0')           // applied one stuck
    expect(summary.candidateVersion).toBeUndefined() // cancelled one not resurrected
    expect(summary.restartRequired).toBe(false)
    await second.dispose()
  })

  it('rejects a plugin whose adapter declares an unapproved permission', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-perm-'))
    temporaryDirectories.push(userDataPath)
    const service = new DevelopmentExternalPluginService({
      root,
      userDataPath,
      hostApiVersion: '1.11.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: new Map([
        ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: ['northstar.write'], approved: true }]
      ]),
      allowedPermissionIds: new Set(['northstar.read'])   // northstar.write not approved
    })
    await service.initialize()
    // new unapproved permission blocks enable/activate at the permission gateway.
    await expect(service.setEnabled('@sciforge/migration-p1-unitverse', true))
      .rejects.toThrow(/not approved/i)
    await service.dispose()
  })

  it('flags workflow plugins as restart-required rather than draining in-flight tasks', async () => {
    const service = await createService()
    service.attachCapabilityRegistry(new CapabilityRegistry())
    await service.setEnabled('@sciforge/migration-p4-agent-teams', true)

    const pkg = '@sciforge/migration-p4-agent-teams'
    const candidate = await createCandidate('p4-agent-teams', 'p4-candidate-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.2.0'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

    const summary = await service.replacePlugin('@sciforge/migration-p4-agent-teams', candidate)
    expect(summary.status).toBe('restart-required')
    expect(summary.restartRequired).toBe(true)
    // version always reflects the currently RUNNING version; the candidate is separate.
    expect(summary.version).toBe('0.1.0')
    expect(summary.candidateVersion).toBe('0.2.0')

    await service.dispose()
  })

  it('stages, applies and cancels a candidate through the host-controlled API', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)
    const pkg = '@sciforge/migration-p1-unitverse'

    const candidate = await createCandidate('p1-unitverse', 'p1-candapi-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.1.1'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

    const checked = await service.checkCandidate(pkg, candidate)
    expect(checked.candidateVersion).toBe('0.1.1')
    expect(checked.status).toBe('active')       // checked, not applied
    expect(checked.version).toBe('0.1.0')

    const applied = await service.applyCandidate(pkg)
    expect(applied.version).toBe('0.1.1')
    expect(applied.generation).toBeGreaterThan(checked.generation ?? 0)
    expect(applied.candidateVersion).toBeUndefined()

    // A fresh check must have a different version from the now-active candidate.
    const nextCandidate = await createCandidate('p1-unitverse', 'p1-cancelapi-')
    const nextManifest = JSON.parse(await readFile(join(nextCandidate, 'package.json'), 'utf8'))
    nextManifest.version = '0.1.2'
    await writeFile(join(nextCandidate, 'package.json'), JSON.stringify(nextManifest))
    await service.checkCandidate(pkg, nextCandidate)
    const cancelled = await service.cancelCandidate(pkg)
    expect(cancelled.candidateVersion).toBeUndefined()

    await service.dispose()
  })

  it('hot-swaps P2 UI candidates while keeping P3/P4 restart-required', async () => {
    const service = await createService()
    service.attachCapabilityRegistry(new CapabilityRegistry())
    for (const pkg of [
      '@sciforge/migration-p2-better-sidebar',
      '@sciforge/migration-p3-mcp-bridge',
      '@sciforge/migration-p4-agent-teams'
    ]) {
      await service.setEnabled(pkg, true)
      const fixtureDir = pkg.endsWith('p2-better-sidebar') ? 'p2-better-sidebar'
        : pkg.endsWith('p3-mcp-bridge') ? 'p3-mcp-bridge' : 'p4-agent-teams'
      const candidate = await createCandidate(fixtureDir, 'candidate-')
      const candidatePkgPath = join(candidate, 'package.json')
      const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
      candidatePkg.version = '0.2.0'
      await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

      await service.checkCandidate(pkg, candidate)
      const applied = await service.applyCandidate(pkg)
      if (pkg.endsWith('p2-better-sidebar')) {
        expect(applied.status).toBe('active')
        expect(applied.version).toBe('0.2.0')
        expect(applied.candidateVersion).toBeUndefined()
        expect(applied.restartRequired).toBe(false)
      } else {
        expect(applied.status).toBe('restart-required')
        expect(applied.version).toBe('0.1.0')
        expect(applied.candidateVersion).toBe('0.2.0')
        expect(applied.restartRequired).toBe(true)
      }
    }
    await service.dispose()
  })

  it('recovers the active pointer after a host restart', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-recovery-'))
    temporaryDirectories.push(userDataPath)
    const create = async (version: string) => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }

    const first = await create('0.1.0')
    const registry = new CapabilityRegistry()
    first.attachCapabilityRegistry(registry)
    await first.setEnabled('@sciforge/migration-p1-unitverse', true)

    const candidate = await createCandidate('p1-unitverse', 'p1-recovery-cand-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.1.1'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

    await first.checkCandidate('@sciforge/migration-p1-unitverse', candidate)
    const applied = await first.applyCandidate('@sciforge/migration-p1-unitverse')
    expect(applied.version).toBe('0.1.1')
    await first.dispose()

    const second = await create('0.1.0')
    const recovered = (await second.list()).find(({ packageName }) =>
      packageName === '@sciforge/migration-p1-unitverse')
    expect(recovered?.version).toBe('0.1.1')
    await second.dispose()
  })

  it('rejects a cross-plugin candidate and writes no candidate/pending state', async () => {
    const service = await createService()
    service.attachCapabilityRegistry(new CapabilityRegistry())
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)

    // Copy a DIFFERENT plugin (p2) as the candidate dir for p1 -> identity mismatch.
    const wrong = await createCandidate('p2-better-sidebar', 'p1-wrong-candidate-')
    const wrongPkgPath = join(wrong, 'package.json')
    const wrongPkg = JSON.parse(await readFile(wrongPkgPath, 'utf8'))
    wrongPkg.version = '9.9.9'
    await writeFile(wrongPkgPath, JSON.stringify(wrongPkg))

    await expect(service.checkCandidate('@sciforge/migration-p1-unitverse', wrong)).rejects.toThrow(/identity mismatch/i)

    const summary = (await service.list()).find(({ packageName }) =>
      packageName === '@sciforge/migration-p1-unitverse')!
    expect(summary.candidateVersion).toBeUndefined()
    expect(summary.restartRequired).toBe(false)
    expect(summary.version).toBe('0.1.0')

    await service.dispose()
  })

  it('rejects candidates failing safety validation and writes nothing', async () => {
    const service = await createService()
    service.attachCapabilityRegistry(new CapabilityRegistry())
    await service.setEnabled('@sciforge/migration-p1-unitverse', true)
    const pkg = '@sciforge/migration-p1-unitverse'

    // directory not found
    await expect(service.checkCandidate(pkg, '/nonexistent-candidate-dir-xyz')).rejects.toThrow(/not found/i)

    // Host API incompatible (DSH runtime engine outside the supported range)
    const badApi = await createCandidate('p1-unitverse', 'p1-badapi-')
    const badApiPkgPath = join(badApi, 'package.json')
    const badApiPkg = JSON.parse(await readFile(badApiPkgPath, 'utf8'))
    badApiPkg.engines = { dsh: '>=999.0.0' }
    await writeFile(badApiPkgPath, JSON.stringify(badApiPkg))
    await expect(service.checkCandidate(pkg, badApi)).rejects.toThrow(/Host API incompatible/i)

    // missing entrypoint
    const noEntry = await createCandidate('p1-unitverse', 'p1-noentry-')
    const noEntryPkgPath = join(noEntry, 'package.json')
    const noEntryPkg = JSON.parse(await readFile(noEntryPkgPath, 'utf8'))
    delete noEntryPkg.exports
    delete noEntryPkg.main
    await writeFile(noEntryPkgPath, JSON.stringify(noEntryPkg))
    await expect(service.checkCandidate(pkg, noEntry)).rejects.toThrow(/no DSH main entrypoint/i)

    // entry escapes its directory (relative path escape)
    const escapeDir = await createCandidate('p1-unitverse', 'p1-escape-')
    const outside = join(tmpdir(), `p1-outside-${Date.now()}.js`)
    await writeFile(outside, 'export function activate(){}\n')
    const escapePkgPath = join(escapeDir, 'package.json')
    const escapePkg = JSON.parse(await readFile(escapePkgPath, 'utf8'))
    escapePkg.exports = { '.': relative(escapeDir, outside) }
    await writeFile(escapePkgPath, JSON.stringify(escapePkg))
    await expect(service.checkCandidate(pkg, escapeDir)).rejects.toThrow(/escapes|entry not found/i)

    // nothing was written
    const summary = (await service.list()).find(({ packageName }) => packageName === pkg)!
    expect(summary.candidateVersion).toBeUndefined()

    await service.dispose()
  })

  it('applies a P2 UI candidate without restarting the host', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-restart-apply-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }

    const pkg = '@sciforge/migration-p2-better-sidebar'
    const first = await create()
    await first.attachCapabilityRegistry(new CapabilityRegistry())
    await first.setEnabled(pkg, true)

    const candidate = await createCandidate('p2-better-sidebar', 'p2-cand-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.2.0'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))

    await first.checkCandidate(pkg, candidate)
    const applied = await first.applyCandidate(pkg)
    expect(applied.status).toBe('active')
    expect(applied.version).toBe('0.2.0')
    expect(applied.restartRequired).toBe(false)
    await first.dispose()
  })

  it('rolls back a development plugin through its own version store/coordinator', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    service.attachCapabilityRegistry(registry)
    const pkg = '@sciforge/migration-p1-unitverse'
    await service.setEnabled(pkg, true)

    // no real previous version yet -> canRollback false + rollback throws
    const initial = (await service.list()).find(({ packageName }) => packageName === pkg)!
    expect(initial.canRollback).toBe(false)
    await expect(service.rollback(pkg)).rejects.toThrow(/no previous/i)

    const candidate = await createCandidate('p1-unitverse', 'p1-rollback-cand-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '0.1.1'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))
    await service.checkCandidate(pkg, candidate)
    const applied = await service.applyCandidate(pkg)
    expect(applied.version).toBe('0.1.1')
    expect(applied.canRollback).toBe(true)

    const rolled = await service.rollback(pkg)
    expect(rolled.version).toBe('0.1.0')
    // Broker capability + unitverse.convert + active pointer all restored
    const definition = registry.require('unitverse.convert')
    const result = await definition.handler({ value: 5, from: 'ft', to: 'cm' }, {} as never)
    expect(result.output).toMatchObject({ result: 152.4 })
    const afterRollback = (await service.list()).find(({ packageName }) => packageName === pkg)!
    expect(afterRollback.version).toBe('0.1.0')
    expect(afterRollback.canRollback).toBe(true)   // 0.1.1 still staged
    await service.dispose()
  })

  it('keeps the old UI version active when a candidate fails to activate', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-restart-fail-'))
    temporaryDirectories.push(userDataPath)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set()
      })
      await service.initialize()
      return service
    }
    const pkg = '@sciforge/migration-p2-better-sidebar'
    const first = await create()
    await first.attachCapabilityRegistry(new CapabilityRegistry())
    await first.setEnabled(pkg, true)

    const candidate = await createCandidate('p2-better-sidebar', 'p2-restart-fail-cand-')
    const candidatePkgPath = join(candidate, 'package.json')
    const candidatePkg = JSON.parse(await readFile(candidatePkgPath, 'utf8'))
    candidatePkg.version = '9.9.9'
    await writeFile(candidatePkgPath, JSON.stringify(candidatePkg))
    // candidate entry exists (passes check) but its activate() throws at restart
    await writeFile(join(candidate, 'dist', 'main.js'), "export async function activate(){ throw new Error('restart-apply boom') }\n")

    await first.checkCandidate(pkg, candidate)
    await expect(first.applyCandidate(pkg)).rejects.toThrow(/restart-apply boom/)
    const summary = (await first.list()).find(({ packageName }) => packageName === pkg)!
    expect(summary.version).toBe('0.1.0')
    expect(summary.restartRequired).toBe(false)
    expect(summary.candidateVersion).toBe('9.9.9')
    await first.dispose()
  })

  it('runs the Agent prepare/check/submit/request flow against an immutable artifact', async () => {
    const runner = vi.fn(async () => ({ ok: true, output: 'ok' }))
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-agent-flow-'))
    temporaryDirectories.push(userDataPath)
    const service = new DevelopmentExternalPluginService({
      root,
      userDataPath,
      hostApiVersion: '1.11.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: new Map([
        ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
      ]),
      allowedPermissionIds: new Set(),
      runAgentCommand: runner
    })
    await service.initialize()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    const packageName = '@sciforge/migration-p2-better-sidebar'
    await service.setEnabled(packageName, true)

    const original = (await service.rendererContributionDescriptors()).find(({ pluginId }) => pluginId === packageName)!
    const admission = service.inventoryAdmission(original)!
    expect(admission).toBeDefined()
    expect(admission.lease).toHaveProperty('current', true)

    const prepared = await service.prepareAgentCandidate(packageName)
    expect(prepared.state).toBe('prepared')
    expect(prepared.workspaceDirectory).not.toContain('test-fixtures\\migration-plugins\\p2-better-sidebar')
    const packagePath = join(prepared.workspaceDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.9.0'
    manifest.scripts = { check: 'check', test: 'test', build: 'build' }
    await writeFile(packagePath, JSON.stringify(manifest))

    const checked = await service.checkAgentCandidate(prepared.candidateId)
    expect(checked.state).toBe('checked')
    expect(checked.check).toMatchObject({ version: '0.9.0', passed: true })
    expect(runner).toHaveBeenCalledTimes(3)

    const submitted = await service.submitAgentCandidate(prepared.candidateId)
    expect(submitted.state).toBe('submitted')
    expect(submitted.plugin).toMatchObject({ candidateVersion: '0.9.0', version: '0.1.0' })
    const requested = await service.requestAgentUpdate(prepared.candidateId)
    expect(requested.state).toBe('approval-pending')
    expect(requested.updateRequest?.status).toBe('pending')

    const applied = await service.applyCandidate(packageName)
    expect(applied.version).toBe('0.9.0')
    expect((await service.agentUpdateStatus(prepared.candidateId)).state).toBe('applied')
    expect(admission.lease).toHaveProperty('current', false)
    expect(service.inventoryAdmission(original)).toBeUndefined()
    const current = (await service.rendererContributionDescriptors()).find(({ pluginId }) => pluginId === packageName)!
    expect(current.version).toBe('0.9.0')
    expect(current.generation).not.toBe(original.generation)
    const currentAdmission = service.inventoryAdmission(current)!
    expect(currentAdmission.lease).toHaveProperty('current', true)
    expect(service.inventoryAdmission({ ...current, contributionId: 'unregistered-panel' })).toBeUndefined()
    await service.setEnabled(packageName, false)
    expect(currentAdmission.lease).toHaveProperty('current', false)
    expect(service.inventoryAdmission(current)).toBeUndefined()
    await service.dispose()
  })

  it('records bounded diagnostics and creates no artifact when an Agent check fails', async () => {
    const runner = vi.fn(async ({ script }: { script: string }) => script === 'test'
      ? { ok: false, output: 'test failed' }
      : { ok: true, output: 'ok' })
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-agent-check-failure-'))
    temporaryDirectories.push(userDataPath)
    const service = new DevelopmentExternalPluginService({
      root,
      userDataPath,
      hostApiVersion: '1.11.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: new Map([
        ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
      ]),
      allowedPermissionIds: new Set(),
      runAgentCommand: runner
    })
    await service.initialize()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    const packageName = '@sciforge/migration-p1-unitverse'
    await service.setEnabled(packageName, true)
    const prepared = await service.prepareAgentCandidate(packageName)
    const packagePath = join(prepared.workspaceDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.9.1'
    manifest.scripts = { check: 'check', test: 'test', build: 'build' }
    await writeFile(packagePath, JSON.stringify(manifest))

    const failed = await service.checkAgentCandidate(prepared.candidateId)
    expect(failed.state).toBe('failed')
    expect(failed.check).toMatchObject({ passed: false, diagnostics: 'test failed' })
    expect(failed.check?.commands).toHaveLength(2)
    expect(runner).toHaveBeenCalledTimes(2)
    await expect(service.submitAgentCandidate(prepared.candidateId)).rejects.toThrow(/must pass check/i)
    await service.dispose()
  })

  it('rejects an Agent submission when the frozen check artifact is modified', async () => {
    const runner = vi.fn(async () => ({ ok: true, output: 'ok' }))
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-agent-tamper-'))
    temporaryDirectories.push(userDataPath)
    const service = new DevelopmentExternalPluginService({
      root,
      userDataPath,
      hostApiVersion: '1.11.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: new Map([
        ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
      ]),
      allowedPermissionIds: new Set(),
      runAgentCommand: runner
    })
    await service.initialize()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    const packageName = '@sciforge/migration-p2-better-sidebar'
    await service.setEnabled(packageName, true)
    const prepared = await service.prepareAgentCandidate(packageName)
    const packagePath = join(prepared.workspaceDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.9.2'
    manifest.scripts = { check: 'check' }
    await writeFile(packagePath, JSON.stringify(manifest))
    const checked = await service.checkAgentCandidate(prepared.candidateId)
    expect(checked.state).toBe('checked')

    const statePath = join(userDataPath, 'extensions', 'development-external-state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { agentCandidates: Record<string, { check?: { artifactDirectory: string } }> }
    const artifact = state.agentCandidates[prepared.candidateId].check!.artifactDirectory
    await writeFile(join(artifact, 'dist', 'renderer.html'), '<!doctype html><html><body>tampered</body></html>')
    await expect(service.submitAgentCandidate(prepared.candidateId)).rejects.toThrow(/changed after it was checked/i)
    expect((await service.agentUpdateStatus(prepared.candidateId)).state).toBe('checked')
    await service.dispose()
  })

  it('restores a checked Agent candidate after restart and rejects forged candidate paths', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'p2-agent-restart-'))
    temporaryDirectories.push(userDataPath)
    const packageName = '@sciforge/migration-p2-better-sidebar'
    const runner = vi.fn(async () => ({ ok: true, output: 'ok' }))
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root,
        userDataPath,
        hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2',
        adapterContracts: new Map([
          [packageName, { hostApiRange: '^1.0.0', permissions: [], approved: true }]
        ]),
        allowedPermissionIds: new Set(),
        runAgentCommand: runner
      })
      await service.initialize()
      await service.attachCapabilityRegistry(new CapabilityRegistry())
      return service
    }

    const first = await create()
    await first.setEnabled(packageName, true)
    const prepared = await first.prepareAgentCandidate(packageName)
    const packagePath = join(prepared.workspaceDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.9.3'
    manifest.scripts = { check: 'check' }
    await writeFile(packagePath, JSON.stringify(manifest))
    await first.checkAgentCandidate(prepared.candidateId)
    await first.dispose()

    const second = await create()
    expect((await second.agentUpdateStatus(prepared.candidateId)).state).toBe('checked')
    await second.dispose()

    const statePath = join(userDataPath, 'extensions', 'development-external-state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { agentCandidates: Record<string, { workspaceDirectory: string }> }
    state.agentCandidates[prepared.candidateId].workspaceDirectory = join(tmpdir(), 'outside-agent-candidate')
    await writeFile(statePath, JSON.stringify(state))
    const third = await create()
    await expect(third.agentUpdateStatus(prepared.candidateId)).rejects.toThrow(/was not found/i)
    await third.dispose()
  })

  it('marks an Agent update failed when its submitted host artifact no longer matches', async () => {
    const runner = vi.fn(async () => ({ ok: true, output: 'ok' }))
    const userDataPath = await mkdtemp(join(tmpdir(), 'p1-agent-apply-failure-'))
    temporaryDirectories.push(userDataPath)
    const service = new DevelopmentExternalPluginService({
      root,
      userDataPath,
      hostApiVersion: '1.11.0',
      dshRuntimeVersion: '0.2.0-rc.2',
      adapterContracts: new Map([
        ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
      ]),
      allowedPermissionIds: new Set(),
      runAgentCommand: runner
    })
    await service.initialize()
    await service.attachCapabilityRegistry(new CapabilityRegistry())
    const packageName = '@sciforge/migration-p1-unitverse'
    await service.setEnabled(packageName, true)
    const prepared = await service.prepareAgentCandidate(packageName)
    const packagePath = join(prepared.workspaceDirectory, 'package.json')
    const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
    manifest.version = '0.9.4'
    await writeFile(packagePath, JSON.stringify(manifest))
    await service.checkAgentCandidate(prepared.candidateId)
    await service.submitAgentCandidate(prepared.candidateId)
    await service.requestAgentUpdate(prepared.candidateId)

    const statePath = join(userDataPath, 'extensions', 'development-external-state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { candidates: Record<string, { stagedDirectory: string }> }
    await writeFile(join(state.candidates[packageName].stagedDirectory, 'dist', 'main.js'), 'export function activate() { throw new Error("tampered") }\n')
    await expect(service.applyCandidate(packageName)).rejects.toThrow()
    expect((await service.agentUpdateStatus(prepared.candidateId)).updateRequest).toMatchObject({ status: 'failed' })
    expect((await service.agentUpdateStatus(prepared.candidateId)).state).toBe('failed')
    await service.dispose()
  })

  it('exposes Agent development capabilities without exposing host update controls', async () => {
    const service = await createService()
    const registry = new CapabilityRegistry()
    await service.attachCapabilityRegistry(registry)
    const discovered = registry.discover({ audience: 'agent', callerId: 'agent-stage2' }, { text: 'plugin development' })
    expect(discovered.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'plugin.dev.prepare',
      'plugin.dev.check',
      'plugin.dev.submit',
      'plugin.update.request',
      'plugin.update.status'
    ]))
    expect(registry.discover({ audience: 'ui', callerId: 'renderer' }, { capabilityId: 'plugin.update.request' })).toHaveLength(0)
    await service.dispose()
  })
})
