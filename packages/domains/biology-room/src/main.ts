import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import { z } from 'zod'
import {
  BIOLOGY_ROOM_CAPABILITY_IDS,
  BIOLOGY_ROOM_MAX_ASSETS,
  BIOLOGY_ROOM_RESOURCE_KIND,
  biologyRoomApplyInputSchema,
  biologyRoomCreateInputSchema,
  biologyRoomFormatSchema,
  biologyRoomHistoryInputSchema,
  biologyRoomIdSchema,
  biologyRoomListInputSchema,
  biologyRoomObserveInputSchema,
  biologyRoomOpenOrCreateInputSchema,
  biologyRoomRefreshInputSchema,
  biologyRoomTargetSchema,
  type BiologyRoomApplyInput,
  type BiologyRoomHistoryInput,
  type BiologyRoomObserveInput
} from './contract.js'
import {
  BIOLOGY_ROOM_CAPABILITY_FACTORY_CONTRIBUTION,
  BIOLOGY_ROOM_DOMAIN_MODULE_ID,
  domainPackageDefinition
} from './definition.js'
import { BiologyRoomService } from './service.js'

export { BiologyRoomService } from './service.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'compute' | 'workspace-write'
// Matches the bounded room discovery surface; additional live identities fail closed.
const BIOLOGY_ROOM_RESOURCE_BINDING_LIMIT = 500

const biologyRoomApplyWireSchema = z.object({
  dryRun: z.boolean().optional(),
  operations: z.array(z.unknown()).min(1).max(100),
  actor: z.unknown().optional()
}).strict()
const biologyRoomCreateWireSchema = z.object({
  roomId: biologyRoomIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
  assets: z.array(z.unknown()).max(BIOLOGY_ROOM_MAX_ASSETS).optional(),
  actor: z.unknown().optional()
}).strict()
const biologyRoomOpenOrCreateWireSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  format: biologyRoomFormatSchema.optional(),
  asReference: z.boolean().optional(),
  indexPaths: z.array(z.string().trim().min(1).max(4_096)).max(4).optional(),
  referenceAssetId: z.string().trim().min(1).max(256).optional(),
  actor: z.unknown().optional()
}).strict()
const biologyRoomLoadWireSchema = z.object({ roomId: biologyRoomIdSchema }).strict()
const biologyRoomRefreshWireSchema = z.object({ actor: z.unknown().optional() }).strict()

export type BiologyRoomCapabilityResourceRegistration = Readonly<{
  resourceId: string
  resourceKind: typeof BIOLOGY_ROOM_RESOURCE_KIND
  workspaceId: string
  audiences: CapabilityAudience[]
  semanticRevision: string
  retireAfterLastHandleExpires: true
  observe: () => Promise<Readonly<{
    semanticRevision: string
    state: unknown
    operationIds: string[]
  }>>
  dispose: () => void
}>

type BiologyRoomCapabilityCaller = Readonly<{
  workspaceId?: string
  principal?: PrincipalSnapshot
  principalContextVersion?: number
}>

export type BiologyRoomCapabilityHandlerContext = Readonly<{
  caller: BiologyRoomCapabilityCaller
  resource?: Readonly<{
    resourceId: string
    workspaceId?: string
    semanticRevision: string
  }>
  issueResource: (registration: BiologyRoomCapabilityResourceRegistration) => unknown
}>

export type BiologyRoomCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'workspace' | 'resource'
  resourceKinds?: readonly string[]
  effect: CapabilityEffect
  approval: 'none'
  concurrency: Readonly<{
    revision: 'none' | 'optimistic'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: any,
    context: BiologyRoomCapabilityHandlerContext
  ) => { output: unknown; changed?: boolean; semanticRevision?: string } |
    Promise<{ output: unknown; changed?: boolean; semanticRevision?: string }>
}>

/** Injected by the main host so the package never imports application internals. */
export type BiologyRoomCapabilityBuilder<CapabilityDefinition = unknown> = (
  options: BiologyRoomCapabilityOptions
) => CapabilityDefinition

