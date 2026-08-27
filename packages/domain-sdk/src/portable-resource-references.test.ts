import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
  MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
  PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE,
  PORTABLE_RESOURCE_REFERENCE_MAX_SERIALIZED_BYTES,
  PORTABLE_RESOURCE_REFERENCE_MAX_STRING_BYTES,
  PortableResourceReferenceError,
  canonicalPortableResourceIdentity,
  definePortableResourceAuthorityResolverContributionContract,
  definePortableResourceCodecContributionContract,
  isPortableResourceAuthorityResolver,
  isPortableResourceExportProjection,
  isPortableResourceReferenceCodec,
  parsePortableResourceReference,
  portableResourceAuthorityResolverContributionContractSchema,
  portableResourceAuthorityResolverMatchesContract,
  portableResourceCodecMatchesContract,
  portableResourceCodecResolverBindingMatches,
  serializePortableResourceReference,
  validatePortableIdentity,
  type DomainMainPortableResourceReferencesHost,
  type PortableResourceAuthorityResolver,
  type PortableResourceReferenceCodec
} from './portable-resource-references.js'

const kind = 'fixture.logical-resource'
const resourceKind = 'fixture.local-resource'
const resolverId = 'fixture.authority-resolver'

const codec: PortableResourceReferenceCodec<
  Readonly<{ logicalId: string }>,
  Readonly<{ stableId: string }>
> = Object.freeze({
  location: MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
  contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  kind,
  resourceKind,
  resolverId,
  decodeIdentity: (identity) => ({ logicalId: String(identity.logicalId) }),
  encodeIdentity: (identity) => ({ logicalId: identity.logicalId }),
  projectExport: (projection) => ({ logicalId: projection.stableId })
})

const resolver: PortableResourceAuthorityResolver = Object.freeze({
  location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
  contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  id: resolverId,
  kinds: Object.freeze([kind]),
  lookupAuthority: ({ reference, kind: requestedKind }) => (
    reference === 'provider_instance_alpha' && requestedKind === kind
      ? { reference, kind: requestedKind, resolverId }
      : undefined
  ),
  resolve: async ({
    resourceKind: requestedResourceKind,
    assertPrincipalCurrent
  }) => {
    await assertPrincipalCurrent()
    return {
      registration: {
        resourceKind: requestedResourceKind,
        semanticRevision: 'revision-1',
        observe: async (context) => {
          await context.assertPrincipalCurrent()
          return { state: {}, semanticRevision: 'revision-1' }
        }
      }
    }
  }
})

const envelope = {
  contractVersion: PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  kind,
  authority: 'provider_instance_alpha',
  identity: {
    nested: { zeta: 2, alpha: 1 },
    logicalId: 'logical-123'
  }
} as const

function expectPortableError(code: string, action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PortableResourceReferenceError)
    assert.equal(error.code, code)
    assert.ok(error.message.length <= 256)
    return true
  })
}

async function compileTimeOwnerScopedFacadeChecks(
  host: DomainMainPortableResourceReferencesHost,
  resourceRef: string
): Promise<void> {
  // @ts-expect-error Caller identity is injected by the Host, not package input.
  await host.materialize(envelope, { audience: 'ui', callerId: 'forged' })
  // @ts-expect-error Consumer identity is injected by the owner-scoped Host facade.
  await host.export({ resourceRef, consumerId: 'forged.consumer' })
  // @ts-expect-error Discard authority is also derived from the active Host invocation.
  await host.discard({ resourceRef, callerId: 'forged' })
}

void compileTimeOwnerScopedFacadeChecks

