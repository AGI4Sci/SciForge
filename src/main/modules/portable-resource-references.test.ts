import { z } from 'zod'
import {
  MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
  MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
  PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
  PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  PortableResourceReferenceError,
  type PortableResourceAuthorityResolver,
  type PortableResourceExportContext,
  type PortableResourceExportProjection,
  type PortableResourceLocalRegistration,
  type PortableResourceReferenceCodec,
  type PortableResourceUseContext
} from '@sciforge/domain-sdk/portable-resource-references'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { describe, expect, it, vi } from 'vitest'
import type { CapabilityCallerContextInput } from '../../shared/capability-broker'
import { CapabilityBroker } from '../capabilities/broker'
import {
  CapabilityRegistry,
  defineCapability,
  type CapabilityResourceRegistration
} from '../capabilities/registry'
import {
  PortableAuthorityResolverRegistry,
  PortableResourceCodecRegistry,
  PortableResourceReferenceService,
  composePortableResourceReferenceRegistries,
  type PortableResourceCapabilityBroker
} from './portable-resource-references'

const kind = 'fixture.logical-resource'
const resourceKind = 'fixture.local-resource'
const resolverId = 'fixture.authority-resolver'
const authority = 'provider_instance_alpha'
const allowedConsumer = {
  moduleId: 'fixture.allowed-consumer',
  moduleVersion: '1.0.0'
}
const deniedConsumer = {
  moduleId: 'fixture.denied-consumer',
  moduleVersion: '1.0.0'
}
const principalA: PrincipalSnapshot = {
  authority: 'local.identity',
  subject: 'alice',
  assurance: 'local-selection',
  deviceId: 'installation-alpha',
  identityVersion: 7
}
const principalB: PrincipalSnapshot = {
  ...principalA,
  subject: 'bob',
  identityVersion: 8
}
const caller: CapabilityCallerContextInput = {
  audience: 'ui',
  callerId: 'window-alpha',
  workspaceId: 'workspace-alpha'
}
const envelope = {
  contractVersion: PORTABLE_RESOURCE_REFERENCE_CONTRACT_VERSION,
  kind,
  authority,
  identity: { resourceId: 'logical-123' }
} as const

function fakeCodec(
  overrides: Partial<PortableResourceReferenceCodec> = {}
): PortableResourceReferenceCodec {
  return Object.freeze({
    location: MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
    contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
    kind,
    resourceKind,
    resolverId,
    decodeIdentity: (identity) => {
      if (Object.keys(identity).length !== 1 ||
        typeof identity.resourceId !== 'string' ||
        !identity.resourceId.startsWith('logical-')) {
        throw new Error('Invalid fixture identity.')
      }
      return { resourceId: identity.resourceId }
    },
    encodeIdentity: (identity: unknown) => ({
      resourceId: (identity as { resourceId: string }).resourceId
    }),
    projectExport: (projection: unknown) => ({
      resourceId: (projection as { stableId: string }).stableId
    }),
    ...overrides
  }) as PortableResourceReferenceCodec
}

function fakeResolver(options: Readonly<{
  id?: string
  kinds?: readonly string[]
  lookup?: PortableResourceAuthorityResolver['lookupAuthority']
  resolve?: PortableResourceAuthorityResolver['resolve']
  observe?: PortableResourceLocalRegistration['observe']
  project?: PortableResourceExportProjection['project']
  dispose?: NonNullable<PortableResourceLocalRegistration['dispose']>
}> = {}): PortableResourceAuthorityResolver {
  const id = options.id ?? resolverId
  const kinds = options.kinds ?? [kind]
  const observe = options.observe ?? vi.fn(async ({ principal }) => ({
    state: { subject: principal.subject },
    semanticRevision: 'revision-1'
  }))
  return Object.freeze({
    location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
    contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
    id,
    kinds,
    lookupAuthority: options.lookup ?? ((input) =>
      input.reference === authority && input.kind === kind
        ? { reference: input.reference, resolverId: id, kind: input.kind }
        : undefined
    ),
    resolve: options.resolve ?? vi.fn(async (input) => ({
      registration: {
        resourceKind,
        workspaceId: 'workspace-alpha',
        audiences: ['ui', 'system'] as const,
        semanticRevision: 'revision-1',
        observe,
        ...(options.dispose ? { dispose: options.dispose } : {})
      },
      exportProjection: {
        consumerModuleIds: [allowedConsumer.moduleId],
        project: options.project ?? vi.fn(async () => ({
          stableId: (input.identity as { resourceId: string }).resourceId
        }))
      }
    }))
  })
}

function ownedCodec(codec = fakeCodec()) {
  return {
    owner: {
      packageName: '@fixture/resource-owner',
      moduleId: 'fixture.resource-owner',
      moduleVersion: '1.0.0',
      contributionId: 'fixture.resource-owner.codec'
    },
    codec
  } as const
}

function ownedResolver(resolver = fakeResolver()) {
  return {
    owner: {
      packageName: '@fixture/integration-owner',
      moduleId: 'fixture.integration-owner',
      moduleVersion: '1.0.0',
      contributionId: 'fixture.integration-owner.resolver'
    },
    resolver
  } as const
}

