import { describe, expect, it, vi } from 'vitest'
import {
  BIOLOGY_ROOM_CAPABILITY_IDS,
  BIOLOGY_ROOM_DEFAULT_OBSERVE_ANNOTATION_LIMIT,
  BIOLOGY_ROOM_DEFAULT_OBSERVE_ASSET_LIMIT,
  BIOLOGY_ROOM_DEFAULT_OBSERVE_CONTIG_LIMIT,
  BIOLOGY_ROOM_RESOURCE_KIND,
  type BiologyRoomManifest,
  type BiologyRoomObserveResult
} from './contract.js'
import { domainPackageDefinition } from './definition.js'
import {
  createDomainMainEntry,
  type BiologyRoomCapabilityHandlerContext,
  type BiologyRoomCapabilityOptions,
  type BiologyRoomCapabilityResourceRegistration,
  type BiologyRoomServicePort
} from './main.js'

const now = '2026-07-22T00:00:00.000Z'

function manifest(revision = 1): BiologyRoomManifest {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Room',
    revision,
    assets: [],
    viewerStates: {},
    annotations: [],
    createdAt: now,
    updatedAt: now
  }
}

function observation(revision = 1): BiologyRoomObserveResult {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    title: 'Room',
    revision,
    viewerStates: {},
    assets: [],
    annotations: [],
    visibleTrackIds: [],
    truncated: { assets: false, annotations: false, contigs: false },
    updatedAt: now
  }
}

function service(): BiologyRoomServicePort {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => manifest()),
    openOrCreate: vi.fn(async () => ({ created: true, manifest: manifest() })),
    load: vi.fn(async () => manifest()),
    observe: vi.fn(async () => observation()),
    apply: vi.fn(async (input) => ({
      dryRun: false,
      changed: true,
      previousRevision: input.baseRevision,
      revision: input.baseRevision + 1,
      manifest: manifest(input.baseRevision + 1),
      warnings: []
    })),
    refresh: vi.fn(async () => ({
      dryRun: false,
      changed: false,
      previousRevision: 1,
      revision: 1,
      manifest: manifest(),
      warnings: []
    })),
    history: vi.fn(async () => ({
      roomId: 'room-1',
      currentRevision: 1,
      entries: [],
      truncated: false
    }))
  }
}

function buildEntry() {
  const definitions: BiologyRoomCapabilityOptions[] = []
  let created = 0
  const services: BiologyRoomServicePort[] = []
  const entry = createDomainMainEntry({
    defineCapability: (definition) => {
      definitions.push(definition as BiologyRoomCapabilityOptions)
      return definition
    },
    getUserDataDir: () => '/tmp/unused',
    createService: () => {
      created += 1
      const next = service()
      services.push(next)
      return next
    }
  })
  return { entry, definitions, services, created: () => created }
}

function strictResourceIssuer() {
  const live = new Map<string, BiologyRoomCapabilityResourceRegistration>()
  const issuedKeys = new Map<BiologyRoomCapabilityResourceRegistration, string>()
  const issued: BiologyRoomCapabilityResourceRegistration[] = []
  const registrationKey = (
    registration: BiologyRoomCapabilityResourceRegistration,
    caller: BiologyRoomCapabilityHandlerContext['caller']
  ) =>
    JSON.stringify([
      registration.workspaceId,
      registration.resourceKind,
      registration.resourceId,
      [...registration.audiences].sort(),
      caller.principalContextVersion ?? caller.principal?.identityVersion ?? 0,
      caller.principal
        ? [
            caller.principal.authority,
            caller.principal.subject,
            caller.principal.assurance,
            caller.principal.deviceId,
            caller.principal.identityVersion
          ]
        : null
    ])
  const issueResourceFor = (caller: BiologyRoomCapabilityHandlerContext['caller']) =>
    (registration: BiologyRoomCapabilityResourceRegistration) => {
      const key = registrationKey(registration, caller)
      const existing = live.get(key)
      if (existing && (
        existing.observe !== registration.observe ||
        existing.dispose !== registration.dispose
      )) {
        throw new Error('resource_registration_conflict')
      }
      live.set(key, registration)
      issuedKeys.set(registration, key)
      issued.push(registration)
      return {
        token: `cap_${issued.length.toString().padStart(20, '0')}`,
        semanticRevision: registration.semanticRevision,
        expiresAt: now
      }
    }
  return {
    issued,
    issueResource: issueResourceFor({}),
    issueResourceFor,
    async retire(registration: BiologyRoomCapabilityResourceRegistration) {
      const key = issuedKeys.get(registration)
      if (!key) throw new Error('resource_unavailable')
      const existing = live.get(key)
      if (!existing) throw new Error('resource_unavailable')
      live.delete(key)
      await existing.dispose()
    }
  }
}