describe('portable resource reference envelope', () => {
  it('round-trips one canonical, deeply frozen, bounded envelope', () => {
    const serialized = serializePortableResourceReference(envelope)
    assert.equal(
      serialized,
      '{"authority":"provider_instance_alpha","contractVersion":1,"identity":{"logicalId":"logical-123","nested":{"alpha":1,"zeta":2}},"kind":"fixture.logical-resource"}'
    )

    const parsed = parsePortableResourceReference(serialized)
    assert.deepEqual(parsed, {
      authority: 'provider_instance_alpha',
      contractVersion: 1,
      identity: {
        logicalId: 'logical-123',
        nested: { alpha: 1, zeta: 2 }
      },
      kind
    })
    assert.equal(Object.isFrozen(parsed), true)
    assert.equal(Object.isFrozen(parsed.identity), true)
    assert.equal(Object.isFrozen(parsed.identity.nested), true)
    assert.equal(serializePortableResourceReference(parsed), serialized)
    assert.equal(
      canonicalPortableResourceIdentity({ zeta: 2, alpha: 1 }),
      '{"alpha":1,"zeta":2}'
    )
  })

  it('rejects unsupported versions, malformed JSON, extra fields, and unsafe numbers', () => {
    expectPortableError('unsupported_version', () => parsePortableResourceReference({
      ...envelope,
      contractVersion: 2
    }))
    expectPortableError('invalid_envelope', () => parsePortableResourceReference('{'))
    expectPortableError('invalid_envelope', () => parsePortableResourceReference(
      JSON.stringify(envelope)
    ))
    expectPortableError('invalid_envelope', () => parsePortableResourceReference(
      '{"authority":"provider_instance_alpha","authority":"provider_instance_beta","contractVersion":1,"identity":{"logicalId":"logical-123"},"kind":"fixture.logical-resource"}'
    ))
    expectPortableError('invalid_envelope', () => parsePortableResourceReference({
      ...envelope,
      endpoint: 'provider_instance_alpha'
    }))
    expectPortableError('malformed_identity', () => parsePortableResourceReference({
      ...envelope,
      identity: { logicalId: 1.5 }
    }))
    expectPortableError('malformed_identity', () => parsePortableResourceReference({
      ...envelope,
      identity: { logicalId: Number.MAX_SAFE_INTEGER + 1 }
    }))
  })

  it('rejects dangerous prototype keys at every identity depth', () => {
    for (const dangerousKey of ['__proto__', 'constructor', 'prototype']) {
      const serialized = JSON.stringify(envelope).replace(
        '"logicalId":"logical-123"',
        `"logicalId":"logical-123","nestedAttack":{"${dangerousKey}":{"polluted":true}}`
      )
      expectPortableError('malformed_identity', () => parsePortableResourceReference(serialized))
    }

    const inherited = { logicalId: 'logical-123' }
    Object.setPrototypeOf(inherited, { polluted: true })
    expectPortableError('malformed_identity', () => validatePortableIdentity(inherited))
    assert.equal(({} as { polluted?: boolean }).polluted, undefined)
  })

  it('rejects runtime handles, connections, network targets, secrets, paths, and display metadata', () => {
    const hostOwnedHandles = [
      `xfer_${'a'.repeat(32)}`,
      `portal_${'b'.repeat(32)}`
    ]
    const invalidIdentities = [
      { logicalId: 'res_abcdefghijklmnopqrstuvwx' },
      { logicalId: 'cap_abcdefghijklmnopqrstuvwx' },
      ...hostOwnedHandles.map((logicalId) => ({ logicalId })),
      { logicalId: 'connection_abcdefghijklmnop' },
      { logicalId: 'https://provider.invalid/resource' },
      { logicalId: '169.254.169.254' },
      { endpoint: 'provider.invalid' },
      { credential: 'opaque-value' },
      { apiKey: 'opaque-value' },
      { localPath: 'relative-file' },
      { displayName: 'Human label' }
    ]
    for (const identity of invalidIdentities) {
      expectPortableError('malformed_identity', () => validatePortableIdentity(identity))
    }

    for (const logicalId of hostOwnedHandles) {
      expectPortableError('malformed_identity', () => parsePortableResourceReference({
        ...envelope,
        identity: { logicalId }
      }))
    }

    assert.deepEqual(validatePortableIdentity({ logicalId: 'xfer_business-record' }), {
      logicalId: 'xfer_business-record'
    })
    assert.deepEqual(validatePortableIdentity({ logicalId: 'portal_customer-record' }), {
      logicalId: 'portal_customer-record'
    })
  })

  it('enforces string, collection, depth, node, cycle, and serialized-input bounds', () => {
    expectPortableError('malformed_identity', () => validatePortableIdentity({
      logicalId: 'x'.repeat(PORTABLE_RESOURCE_REFERENCE_MAX_STRING_BYTES + 1)
    }))
    expectPortableError('malformed_identity', () => validatePortableIdentity({
      values: Array.from({ length: PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE + 1 }, () => 1)
    }))

    let tooDeep: Record<string, unknown> = { leaf: 1 }
    for (let index = 0; index < 9; index += 1) tooDeep = { nested: tooDeep }
    expectPortableError('malformed_identity', () => validatePortableIdentity(tooDeep))

    const tooManyNodes = {
      values: Array.from({ length: PORTABLE_RESOURCE_REFERENCE_MAX_COLLECTION_SIZE }, (_, index) => ({
        alpha: index,
        beta: index,
        gamma: index,
        delta: index
      }))
    }
    expectPortableError('malformed_identity', () => validatePortableIdentity(tooManyNodes))

    const cyclic: Record<string, unknown> = { logicalId: 'logical-123' }
    cyclic.self = cyclic
    expectPortableError('malformed_identity', () => validatePortableIdentity(cyclic))

    expectPortableError('envelope_too_large', () => parsePortableResourceReference(
      `${JSON.stringify(envelope)}${' '.repeat(PORTABLE_RESOURCE_REFERENCE_MAX_SERIALIZED_BYTES)}`
    ))
  })
})