export type BiologyRoomServicePort = Pick<BiologyRoomService,
  | 'create'
  | 'openOrCreate'
  | 'load'
  | 'list'
  | 'observe'
  | 'apply'
  | 'refresh'
  | 'history'
>

export type BiologyRoomCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof BIOLOGY_ROOM_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'biology-room'
    title: 'Biology Room'
    directTransportPrefixes: readonly ['biologyRoom:']
    allowedDirectTransports: readonly []
  }>
  createDefinitions: () => readonly CapabilityDefinition[]
}>

export type BiologyRoomMainContribution<CapabilityDefinition = unknown> =
  BiologyRoomCapabilityFactory<CapabilityDefinition>

type BiologyRoomMainHost = DomainMainHost & Readonly<{
  createService?: () => BiologyRoomServicePort
}>

type BiologyRoomCapabilityFactoryOptions<CapabilityDefinition> = Readonly<{
  defineCapability: BiologyRoomCapabilityBuilder<CapabilityDefinition>
  getService: () => BiologyRoomServicePort
}>

/**
 * Creates the raw main-process entry for the trusted package. The service is
 * instantiated only when a capability or another package actually requests it.
 */
export function createDomainMainEntry(
  host: BiologyRoomMainHost
): TrustedDomainProcessEntryInput<BiologyRoomMainContribution> {
  let service: BiologyRoomServicePort | undefined
  const getService = (): BiologyRoomServicePort => {
    service ??= (host.createService ?? (() => new BiologyRoomService()))()
    return service
  }
  const resourceBindings = createBiologyRoomResourceBindings(getService)
  const capabilityFactory = createBiologyRoomCapabilityFactoryWithBindings({
    defineCapability: host.defineCapability,
    getService
  }, resourceBindings)
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...BIOLOGY_ROOM_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory,
        onDispose: () => {
          resourceBindings.dispose()
          service = undefined
        }
      }
    ]
  }
}

export function createBiologyRoomCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability: BiologyRoomCapabilityBuilder<CapabilityDefinition>
  getService: () => BiologyRoomServicePort
}>): BiologyRoomCapabilityFactory<CapabilityDefinition> {
  return createBiologyRoomCapabilityFactoryWithBindings(
    options,
    createBiologyRoomResourceBindings(options.getService)
  )
}

