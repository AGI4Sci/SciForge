import { z } from 'zod'
import {
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
} from '../../shared/biology-room'
import { capabilityJsonValueSchema } from '../../shared/capability-broker'
import {
  workspacePreviewByteRangeSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  type WorkspacePreviewSession
} from '../../shared/workspace-preview'
import {
  workspacePreviewOpenPayloadSchema
} from '../ipc/app-ipc-schemas'
import type { BiologyRoomService } from '../services/biology-room-service'
import type { WorkspacePreviewHost } from '../services/workspace-preview'
import { CapabilityRegistry, defineCapability, type CapabilityResourceRegistration } from './registry'

export const WORKSPACE_PREVIEW_RESOURCE_KIND = 'workspace-preview'
export const BIOLOGY_ROOM_RESOURCE_KIND = 'biology-room'

export const MIGRATED_CAPABILITY_DOMAINS = [
  {
    id: 'workspace-preview',
    title: 'Workspace Preview',
    directTransportPrefixes: ['workspacePreview:'],
    allowedDirectTransports: []
  },
  {
    id: 'biology-room',
    title: 'Biology Room',
    directTransportPrefixes: ['biologyRoom:'],
    allowedDirectTransports: ['biologyRoom:pick-file']
  }
] as const

export const APP_CAPABILITY_IDS = {
  workspacePreviewList: 'workspace-preview.list',
  workspacePreviewOpen: 'workspace-preview.open',
  workspacePreviewDescribeAsset: 'workspace-preview.describe-asset',
  workspacePreviewReadRange: 'workspace-preview.read-range',
  workspacePreviewPrepareArtifact: 'workspace-preview.prepare-artifact',
  workspacePreviewReadArtifactRange: 'workspace-preview.read-artifact-range',
  workspacePreviewApplyEdit: 'workspace-preview.apply-edit',
  workspacePreviewExport: 'workspace-preview.export',
  workspacePreviewInvokeAction: 'workspace-preview.invoke-action',
  workspacePreviewRelease: 'workspace-preview.release',
  biologyRoomList: 'biology-room.list',
  biologyRoomCreate: 'biology-room.create',
  biologyRoomOpenOrCreate: 'biology-room.open-or-create',
  biologyRoomLoad: 'biology-room.load',
  biologyRoomOpen: 'biology-room.open',
  biologyRoomApply: 'biology-room.apply',
  biologyRoomRefresh: 'biology-room.refresh',
  biologyRoomHistory: 'biology-room.history'
} as const

export type AppCapabilityDependencies = {
  workspacePreviewHost: Pick<WorkspacePreviewHost,
    | 'listPlugins'
    | 'getSession'
    | 'open'
    | 'observe'
    | 'describeAsset'
    | 'readRange'
    | 'prepareArtifact'
    | 'readArtifactRange'
    | 'applyEdit'
    | 'exportPreview'
    | 'invokeAction'
    | 'releaseSession'
  >
  biologyRoomService: Pick<BiologyRoomService,
    | 'create'
    | 'openOrCreate'
    | 'load'
    | 'list'
    | 'observe'
    | 'apply'
    | 'refresh'
    | 'history'
  >
}