function serviceFixture(options: Readonly<{
  codec?: PortableResourceReferenceCodec
  resolver?: PortableResourceAuthorityResolver
  principal?: PrincipalSnapshot | undefined
  maxExportBindings?: number
}> = {}) {
  let currentPrincipal = Object.hasOwn(options, 'principal')
    ? options.principal
    : principalA
  const broker = new CapabilityBroker(new CapabilityRegistry(), {
    resolveCurrentPrincipal: () => currentPrincipal ?? null
  })
  const service = new PortableResourceReferenceService({
    broker,
    codecs: new PortableResourceCodecRegistry([ownedCodec(options.codec)]),
    resolvers: new PortableAuthorityResolverRegistry([ownedResolver(options.resolver)]),
    currentPrincipal: () => currentPrincipal,
    ...(options.maxExportBindings === undefined
      ? {}
      : { maxExportBindings: options.maxExportBindings })
  })
  return {
    broker,
    service,
    setPrincipal: (principal: PrincipalSnapshot | undefined) => {
      currentPrincipal = principal
    }
  }
}

function extensionContributions(
  codec = fakeCodec(),
  resolver = fakeResolver()
): DomainMainContribution[] {
  return [
    {
      id: 'fixture.resource-owner.codec',
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: '@fixture/resource-owner',
      owner: {
        moduleId: 'fixture.resource-owner',
        moduleVersion: '1.0.0'
      },
      version: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
      contract: {
        location: MAIN_PORTABLE_RESOURCE_CODEC_LOCATION,
        contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
        kind,
        resourceKind,
        resolverId
      },
      value: codec
    },
    {
      id: 'fixture.integration-owner.resolver',
      kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
      packageName: '@fixture/integration-owner',
      owner: {
        moduleId: 'fixture.integration-owner',
        moduleVersion: '1.0.0'
      },
      version: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
      contract: {
        location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
        contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
        resolverId,
        kinds: [kind]
      },
      value: resolver
    }
  ]
}

function contributionHost(
  contributions: readonly DomainMainContribution[]
): DomainMainContributionHost {
  return Object.freeze({
    list: (requestedKind) =>
      requestedKind === MAIN_EXTENSION_CONTRIBUTION_KIND
        ? contributions
        : Object.freeze([])
  })
}

describe('portable resource reference composition', () => {
  it('binds declaration, contract, runtime value, owner, and exact resolver', () => {
    const registries = composePortableResourceReferenceRegistries(
      contributionHost(extensionContributions())
    )
    expect(registries.codecs.list()).toHaveLength(1)
    expect(registries.resolvers.list()).toHaveLength(1)
    expect(registries.codecs.require(kind).owner.moduleId)
      .toBe('fixture.resource-owner')
    expect(registries.resolvers.require(resolverId, kind).owner.moduleId)
      .toBe('fixture.integration-owner')
  })

  it('fails closed for duplicates, missing resolvers, and manifest-runtime drift', () => {
    expect(() => new PortableResourceCodecRegistry([
      ownedCodec(),
      {
        ...ownedCodec(),
        owner: {
          ...ownedCodec().owner,
          moduleId: 'fixture.other-owner',
          contributionId: 'fixture.other-owner.codec'
        }
      }
    ])).toThrow(expect.objectContaining({ code: 'duplicate_codec' }))

    expect(() => new PortableAuthorityResolverRegistry([
      ownedResolver(),
      {
        ...ownedResolver(),
        owner: {
          ...ownedResolver().owner,
          moduleId: 'fixture.other-owner',
          contributionId: 'fixture.other-owner.resolver'
        }
      }
    ])).toThrow(expect.objectContaining({ code: 'duplicate_resolver' }))
    expect(() => new PortableAuthorityResolverRegistry([
      ownedResolver(),
      {
        owner: {
          ...ownedResolver().owner,
          moduleId: 'fixture.other-owner',
          contributionId: 'fixture.other-owner.resolver'
        },
        resolver: fakeResolver({ id: 'fixture.other-resolver' })
      }
    ])).toThrow(expect.objectContaining({ code: 'duplicate_resolver' }))
    expect(() => new PortableResourceCodecRegistry([{
      ...ownedCodec(),
      owner: {
        ...ownedCodec().owner,
        moduleId: 'not a canonical module id'
      }
    }])).toThrow(expect.objectContaining({ code: 'invalid_resolution' }))

    expect(() => composePortableResourceReferenceRegistries(
      contributionHost(extensionContributions().slice(0, 1))
    )).toThrow(expect.objectContaining({ code: 'unknown_resolver' }))

    const drifted = extensionContributions()
    drifted[0] = {
      ...drifted[0]!,
      version: '2.0.0'
    }
    expect(() => composePortableResourceReferenceRegistries(
      contributionHost(drifted)
    )).toThrow(expect.objectContaining({ code: 'invalid_resolution' }))

    const locationDrifted = extensionContributions()
    locationDrifted[0] = {
      ...locationDrifted[0]!,
      contract: {
        location: MAIN_PORTABLE_AUTHORITY_RESOLVER_LOCATION,
        contractVersion: PORTABLE_RESOURCE_COMPOSITION_CONTRACT_VERSION,
        kind,
        resourceKind,
        resolverId
      }
    }
    expect(() => composePortableResourceReferenceRegistries(
      contributionHost(locationDrifted)
    )).toThrow(expect.objectContaining({ code: 'invalid_resolution' }))
  })

  it('snapshots mutable runtime contributions before activation', () => {
    const mutableCodec = { ...fakeCodec() }
    const mutableResolver = {
      ...fakeResolver(),
      kinds: [kind]
    }
    const codecs = new PortableResourceCodecRegistry([ownedCodec(mutableCodec)])
    const resolvers = new PortableAuthorityResolverRegistry([
      ownedResolver(mutableResolver)
    ])
    const decodeIdentity = mutableCodec.decodeIdentity
    const lookupAuthority = mutableResolver.lookupAuthority

    mutableCodec.resolverId = 'fixture.forged-resolver'
    mutableCodec.decodeIdentity = () => ({ resourceId: 'forged' })
    mutableResolver.kinds[0] = 'fixture.forged-kind'
    mutableResolver.lookupAuthority = () => undefined

    expect(codecs.require(kind).codec.resolverId).toBe(resolverId)
    expect(codecs.require(kind).codec.decodeIdentity).toBe(decodeIdentity)
    expect(resolvers.require(resolverId, kind).resolver.kinds).toEqual([kind])
    expect(resolvers.require(resolverId, kind).resolver.lookupAuthority)
      .toBe(lookupAuthority)
  })

  it('never scans an unrelated resolver while resolving an exact codec binding', async () => {
    const unrelatedLookup = vi.fn(() => {
      throw new Error('Unrelated resolver must not be consulted.')
    })
    const exact = fakeResolver()
    const unrelated = fakeResolver({
      id: 'fixture.unrelated-resolver',
      kinds: ['fixture.unrelated-kind'],
      lookup: unrelatedLookup
    })
    const broker = new CapabilityBroker(new CapabilityRegistry(), {
      resolveCurrentPrincipal: () => principalA
    })
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([
        ownedResolver(exact),
        {
          owner: {
            ...ownedResolver().owner,
            moduleId: 'fixture.unrelated-owner',
            contributionId: 'fixture.unrelated-owner.resolver'
          },
          resolver: unrelated
        }
      ]),
      currentPrincipal: () => principalA
    })

    await service.materialize(envelope, caller)
    expect(unrelatedLookup).not.toHaveBeenCalled()
  })
})

