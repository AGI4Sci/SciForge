import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
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
  observe: () => Promise<Readonly<{
    semanticRevision: string
    state: unknown
    operationIds: string[]
  }>>
}>

export type BiologyRoomCapabilityHandlerContext = Readonly<{
  caller: Readonly<{ workspaceId?: string }>
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
  const capabilityFactory = createBiologyRoomCapabilityFactory({
    defineCapability: host.defineCapability,
    getService
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...BIOLOGY_ROOM_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory,
        onDispose: () => {
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
          const manifest = await getService().create(
            biologyRoomCreateInputSchema.parse({ workspaceRoot, ...input })
          )
          const resource = context.issueResource(biologyRoomResource(
            getService,
            { workspaceRoot, roomId: manifest.roomId },
            manifest.revision
          ))
          return { output: { manifest, resource } }
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
          const result = await getService().openOrCreate(
            biologyRoomOpenOrCreateInputSchema.parse({ workspaceRoot, ...input })
          )
          const resource = context.issueResource(biologyRoomResource(
            getService,
            { workspaceRoot, roomId: result.manifest.roomId },
            result.manifest.revision
          ))
          return { output: { ...result, resource } }
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
          const manifest = await getService().load({ workspaceRoot, roomId: input.roomId })
          const resource = context.issueResource(biologyRoomResource(
            getService,
            { workspaceRoot, roomId: manifest.roomId },
            manifest.revision
          ))
          return { output: { manifest, resource } }
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
          const observation = await getService().observe(target)
          const resource = context.issueResource(biologyRoomResource(
            getService,
            target,
            observation.revision
          ))
          return { output: { observation, resource } }
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

function biologyRoomResource(
  getService: () => BiologyRoomServicePort,
  target: BiologyRoomObserveInput,
  revision: number
): BiologyRoomCapabilityResourceRegistration {
  return {
    resourceId: target.roomId,
    resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
    workspaceId: target.workspaceRoot,
    audiences: ['ui', 'agent', 'system'],
    semanticRevision: String(revision),
    observe: async () => {
      const observed = await getService().observe(target)
      return {
        semanticRevision: String(observed.revision),
        state: observed,
        operationIds: [
          BIOLOGY_ROOM_CAPABILITY_IDS.apply,
          BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
          BIOLOGY_ROOM_CAPABILITY_IDS.history
        ]
      }
    }
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
