/**
 * Host service for DSH plugins (GAPS.md G9).
 *
 * The provider must decide from Host-owned facts only: the exact package/version
 * contract's `dshAuthorization.ports` or declared workspace service, the
 * Broker-authenticated caller and the live invocation lease. These tests pin
 * the allow/deny matrix and the fact that
 * the domain's own commit/read capability is what actually executes.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  createDomainHostServiceResolver,
  ARTIFACT_VERSIONS_HOST_SERVICE_ID,
  ARTIFACT_HOST_SERVICE_ID
} from './host-services.js'

const CALLER = Object.freeze({ audience: 'agent', callerId: 'caller-1', workspaceId: '/tmp/workspace', approvals: [] })
const SESSION = Object.freeze({ runtimeId: 'runtime-1', threadId: 'thread-1' })

const COMMIT_INPUT = Object.freeze({
  idempotencyKey: 'host-service:commit:1',
  candidates: [{
    candidateId: 'visual-review:revision-1',
    expectedCurrentVersionId: null,
    kind: 'figure',
    intent: 'save' as const,
    content: { mode: 'snapshot' as const, dataBase64: Buffer.from('figure').toString('base64'), mediaType: 'image/png' },
    accessPolicy: { visibility: 'workspace' as const, principals: [], allowExport: true }
  }]
})

function request(operation: string, input: unknown, overrides: Partial<{ packageName: string; version: string; authority: Record<string, unknown> }> = {}) {
  const packageName = overrides.packageName ?? '@sciforge/plugin-visual-review'
  const version = overrides.version ?? '0.1.0'
  return Object.freeze({
    requestId: 'request-1',
    serviceId: ARTIFACT_VERSIONS_HOST_SERVICE_ID,
    operation,
    input,
    owner: Object.freeze({
      connectionId: 'connection-1',
      pluginId: packageName,
      packageName,
      version,
      generation: 1,
      invocationId: 'invocation-1',
      authority: overrides.authority ?? { caller: CALLER, ordinarySession: SESSION }
    }),
    signal: new AbortController().signal,
    assertCurrent: () => undefined
  })
}

function commitReceipt(input: typeof COMMIT_INPUT) {
  const candidate = input.candidates[0]!
  const digest = 'a'.repeat(64)
  const artifactId = 'artifact:00000000-0000-4000-8000-000000000001'
  const versionId = 'artifact-version:00000000-0000-4000-8000-000000000001'
  return {
    ok: true,
    value: {
      transactionId: 'artifact-commit:1',
      committedAt: '2026-11-01T00:00:00.000Z',
      idempotentReplay: false,
      versions: [{
        candidateId: candidate.candidateId,
        artifact: {
          artifactId,
          kind: candidate.kind,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          currentVersionId: versionId,
          versionCount: 1
        },
        version: {
          schemaVersion: 1,
          versionId,
          artifactId,
          sequence: 1,
          transactionId: 'artifact-commit:1',
          createdAt: '2026-11-01T00:00:00.000Z',
          intent: candidate.intent,
          storage: { mode: 'snapshot', contentDigest: digest, byteLength: 6, mediaType: 'image/png' },
          dependencies: [],
          accessPolicy: candidate.accessPolicy,
          metadata: {}
        },
        ref: {
          artifactId,
          versionId,
          contentDigest: digest,
          byteLength: 6,
          mediaType: 'image/png',
          availability: 'available',
          retention: 'snapshot',
          accessPolicy: candidate.accessPolicy
        }
      }],
      events: []
    }
  }
}

test('the complete service catalog grants no providers or clients without Host approval', () => {
  const resolver = createDomainHostServiceResolver({ capabilities: { invoke: async () => undefined } })
  // serviceIds describes the domain's complete catalog, not an identity's grant.
  // Both generic ports and the client-backed service still require admission.
  assert.deepEqual(resolver.serviceIds, [ARTIFACT_VERSIONS_HOST_SERVICE_ID, ARTIFACT_HOST_SERVICE_ID])
  assert.equal(resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1), undefined)
  assert.deepEqual(resolver.resolveClients('@sciforge/plugin-visual-review', '0.1.0', 1), [])
  assert.equal(resolver.resolve('@sciforge/plugin-scientific-plotting', '0.1.0', 1), undefined)
  assert.deepEqual(resolver.resolveClients('@sciforge/plugin-scientific-plotting', '0.1.0', 1), [])
})

test('an approved port list composes the provider, and unapproved operations are refused', () => {
  const resolver = createDomainHostServiceResolver({
    capabilities: { invoke: async () => undefined },
    portsFor: (packageName: string, version: string) =>
      packageName === '@sciforge/plugin-visual-review' && version === '0.1.0' ? ['artifacts.read'] : undefined
  })
  const providers = resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1)
  assert.ok(providers)
  const provider = providers[ARTIFACT_VERSIONS_HOST_SERVICE_ID]!
  assert.equal(typeof provider.operations.commit, 'function')
  assert.throws(() => provider.authorize(request('commit', COMMIT_INPUT)), /not approved/)
  assert.doesNotThrow(() => provider.authorize(request('read', { versionId: 'artifact-version:1' })))
})

test('a foreign owner cannot use another package approval', () => {
  const resolver = createDomainHostServiceResolver({
    capabilities: { invoke: async () => undefined },
    portsFor: () => ['artifacts.commit']
  })
  const provider = resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1)![ARTIFACT_VERSIONS_HOST_SERVICE_ID]!
  assert.throws(
    () => provider.authorize(request('commit', COMMIT_INPUT, { packageName: '@sciforge/other', version: '9.9.9' })),
    /owner mismatch/
  )
})

test('commit runs the real artifact-versions capability with the Host-bound caller', async () => {
  const calls: Array<{ request: unknown; context: Record<string, unknown> }> = []
  const resolver = createDomainHostServiceResolver({
    capabilities: {
      invoke: async (capabilityRequest: { actionId: string; input: unknown; invocationId?: string }, context: { caller: unknown }) => {
        calls.push({ request: capabilityRequest, context: context as unknown as Record<string, unknown> })
        return commitReceipt(COMMIT_INPUT as unknown as typeof COMMIT_INPUT)
      }
    },
    portsFor: () => ['artifacts.commit', 'artifacts.read']
  })
  const provider = resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1)![ARTIFACT_VERSIONS_HOST_SERVICE_ID]!
  const outgoing = request('commit', COMMIT_INPUT)
  provider.authorize(outgoing)
  const result = await provider.operations.commit!(outgoing) as { ok: boolean; value: { versions: Array<{ ref: { versionId: string } }> } }

  assert.equal(result.ok, true)
  assert.equal(result.value.versions[0]!.ref.versionId, 'artifact-version:00000000-0000-4000-8000-000000000001')
  assert.equal(calls.length, 1)
  const call = calls[0]!
  assert.deepEqual(call.request, {
    actionId: 'artifact-versions.commit',
    input: COMMIT_INPUT,
    invocationId: `artifact-versions:${createHash('sha256').update(COMMIT_INPUT.idempotencyKey).digest('hex')}`
  })
  assert.deepEqual(call.context.caller, CALLER)
  assert.deepEqual(call.context.ordinarySession, SESSION)
})

test('read is forwarded as artifact-versions.read and an error result passes through', async () => {
  const calls: unknown[] = []
  const resolver = createDomainHostServiceResolver({
    capabilities: {
      invoke: async (capabilityRequest: { actionId: string }) => {
        calls.push(capabilityRequest)
        return { ok: false, issue: { code: 'version-not-found', message: 'Unknown version' } }
      }
    },
    portsFor: () => ['artifacts.read']
  })
  const provider = resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1)![ARTIFACT_VERSIONS_HOST_SERVICE_ID]!
  const outgoing = request('read', { versionId: 'artifact-version:1' })
  provider.authorize(outgoing)
  const result = await provider.operations.read!(outgoing) as { ok: boolean; issue: { code: string } }
  assert.equal(result.ok, false)
  assert.equal(result.issue.code, 'version-not-found')
  assert.equal((calls[0] as { actionId: string }).actionId, 'artifact-versions.read')
})

test('a child input carrying authority fields is rejected by the contract schema', async () => {
  const resolver = createDomainHostServiceResolver({
    capabilities: { invoke: async () => { throw new Error('must not be called') } },
    portsFor: () => ['artifacts.commit']
  })
  const provider = resolver.resolve('@sciforge/plugin-visual-review', '0.1.0', 1)![ARTIFACT_VERSIONS_HOST_SERVICE_ID]!
  await assert.rejects(
    async () => provider.operations.commit!(request('commit', { ...COMMIT_INPUT, workspaceId: '/tmp/other' })),
    /Unrecognized key|invalid/i
  )
})