describe('Biology Room main domain entry', () => {
  it('matches its manifest and owns one lazy, disposable service', async () => {
    const harness = buildEntry()
    expect(harness.entry.definition).toBe(domainPackageDefinition)
    expect(harness.entry.contributions.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      'main.capability-factory:biology-room.capabilities'
    ])

    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    expect(factory.createDefinitions()).toHaveLength(8)
    expect(harness.created()).toBe(0)

    await harness.definitions[0]!.handler({}, {
      caller: { workspaceId: '/workspace' },
      issueResource: () => ({})
    })
    expect(harness.created()).toBe(1)
    harness.entry.contributions[0]!.onDispose?.()
    await harness.definitions[0]!.handler({}, {
      caller: { workspaceId: '/workspace' },
      issueResource: () => ({})
    })
    expect(harness.created()).toBe(2)
  })

  it('creates a room through the canonical service and issues an observable resource', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const create = harness.definitions.find((definition) =>
      definition.id === BIOLOGY_ROOM_CAPABILITY_IDS.create
    )!
    const issued: unknown[] = []
    const input = create.inputSchema.parse({ title: 'Room' })
    expect(() => create.inputSchema.parse({ title: '', unknown: true })).toThrow()
    const result = await create.handler(
      input,
      {
        caller: { workspaceId: '/workspace' },
        issueResource: (registration) => {
          issued.push(registration)
          return { token: 'opaque', semanticRevision: registration.semanticRevision, expiresAt: now }
        }
      }
    )

    expect(harness.services[0]!.create).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      title: 'Room',
      assets: []
    })
    expect(result.output).toMatchObject({ manifest: { roomId: 'room-1' } })
    expect(issued[0]).toMatchObject({
      resourceId: 'room-1',
      resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
      workspaceId: '/workspace',
      semanticRevision: '1'
    })
  })

  it('keeps one Broker registration callback per canonical room identity', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const create = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.create
    )!
    const load = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.load
    )!
    const open = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.open
    )!
    const issuer = strictResourceIssuer()
    const firstContext = {
      caller: { workspaceId: '/workspace' },
      issueResource: issuer.issueResource
    }

    await create.handler({ title: 'Room' }, firstContext)
    await create.handler({ title: 'Room' }, firstContext)
    await load.handler({ roomId: 'room-1' }, firstContext)
    await open.handler({ roomId: 'room-1', assetLimit: 1 }, firstContext)

    expect(issuer.issued).toHaveLength(4)
    expect(issuer.issued.slice(1).every((registration) =>
      registration.observe === issuer.issued[0]!.observe
    )).toBe(true)
    expect(issuer.issued.slice(1).every((registration) =>
      registration.dispose === issuer.issued[0]!.dispose
    )).toBe(true)
    expect(issuer.issued.every((registration) =>
      registration.retireAfterLastHandleExpires
    )).toBe(true)

    await issuer.issued[0]!.observe()
    expect(harness.services[0]!.observe).toHaveBeenLastCalledWith({
      workspaceRoot: '/workspace',
      roomId: 'room-1',
      assetLimit: BIOLOGY_ROOM_DEFAULT_OBSERVE_ASSET_LIMIT,
      annotationLimit: BIOLOGY_ROOM_DEFAULT_OBSERVE_ANNOTATION_LIMIT,
      contigLimit: BIOLOGY_ROOM_DEFAULT_OBSERVE_CONTIG_LIMIT
    })

    const original = issuer.issued[0]!
    await issuer.retire(issuer.issued[3]!)
    await open.handler({ roomId: 'room-1' }, firstContext)
    const replacement = issuer.issued[4]!
    expect(replacement.observe).not.toBe(original.observe)
    expect(replacement.dispose).not.toBe(original.dispose)

    original.dispose()
    await open.handler({ roomId: 'room-1' }, firstContext)
    expect(issuer.issued[5]!.observe).toBe(replacement.observe)
    expect(issuer.issued[5]!.dispose).toBe(replacement.dispose)

    await open.handler(
      { roomId: 'room-1' },
      {
        caller: { workspaceId: '/workspace-2' },
        issueResource: issuer.issueResource
      }
    )
    expect(issuer.issued[6]!.observe).not.toBe(replacement.observe)

    harness.entry.contributions[0]!.onDispose?.()
    let afterContributionDispose: BiologyRoomCapabilityResourceRegistration | undefined
    await open.handler(
      { roomId: 'room-1' },
      {
        caller: { workspaceId: '/workspace' },
        issueResource: (registration) => {
          afterContributionDispose = registration
          return {}
        }
      }
    )
    expect(afterContributionDispose!.observe).not.toBe(replacement.observe)
    expect(afterContributionDispose!.dispose).not.toBe(replacement.dispose)
  })

  it('bounds live room registration bindings and reclaims disposed capacity', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const open = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.open
    )!
    const create = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.create
    )!
    const openOrCreate = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate
    )!
    let first: BiologyRoomCapabilityResourceRegistration | undefined
    const issueResource = (registration: BiologyRoomCapabilityResourceRegistration) => {
      first ??= registration
      return {}
    }

    for (let index = 0; index < 500; index += 1) {
      await open.handler(
        { roomId: `room-${index}` },
        { caller: { workspaceId: '/workspace' }, issueResource }
      )
    }
    await expect(open.handler(
      { roomId: 'room-over-capacity' },
      { caller: { workspaceId: '/workspace' }, issueResource }
    )).rejects.toThrow('Biology Room resource binding capacity was exceeded.')
    const service = harness.services[0]!
    expect(service.observe).toHaveBeenCalledTimes(500)
    await expect(create.handler(
      { title: 'Over capacity' },
      { caller: { workspaceId: '/workspace' }, issueResource }
    )).rejects.toThrow('Biology Room resource binding capacity was exceeded.')
    await expect(openOrCreate.handler(
      { path: 'over-capacity.pdb' },
      { caller: { workspaceId: '/workspace' }, issueResource }
    )).rejects.toThrow('Biology Room resource binding capacity was exceeded.')
    expect(service.create).not.toHaveBeenCalled()
    expect(service.openOrCreate).not.toHaveBeenCalled()

    first!.dispose()
    await expect(open.handler(
      { roomId: 'room-after-dispose' },
      { caller: { workspaceId: '/workspace' }, issueResource }
    )).resolves.toBeDefined()
  })

  it('isolates bindings by exact Principal lease and retiring A leaves B stable', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const open = harness.definitions.find((candidate) =>
      candidate.id === BIOLOGY_ROOM_CAPABILITY_IDS.open
    )!
    const issuer = strictResourceIssuer()
    const callerA = {
      workspaceId: '/workspace',
      principalContextVersion: 1,
      principal: {
        authority: 'local',
        subject: 'user-a',
        assurance: 'local-selection',
        deviceId: 'device-a',
        identityVersion: 1
      }
    } as const
    const callerB = {
      workspaceId: '/workspace',
      principalContextVersion: 2,
      principal: {
        authority: 'local',
        subject: 'user-b',
        assurance: 'local-selection',
        deviceId: 'device-a',
        identityVersion: 2
      }
    } as const

    await open.handler(
      { roomId: 'room-1' },
      { caller: callerA, issueResource: issuer.issueResourceFor(callerA) }
    )
    await open.handler(
      { roomId: 'room-1' },
      { caller: callerB, issueResource: issuer.issueResourceFor(callerB) }
    )
    expect(issuer.issued[1]!.observe).not.toBe(issuer.issued[0]!.observe)
    expect(issuer.issued[1]!.dispose).not.toBe(issuer.issued[0]!.dispose)

    await issuer.retire(issuer.issued[0]!)
    await open.handler(
      { roomId: 'room-1' },
      { caller: callerB, issueResource: issuer.issueResourceFor(callerB) }
    )
    expect(issuer.issued[2]!.observe).toBe(issuer.issued[1]!.observe)
    expect(issuer.issued[2]!.dispose).toBe(issuer.issued[1]!.dispose)
  })

  it('applies resource-scoped operations with optimistic revision semantics', async () => {
    const harness = buildEntry()
    const factory = harness.entry.contributions[0]!.value as {
      createDefinitions(): readonly BiologyRoomCapabilityOptions[]
    }
    factory.createDefinitions()
    const apply = harness.definitions.find((definition) =>
      definition.id === BIOLOGY_ROOM_CAPABILITY_IDS.apply
    )!
    const input = apply.inputSchema.parse({
      operations: [{ type: 'setActiveAsset', assetId: 'asset-1' }]
    })
    expect(() => apply.inputSchema.parse({ operations: [] })).toThrow()
    const result = await apply.handler(
      input,
      {
        caller: { workspaceId: '/workspace' },
        resource: {
          resourceId: 'room-1',
          workspaceId: '/workspace',
          semanticRevision: '4'
        },
        issueResource: vi.fn()
      }
    )

    expect(harness.services[0]!.apply).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      roomId: 'room-1',
      baseRevision: 4,
      dryRun: false,
      operations: [{ type: 'setActiveAsset', assetId: 'asset-1' }]
    })
    expect(result).toMatchObject({ changed: true, semanticRevision: '5' })
  })
})
