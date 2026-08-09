import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  DomainArtifactEvent,
  DomainMainActionGuard,
  DomainMainRuntimeLifecycleContext
} from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  type EvidenceDagCanonicalStatus,
  type EvidenceDagExportSnapshotProductsOutput
} from './contract.js'
import {
  createDomainMainEntry,
  type EvidenceDagCapabilityFactory,
  type EvidenceDagCapabilityOptions
} from './main.js'
import type { EvidenceDagRuntimePort } from './main/runtime.js'

const now = '2026-07-26T06:00:00.000Z'
const status: EvidenceDagCanonicalStatus = {
  committed: null,
  pending: null,
  updatedAt: now
}
const exportSnapshotProductsOutput: EvidenceDagExportSnapshotProductsOutput = {
  runtimeId: 'codex',
  threadId: 'thread-1',
  snapshotDigest: `sha256:${'a'.repeat(64)}`,
  transactionId: 'artifact-commit:evidence-products',
  idempotentReplay: false,
  products: [
    'prov-json', 'ro-crate', 'datacite', 'audit-report', 'reproduction-report'
  ].map((product, index) => ({
    product: product as EvidenceDagExportSnapshotProductsOutput['products'][number]['product'],
    ref: {
      artifactId: `artifact:evidence-product-${index + 1}`,
      versionId: `artifact-version:evidence-product-${index + 1}`,
      contentDigest: `${index + 1}`.repeat(64),
      byteLength: index + 1,
      mediaType: 'application/json',
      availability: 'available',
      retention: 'snapshot',
      accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
    }
  })),
  sourceArtifactVersionRefs: []
}

