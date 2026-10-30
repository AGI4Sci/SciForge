import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry'
import { CapabilityBroker } from '../../../src/main/capabilities/broker'
import { createMainSystemCapabilityInvokerFactory } from '../../../src/main/modules/runtime-contributions'
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins'
import { ProjectDagRuntime } from '../../../packages/domains/project-dag/src/runtime'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { workerOptions } from './worker-fixture'
import { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace, evidenceDagCommittedSnapshotSchema } from '../src/core'

it('Project public consumer reaches committed.status via real Broker, issued workspace resource and Cordis child without ordinarySession', async () => {
  const opts = await workerOptions()
  const root = await mkdtemp(join(tmpdir(), 'committed-broker-'))
  const name = 'neutral-committed-reader', version = '1.0.0'
  const plugin = join(root, 'plugins', name), state = join(root, 'state')
  await mkdir(plugin, { recursive: true }); await mkdir(state)
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': './main.mjs' }, dsh: { bundle: { patch: './patch.yml' } } }))
  await writeFile(join(plugin, 'patch.yml'), '[]')
  await writeFile(join(plugin, 'main.mjs'), `export * from ${JSON.stringify(pathToFileURL(join(opts.release, 'main.mjs')).href)}`)
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: root }
  const deliveries: any[] = []
  const store = new EvidenceDagDeltaStore(join(state, 'deltas.json'))
  const delta = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'r:t', operationId: 'one', idempotencyKey: 'broker-one', kind: 'manual', requestedWatermark: '1', trace: [] })
  const appended = await store.append({ ...delta, payload: { ...delta.payload, claims: [{ id: 'claim-1', text: 'Controlled.' }] } })
  const closure = await store.seal('r:t', { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim-1'], expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
  const producer = createEvidenceProductionService({ identity: { pluginId: name, version, profileId: root }, storageRoot: state, worker: opts, clientModule: 'unused', threads: {} as any, artifacts: {} as any })
  const produced = await producer.worker.request('commitSnapshot', { threadId: 'r:t', workspaceRoot: root, trace: [], targetWatermark: '1', idempotencyKey: 'broker-one' })
  const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).map(k => [k, produced.snapshot[k]])))
  await store.recordCommittedSnapshot('r:t', snapshot, closure.closureDigest)
  await producer.close()
  const production = createEvidenceProductionService({ identity: { pluginId: name, version, profileId: root }, storageRoot: state, storageInterpreter: opts.executable, worker: opts,
    clientModule: join(opts.release, 'host-provider.mjs'),
    threads: { read: async (requested, context) => { context.assertCurrent(); expect(context.ordinarySession).toBeUndefined(); expect(requested).toEqual(scope); return { ...scope, watermark: '0', trace: [] } }, list: async () => [] },
    artifacts: { invoke: async () => { throw Error('no artifact effects') } } })
  const base = production.providers.evidenceDagPorts
  const contracts = new Map([[`${name}@${version}`, { hostApiRange: '^1', permissions: [], approved: true, dshAuthorization: { packageName: name, packageVersion: version, dshRuntimeVersion: '0.2.0-rc.2', tools: {
    evidence_dag_snapshot_status: { id: 'evidence-dag.snapshot-status', effect: 'read', readResource: 'workspace' },
    evidence_dag_update: { id: 'neutral.update', effect: 'workspace-write' }, evidence_dag_seal_closure: { id: 'neutral.seal', effect: 'workspace-write' },
    evidence_dag_append_sidechain: { id: 'neutral.append', effect: 'workspace-write' }, evidence_dag_export_snapshot_products: { id: 'neutral.export', effect: 'workspace-write' }, evidence_dag_poll_artifact_events: { id: 'neutral.poll', effect: 'workspace-write' }
  } } }]])
  const registry = new CapabilityRegistry(), broker = new CapabilityBroker(registry)
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'profile'), hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2', adapterContracts: contracts as any,
    hostServiceClients: new Map([[name, production.clients]]), hostServiceProviders: { evidenceDagPorts: { ...base, authorize: request => base.authorize(request), operations: { ...base.operations, 'committed.status': async request => { deliveries.push(request); return base.operations['committed.status'](request) } } } } })
  const capabilities = createMainSystemCapabilityInvokerFactory(broker).forDomain({ moduleId: 'public-consumer', moduleVersion: '1' })
  const now = '2026-09-01T00:00:00.000Z'
  const receipt = { projectKey: 'path:' + root, jobId: 'pjob_0123456789ab', acceptedRequestVersion: 1, desiredFingerprint: `project-update-desired:${'a'.repeat(64)}`, desiredEvidenceVector: [], capturedScope: { includedSessions: ['r:t'], excludedSessions: [], isolatedSessions: [] }, state: 'queued', acceptedAt: now, updatedAt: now, attempts: 0, lastError: null }
  let posted: any
  const project = new ProjectDagRuntime({ sidecar: { ensure: async () => ({ baseUrl: 'http://component.invalid', token: 'fixture' }), stop: async () => {} } as any,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/updates') && init?.method === 'POST') posted = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ ok: true, data: String(url).includes('/updates/status') ? { projectKey: receipt.projectKey, state: 'idle', scope: receipt.capturedScope, committedSnapshot: null, latestReceipt: null, activeReceipt: null } : receipt }), { headers: { 'Content-Type': 'application/json' } })
    } })
  try {
    await service.initialize(); await service.attachCapabilityRegistry(registry); await service.setEnabled(name, true)
    expect(registry.get('evidence-dag.snapshot-status')?.descriptor.scope).toBe('resource')
    await project.activate({ owner: { moduleId: 'project', moduleVersion: '1' }, signal: new AbortController().signal, enablement: { isEnabled: () => true, subscribe: () => () => {} }, log() {}, capabilities,
      agentThreads: { read: async () => ({ runtimeId: 'r', threadId: 't', id: 't', workspaceRoot: root }) } } as any)
    await expect(project.update({ workspaceRoot: root, scope: ['r:t'] })).resolves.toMatchObject({ receipt: { state: 'queued' } })
    expect(posted.evidenceVector).toEqual([{ threadId: 'r:t', digest: snapshot.digest }])
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0].owner.authority).toMatchObject({ effect: 'read', caller: { audience: 'system', workspaceId: root } })
    expect(deliveries[0].owner.authority.ordinarySession).toBeUndefined()
    expect(deliveries[0].owner.authority.resource.resourceKind).toBe('dsh-workspace')
    expect(production.worker.pid).toBeUndefined()
    // Unresourced public Broker calls stay denied, rather than weakening all read descriptors.
    await expect(broker.invokeHostSystem({ callerId: 'unresourced', workspaceId: root }, { actionId: 'evidence-dag.snapshot-status', input: scope })).rejects.toMatchObject({ code: 'resource_required' })
    const caller = { callerId: 'resource-control', workspaceId: root }
    const opened = await broker.invokeHostSystem(caller, { actionId: 'evidence-dag.snapshot-status.open', input: {} })
    await broker.invokeHostSystem(caller, { actionId: 'evidence-dag.snapshot-status.open', input: {} })
    const resource = opened.output as any
    await expect(broker.invokeHostSystem({ ...caller, callerId: 'foreign' }, { actionId: 'evidence-dag.snapshot-status', input: scope, resource })).rejects.toThrow()
    await expect(broker.invokeHostSystem({ ...caller, workspaceId: root + '-foreign' }, { actionId: 'evidence-dag.snapshot-status', input: scope, resource })).rejects.toThrow()
    const authorization = contracts.get(`${name}@${version}`)!.dshAuthorization
    delete (authorization.tools.evidence_dag_snapshot_status as any).readResource
    await expect(broker.invokeHostSystem(caller, { actionId: 'evidence-dag.snapshot-status', input: scope, resource })).rejects.toThrow()
    await expect(broker.invokeHostSystem(caller, { actionId: 'evidence-dag.snapshot-status.open', input: {} })).rejects.toThrow()
    expect(deliveries).toHaveLength(1)
  } finally { await project.dispose(); await service.dispose(); await production.close(); await rm(root, { recursive: true, force: true }); await rm(opts.root, { recursive: true, force: true }) }
}, 120000)