describe('portable resource composition contracts', () => {
  it('requires the Host-owned Principal lease assertion at resolver and use boundaries', async () => {
    let assertions = 0
    const assertPrincipalCurrent = () => {
      assertions += 1
    }
    const principal = {
      authority: 'local.identity',
      subject: 'alice',
      assurance: 'local-selection' as const,
      deviceId: 'installation-alpha',
      identityVersion: 1
    }
    const resolution = await resolver.resolve({
      envelope: parsePortableResourceReference(envelope),
      identity: { logicalId: 'logical-123' },
      resourceKind,
      authority: { reference: envelope.authority, kind, resolverId },
      principal,
      assertPrincipalCurrent
    })
    await resolution.registration.observe({ principal, assertPrincipalCurrent })
    assert.equal(assertions, 2)
  })

  it('binds declaration contract, runtime value, kind, and exact resolver ID', () => {
    const codecContract = definePortableResourceCodecContributionContract({
      location: MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
      contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
      kind,
      resourceKind,
      resolverId
    })
    const resolverContract = definePortableResourceAuthorityResolverContributionContract({
      location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
      contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
      resolverId,
      kinds: [kind]
    })

    assert.equal(Object.isFrozen(codecContract), true)
    assert.equal(Object.isFrozen(resolverContract), true)
    assert.equal(Object.isFrozen(resolverContract.kinds), true)
    assert.equal(isPortableResourceReferenceCodec(codec), true)
    assert.equal(isPortableResourceAuthorityResolver(resolver), true)
    assert.equal(portableResourceCodecMatchesContract(codecContract, codec), true)
    assert.equal(portableResourceAuthorityResolverMatchesContract(resolverContract, resolver), true)
    assert.equal(portableResourceCodecResolverBindingMatches(codec, resolver), true)

    assert.equal(portableResourceCodecMatchesContract({
      ...codecContract,
      resolverId: 'fixture.other-resolver'
    }, codec), false)
    assert.equal(portableResourceCodecResolverBindingMatches(codec, {
      ...resolver,
      id: 'fixture.other-resolver'
    }), false)
    assert.equal(portableResourceCodecResolverBindingMatches(codec, {
      ...resolver,
      kinds: ['fixture.other-kind']
    }), false)
  })

  it('rejects duplicate, non-canonical, or extra resolver declarations and runtime fields', () => {
    for (const kinds of [
      [kind, kind],
      ['fixture.zeta-kind', 'fixture.alpha-kind']
    ]) {
      assert.equal(portableResourceAuthorityResolverContributionContractSchema.safeParse({
        location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
        contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
        resolverId,
        kinds
      }).success, false)
    }
    assert.equal(portableResourceAuthorityResolverContributionContractSchema.safeParse({
      location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
      contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
      resolverId,
      kinds: [kind],
      fallbackResolverId: 'fixture.fallback-resolver'
    }).success, false)
    assert.equal(isPortableResourceReferenceCodec({ ...codec, fallback: true }), false)
    assert.equal(isPortableResourceAuthorityResolver({ ...resolver, fallback: true }), false)
  })

  it('accepts only canonical Host-injected export consumer owner allowlists', () => {
    assert.equal(isPortableResourceExportProjection({
      consumerModuleIds: ['fixture.allowed-consumer', 'fixture.second-consumer'],
      project: () => ({ logicalId: 'logical-123' })
    }), true)
    assert.equal(isPortableResourceExportProjection({
      consumerModuleIds: ['fixture.second-consumer', 'fixture.allowed-consumer'],
      project: () => ({ logicalId: 'logical-123' })
    }), false)
    assert.equal(isPortableResourceExportProjection({
      consumerModuleIds: ['fixture.allowed-consumer', 'fixture.allowed-consumer'],
      project: () => ({ logicalId: 'logical-123' })
    }), false)
    assert.equal(isPortableResourceExportProjection({
      consumerModuleIds: ['fixture.allowed-consumer'],
      consumerId: 'caller-selected',
      project: () => ({ logicalId: 'logical-123' })
    }), false)
  })

  it('exposes an owner-scoped Host facade with no caller, Principal, or consumer-ID input', async () => {
    const host: DomainMainPortableResourceReferencesHost = Object.freeze({
      materialize: async () => ({
        resource: {
          token: `cap_${'a'.repeat(24)}`,
          semanticRevision: 'revision-1',
          expiresAt: '2026-08-16T00:00:00.000Z'
        },
        resourceRef: `res_${'b'.repeat(24)}`,
        resourceKind
      }),
      discard: async () => undefined,
      export: async () => envelope
    })

    const materialized = await host.materialize(envelope)
    assert.equal(materialized.resourceKind, resourceKind)
    assert.deepEqual(await host.export({ resourceRef: materialized.resourceRef }), envelope)
    await host.discard({ resourceRef: materialized.resourceRef })

  })
})
