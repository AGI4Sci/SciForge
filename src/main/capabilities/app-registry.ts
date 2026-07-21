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
  SURFACE_RESOURCE_KIND,
  artifactInspectInputSchema,
  artifactInspectOutputSchema,
  surfaceInspectInputSchema,
  surfaceInspectOutputSchema,
  type ArtifactInspectInput,
  type ArtifactInspectOutput
} from '../../shared/surface-inspection'
import {
  workspacePreviewAnnotationDeleteInputSchema,
  workspacePreviewAnnotationResolveInputSchema,
  workspacePreviewAnnotationSidecarImportActionInputSchema,
  workspacePreviewAnnotationUpdateInputSchema,
  workspacePreviewByteRangeSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  type WorkspaceObservation,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewSession
} from '../../shared/workspace-preview'
import {
  pdfReviewGenerateActionInputSchema,
  pdfReviewImproveAnnotationActionInputSchema
} from '../../shared/pdf-review'
import {
  workspacePreviewOpenPayloadSchema
} from '../ipc/app-ipc-schemas'
import type { BiologyRoomService } from '../services/biology-room-service'
import type { VisibleContextService } from '../services/visible-context-service'
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
  },
  {
    id: 'surface',
    title: 'Surface Inspection',
    directTransportPrefixes: [],
    allowedDirectTransports: []
  },
  {
    id: 'artifact',
    title: 'Artifact Inspection',
    directTransportPrefixes: [],
    allowedDirectTransports: []
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
  workspacePreviewAnnotationsList: 'workspace-preview.annotations.list',
  workspacePreviewAnnotationsUpdate: 'workspace-preview.annotations.update',
  workspacePreviewAnnotationsResolve: 'workspace-preview.annotations.resolve',
  workspacePreviewAnnotationsDelete: 'workspace-preview.annotations.delete',
  workspacePreviewAnnotationsImport: 'workspace-preview.annotations.import',
  workspacePreviewAnnotationsReviewGenerate: 'workspace-preview.annotations.review.generate',
  workspacePreviewAnnotationsReviewImprove: 'workspace-preview.annotations.review.improve',
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
  biologyRoomHistory: 'biology-room.history',
  surfaceCurrent: 'surface.current',
  surfaceInspect: 'surface.inspect',
  artifactInspect: 'artifact.inspect'
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
    | 'listAnnotations'
    | 'updateAnnotation'
    | 'resolveAnnotation'
    | 'deleteAnnotation'
    | 'importAnnotations'
    | 'generateAnnotationReview'
    | 'improveAnnotationReview'
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
  visibleContextService?: Pick<VisibleContextService, 'currentSurface' | 'inspectSurface'>
  inspectArtifacts?: (workspaceRoot: string, input: ArtifactInspectInput) => Promise<ArtifactInspectOutput>
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
const workspacePreviewBrokerEditOperationSchema: z.ZodType<WorkspacePreviewEditOperation> = z.discriminatedUnion('kind', [
  workspacePreviewEditOperationSchema.options[0]!,
  workspacePreviewEditOperationSchema.options[1]!,
  workspacePreviewEditOperationSchema.options[2]!,
  workspacePreviewEditOperationSchema.options[3]!,
  workspacePreviewEditOperationSchema.options[4]!,
  workspacePreviewEditOperationSchema.options[5]!,
  workspacePreviewEditOperationSchema.options[6]!,
  workspacePreviewEditOperationSchema.options[7]!,
  workspacePreviewEditOperationSchema.options[8]!,
  workspacePreviewEditOperationSchema.options[12]!
])
const workspacePreviewApplyEditInputSchema = z.object({
  operation: workspacePreviewBrokerEditOperationSchema
}).strict()
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
  observation: WorkspaceObservation,
  canEdit: boolean,
  canAnnotate: boolean,
  canExport: boolean,
  audience: 'ui' | 'agent' | 'system'
): string[] {
  const annotationDocument = /\.(?:pdf|docx|md|mdx|markdown)$/iu.test(observation.file.path)
  const annotationOperations = canAnnotate && annotationDocument
    ? [
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsList,
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsDelete,
      ]
    : []
  const genericActions = observation.actions.filter((action) => !action.startsWith('annotation.'))
  const uiAnnotationOperations = audience === 'ui' && canAnnotate &&
    observation.file.path.toLowerCase().endsWith('.pdf')
    ? [
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsImport,
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate,
        APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewImprove
      ]
    : []
  return [
    APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
    APP_CAPABILITY_IDS.workspacePreviewReadRange,
    APP_CAPABILITY_IDS.workspacePreviewPrepareArtifact,
    APP_CAPABILITY_IDS.workspacePreviewReadArtifactRange,
    APP_CAPABILITY_IDS.workspacePreviewRelease,
    ...(audience === 'ui' && genericActions.length ? [APP_CAPABILITY_IDS.workspacePreviewInvokeAction] : []),
    ...annotationOperations,
    ...uiAnnotationOperations,
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
    observe: async (caller) => {
      const session = dependencies.workspacePreviewHost.getSession(sessionId)
      if (!session) throw new Error('Workspace Preview session was not found.')
      const result = await dependencies.workspacePreviewHost.observe(sessionId)
      if (!result.ok) throw new Error(result.message)
      const manifest = dependencies.workspacePreviewHost.listPlugins()
        .find((candidate) => candidate.id === session.pluginId)
      return {
        semanticRevision: workspacePreviewRevision(session),
        state: capabilityJsonValueSchema.parse({
          documentAnnotations: result.observation.documentAnnotations ?? null,
          session,
          observation: result.observation
        }),
        operationIds: workspacePreviewOperations(
          result.observation,
          manifest?.capabilities.edit === true,
          manifest?.capabilities.annotations === true,
          Boolean(manifest?.capabilities.export?.length),
          caller.audience
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

type CurrentSurface = Awaited<ReturnType<VisibleContextService['currentSurface']>>

function surfaceResource(
  service: Pick<VisibleContextService, 'currentSurface' | 'inspectSurface'>,
  current: CurrentSurface,
  callerId?: string
): CapabilityResourceRegistration {
  return {
    resourceId: current.resourceId,
    resourceKind: SURFACE_RESOURCE_KIND,
    ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
    audiences: ['ui', 'agent', 'system'],
    semanticRevision: current.semanticRevision,
    layoutRevision: current.layoutRevision,
    observe: async () => {
      const latest = await service.currentSurface(callerId)
      if (latest.resourceId !== current.resourceId) {
        throw new Error('The visible SciForge surface is no longer available.')
      }
      return {
        semanticRevision: latest.semanticRevision,
        layoutRevision: latest.layoutRevision,
        state: latest.state,
        operationIds: [APP_CAPABILITY_IDS.surfaceInspect]
      }
    }
  }
}

function surfaceCapabilities(
  service: Pick<VisibleContextService, 'currentSurface' | 'inspectSurface'> | undefined
) {
  if (!service) return []
  return [
    defineCapability({
      id: APP_CAPABILITY_IDS.surfaceCurrent,
      version: '2.0.0',
      title: 'Open current SciForge surface',
      description: 'Returns an opaque resource for the currently visible SciForge surface.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'global',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['surface', 'visual', 'discovery'],
      inputSchema: z.object({}).strict(),
      outputSchema: capabilityOutputSchema,
      handler: async (_, context) => {
        const callerId = context.caller.audience === 'agent' ? context.caller.callerId : undefined
        const current = await service.currentSurface(callerId)
        const surface = context.issueResource(surfaceResource(service, current, callerId))
        return {
          output: capabilityJsonValueSchema.parse({
            surface,
            current: current.state
          })
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.surfaceInspect,
      version: '2.0.0',
      title: 'Inspect visible SciForge surface',
      description: 'Captures and visually inspects the latest visible surface or an opaque target reference.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [SURFACE_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['surface', 'visual', 'inspection'],
      inputSchema: surfaceInspectInputSchema,
      outputSchema: surfaceInspectOutputSchema,
      handler: async (input, context) => ({
        output: await service.inspectSurface(resourceSessionId(context.resource), input)
      })
    })
  ]
}

function artifactCapabilities(
  inspectArtifacts: AppCapabilityDependencies['inspectArtifacts']
) {
  if (!inspectArtifacts) return []
  return [defineCapability({
    id: APP_CAPABILITY_IDS.artifactInspect,
    version: '2.0.0',
    title: 'Inspect workspace image artifacts',
    description: 'Visually inspects workspace-confined PNG, JPEG, or WebP artifacts through the Model Router.',
    audiences: ['ui', 'agent', 'system'],
    scope: 'workspace',
    effect: 'read',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'none' },
    tags: ['artifact', 'visual', 'inspection'],
    inputSchema: artifactInspectInputSchema,
    outputSchema: artifactInspectOutputSchema,
    handler: async (input, context) => ({
      output: await inspectArtifacts(context.caller.workspaceId ?? '', input)
    })
  })]
}

export function createAppCapabilityRegistry(dependencies: AppCapabilityDependencies): CapabilityRegistry {
  return new CapabilityRegistry([
    ...surfaceCapabilities(dependencies.visibleContextService),
    ...artifactCapabilities(dependencies.inspectArtifacts),
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
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsList,
      version: '2.0.0',
      title: 'List document annotations',
      description: 'Returns annotations from the canonical provider for the open document.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'annotation'],
      inputSchema: resourceActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (_, context) => ({
        output: capabilityJsonValueSchema.parse(
          await dependencies.workspacePreviewHost.listAnnotations(resourceSessionId(context.resource))
        )
      })
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
      version: '2.0.0',
      title: 'Update a document annotation',
      description: 'Creates or updates an annotation through the canonical document annotation provider.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'edit'],
      inputSchema: workspacePreviewAnnotationUpdateInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.updateAnnotation(
          resourceSessionId(context.resource),
          input
        )
        return result.ok
          ? {
              output: capabilityJsonValueSchema.parse(result),
              changed: true,
              semanticRevision: workspacePreviewRevision(result.session)
            }
          : { output: capabilityJsonValueSchema.parse(result), changed: false }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsResolve,
      version: '2.0.0',
      title: 'Resolve or reopen an annotation thread',
      description: 'Changes thread resolution state through the canonical document annotation provider.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'edit'],
      inputSchema: workspacePreviewAnnotationResolveInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.resolveAnnotation(
          resourceSessionId(context.resource),
          input
        )
        return result.ok
          ? {
              output: capabilityJsonValueSchema.parse(result),
              changed: true,
              semanticRevision: workspacePreviewRevision(result.session)
            }
          : { output: capabilityJsonValueSchema.parse(result), changed: false }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsDelete,
      version: '2.0.0',
      title: 'Delete an annotation thread',
      description: 'Deletes one annotation thread through the canonical document annotation provider.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'edit'],
      inputSchema: workspacePreviewAnnotationDeleteInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.deleteAnnotation(
          resourceSessionId(context.resource),
          input
        )
        return result.ok
          ? {
              output: capabilityJsonValueSchema.parse(result),
              changed: true,
              semanticRevision: workspacePreviewRevision(result.session)
            }
          : { output: capabilityJsonValueSchema.parse(result), changed: false }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsImport,
      version: '2.0.0',
      title: 'Import document annotations',
      description: 'Explicitly imports an annotation package into the canonical provider.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'migration'],
      inputSchema: workspacePreviewAnnotationSidecarImportActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.importAnnotations(
          resourceSessionId(context.resource),
          input
        )
        if (!result.ok) return { output: capabilityJsonValueSchema.parse(result), changed: false }
        const session = requireWorkspacePreviewSession(dependencies, resourceSessionId(context.resource))
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: true,
          semanticRevision: workspacePreviewRevision(session)
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewGenerate,
      version: '2.0.0',
      title: 'Generate document review annotations',
      description: 'Generates review annotations after the caller confirms the editable review prompt.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'confirmation',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'review'],
      inputSchema: pdfReviewGenerateActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const sessionId = resourceSessionId(context.resource)
        const result = await dependencies.workspacePreviewHost.generateAnnotationReview(sessionId, input)
        if (!result.ok) return { output: capabilityJsonValueSchema.parse(result), changed: false }
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: true,
          semanticRevision: workspacePreviewRevision(requireWorkspacePreviewSession(dependencies, sessionId))
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsReviewImprove,
      version: '2.0.0',
      title: 'Improve a review annotation',
      description: 'Adds improvement guidance to an existing review annotation after confirmation.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'workspace-write',
      approval: 'confirmation',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['workspace', 'preview', 'annotation', 'review'],
      inputSchema: pdfReviewImproveAnnotationActionInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const sessionId = resourceSessionId(context.resource)
        const result = await dependencies.workspacePreviewHost.improveAnnotationReview(sessionId, input)
        if (!result.ok) return { output: capabilityJsonValueSchema.parse(result), changed: false }
        return {
          output: capabilityJsonValueSchema.parse(result),
          changed: true,
          semanticRevision: workspacePreviewRevision(requireWorkspacePreviewSession(dependencies, sessionId))
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
      audiences: ['ui'],
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
    biologyRoomService: new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies['biologyRoomService'],
    visibleContextService: new Proxy({}, { get: () => unavailable }) as NonNullable<AppCapabilityDependencies['visibleContextService']>,
    inspectArtifacts: unavailable
  })
}