test('lazily activates one runtime shared by every Evidence contribution', async () => {
  const calls: string[] = []
  const runtimeUserDataDirs: string[] = []
  let hostUserDataDirReads = 0
  const createRuntime = (instance: number): EvidenceDagRuntimePort => ({
    activate: async () => {
      calls.push(`${instance}:activate`)
      return () => { calls.push(`${instance}:deactivate`) }
    },
    consume: async () => { calls.push(`${instance}:consume`) },
    view: async () => {
      calls.push(`${instance}:view`)
      return { url: 'http://127.0.0.1:3897/', status }
    },
    update: async () => {
      calls.push(`${instance}:update`)
      return {
        url: 'http://127.0.0.1:3897/',
        threadId: 'codex:thread-1',
        itemCount: 1,
        jobId: 'job-1',
        coalesced: false,
        status
      }
    },
    priority: async () => {
      calls.push(`${instance}:priority`)
      return status
    },
    preview: async () => {
      calls.push(`${instance}:preview`)
      return { ok: false, code: 'file_unavailable', message: 'Unavailable.' }
    },
    exportSnapshotProducts: async () => {
      calls.push(`${instance}:export`)
      throw new Error('Not exercised by this lifecycle test.')
    },
    guardWriteExport: async () => {
      calls.push(`${instance}:guard`)
      return { allowed: true, metadata: { policy: 'evidence-dag-high-impact-gate' } }
    },
    close: async () => { calls.push(`${instance}:close`) }
  })
  const definitions: EvidenceDagCapabilityOptions[] = []
  const entry = createDomainMainEntry<EvidenceDagCapabilityOptions>({
    getUserDataDir: () => {
      hostUserDataDirReads += 1
      throw new Error('Catalog construction must not read the host user-data directory.')
    },
    defineCapability: (value) => {
      definitions.push(value as EvidenceDagCapabilityOptions)
      return value
    },
    createEvidenceDagRuntime: ({ userDataDir }) => {
      runtimeUserDataDirs.push(userDataDir)
      return createRuntime(runtimeUserDataDirs.length)
    }
  })
  assert.equal(hostUserDataDirReads, 0)
  assert.deepEqual(runtimeUserDataDirs, [])
  assert.deepEqual(entry.contributions.map(({ kind, id }) => `${kind}:${id}`), [
    'main.capability-factory:evidence-dag.capabilities',
    'main.runtime-lifecycle:evidence-dag.runtime-lifecycle',
    'main.artifact-consumer:evidence-dag.artifact-consumer',
    'main.action-guard:evidence-dag.write-export-guard'
  ])

  const factory = entry.contributions[0]!.value as EvidenceDagCapabilityFactory<
    EvidenceDagCapabilityOptions
  >
  const capabilities = factory.createDefinitions()
  assert.equal(hostUserDataDirReads, 0)
  assert.deepEqual(runtimeUserDataDirs, [])
  assert.deepEqual(capabilities.map(({ id }) => id), Object.values(EVIDENCE_DAG_CAPABILITY_IDS))
  const updateCapability = capabilities.find(
    ({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.update
  )
  assert.equal(updateCapability?.effect, 'compute')
  assert.equal(updateCapability?.approval, 'none')
  assert.deepEqual(updateCapability?.concurrency, {
    revision: 'none', idempotency: 'required'
  })
  const exportCapability = capabilities.find(
    ({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.exportSnapshotProducts
  )
  assert.equal(exportCapability?.effect, 'workspace-write')
  assert.equal(exportCapability?.approval, 'none')
  assert.deepEqual(exportCapability?.concurrency, {
    revision: 'none', idempotency: 'required'
  })
  assert.deepEqual(factory.policy.directTransportPrefixes, ['evidenceDag:'])
  assert.deepEqual(factory.policy.allowedDirectTransports, [])
  assert.ok(capabilities.every((definition) => definition.tags.includes('evidence')))
  assert.ok(capabilities.every((definition) => definition.scope === 'workspace'))
  await assert.rejects(
    () => capabilities[0]!.handler({}, { caller: { workspaceId: '/workspace' } }),
    /Evidence DAG runtime is not active/
  )
  assert.deepEqual(runtimeUserDataDirs, [])

  const lifecycle = entry.contributions[1]!.value as {
    activate(
      context: DomainMainRuntimeLifecycleContext
    ): Promise<() => void | Promise<void>>
  }
  const controller = new AbortController()
  const context = lifecycleContext(controller.signal)
  const dispose = await lifecycle.activate(context)
  assert.equal(hostUserDataDirReads, 0)
  assert.deepEqual(runtimeUserDataDirs, [context.userDataDir])
  const consumer = entry.contributions[2]!.value as {
    consume(event: DomainArtifactEvent): Promise<void>
  }
  await consumer.consume({
    contractVersion: 1,
    kind: 'turn-completed',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    targetWatermark: '1',
    occurredAt: now,
    artifacts: []
  })
  await capabilities[0]!.handler({}, { caller: { workspaceId: '/workspace' } })
  const actionGuard = entry.contributions[3]!.value as DomainMainActionGuard
  assert.deepEqual(actionGuard.actions, ['write.export'])
  assert.deepEqual(await actionGuard.evaluate({
    actionId: 'write.export',
    payload: {
      runtimeId: 'codex',
      threadId: 'thread-1',
      overrideConfirmed: false
    }
  }), {
    allowed: true,
    metadata: { policy: 'evidence-dag-high-impact-gate' }
  })
  await dispose()
  await dispose()
  entry.contributions[1]!.onDispose?.()

  assert.deepEqual(calls, [
    '1:activate',
    '1:consume',
    '1:view',
    '1:guard',
    '1:deactivate'
  ])
  await assert.rejects(
    () => capabilities[0]!.handler({}, { caller: { workspaceId: '/workspace' } }),
    /Evidence DAG runtime is not active/
  )

  const secondContext = {
    ...lifecycleContext(new AbortController().signal),
    userDataDir: '/tmp/evidence-domain-second'
  }
  const secondDispose = await lifecycle.activate(secondContext)
  await capabilities[0]!.handler({}, { caller: { workspaceId: '/workspace' } })
  entry.contributions[1]!.onDispose?.()
  entry.contributions[1]!.onDispose?.()
  await secondDispose()
  assert.deepEqual(runtimeUserDataDirs, [
    context.userDataDir,
    secondContext.userDataDir
  ])
  assert.deepEqual(calls, [
    '1:activate',
    '1:consume',
    '1:view',
    '1:guard',
    '1:deactivate',
    '2:activate',
    '2:view',
    '2:deactivate'
  ])
})

test('disposal during activation stays fail-closed and deactivates exactly once', async () => {
  const calls: string[] = []
  let finishActivation!: (deactivate: () => void) => void
  const activationGate = new Promise<() => void>((resolve) => {
    finishActivation = resolve
  })
  const runtime: EvidenceDagRuntimePort = {
    activate: () => {
      calls.push('activate')
      return activationGate
    },
    consume: async () => { calls.push('consume') },
    view: async () => ({ url: 'http://127.0.0.1:3897/', status }),
    update: async () => ({
      url: 'http://127.0.0.1:3897/',
      threadId: 'codex:thread-1',
      itemCount: 1,
      jobId: 'job-1',
      coalesced: false,
      status
    }),
    priority: async () => status,
    preview: async () => ({
      ok: false,
      code: 'file_unavailable',
      message: 'Unavailable.'
    }),
    exportSnapshotProducts: async () => {
      throw new Error('Not exercised by this lifecycle test.')
    },
    guardWriteExport: async () => ({ allowed: true }),
    close: async () => { calls.push('close') }
  }
  const entry = createDomainMainEntry<EvidenceDagCapabilityOptions>({
    getUserDataDir: () => {
      throw new Error('Catalog construction must not read the host user-data directory.')
    },
    defineCapability: (definition) => definition,
    createEvidenceDagRuntime: () => runtime
  })
  const factory = entry.contributions[0]!.value as EvidenceDagCapabilityFactory<
    EvidenceDagCapabilityOptions
  >
  const view = factory.createDefinitions().find(
    ({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.view
  )!
  const lifecycle = entry.contributions[1]!.value as {
    activate(
      context: DomainMainRuntimeLifecycleContext
    ): Promise<() => void | Promise<void>>
  }

  const activating = lifecycle.activate(
    lifecycleContext(new AbortController().signal)
  )
  assert.deepEqual(calls, ['activate'])
  entry.contributions[1]!.onDispose?.()
  entry.contributions[1]!.onDispose?.()
  finishActivation(() => { calls.push('deactivate') })

  await assert.rejects(
    activating,
    /Evidence DAG runtime activation was disposed before completion/
  )
  assert.deepEqual(calls, ['activate', 'deactivate'])
  await assert.rejects(
    () => view.handler({}, { caller: { workspaceId: '/workspace' } }),
    /Evidence DAG runtime is not active/
  )
})

test('keeps system access read-only and never reports a changed global resource', async () => {
  let exportInput: unknown
  const runtime: EvidenceDagRuntimePort = {
    activate: async () => () => undefined,
    consume: async () => undefined,
    view: async () => ({ url: 'http://127.0.0.1:3897/', status }),
    update: async () => ({
      url: 'http://127.0.0.1:3897/',
      threadId: 'codex:thread-1',
      itemCount: 1,
      jobId: 'job-1',
      coalesced: false,
      status
    }),
    priority: async () => status,
    preview: async () => ({
      ok: false,
      code: 'file_unavailable',
      message: 'Unavailable.'
    }),
    exportSnapshotProducts: async (input) => {
      exportInput = input
      return exportSnapshotProductsOutput
    },
    guardWriteExport: async () => ({ allowed: true }),
    close: async () => undefined
  }
  const definitions: EvidenceDagCapabilityOptions[] = []
  const entry = createDomainMainEntry<EvidenceDagCapabilityOptions>({
    getUserDataDir: () => {
      throw new Error('Catalog construction must not read the host user-data directory.')
    },
    defineCapability: (value) => {
      definitions.push(value as EvidenceDagCapabilityOptions)
      return value
    },
    createEvidenceDagRuntime: () => runtime
  })
  const factory = entry.contributions[0]!.value as EvidenceDagCapabilityFactory<
    EvidenceDagCapabilityOptions
  >
  const capabilities = factory.createDefinitions()
  const lifecycle = entry.contributions[1]!.value as {
    activate(
      context: DomainMainRuntimeLifecycleContext
    ): Promise<() => void | Promise<void>>
  }
  const dispose = await lifecycle.activate(lifecycleContext(new AbortController().signal))
  const view = capabilities.find(({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.view)!
  const update = capabilities.find(({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.update)!
  const priority = capabilities.find(({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.priority)!
  const exportProducts = capabilities.find(
    ({ id }) => id === EVIDENCE_DAG_CAPABILITY_IDS.exportSnapshotProducts
  )!

  assert.deepEqual(view.audiences, ['ui', 'agent', 'system'])
  assert.deepEqual(update.audiences, ['ui', 'agent'])
  assert.deepEqual(priority.audiences, ['ui', 'agent'])
  assert.deepEqual(await update.handler({
    runtimeId: 'codex',
    threadId: 'thread-1'
  }, { caller: { workspaceId: '/workspace' } }), {
    output: {
      url: 'http://127.0.0.1:3897/',
      threadId: 'codex:thread-1',
      itemCount: 1,
      jobId: 'job-1',
      coalesced: false,
      status
    }
  })
  assert.equal('changed' in await priority.handler({
    runtimeId: 'codex',
    threadId: 'thread-1',
    visible: true
  }, { caller: { workspaceId: '/workspace' } }), false)
  const exported = await exportProducts.handler({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/spoofed',
    snapshotDigest: `sha256:${'a'.repeat(64)}`,
    idempotencyKey: 'evidence-export-test',
    datacite: {
      doi: '10.12345/evidence.snapshot',
      title: 'Evidence Snapshot',
      creators: [{ name: 'SciForge' }],
      publisher: 'SciForge',
      publicationYear: 2026,
      projectId: 'project:test'
    }
  }, { caller: { workspaceId: '/workspace' } })
  assert.deepEqual(exported, { output: exportSnapshotProductsOutput })
  assert.equal('changed' in exported, false)
  assert.equal((exportInput as { workspaceRoot: string }).workspaceRoot, '/workspace')
  await dispose()
  entry.contributions[1]!.onDispose?.()
})

function lifecycleContext(signal: AbortSignal): DomainMainRuntimeLifecycleContext {
  return {
    owner: { moduleId: 'sciforge.evidence-dag', moduleVersion: '1.0.0' },
    signal,
    userDataDir: '/tmp/evidence-domain',
    appRoot: '/workspace',
    environment: {},
    agentThreads: {
      list: async () => [],
      read: async () => ({
        id: 'thread-1',
        runtimeId: 'codex',
        watermark: '1',
        turns: [],
        artifacts: []
      }),
      hasActiveTurns: () => false
    },
    capabilities: {
      invoke: async () => {
        throw new Error('Unexpected capability invocation.')
      }
    },
    modelAccess: {
      textReasoner: async () => ({
        baseUrl: 'http://127.0.0.1:3892/v1',
        apiKey: 'router-key',
        model: 'sciforge-router'
      })
    },
    executionEvents: {
      publish: async () => { throw new Error('Unexpected execution event.') }
    },
    workflowExecutionReceipts: [],
    enablement: {
      isEnabled: async () => true,
      subscribe: () => () => undefined
    },
    log: () => undefined
  }
}