describe('portable resource materialization', () => {
  it('injects a live Host Principal lease into resolve, observe, and export', async () => {
    let resolveLease: (() => void | Promise<void>) | undefined
    let observeLease: (() => void | Promise<void>) | undefined
    let observeSignal: AbortSignal | undefined
    let exportLease: (() => void | Promise<void>) | undefined
    const resolver = fakeResolver({
      resolve: vi.fn(async (input) => {
        resolveLease = input.assertPrincipalCurrent
        await input.assertPrincipalCurrent()
        return {
          registration: {
            resourceKind,
            semanticRevision: 'revision-1',
            observe: async (context: PortableResourceUseContext) => {
              observeLease = context.assertPrincipalCurrent
              observeSignal = context.signal
              await context.assertPrincipalCurrent()
              return { state: {}, semanticRevision: 'revision-1' }
            }
          },
          exportProjection: {
            consumerModuleIds: [allowedConsumer.moduleId],
            project: async (context: PortableResourceExportContext) => {
              exportLease = context.assertPrincipalCurrent
              await context.assertPrincipalCurrent()
              return { stableId: 'logical-123' }
            }
          }
        }
      })
    })
    const fixture = serviceFixture({ resolver })
    const materialized = await fixture.service.materialize(envelope, caller)
    const observeController = new AbortController()
    await fixture.broker.observe(
      caller,
      { resource: materialized.resource },
      { signal: observeController.signal }
    )
    await fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )

    expect(resolveLease).toBeTypeOf('function')
    expect(observeLease).toBeTypeOf('function')
    expect(observeSignal).toBe(observeController.signal)
    expect(exportLease).toBeTypeOf('function')
    fixture.setPrincipal(principalB)
    for (const assertCurrent of [resolveLease, observeLease, exportLease]) {
      await expect(Promise.resolve().then(() => assertCurrent?.()))
        .rejects.toMatchObject({ code: 'principal_changed' })
    }
  })

  it('reauthorizes and observes through the real Principal-scoped Broker path', async () => {
    const observe = vi.fn(async ({ principal }: { principal: PrincipalSnapshot }) => ({
      state: { subject: principal.subject },
      semanticRevision: 'revision-1'
    }))
    const resolver = fakeResolver({ observe })
    const fixture = serviceFixture({ resolver })
    const issue = vi.spyOn(fixture.broker, 'issueResource')

    const materialized = await fixture.service.materialize(envelope, caller)
    expect(issue).toHaveBeenCalledTimes(1)
    expect(materialized.resourceRef).toMatch(/^res_/u)
    expect(materialized.resource.token).toMatch(/^cap_/u)
    expect(JSON.stringify(materialized)).not.toContain('logical-123')

    const first = await fixture.broker.observe(caller, {
      resource: materialized.resource
    })
    expect(first.resourceRef).toBe(materialized.resourceRef)
    expect(first.state).toEqual({ subject: 'alice' })
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({
      principal: principalA,
      assertPrincipalCurrent: expect.any(Function)
    }))

    await fixture.broker.observe(caller, { resource: first.resource })
    expect(observe).toHaveBeenCalledTimes(2)
  })

  it('propagates observation cancellation without dispatching or returning stale state', async () => {
    let settleObservation: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const observationGate = new Promise<void>((resolve) => { settleObservation = resolve })
    const observationStarted = new Promise<void>((resolve) => { markStarted = resolve })
    let providerSignal: AbortSignal | undefined
    const observe = vi.fn(async (context: PortableResourceUseContext) => {
      providerSignal = context.signal
      markStarted?.()
      await observationGate
      await context.assertPrincipalCurrent()
      return { state: {}, semanticRevision: 'revision-1' }
    })
    const fixture = serviceFixture({ resolver: fakeResolver({ observe }) })
    const materialized = await fixture.service.materialize(envelope, caller)

    const cancelledBeforeDispatch = new AbortController()
    cancelledBeforeDispatch.abort()
    await expect(fixture.broker.observe(
      caller,
      { resource: materialized.resource },
      { signal: cancelledBeforeDispatch.signal }
    )).rejects.toMatchObject({ code: 'invocation_cancelled' })
    expect(observe).not.toHaveBeenCalled()

    const cancelledDuringDispatch = new AbortController()
    const pending = fixture.broker.observe(
      caller,
      { resource: materialized.resource },
      { signal: cancelledDuringDispatch.signal }
    )
    await observationStarted
    expect(providerSignal).toBe(cancelledDuringDispatch.signal)
    cancelledDuringDispatch.abort()
    settleObservation?.()
    await expect(pending).rejects.toMatchObject({ code: 'invocation_cancelled' })
    expect(observe).toHaveBeenCalledTimes(1)
  })

  it('does not issue without a Principal or after a rejected reauthorization', async () => {
    const noPrincipal = serviceFixture({ principal: undefined })
    const issueWithoutPrincipal = vi.spyOn(noPrincipal.broker, 'issueResource')
    await expect(noPrincipal.service.materialize(envelope, caller))
      .rejects.toMatchObject({ code: 'principal_unavailable' })
    expect(issueWithoutPrincipal).not.toHaveBeenCalled()

    const resolver = fakeResolver({
      resolve: vi.fn(async () => {
        throw new Error('Provider detail must be bounded away.')
      })
    })
    const rejected = serviceFixture({ resolver })
    const issueRejected = vi.spyOn(rejected.broker, 'issueResource')
    await expect(rejected.service.materialize(envelope, caller))
      .rejects.toMatchObject({ code: 'resolution_rejected' })
    expect(issueRejected).not.toHaveBeenCalled()
  })

  it('maps Principal provider read failures onto the closed portable error surface', async () => {
    const broker = new CapabilityBroker(new CapabilityRegistry(), {
      resolveCurrentPrincipal: () => principalA
    })
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([ownedResolver()]),
      currentPrincipal: () => {
        throw new Error('sensitive provider corruption detail')
      }
    })

    const error = await service.materialize(envelope, caller).catch((caught) => caught)
    expect(error).toMatchObject({ code: 'principal_unavailable' })
    expect(String((error as Error).message)).not.toContain('sensitive')
  })

  it('rejects Principal change and cancellation after async resolution before issuance', async () => {
    let settle: ((value: unknown) => void) | undefined
    const pending = new Promise((resolve) => {
      settle = resolve
    })
    const resolver = fakeResolver({
      resolve: vi.fn(() => pending as ReturnType<PortableResourceAuthorityResolver['resolve']>)
    })
    const changed = serviceFixture({ resolver })
    const changedIssue = vi.spyOn(changed.broker, 'issueResource')
    const changing = changed.service.materialize(envelope, caller)
    changed.setPrincipal(principalB)
    settle?.({
      registration: {
        resourceKind,
        semanticRevision: 'revision-1',
        observe: async () => ({ state: {}, semanticRevision: 'revision-1' })
      }
    })
    await expect(changing).rejects.toMatchObject({ code: 'principal_changed' })
    expect(changedIssue).not.toHaveBeenCalled()

    let settleCancelled: ((value: unknown) => void) | undefined
    const pendingCancelled = new Promise((resolve) => {
      settleCancelled = resolve
    })
    const cancelledResolver = fakeResolver({
      resolve: vi.fn(() =>
        pendingCancelled as ReturnType<PortableResourceAuthorityResolver['resolve']>
      )
    })
    const cancelled = serviceFixture({ resolver: cancelledResolver })
    const cancelledIssue = vi.spyOn(cancelled.broker, 'issueResource')
    const controller = new AbortController()
    const cancelledDispose = vi.fn(async () => undefined)
    const operation = cancelled.service.materialize(
      envelope,
      caller,
      { signal: controller.signal }
    )
    controller.abort()
    settleCancelled?.({
      registration: {
        resourceKind,
        semanticRevision: 'revision-1',
        observe: async () => ({ state: {}, semanticRevision: 'revision-1' }),
        dispose: cancelledDispose
      }
    })
    await expect(operation).rejects.toMatchObject({ code: 'operation_cancelled' })
    expect(cancelledIssue).not.toHaveBeenCalled()
    expect(cancelledDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a completed resolution instead of issuing after shutdown starts', async () => {
    let settle: ((value: unknown) => void) | undefined
    const pending = new Promise((resolve) => {
      settle = resolve
    })
    const dispose = vi.fn(async () => undefined)
    const resolver = fakeResolver({
      resolve: vi.fn(() => pending as ReturnType<PortableResourceAuthorityResolver['resolve']>)
    })
    const fixture = serviceFixture({ resolver })
    const issue = vi.spyOn(fixture.broker, 'issueResource')
    const materializing = fixture.service.materialize(envelope, caller)

    await fixture.service.dispose()
    settle?.({
      registration: {
        resourceKind,
        semanticRevision: 'revision-1',
        observe: async () => ({ state: {}, semanticRevision: 'revision-1' }),
        dispose
      }
    })

    await expect(materializing).rejects.toMatchObject({ code: 'resolution_rejected' })
    expect(issue).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps identical portable identities isolated across Principal leases', async () => {
    const fixture = serviceFixture()
    const forA = await fixture.service.materialize(envelope, caller)
    fixture.setPrincipal(principalB)
    const forB = await fixture.service.materialize(envelope, caller)

    expect(forB.resourceRef).not.toBe(forA.resourceRef)
    await expect(fixture.broker.observe(caller, { resource: forA.resource }))
      .rejects.toMatchObject({ code: 'resource_scope_mismatch' })
  })

  it('rejects forged authority results and never invokes resolution', async () => {
    const resolve = vi.fn()
    const resolver = fakeResolver({
      lookup: ({ reference, kind: requestedKind }) => ({
        reference,
        resolverId: 'fixture.forged-resolver',
        kind: requestedKind
      }),
      resolve
    })
    const fixture = serviceFixture({ resolver })
    await expect(fixture.service.materialize(envelope, caller))
      .rejects.toMatchObject({ code: 'unknown_authority' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('never issues a resource when the domain resolver rejects a forged proof', async () => {
    const resolver = fakeResolver({
      resolve: vi.fn(async () => {
        throw new PortableResourceReferenceError(
          'resolution_rejected',
          'Forged immutable-version proof.'
        )
      })
    })
    const fixture = serviceFixture({ resolver })
    const issue = vi.spyOn(fixture.broker, 'issueResource')
    await expect(fixture.service.materialize(envelope, caller))
      .rejects.toMatchObject({ code: 'resolution_rejected' })
    expect(issue).not.toHaveBeenCalled()
  })

  it('retires resources captured by a stale Principal notification', async () => {
    const dispose = vi.fn(async () => undefined)
    const fixture = serviceFixture({ resolver: fakeResolver({ dispose }) })
    const materialized = await fixture.service.materialize(envelope, caller)
    fixture.setPrincipal(principalB)
    await fixture.service.revokeStalePrincipals(principalB)

    expect(dispose).toHaveBeenCalledTimes(1)
    fixture.setPrincipal(principalA)
    expect(() => fixture.broker.describeResourceRef(caller, materialized.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
  })

  it('force-retires stale Principal resources even while a task retains them', async () => {
    const dispose = vi.fn(async () => undefined)
    const fixture = serviceFixture({ resolver: fakeResolver({ dispose }) })
    const materialized = await fixture.service.materialize(envelope, caller)
    const releaseRetention = fixture.broker.retainResourceRefs(
      caller,
      [materialized.resourceRef]
    )

    fixture.setPrincipal(principalB)
    await fixture.service.revokeStalePrincipals(principalB)

    expect(dispose).toHaveBeenCalledTimes(1)
    fixture.setPrincipal(principalA)
    expect(() => fixture.broker.describeResourceRef(caller, materialized.resourceRef))
      .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    await releaseRetention()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('joins concurrent Principal and shutdown retirement for exact-once disposal', async () => {
    let settleDispose: (() => void) | undefined
    const pendingDispose = new Promise<void>((resolve) => {
      settleDispose = resolve
    })
    const dispose = vi.fn(() => pendingDispose)
    const fixture = serviceFixture({ resolver: fakeResolver({ dispose }) })
    await fixture.service.materialize(envelope, caller)

    fixture.setPrincipal(principalB)
    const revoking = fixture.service.revokeStalePrincipals(principalB)
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
    const shuttingDown = fixture.service.dispose()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledTimes(1)

    settleDispose?.()
    await Promise.all([revoking, shuttingDown])
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps failed retirement poisoned and retries it through lifecycle cleanup', async () => {
    let attempts = 0
    const dispose = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('provider partially released its session')
    })
    const fixture = serviceFixture({ resolver: fakeResolver({ dispose }) })
    const materialized = await fixture.service.materialize(envelope, caller)

    fixture.setPrincipal(principalB)
    await expect(fixture.service.revokeStalePrincipals(principalB)).rejects.toBeDefined()
    expect(dispose).toHaveBeenCalledTimes(1)

    fixture.setPrincipal(principalA)
    await expect(fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )).rejects.toMatchObject({ code: 'unauthorized_export' })

    // Any later Principal notification retries poisoned cleanup. Switching
    // back to the captured Principal must not revive the stale authority.
    await fixture.service.revokeStalePrincipals(principalA)
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})

describe('portable resource export and owner facade', () => {
  it('exports only a live, Principal-bound, owner-authorized fresh projection', async () => {
    const project = vi.fn(async () => ({ stableId: 'logical-123' }))
    const fixture = serviceFixture({ resolver: fakeResolver({ project }) })
    const materialized = await fixture.service.materialize(envelope, caller)

    await expect(fixture.service.exportForOwner(
      deniedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )).rejects.toMatchObject({ code: 'unauthorized_export' })
    expect(project).not.toHaveBeenCalled()

    const exported = await fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )
    expect(exported).toEqual(envelope)
    expect(project).toHaveBeenCalledWith(expect.objectContaining({
      consumer: allowedConsumer,
      principal: principalA,
      assertPrincipalCurrent: expect.any(Function)
    }))

    await fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )
    expect(project).toHaveBeenCalledTimes(2)

    fixture.setPrincipal(principalB)
    await expect(fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )).rejects.toMatchObject({ code: 'unauthorized_export' })
  })

  it('rejects projection leakage before a portable envelope can be emitted', async () => {
    const leakingCodec = fakeCodec({
      projectExport: (projection: unknown) => ({
        resourceId: (projection as { stableId: string }).stableId,
        endpoint: 'https://provider.invalid'
      }),
      encodeIdentity: (identity: unknown) => identity as never
    })
    const fixture = serviceFixture({ codec: leakingCodec })
    const materialized = await fixture.service.materialize(envelope, caller)
    await expect(fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )).rejects.toMatchObject({ code: 'invalid_export_projection' })
  })

  it('rejects an export identity that its pinned codec cannot materialize canonically', async () => {
    const nonCanonicalCodec = fakeCodec({
      projectExport: () => ({ resourceId: 'not-a-logical-resource' })
    })
    const fixture = serviceFixture({ codec: nonCanonicalCodec })
    const materialized = await fixture.service.materialize(envelope, caller)

    await expect(fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )).rejects.toMatchObject({ code: 'invalid_export_projection' })
  })

  it('cancels export after provider projection without invoking the codec', async () => {
    let settleProjection: ((value: { stableId: string }) => void) | undefined
    const pendingProjection = new Promise<{ stableId: string }>((resolve) => {
      settleProjection = resolve
    })
    const projectExport = vi.fn((projection: unknown) => ({
      resourceId: (projection as { stableId: string }).stableId
    }))
    const fixture = serviceFixture({
      codec: fakeCodec({ projectExport }),
      resolver: fakeResolver({ project: vi.fn(() => pendingProjection) })
    })
    const materialized = await fixture.service.materialize(envelope, caller)
    const controller = new AbortController()
    const exporting = fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef },
      { signal: controller.signal }
    )

    controller.abort()
    settleProjection?.({ stableId: 'logical-123' })
    await expect(exporting).rejects.toMatchObject({ code: 'operation_cancelled' })
    expect(projectExport).not.toHaveBeenCalled()
  })

  it('bounds export state and releases bindings with Broker-owned disposal', async () => {
    const registrations: CapabilityResourceRegistration[] = []
    const registrationsByRef = new Map<string, CapabilityResourceRegistration>()
    let sequence = 0
    const fakeBroker: PortableResourceCapabilityBroker = {
      currentInvocation: () => undefined,
      issueResource: (_caller, registration) => {
        registrations.push(registration)
        sequence += 1
        const resourceRef = 'res_' + String(sequence).padEnd(24, 'x')
        registrationsByRef.set(resourceRef, registration)
        return {
          resource: {
            token: 'cap_' + String(sequence).padEnd(24, 'x'),
            semanticRevision: registration.semanticRevision,
            expiresAt: '2099-08-16T00:15:00.000Z'
          },
          resourceRef,
          retire: async () => {
            await registration.dispose?.()
            registrationsByRef.delete(resourceRef)
          }
        }
      },
      bindResourceRef: (_caller, resourceRef) => {
        const registration = registrationsByRef.get(resourceRef)!
        return {
          token: 'cap_' + String(++sequence).padEnd(24, 'x'),
          semanticRevision: registration.semanticRevision,
          expiresAt: '2099-08-16T00:15:00.000Z'
        }
      },
      describeResourceRef: (_caller, resourceRef) => ({ resourceRef, resourceKind })
    }
    const dispose = vi.fn(async () => undefined)
    const service = new PortableResourceReferenceService({
      broker: fakeBroker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([
        ownedResolver(fakeResolver({ dispose }))
      ]),
      currentPrincipal: () => principalA,
      maxExportBindings: 1
    })

    await service.materialize(envelope, caller)
    await expect(service.materialize({
      ...envelope,
      identity: { resourceId: 'logical-456' }
    }, caller)).rejects.toMatchObject({ code: 'export_capacity_exceeded' })

    await registrations[0]!.dispose?.()
    // One cleanup belongs to the rejected over-capacity resolution and one to
    // the retired live registration.
    expect(dispose).toHaveBeenCalledTimes(2)
    await expect(service.materialize({
      ...envelope,
      identity: { resourceId: 'logical-456' }
    }, caller)).resolves.toMatchObject({ resourceKind })
  })

  it('keeps the first canonical export policy when a repeated resolution changes it', async () => {
    let resolution = 0
    const resolver = fakeResolver({
      resolve: vi.fn(async (input) => {
        resolution += 1
        const registration = {
          resourceKind,
          workspaceId: 'workspace-alpha',
          semanticRevision: 'revision-1',
          observe: async () => ({ state: {}, semanticRevision: 'revision-1' })
        }
        if (resolution === 1) return { registration }
        return {
          registration,
          exportProjection: {
            consumerModuleIds: [allowedConsumer.moduleId],
            project: async () => ({
              stableId: (input.identity as { resourceId: string }).resourceId
            })
          }
        }
      })
    })
    const fixture = serviceFixture({
      resolver,
      maxExportBindings: 1
    })
    await fixture.service.materialize(envelope, caller)
    await fixture.service.materialize({
      ...envelope,
      identity: { resourceId: 'logical-456' }
    }, caller)
    const repeated = await fixture.service.materialize(envelope, caller)
    await expect(fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: repeated.resourceRef }
    )).rejects.toMatchObject({ code: 'unauthorized_export' })
  })

  it('reuses canonical Broker state and disposes redundant resolver registration', async () => {
    const firstDispose = vi.fn(async () => undefined)
    const redundantDispose = vi.fn(async () => undefined)
    let resolution = 0
    const resolver = fakeResolver({
      resolve: vi.fn(async (input) => {
        const dispose = resolution++ === 0 ? firstDispose : redundantDispose
        return {
          registration: {
            resourceKind,
            workspaceId: 'workspace-alpha',
            semanticRevision: 'revision-1',
            observe: async () => ({ state: {}, semanticRevision: 'revision-1' }),
            dispose
          },
          exportProjection: {
            consumerModuleIds: [allowedConsumer.moduleId],
            project: async () => ({
              stableId: (input.identity as { resourceId: string }).resourceId
            })
          }
        }
      })
    })
    const fixture = serviceFixture({ resolver })
    const first = await fixture.service.materialize(envelope, caller)
    const second = await fixture.service.materialize(envelope, caller)

    expect(second.resourceRef).toBe(first.resourceRef)
    expect(redundantDispose).toHaveBeenCalledTimes(1)
    expect(firstDispose).not.toHaveBeenCalled()
    await fixture.service.dispose()
    expect(firstDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a repeated resolution that races canonical retirement', async () => {
    let settleCanonicalDispose: (() => void) | undefined
    let settleRepeatedResolution: ((value: unknown) => void) | undefined
    const canonicalDisposeGate = new Promise<void>((resolve) => {
      settleCanonicalDispose = resolve
    })
    const repeatedResolution = new Promise((resolve) => {
      settleRepeatedResolution = resolve
    })
    const canonicalDispose = vi.fn(() => canonicalDisposeGate)
    const repeatedDispose = vi.fn(async () => undefined)
    let resolution = 0
    const resolver = fakeResolver({
      resolve: vi.fn(async () => {
        resolution += 1
        if (resolution > 1) {
          return await repeatedResolution as Awaited<
            ReturnType<PortableResourceAuthorityResolver['resolve']>
          >
        }
        return {
          registration: {
            resourceKind,
            workspaceId: 'workspace-alpha',
            semanticRevision: 'revision-1',
            observe: async () => ({ state: {}, semanticRevision: 'revision-1' }),
            dispose: canonicalDispose
          }
        }
      })
    })
    const fixture = serviceFixture({ resolver })
    await fixture.service.materialize(envelope, caller)
    const repeated = fixture.service.materialize(envelope, caller)
    const retiring = fixture.service.revokeStalePrincipals(principalB)
    await vi.waitFor(() => expect(canonicalDispose).toHaveBeenCalledTimes(1))

    settleRepeatedResolution?.({
      registration: {
        resourceKind,
        workspaceId: 'workspace-alpha',
        semanticRevision: 'revision-1',
        observe: async () => ({ state: {}, semanticRevision: 'revision-1' }),
        dispose: repeatedDispose
      }
    })
    await expect(repeated).rejects.toMatchObject({ code: 'invalid_resolution' })
    expect(repeatedDispose).toHaveBeenCalledTimes(1)

    settleCanonicalDispose?.()
    await retiring
  })

  it('rechecks liveness after provider awaits and rejects export during retirement', async () => {
    let settleProjection: ((value: { stableId: string }) => void) | undefined
    const pendingProjection = new Promise<{ stableId: string }>((resolve) => {
      settleProjection = resolve
    })
    const dispose = vi.fn(async () => undefined)
    const resolver = fakeResolver({
      dispose,
      project: vi.fn(() => pendingProjection)
    })
    const fixture = serviceFixture({ resolver })
    const materialized = await fixture.service.materialize(envelope, caller)
    const exporting = fixture.service.exportForOwner(
      allowedConsumer,
      caller,
      { resourceRef: materialized.resourceRef }
    )
    await fixture.service.dispose()
    settleProjection?.({ stableId: 'logical-123' })

    await expect(exporting).rejects.toMatchObject({ code: 'unauthorized_export' })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('lets the Broker retire only after every portable handle expires', async () => {
    vi.useFakeTimers()
    const dispose = vi.fn(async () => undefined)
    const resolver = fakeResolver({ dispose })
    const broker = new CapabilityBroker(new CapabilityRegistry(), {
      resolveCurrentPrincipal: () => principalA,
      handleTtlMs: 20
    })
    const cleanupErrors = vi.fn()
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([ownedResolver(resolver)]),
      currentPrincipal: () => principalA,
      reportCleanupError: cleanupErrors
    })
    try {
      const first = await service.materialize(envelope, caller)
      await vi.advanceTimersByTimeAsync(10)
      const refreshed = await broker.observe(caller, { resource: first.resource })
      expect(refreshed.resourceRef).toBe(first.resourceRef)
      expect(dispose).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(11)
      expect(broker.describeResourceRef(caller, first.resourceRef))
        .toMatchObject({ resourceRef: first.resourceRef })
      expect(dispose).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(10)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(cleanupErrors).not.toHaveBeenCalled()
      expect(() => broker.describeResourceRef(caller, first.resourceRef))
        .toThrow(expect.objectContaining({ code: 'resource_ref_retired' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('derives the public owner facade caller only from an active Broker invocation', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => principalA
    })
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([ownedResolver()]),
      currentPrincipal: () => principalA
    })
    const facade = service.forOwner(allowedConsumer)
    await expect(facade.materialize(envelope))
      .rejects.toMatchObject({ code: 'unauthorized_export' })

    registry.register(defineCapability({
      id: 'fixture.portable.materialize',
      version: '1.0.0',
      title: 'Materialize fixture resource',
      description: 'Exercises the owner-scoped portable resource facade.',
      audiences: ['ui'],
      scope: 'global',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        resource: z.object({
          token: z.string(),
          semanticRevision: z.string(),
          expiresAt: z.string()
        }).strict(),
        resourceRef: z.string(),
        resourceKind: z.string()
      }).strict(),
      handler: async () => ({
        output: await facade.materialize(envelope)
      })
    }))

    const result = await broker.invoke(caller, {
      actionId: 'fixture.portable.materialize',
      input: {}
    })
    expect(result.output).toMatchObject({ resourceKind })
  })

  it('binds process-local materialization to the exact Host system execution and discards it', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => principalA
    })
    const resolver = fakeResolver()
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([ownedResolver(resolver)]),
      currentPrincipal: () => principalA
    })
    const facade = service.forOwner(allowedConsumer)
    const resultSchema = z.object({
      resourceRef: z.string().nullable(),
      usable: z.boolean(),
      exportable: z.boolean()
    }).strict()
    registry.register(defineCapability({
      id: 'fixture.portable.system-process-local',
      version: '1.0.0',
      title: 'Use one process-local portable resource',
      description: 'Characterizes caller, Principal, Workspace, and execution binding.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({
        action: z.enum(['materialize', 'probe', 'discard']),
        resourceRef: z.string().optional()
      }).strict(),
      outputSchema: resultSchema,
      handler: async (input, context) => {
        if (input.action === 'materialize') {
          const materialized = await facade.materialize(envelope, {
            exportPolicy: 'forbid'
          })
          let exportable = true
          try {
            await facade.export({ resourceRef: materialized.resourceRef })
          } catch {
            exportable = false
          }
          return {
            output: {
              resourceRef: materialized.resourceRef,
              usable: true,
              exportable
            }
          }
        }
        if (!input.resourceRef) throw new Error('A process-local resource reference is required.')
        if (input.action === 'discard') {
          await facade.discard({ resourceRef: input.resourceRef })
        }
        let usable = true
        try {
          broker.describeResourceRef(context.caller, input.resourceRef)
        } catch {
          usable = false
        }
        return {
          output: {
            resourceRef: input.resourceRef,
            usable,
            exportable: false
          }
        }
      }
    }))
    let invocationSequence = 0
    const invoke = async (
      callerId: string,
      executionId: string,
      input: Readonly<{
        action: 'materialize' | 'probe' | 'discard'
        resourceRef?: string
      }>
    ) => broker.invokeHostSystem({
      callerId,
      workspaceId: 'workspace-alpha',
      systemExecutionContext: {
        contractVersion: 1,
        projectId: 'project-alpha',
        taskId: 'task-alpha',
        executionId,
        executionRevision: 3
      }
    }, {
      actionId: 'fixture.portable.system-process-local',
      invocationId: `fixture-portable-process-local-${++invocationSequence}`,
      input
    })

    const issued = resultSchema.parse((await invoke(
      'domain-runtime:fixture.session',
      'execution-alpha',
      { action: 'materialize' }
    )).output)
    expect(issued.resourceRef).toMatch(/^res_/u)
    expect(issued.exportable).toBe(false)

    const sameExecution = resultSchema.parse((await invoke(
      'domain-runtime:fixture.session',
      'execution-alpha',
      { action: 'probe', resourceRef: issued.resourceRef! }
    )).output)
    expect(sameExecution.usable).toBe(true)

    const otherExecution = resultSchema.parse((await invoke(
      'domain-runtime:fixture.session',
      'execution-beta',
      { action: 'probe', resourceRef: issued.resourceRef! }
    )).output)
    expect(otherExecution.usable).toBe(false)

    const otherCaller = resultSchema.parse((await invoke(
      'domain-runtime:fixture.other',
      'execution-alpha',
      { action: 'probe', resourceRef: issued.resourceRef! }
    )).output)
    expect(otherCaller.usable).toBe(false)

    const discarded = resultSchema.parse((await invoke(
      'domain-runtime:fixture.session',
      'execution-alpha',
      { action: 'discard', resourceRef: issued.resourceRef! }
    )).output)
    expect(discarded.usable).toBe(false)
  })

  it('rejects a system materialization without Host-derived execution context before resolution', async () => {
    const registry = new CapabilityRegistry()
    const broker = new CapabilityBroker(registry, {
      resolveCurrentPrincipal: () => principalA
    })
    const resolve = vi.fn(fakeResolver().resolve)
    const resolver = fakeResolver({ resolve })
    const issue = vi.spyOn(broker, 'issueResource')
    const service = new PortableResourceReferenceService({
      broker,
      codecs: new PortableResourceCodecRegistry([ownedCodec()]),
      resolvers: new PortableAuthorityResolverRegistry([ownedResolver(resolver)]),
      currentPrincipal: () => principalA
    })
    const facade = service.forOwner(allowedConsumer)
    registry.register(defineCapability({
      id: 'fixture.portable.system-context-required',
      version: '1.0.0',
      title: 'Require one Host system execution context',
      description: 'Rejects system materialization without Host-derived execution authority.',
      audiences: ['system'],
      scope: 'workspace',
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      handler: async () => {
        await facade.materialize(envelope, { exportPolicy: 'forbid' })
        return { output: { ok: true as const } }
      }
    }))

    await expect(broker.invokeHostSystem({
      callerId: 'domain-runtime:fixture.session',
      workspaceId: 'workspace-alpha'
    }, {
      actionId: 'fixture.portable.system-context-required',
      invocationId: 'fixture-portable-system-context-required',
      input: {}
    })).rejects.toMatchObject({ code: 'handler_failed' })
    expect(resolve).not.toHaveBeenCalled()
    expect(issue).not.toHaveBeenCalled()
  })
})