const resourceActionInputSchema = z.object({}).strict()
const workspacePreviewOpenWireSchema = z.object({
  path: z.string().min(1).max(4_096),
  workspaceRoot: z.string().min(1).max(4_096),
  mimeType: z.string().min(1).max(256).optional(),
  mode: z.enum(['preview', 'edit', 'inspect']).optional(),
  line: z.number().int().positive().max(1_000_000).optional(),
  column: z.number().int().positive().max(1_000_000).optional(),
  selection: z.unknown().optional(),
  anchor: z.unknown().optional(),
  integrity: z.unknown().optional()
}).strict()
const workspacePreviewReadRangeInputSchema = z.object({ range: workspacePreviewByteRangeSchema }).strict()
const workspacePreviewPrepareArtifactInputSchema = z.object({
  request: workspacePreviewPrepareArtifactRequestSchema
}).strict()
const workspacePreviewReadArtifactRangeInputSchema = z.object({
  request: workspacePreviewReadArtifactRangeRequestSchema
}).strict()
const workspacePreviewApplyEditInputSchema = z.object({ operation: workspacePreviewEditOperationSchema }).strict()
const workspacePreviewExportInputSchema = z.object({ target: workspacePreviewExportTargetSchema }).strict()
const workspacePreviewInvokeActionInputSchema = z.object({ action: workspacePreviewPluginActionInputSchema }).strict()
const biologyRoomApplyWireSchema = z.object({
  dryRun: z.boolean().optional(),
  operations: z.array(z.unknown()).min(1).max(100),
  actor: z.unknown().optional()
}).strict()
const biologyRoomCreateWireSchema = z.object({
  roomId: biologyRoomIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
  assets: z.array(z.unknown()).max(128).optional(),
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
const capabilityOutputSchema = capabilityJsonValueSchema

function workspacePreviewRevision(session: WorkspacePreviewSession): string {
  return session.updatedAt || String(session.mtimeMs ?? session.openedAt)
}

function workspacePreviewOperations(
  actions: readonly string[],
  canEdit: boolean,
  canExport: boolean
): string[] {
  return [
    APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
    APP_CAPABILITY_IDS.workspacePreviewReadRange,
    APP_CAPABILITY_IDS.workspacePreviewPrepareArtifact,
    APP_CAPABILITY_IDS.workspacePreviewReadArtifactRange,
    APP_CAPABILITY_IDS.workspacePreviewRelease,
    ...(actions.length ? [APP_CAPABILITY_IDS.workspacePreviewInvokeAction] : []),
    ...(canEdit ? [APP_CAPABILITY_IDS.workspacePreviewApplyEdit] : []),
    ...(canExport ? [APP_CAPABILITY_IDS.workspacePreviewExport] : [])
  ]
}

function workspacePreviewResource(
  dependencies: AppCapabilityDependencies,
  sessionId: string,
  workspaceId: string
): CapabilityResourceRegistration {
  const initial = dependencies.workspacePreviewHost.getSession(sessionId)
  if (!initial) throw new Error('Workspace Preview session was not found.')
  return {
    resourceId: sessionId,
    resourceKind: WORKSPACE_PREVIEW_RESOURCE_KIND,
    workspaceId,
    audiences: ['ui', 'agent', 'system'],
    semanticRevision: workspacePreviewRevision(initial),
    contentTransport: {
      describeActionId: APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
      readRangeActionId: APP_CAPABILITY_IDS.workspacePreviewReadRange
    },
    observe: async () => {
      const session = dependencies.workspacePreviewHost.getSession(sessionId)
      if (!session) throw new Error('Workspace Preview session was not found.')
      const result = await dependencies.workspacePreviewHost.observe(sessionId)
      if (!result.ok) throw new Error(result.message)
      const manifest = dependencies.workspacePreviewHost.listPlugins()
        .find((candidate) => candidate.id === session.pluginId)
      return {
        semanticRevision: workspacePreviewRevision(session),
        state: capabilityJsonValueSchema.parse({ session, observation: result.observation }),
        operationIds: workspacePreviewOperations(
          result.observation.actions,
          manifest?.capabilities.edit === true,
          Boolean(manifest?.capabilities.export?.length)
        )
      }
    }
  }
}

function requireWorkspacePreviewSession(
  dependencies: AppCapabilityDependencies,
  sessionId: string
): WorkspacePreviewSession {
  const session = dependencies.workspacePreviewHost.getSession(sessionId)
  if (!session) throw new Error('Workspace Preview session was not found.')
  return session
}

function biologyRoomResource(
  dependencies: AppCapabilityDependencies,
  target: BiologyRoomObserveInput,
  revision: number
): CapabilityResourceRegistration {
  return {
    resourceId: target.roomId,
    resourceKind: BIOLOGY_ROOM_RESOURCE_KIND,
    workspaceId: target.workspaceRoot,
    audiences: ['ui', 'agent', 'system'],
    semanticRevision: String(revision),
    observe: async () => {
      const observed = await dependencies.biologyRoomService.observe(target)
      return {
        semanticRevision: String(observed.revision),
        state: capabilityJsonValueSchema.parse(observed),
        operationIds: [
          APP_CAPABILITY_IDS.biologyRoomApply,
          APP_CAPABILITY_IDS.biologyRoomRefresh,
          APP_CAPABILITY_IDS.biologyRoomHistory
        ]
      }
    }
  }
}

function resourceSessionId(resource: { resourceId: string } | undefined): string {
  if (!resource) throw new Error('Capability resource is required.')
  return resource.resourceId
}

function workspaceId(resource: { workspaceId?: string } | undefined): string {
  const value = resource?.workspaceId?.trim()
  if (!value) throw new Error('Capability workspace scope is required.')
  return value
}

export function createAppCapabilityRegistry(dependencies: AppCapabilityDependencies): CapabilityRegistry {
  return new CapabilityRegistry([
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewList,
      version: '1.0.0',
      title: 'List Workspace Preview plugins',
      description: 'Lists the canonical Workspace Preview providers registered in SciForge.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'global',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'discovery'],
      inputSchema: z.object({}).strict(),
      outputSchema: capabilityOutputSchema,
      handler: () => ({ output: capabilityJsonValueSchema.parse(dependencies.workspacePreviewHost.listPlugins()) })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewOpen,
      version: '1.0.0',
      title: 'Open Workspace Preview',
      description: 'Opens a workspace file with the canonical Workspace Preview host and returns a scoped resource handle.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview'],
      inputSchema: workspacePreviewOpenWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.open(workspacePreviewOpenPayloadSchema.parse(input))
        if (!result.ok) return { output: capabilityJsonValueSchema.parse(result) }
        const resource = context.issueResource(workspacePreviewResource(
          dependencies,
          result.session.id,
          context.caller.workspaceId ?? result.session.workspaceRoot
        ))
        return { output: capabilityJsonValueSchema.parse({ ...result, resource }) }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
      version: '1.0.0',
      title: 'Describe Workspace Preview asset',
      description: 'Returns structured transport information for an open preview asset.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'asset'],
      inputSchema: resourceActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (_, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.describeAsset(resourceSessionId(context.resource))
        )
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewReadRange,
      version: '1.0.0',
      title: 'Read Workspace Preview bytes',
      description: 'Reads a bounded byte range from the current preview asset.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'read'],
      inputSchema: workspacePreviewReadRangeInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.readRange(resourceSessionId(context.resource), input.range)
        )
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewPrepareArtifact,
      version: '1.0.0',
      title: 'Prepare Workspace Preview artifact',
      description: 'Prepares a bounded derived artifact using the canonical preview provider.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['workspace', 'preview', 'artifact'],
      inputSchema: workspacePreviewPrepareArtifactInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.prepareArtifact(resourceSessionId(context.resource), input.request)
        )
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewReadArtifactRange,
      version: '1.0.0',
      title: 'Read Workspace Preview artifact bytes',
      description: 'Reads a bounded byte range from a prepared preview artifact.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'artifact', 'read'],
      inputSchema: workspacePreviewReadArtifactRangeInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.readArtifactRange(resourceSessionId(context.resource), input.request)
        )
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewApplyEdit,
      version: '1.0.0',
      title: 'Apply Workspace Preview edit',
      description: 'Applies one schema-validated edit using the canonical Workspace Preview host.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'edit'],
      inputSchema: workspacePreviewApplyEditInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const sessionId = resourceSessionId(context.resource)
        const result = await dependencies.workspacePreviewHost.applyEdit(sessionId, input.operation)
        if (!result.ok) return { output: capabilityJsonValueSchema.parse(result), changed: false }
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: true,
          semanticRevision: workspacePreviewRevision(result.session)
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewExport,
      version: '1.0.0',
      title: 'Export Workspace Preview',
      description: 'Exports the current preview through the canonical provider.',
      audiences: ['ui', 'agent'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'external-write',
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['workspace', 'preview', 'export'],
      inputSchema: workspacePreviewExportInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.exportPreview(resourceSessionId(context.resource), input.target)
        ),
        changed: false
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewInvokeAction,
      version: '1.0.0',
      title: 'Invoke Workspace Preview action',
      description: 'Invokes an action advertised by the current Workspace Preview observation.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'action'],
      inputSchema: workspacePreviewInvokeActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const sessionId = resourceSessionId(context.resource)
        const before = requireWorkspacePreviewSession(dependencies, sessionId)
        const result = await dependencies.workspacePreviewHost.invokeAction(sessionId, input.action)
        const after = requireWorkspacePreviewSession(dependencies, sessionId)
        const changed = before.updatedAt !== after.updatedAt
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed,
          ...(changed ? { semanticRevision: workspacePreviewRevision(after) } : {})
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewRelease,
      version: '1.0.0',
      title: 'Release Workspace Preview',
      description: 'Releases an open Workspace Preview session.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['workspace', 'preview', 'lifecycle'],
      inputSchema: resourceActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: (_, context) => ({
        output: dependencies.workspacePreviewHost.releaseSession(resourceSessionId(context.resource)),
        changed: false
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomList,
      version: '1.0.0',
      title: 'List Biology Rooms',
      description: 'Lists Biology Rooms in the caller workspace.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['biology', 'room', 'discovery'],
      inputSchema: biologyRoomListInputSchema.omit({ workspaceRoot: true }),
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => ({
        output: capabilityJsonValueSchema.parse(await dependencies.biologyRoomService.list({
          workspaceRoot: context.caller.workspaceId ?? '',
          ...input
        }))
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomCreate,
      version: '1.0.0',
      title: 'Create Biology Room',
      description: 'Creates a Biology Room in the caller workspace and returns a scoped resource handle.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['biology', 'room', 'create'],
      inputSchema: biologyRoomCreateWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const workspaceRoot = context.caller.workspaceId ?? ''
        const manifest = await dependencies.biologyRoomService.create(
          biologyRoomCreateInputSchema.parse({ workspaceRoot, ...input })
        )
        const resource = context.issueResource(biologyRoomResource(
          dependencies,
          { workspaceRoot, roomId: manifest.roomId },
          manifest.revision
        ))
        return { output: capabilityJsonValueSchema.parse({ manifest, resource }) }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomOpenOrCreate,
      version: '1.0.0',
      title: 'Open or create Biology Room',
      description: 'Opens the room for a workspace biology asset, creating it through the canonical service when needed.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['biology', 'room', 'open'],
      inputSchema: biologyRoomOpenOrCreateWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const workspaceRoot = context.caller.workspaceId ?? ''
        const result = await dependencies.biologyRoomService.openOrCreate(
          biologyRoomOpenOrCreateInputSchema.parse({ workspaceRoot, ...input })
        )
        const resource = context.issueResource(biologyRoomResource(
          dependencies,
          { workspaceRoot, roomId: result.manifest.roomId },
          result.manifest.revision
        ))
        return { output: capabilityJsonValueSchema.parse({ ...result, resource }) }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomLoad,
      version: '1.0.0',
      title: 'Load Biology Room',
      description: 'Loads a Biology Room manifest and returns its scoped resource handle.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['biology', 'room', 'load'],
      inputSchema: biologyRoomLoadWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const workspaceRoot = context.caller.workspaceId ?? ''
        const manifest = await dependencies.biologyRoomService.load({ workspaceRoot, roomId: input.roomId })
        const resource = context.issueResource(biologyRoomResource(
          dependencies,
          { workspaceRoot, roomId: manifest.roomId },
          manifest.revision
        ))
        return { output: capabilityJsonValueSchema.parse({ manifest, resource }) }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomOpen,
      version: '1.0.0',
      title: 'Open Biology Room resource',
      description: 'Observes a Biology Room and returns a scoped resource handle.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['biology', 'room'],
      inputSchema: biologyRoomTargetSchema.omit({ workspaceRoot: true }).merge(
        biologyRoomObserveInputSchema.pick({ assetLimit: true, annotationLimit: true, contigLimit: true }).partial()
      ),
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const target = biologyRoomObserveInputSchema.parse({
          workspaceRoot: context.caller.workspaceId ?? '',
          ...input
        })
        const observation = await dependencies.biologyRoomService.observe(target)
        const resource = context.issueResource(biologyRoomResource(dependencies, target, observation.revision))
        return { output: capabilityJsonValueSchema.parse({ observation, resource }) }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomApply,
      version: '1.0.0',
      title: 'Apply Biology Room operations',
      description: 'Applies revisioned Biology Room operations using the canonical service.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['biology', 'room', 'edit'],
      inputSchema: biologyRoomApplyWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const resource = context.resource
        const request: BiologyRoomApplyInput = biologyRoomApplyInputSchema.parse({
          ...input,
          workspaceRoot: workspaceId(resource),
          roomId: resourceSessionId(resource),
          baseRevision: Number(resource?.semanticRevision)
        })
        const result = await dependencies.biologyRoomService.apply(request)
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: result.changed && !result.dryRun,
          ...(result.changed && !result.dryRun ? { semanticRevision: String(result.revision) } : {})
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomRefresh,
      version: '1.0.0',
      title: 'Refresh Biology Room assets',
      description: 'Refreshes source-backed assets in the current Biology Room through the canonical service.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['biology', 'room', 'refresh'],
      inputSchema: biologyRoomRefreshWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const resource = context.resource
        const result = await dependencies.biologyRoomService.refresh(
          biologyRoomRefreshInputSchema.parse({
            ...input,
            workspaceRoot: workspaceId(resource),
            roomId: resourceSessionId(resource)
          })
        )
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: result.changed,
          ...(result.changed ? { semanticRevision: String(result.revision) } : {})
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.biologyRoomHistory,
      version: '1.0.0',
      title: 'Read Biology Room history',
      description: 'Returns bounded revision history for the current Biology Room.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [BIOLOGY_ROOM_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['biology', 'room', 'history'],
      inputSchema: biologyRoomHistoryInputSchema.omit({ workspaceRoot: true, roomId: true }),
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const resource = context.resource
        const request: BiologyRoomHistoryInput = {
          ...input,
          workspaceRoot: workspaceId(resource),
          roomId: resourceSessionId(resource)
        }
        return { output: capabilityJsonValueSchema.parse(await dependencies.biologyRoomService.history(request)) }
      }
    })
  ])
}

export function createCapabilityDocumentationRegistry(): CapabilityRegistry {
  const unavailable = (): never => {
    throw new Error('Capability documentation providers cannot execute actions.')
  }
  return createAppCapabilityRegistry({
    workspacePreviewHost: new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies['workspacePreviewHost'],
    biologyRoomService: new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies['biologyRoomService']
  })
}