function createBiologyRoomCapabilityFactoryWithBindings<CapabilityDefinition>(
  options: BiologyRoomCapabilityFactoryOptions<CapabilityDefinition>,
  resourceBindings: BiologyRoomResourceBindings
): BiologyRoomCapabilityFactory<CapabilityDefinition> {
  const { defineCapability, getService } = options
  const outputSchema = z.json()

  return Object.freeze({
    moduleId: BIOLOGY_ROOM_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'biology-room' as const,
      title: 'Biology Room' as const,
      directTransportPrefixes: Object.freeze(['biologyRoom:']) as readonly ['biologyRoom:'],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.list,
        version: '1.0.0',
        title: 'List Biology Rooms',
        description: 'Lists Biology Rooms in the caller workspace.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['biology', 'room', 'discovery'],
        inputSchema: biologyRoomListInputSchema.omit({ workspaceRoot: true }),
        outputSchema,
        handler: async (input, context) => ({
          output: await getService().list({
            workspaceRoot: requireCallerWorkspace(context),
            ...input
          })
        })
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.create,
        version: '1.0.0',
        title: 'Create Biology Room',
        description: 'Creates a Biology Room in the caller workspace and returns a scoped resource handle.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace', effect: 'workspace-write', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['biology', 'room', 'create'],
        inputSchema: biologyRoomCreateWireSchema,
        outputSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireCallerWorkspace(context)
          const reservation = resourceBindings.reserveUnknown(workspaceRoot, context.caller)
          try {
            const manifest = await getService().create(
              biologyRoomCreateInputSchema.parse({ workspaceRoot, ...input })
            )
            const resource = context.issueResource(reservation.registration(
              { workspaceRoot, roomId: manifest.roomId },
              manifest.revision
            ))
            reservation.commit()
            return { output: { manifest, resource } }
          } catch (error) {
            reservation.rollback()
            throw error
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate,
        version: '1.0.0',
        title: 'Open or create Biology Room',
        description: 'Opens the room for a workspace biology asset, creating it when needed.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace', effect: 'workspace-write', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['biology', 'room', 'open'],
        inputSchema: biologyRoomOpenOrCreateWireSchema,
        outputSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireCallerWorkspace(context)
          const reservation = resourceBindings.reserveUnknown(workspaceRoot, context.caller)
          try {
            const result = await getService().openOrCreate(
              biologyRoomOpenOrCreateInputSchema.parse({ workspaceRoot, ...input })
            )
            const resource = context.issueResource(reservation.registration(
              { workspaceRoot, roomId: result.manifest.roomId },
              result.manifest.revision
            ))
            reservation.commit()
            return { output: { ...result, resource } }
          } catch (error) {
            reservation.rollback()
            throw error
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.load,
        version: '1.0.0',
        title: 'Load Biology Room',
        description: 'Loads a Biology Room manifest and returns its scoped resource handle.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['biology', 'room', 'load'],
        inputSchema: biologyRoomLoadWireSchema,
        outputSchema,
        handler: async (input, context) => {
          const workspaceRoot = requireCallerWorkspace(context)
          const target = { workspaceRoot, roomId: input.roomId }
          const reservation = resourceBindings.reserveKnown(target, context.caller)
          try {
            const manifest = await getService().load(target)
            const resource = context.issueResource(reservation.registration(
              { workspaceRoot, roomId: manifest.roomId },
              manifest.revision
            ))
            reservation.commit()
            return { output: { manifest, resource } }
          } catch (error) {
            reservation.rollback()
            throw error
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.open,
        version: '1.0.0',
        title: 'Open Biology Room resource',
        description: 'Observes a Biology Room and returns a scoped resource handle.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'workspace', effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['biology', 'room'],
        inputSchema: biologyRoomObserveInputSchema.omit({ workspaceRoot: true }),
        outputSchema,
        handler: async (input, context) => {
          const target = biologyRoomObserveInputSchema.parse({
            workspaceRoot: requireCallerWorkspace(context),
            ...input
          })
          const reservation = resourceBindings.reserveKnown(target, context.caller)
          try {
            const observation = await getService().observe(target)
            const resource = context.issueResource(reservation.registration(
              target,
              observation.revision
            ))
            reservation.commit()
            return { output: { observation, resource } }
          } catch (error) {
            reservation.rollback()
            throw error
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.apply,
        version: '1.0.0',
        title: 'Apply Biology Room operations',
        description: 'Applies revisioned Biology Room operations using the canonical service.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'resource', resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
        effect: 'workspace-write', approval: 'none',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['biology', 'room', 'edit'],
        inputSchema: biologyRoomApplyWireSchema,
        outputSchema,
        handler: async (input, context) => {
          const resource = requireResource(context)
          const request: BiologyRoomApplyInput = biologyRoomApplyInputSchema.parse({
            ...input,
            workspaceRoot: requireResourceWorkspace(resource),
            roomId: resource.resourceId,
            baseRevision: parseRevision(resource.semanticRevision)
          })
          const result = await getService().apply(request)
          const changed = result.changed && !result.dryRun
          return {
            output: result,
            changed,
            ...(changed ? { semanticRevision: String(result.revision) } : {})
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
        version: '1.0.0',
        title: 'Refresh Biology Room assets',
        description: 'Refreshes source-backed assets in the current Biology Room.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'resource', resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
        effect: 'workspace-write', approval: 'none',
        concurrency: { revision: 'optimistic', idempotency: 'required' },
        tags: ['biology', 'room', 'refresh'],
        inputSchema: biologyRoomRefreshWireSchema,
        outputSchema,
        handler: async (input, context) => {
          const resource = requireResource(context)
          const result = await getService().refresh(
            biologyRoomRefreshInputSchema.parse({
              ...input,
              workspaceRoot: requireResourceWorkspace(resource),
              roomId: resource.resourceId
            })
          )
          return {
            output: result,
            changed: result.changed,
            ...(result.changed ? { semanticRevision: String(result.revision) } : {})
          }
        }
      }),
      defineCapability({
        id: BIOLOGY_ROOM_CAPABILITY_IDS.history,
        version: '1.0.0',
        title: 'Read Biology Room history',
        description: 'Returns bounded revision history for the current Biology Room.',
        audiences: ['ui', 'agent', 'system'],
        scope: 'resource', resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
        effect: 'read', approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['biology', 'room', 'history'],
        inputSchema: biologyRoomHistoryInputSchema.omit({ workspaceRoot: true, roomId: true }),
        outputSchema,
        handler: async (input, context) => {
          const resource = requireResource(context)
          const request: BiologyRoomHistoryInput = {
            ...input,
            workspaceRoot: requireResourceWorkspace(resource),
            roomId: resource.resourceId
          }
          return { output: await getService().history(request) }
        }
      })
    ]
  })
}

type BiologyRoomResourceReservation = Readonly<{
  registration: (
    target: BiologyRoomObserveInput,
    revision: number
  ) => BiologyRoomCapabilityResourceRegistration
  commit: () => void
  rollback: () => void
}>

type BiologyRoomResourceBindings = Readonly<{
  reserveKnown: (
    target: BiologyRoomObserveInput,
    caller: BiologyRoomCapabilityCaller
  ) => BiologyRoomResourceReservation
  reserveUnknown: (
    workspaceId: string,
    caller: BiologyRoomCapabilityCaller
  ) => BiologyRoomResourceReservation
  dispose: () => void
}>

function createBiologyRoomResourceBindings(
  getService: () => BiologyRoomServicePort
): BiologyRoomResourceBindings {
  type ResourceBinding = {
    observe: BiologyRoomCapabilityResourceRegistration['observe']
    dispose: BiologyRoomCapabilityResourceRegistration['dispose']
    pendingReservations: number
    registered: boolean
  }
  const bindings = new Map<string, ResourceBinding>()
  let pendingUnknownReservations = 0
  let lifecycleEpoch = 0

  const assertCapacity = (): void => {
    if (bindings.size + pendingUnknownReservations >= BIOLOGY_ROOM_RESOURCE_BINDING_LIMIT) {
      throw new Error('Biology Room resource binding capacity was exceeded.')
    }
  }

  const createBinding = (
    identity: ReturnType<typeof biologyRoomResourceIdentity>,
    bindingEpoch: number
  ): ResourceBinding => {
    const canonicalTarget = biologyRoomObserveInputSchema.parse({
      workspaceRoot: identity.workspaceId,
      roomId: identity.resourceId
    })
    let binding!: ResourceBinding
    binding = {
      dispose: () => {
        binding.registered = false
        if (
          binding.pendingReservations === 0 &&
          bindings.get(identity.key) === binding
        ) {
          bindings.delete(identity.key)
        }
      },
      observe: async () => {
        if (bindingEpoch !== lifecycleEpoch) {
          throw new Error('Biology Room resource binding is retired.')
        }
        const observed = await getService().observe(canonicalTarget)
        return {
          semanticRevision: String(observed.revision),
          state: observed,
          operationIds: [
            BIOLOGY_ROOM_CAPABILITY_IDS.apply,
            BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
            BIOLOGY_ROOM_CAPABILITY_IDS.history
          ]
        }
      },
      pendingReservations: 0,
      registered: false
    }
    return binding
  }

  const reservation = (
    workspaceId: string,
    caller: BiologyRoomCapabilityCaller,
    expectedIdentity?: ReturnType<typeof biologyRoomResourceIdentity>
  ): BiologyRoomResourceReservation => {
    const reservationEpoch = lifecycleEpoch
    let binding = expectedIdentity ? bindings.get(expectedIdentity.key) : undefined
    let ownsUnknownSlot = false
    if (binding) {
      binding.pendingReservations += 1
    } else if (expectedIdentity) {
      assertCapacity()
      binding = createBinding(expectedIdentity, reservationEpoch)
      binding.pendingReservations = 1
      bindings.set(expectedIdentity.key, binding)
    } else {
      assertCapacity()
      pendingUnknownReservations += 1
      ownsUnknownSlot = true
    }
    let identity = expectedIdentity
    let settled = false
    let registered = false

    const settle = (commit: boolean): void => {
      if (settled) return
      settled = true
      if (reservationEpoch !== lifecycleEpoch) return
      if (ownsUnknownSlot) pendingUnknownReservations -= 1
      if (binding) {
        binding.pendingReservations -= 1
        if (commit) binding.registered = true
        if (
          !binding.registered &&
          binding.pendingReservations === 0 &&
          identity &&
          bindings.get(identity.key) === binding
        ) {
          bindings.delete(identity.key)
        }
      }
    }

    return Object.freeze({
      registration: (target, revision) => {
        if (reservationEpoch !== lifecycleEpoch) {
          throw new Error('Biology Room resource binding lifecycle changed.')
        }
        if (registered || settled) throw new Error('Biology Room resource reservation is already settled.')
        const resolvedIdentity = biologyRoomResourceIdentity(target, caller)
        if (resolvedIdentity.workspaceId !== workspaceId) {
          throw new Error('Biology Room resource reservation changed workspace.')
        }
        if (identity && identity.key !== resolvedIdentity.key) {
          throw new Error('Biology Room resource reservation changed identity.')
        }
        identity = resolvedIdentity
        if (!binding) {
          const existing = bindings.get(identity.key)
          if (existing) {
            binding = existing
            binding.pendingReservations += 1
          } else {
            binding = createBinding(identity, reservationEpoch)
            binding.pendingReservations = 1
            bindings.set(identity.key, binding)
          }
          pendingUnknownReservations -= 1
          ownsUnknownSlot = false
        }
        registered = true
        return {
          resourceId: identity.resourceId,
          resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
          workspaceId: identity.workspaceId,
          audiences: ['ui', 'agent', 'system'],
          semanticRevision: String(revision),
          retireAfterLastHandleExpires: true,
          observe: binding.observe,
          dispose: binding.dispose
        }
      },
      commit: () => settle(true),
      rollback: () => settle(false)
    })
  }

  return {
    reserveKnown: (target, caller) => {
      const identity = biologyRoomResourceIdentity(target, caller)
      return reservation(identity.workspaceId, caller, identity)
    },
    reserveUnknown: (workspaceId, caller) => {
      const normalizedWorkspaceId = workspaceId.trim()
      if (!normalizedWorkspaceId) throw new Error('Biology Room workspace is required.')
      return reservation(normalizedWorkspaceId, caller)
    },
    dispose: () => {
      lifecycleEpoch += 1
      pendingUnknownReservations = 0
      bindings.clear()
    }
  }
}

function biologyRoomResourceIdentity(
  target: BiologyRoomObserveInput,
  caller: BiologyRoomCapabilityCaller
): Readonly<{
  key: string
  workspaceId: string
  resourceId: string
}> {
  const { workspaceRoot: workspaceId, roomId: resourceId } = biologyRoomTargetSchema.parse({
    workspaceRoot: target.workspaceRoot,
    roomId: target.roomId
  })
  return {
    key: JSON.stringify([
      workspaceId,
      BIOLOGY_ROOM_RESOURCE_KIND,
      resourceId,
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
    ]),
    workspaceId,
    resourceId
  }
}

function requireCallerWorkspace(context: BiologyRoomCapabilityHandlerContext): string {
  const workspaceId = context.caller.workspaceId?.trim()
  if (!workspaceId) throw new Error('Biology Room requires a workspace-scoped caller.')
  return workspaceId
}

function requireResource(context: BiologyRoomCapabilityHandlerContext) {
  if (!context.resource) throw new Error('Biology Room capability resource is required.')
  return context.resource
}

function requireResourceWorkspace(resource: { workspaceId?: string }): string {
  const workspaceId = resource.workspaceId?.trim()
  if (!workspaceId) throw new Error('Biology Room capability workspace scope is required.')
  return workspaceId
}

function parseRevision(value: string): number {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Biology Room capability revision is invalid.')
  }
  return revision
}
