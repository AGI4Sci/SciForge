import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ARTIFACT_HOST_SERVICE_ID, createDomainHostServiceResolver, type ArtifactHostServiceOptions } from './host-services.js'
import { createArtifactVersionsCapabilityFactory } from './main.js'
import { ArtifactVersionService } from './main/service.js'
import { artifactVersionCommitResultV1Schema, artifactVersionReadResultV1Schema } from './contract.js'

const PACKAGE = '@example/plugin-workspace-client'
const VERSION = '2.3.4'
const CALLER = Object.freeze({ audience: 'agent', callerId: 'caller-1', workspaceId: '/tmp/workspace', approvals: [] })
const SESSION = Object.freeze({ runtimeId: 'runtime-1', threadId: 'thread-1' })
const READ_INPUT = Object.freeze({ versionId: 'artifact-version:1' })
const READ_DENIAL = Object.freeze({ ok: false, issue: { code: 'version-not-found', message: 'Unknown version' } })
const COMMIT_INPUT = Object.freeze({ idempotencyKey: 'workspace:commit:1', candidates: [{
  candidateId: 'revision-1', expectedCurrentVersionId: null, kind: 'figure', intent: 'save',
  content: { mode: 'snapshot', dataBase64: Buffer.from('figure').toString('base64'), mediaType: 'image/png' },
  accessPolicy: { visibility: 'workspace', principals: [], allowExport: true }
}] })
const COMMIT_DENIAL = Object.freeze({ ok: false, issue: { code: 'invalid-input', message: 'Commit denied' } })

function request(operation: string, input: unknown, overrides: Partial<{ packageName: string; version: string; authority: Record<string, unknown> }> = {}) {
  return {
    requestId: 'request-1', serviceId: ARTIFACT_HOST_SERVICE_ID, operation,
    input: { workspaceRoot: CALLER.workspaceId, input },
    owner: {
      connectionId: 'connection-1', pluginId: PACKAGE, packageName: overrides.packageName ?? PACKAGE,
      version: overrides.version ?? VERSION, generation: 1, invocationId: 'invocation-1',
      authority: overrides.authority ?? { caller: CALLER, ordinarySession: SESSION, effect: 'workspace-write' }
    },
    signal: new AbortController().signal, assertCurrent: () => undefined
  }
}

function resolver(overrides: Record<string, unknown> = {}) {
  return createDomainHostServiceResolver({
    capabilities: { invoke: async () => { throw new Error('must not be called') } },
    authorizeHostService: (input: { packageName: string; version: string; serviceId: string }) =>
      input.packageName === PACKAGE && input.version === VERSION && input.serviceId === ARTIFACT_HOST_SERVICE_ID,
    authorizeWorkspace: ({ workspaceId }: { workspaceId: string }) => workspaceId === CALLER.workspaceId,
    hostServiceClientModule: '/tmp/host-service-client.mjs', ...overrides
  })
}
function provider(overrides: Record<string, unknown> = {}) {
  return resolver(overrides).resolve(PACKAGE, VERSION, 1)![ARTIFACT_HOST_SERVICE_ID]!
}

test('workspace service has one generic ID and exact package/version admission', () => {
  const resolved = resolver()
  assert.equal(ARTIFACT_HOST_SERVICE_ID, 'artifact-versions.workspace')
  assert.deepEqual(Object.keys(resolved.resolve(PACKAGE, VERSION, 1)!), [ARTIFACT_HOST_SERVICE_ID])
  assert.deepEqual(resolved.resolveClients(PACKAGE, VERSION, 1), [{
    serviceId: ARTIFACT_HOST_SERVICE_ID, modulePath: '/tmp/host-service-client.mjs',
    exportName: 'createHostServiceClient', config: { serviceId: ARTIFACT_HOST_SERVICE_ID }
  }])
  for (const [packageName, version] of [[PACKAGE, '2.3.5'], ['@example/other', VERSION]]) {
    assert.equal(resolved.resolve(packageName!, version!, 1), undefined)
    assert.deepEqual(resolved.resolveClients(packageName!, version!, 1), [])
  }
})

test('absent or denied admission resolves neither workspace provider nor client', () => {
  for (const authorizeHostService of [undefined, () => false]) {
    const resolved = resolver({ authorizeHostService })
    assert.equal(resolved.resolve(PACKAGE, VERSION, 1), undefined)
    assert.deepEqual(resolved.resolveClients(PACKAGE, VERSION, 1), [])
  }
})

test('workspace client module must be Host-chosen and absolute', () => {
  for (const hostServiceClientModule of [undefined, '', 'relative/client.mjs']) {
    assert.deepEqual(resolver({ hostServiceClientModule }).resolveClients(PACKAGE, VERSION, 1), [])
  }
})

test('workspace provider rejects a foreign package or different owner version', async () => {
  const service = provider()
  for (const overrides of [{ packageName: '@example/other' }, { version: '2.3.5' }]) {
    const outgoing = request('commit', COMMIT_INPUT, overrides)
    await assert.rejects(async () => service.authorize(outgoing), /owner does not match/)
    await assert.rejects(async () => service.operations.commit!(outgoing), /owner does not match/)
  }
})

test('workspace provider retains the complete effect allow/deny matrix', async () => {
  const service = provider()
  for (const [operation, effect, allowed] of [
    ['commit', 'workspace-write', true], ['read', 'workspace-write', true], ['read', 'read', true],
    ['commit', 'destructive', true], ['read', 'destructive', true],
    ['commit', 'read', false], ['commit', 'compute', false], ['read', 'compute', false],
    ['commit', undefined, false], ['read', undefined, false],
    ['remove', 'workspace-write', false], ['remove', 'destructive', false]
  ] as const) {
    const outgoing = request(operation, operation === 'commit' ? COMMIT_INPUT : READ_INPUT, {
      authority: { caller: CALLER, ordinarySession: SESSION, effect }
    })
    if (allowed) await service.authorize(outgoing)
    else {
      await assert.rejects(async () => service.authorize(outgoing), /not authorized by capability effect/)
      if (operation === 'commit' || operation === 'read') {
        await assert.rejects(async () => service.operations[operation]!(outgoing), /not authorized by capability effect/)
      }
    }
  }
})

test('workspace provider requires caller-bound root and Host workspace approval', async () => {
  const service = provider()
  for (const caller of [undefined, {}, { ...CALLER, workspaceId: '' }, { ...CALLER, workspaceId: '/tmp/other' }]) {
    await assert.rejects(async () => service.operations.read!(request('read', READ_INPUT, {
      authority: { caller, ordinarySession: SESSION, effect: 'read' }
    })), /caller-bound workspace root/)
  }
  const outgoing = request('read', READ_INPUT)
  await assert.rejects(async () => service.operations.read!({ ...outgoing, input: { workspaceRoot: '/tmp/forged', input: READ_INPUT } }), /caller-bound workspace root/)
  const denied = provider({ authorizeWorkspace: async () => false })
  await assert.rejects(async () => denied.authorize(outgoing), /not authorized for workspace/)
  await assert.rejects(async () => denied.operations.read!(outgoing), /not authorized for workspace/)
})

test('workspace provider requires an ordinary Session or authenticated UI caller', async () => {
  const service = provider()
  await assert.rejects(async () => service.operations.read!(request('read', READ_INPUT, {
    authority: { caller: CALLER, effect: 'read' }
  })), /ordinary Session or an authenticated UI caller/)
  await service.authorize(request('read', READ_INPUT, {
    authority: { caller: { ...CALLER, audience: 'ui' }, effect: 'read' }
  }))
})

test('workspace provider rejects missing, expired and aborted invocation leases', async () => {
  const service = provider()
  const outgoing = request('read', READ_INPUT)
  await assert.rejects(async () => service.operations.read!({ ...outgoing, assertCurrent: undefined }), /live Host principal lease/)
  await assert.rejects(async () => service.operations.read!({ ...outgoing, assertCurrent: () => { throw new Error('expired lease') } }), /expired lease/)
  const controller = new AbortController()
  controller.abort(new Error('cancelled invocation'))
  await assert.rejects(async () => service.operations.read!({ ...outgoing, signal: controller.signal }), /cancelled invocation/)
})

test('workspace provider rejects plugin-supplied authority in envelope or input', async () => {
  const service = provider()
  const outgoing = request('commit', COMMIT_INPUT)
  await assert.rejects(async () => service.operations.commit!({ ...outgoing, input: {
    workspaceRoot: CALLER.workspaceId, input: COMMIT_INPUT, caller: CALLER
  } }), /Unrecognized key|invalid/i)
  await assert.rejects(async () => service.operations.commit!(request('commit', {
    ...COMMIT_INPUT, workspaceId: '/tmp/forged'
  })), /Unrecognized key|invalid/i)
})

test('workspace commit/read use canonical capabilities and public Host caller identity', async () => {
  const calls: Array<{ request: { actionId: string; input: unknown; invocationId?: string }; context: Record<string, unknown> }> = []
  const service = provider({ capabilities: {
    invoke: async (capabilityRequest: { actionId: string; input: unknown; invocationId?: string }, context: Record<string, unknown>) => {
      calls.push({ request: capabilityRequest, context })
      return capabilityRequest.actionId === 'artifact-versions.commit' ? COMMIT_DENIAL : READ_DENIAL
    }
  } })
  const originalContext = Object.freeze({ trace: 'host-trace' })
  const authority = {
    caller: { ...CALLER, principal: { private: true }, principalContextVersion: 42 },
    ordinarySession: SESSION, originalContext, effect: 'workspace-write'
  }
  assert.deepEqual(await service.operations.commit!(request('commit', COMMIT_INPUT, { authority })), COMMIT_DENIAL)
  assert.deepEqual(await service.operations.read!(request('read', READ_INPUT, { authority })), READ_DENIAL)
  assert.deepEqual(calls.map(({ request }) => request.actionId), ['artifact-versions.commit', 'artifact-versions.read'])
  assert.deepEqual(calls[0]!.request.input, COMMIT_INPUT)
  assert.deepEqual(calls[1]!.request.input, READ_INPUT)
  assert.match(calls[0]!.request.invocationId!, /^plugin-artifacts:[0-9a-f]{64}$/)
  assert.equal(calls[1]!.request.invocationId, undefined)
  for (const { context } of calls) {
    assert.deepEqual(context.caller, CALLER)
    assert.deepEqual(context.ordinarySession, SESSION)
    assert.deepEqual(context.originalContext, originalContext)
    assert.equal(typeof context.assertCurrent, 'function')
  }
})

test('approved destructive UI lease commits and reads through the public provider and real domain', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'artifact-workspace-approved-')))
  try {
    const workspaceRoot = join(root, 'workspace')
    const userDataDir = join(root, 'user-data')
    await mkdir(workspaceRoot)
    await mkdir(userDataDir)
    const store = new ArtifactVersionService({ userDataDir })
    const definitions = createArtifactVersionsCapabilityFactory({
      defineCapability: (definition) => definition,
      getService: () => store
    }).createDefinitions()
    const approvedCaller = Object.freeze({
      audience: 'ui' as const, callerId: 'window:approved-review', workspaceId: workspaceRoot,
      approvals: [{ actionId: 'example.review.accept', invocationId: 'approved-accept-1', mode: 'confirmation' as const }]
    })
    let leaseChecks = 0
    const assertCurrent = () => { leaseChecks += 1 }
    const calls: string[] = []
    const capabilities: ArtifactHostServiceOptions['capabilities'] = {
      invoke: async (capabilityRequest, context) => {
        context.assertCurrent()
        assert.deepEqual(context.caller, approvedCaller)
        assert.equal(context.ordinarySession, undefined)
        const definition = definitions.find(({ id }) => id === capabilityRequest.actionId)
        assert.ok(definition)
        calls.push(capabilityRequest.actionId)
        const result = await definition.handler(capabilityRequest.input, { caller: approvedCaller })
        context.assertCurrent()
        return result.output
      }
    }
    const service = provider({
      capabilities,
      authorizeWorkspace: ({ caller, workspaceId }: { caller: Record<string, unknown>; workspaceId: string }) =>
        caller.callerId === approvedCaller.callerId && workspaceId === workspaceRoot
    })
    // Broker approval is an upstream prerequisite, not an alternate provider
    // approval path. Exercise its already-approved UI authority and live lease.
    const authority = { caller: approvedCaller, effect: 'destructive' }
    const commitRequest = {
      ...request('commit', COMMIT_INPUT, { authority }),
      input: { workspaceRoot, input: COMMIT_INPUT }, assertCurrent
    }
    await service.authorize(commitRequest)
    const committed = artifactVersionCommitResultV1Schema.parse(await service.operations.commit!(commitRequest))
    assert.equal(committed.ok, true, JSON.stringify(committed))
    const version = committed.value.versions[0]!
    assert.equal(version.candidateId, COMMIT_INPUT.candidates[0]!.candidateId)
    const readRequest = {
      ...request('read', { versionId: version.ref.versionId }, { authority }),
      input: { workspaceRoot, input: { versionId: version.ref.versionId } }, assertCurrent
    }
    await service.authorize(readRequest)
    const read = artifactVersionReadResultV1Schema.parse(await service.operations.read!(readRequest))
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.value.ref.versionId, version.ref.versionId)
    assert.equal(read.value.dataBase64, COMMIT_INPUT.candidates[0]!.content.dataBase64)
    assert.deepEqual(calls, ['artifact-versions.commit', 'artifact-versions.read'])
    assert.ok(leaseChecks >= 10, 'authorization, invocation and completion must retain live lease checks')
  } finally {
    // root is the absolute, canonical mkdtemp result owned by this test.
    assert.ok(isAbsolute(root))
    assert.equal(await realpath(root), root)
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace results are refused if the lease expires during capability execution', async () => {
  let current = true
  const service = provider({ capabilities: { invoke: async () => { current = false; return READ_DENIAL } } })
  await assert.rejects(async () => service.operations.read!({
    ...request('read', READ_INPUT),
    assertCurrent: () => { if (!current) throw new Error('expired during invocation') }
  }), /expired during invocation/)
})
