import { z } from 'zod'
import {
  CONTROLLED_PROCESS_CREATE_ACTION_ID,
  CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
  CONTROLLED_PROCESS_READ_ACTION_ID,
  CONTROLLED_PROCESS_RESIZE_ACTION_ID,
  CONTROLLED_PROCESS_RESOURCE_KIND,
  CONTROLLED_PROCESS_WRITE_ACTION_ID,
  controlledProcessCreateInputSchema,
  controlledProcessCreateOutputSchema,
  controlledProcessDisposeInputSchema,
  controlledProcessMutationOutputSchema,
  controlledProcessReadInputSchema,
  controlledProcessReadOutputSchema,
  controlledProcessResizeInputSchema,
  controlledProcessWriteInputSchema,
  controlledProcessWriteOutputSchema
} from '@sciforge/domain-sdk/controlled-process'
import { WORKSPACE_PREVIEW_RESOURCE_KIND } from '@sciforge/domain-sdk/workspace-preview'
import { workspaceLocatorSchema } from '@sciforge/domain-sdk/workspace-host'
import {
  capabilityJsonValueSchema,
  type CapabilityCallerContext
} from '../../shared/capability-broker'
import { SURFACE_RESOURCE_KIND } from '../../shared/visible-context'
import {
  workspacePreviewAnnotationDeleteInputSchema,
  workspacePreviewAnnotationListInputSchema,
  workspacePreviewAnnotationResolveInputSchema,
  workspacePreviewAnnotationSidecarImportActionInputSchema,
  workspacePreviewAnnotationUpdateInputSchema,
  workspacePreviewReadRangeSchema,
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
import {
  DOMAIN_EXTENSION_ACTIVATION_STATES,
  DOMAIN_EXTENSION_STATUSES,
  type DomainExtensionSummary,
  type DomainExtensionsApi
} from '../../shared/domain-extensions'
import { projectPdfAnnotationsForAgent } from '../../shared/pdf-annotations'
import type { VisibleContextService } from '../services/visible-context-service'
import type { WorkspacePreviewHost } from '../services/workspace-preview'
import type {
  ControlledProcessCreateInput,
  ControlledProcessCreateResult,
  ControlledProcessReadInput,
  ControlledProcessReadResult
} from '../processes/controlled-process-service'
import type { VersionControlWorkspaceService } from '../services/version-control-workspace-service'
import {
  defineAppCapabilityContribution
} from './app-contributions/composition'
import { defineCapability, type CapabilityResourceRegistration } from './registry'
import {
  principalContextBindingKey,
  StableResourceBindingRegistry,
  type StableResourceBindingReservation
} from './stable-resource-bindings'

export { WORKSPACE_PREVIEW_RESOURCE_KIND } from '@sciforge/domain-sdk/workspace-preview'

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
  surfaceCurrent: 'surface.current',
  extensionsList: 'extensions.list',
  extensionStatus: 'extensions.status',
  extensionCandidateCheck: 'extensions.candidate.check',
  extensionCandidateApply: 'extensions.candidate.apply',
  extensionCandidateCancel: 'extensions.candidate.cancel'
} as const

const MAX_APP_RESOURCE_REGISTRATION_BINDINGS = 512

type ControlledProcessCapabilityService = {
  create(input: ControlledProcessCreateInput): Promise<ControlledProcessCreateResult>
  read(input: ControlledProcessReadInput): Promise<ControlledProcessReadResult>
  write(ownerId: string, resourceId: string, data: string): number | Promise<number>
  resize(
    ownerId: string,
    resourceId: string,
    columns: number,
    rows: number
  ): void | Promise<void>
  dispose(ownerId: string, resourceId: string): boolean | Promise<boolean>
  has(ownerId: string, resourceId: string): boolean
}

export type AppCapabilityDependencies = {
  controlledProcessService: ControlledProcessCapabilityService
  workspacePreviewHost: Omit<Pick<WorkspacePreviewHost,
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
  >, 'releaseSession'> & {
    releaseSession(sessionId: string): boolean | Promise<boolean>
  }
  visibleContextService?: Pick<VisibleContextService, 'currentSurface'>
  extensionsApi?: Pick<DomainExtensionsApi, 'list'>
  /** Agent-facing development-plugin candidate workflow used by conversational UI changes. */
  extensionCandidateApi?: Pick<
    DomainExtensionsApi,
    'checkCandidate' | 'applyCandidate' | 'cancelCandidate'
  >
  versionControlWorkspaceService: Pick<
    VersionControlWorkspaceService,
    | 'open'
    | 'requireSession'
    | 'status'
    | 'createSnapshot'
    | 'createReference'
    | 'listSnapshots'
    | 'diff'
    | 'readFile'
    | 'restore'
  >
}

const extensionStatusInputSchema = z.object({
  packageName: z.string().trim().min(1).max(256).optional()
}).strict()

const extensionStatusItemSchema = z.object({
  packageName: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  status: z.enum(DOMAIN_EXTENSION_STATUSES),
  activationState: z.enum(DOMAIN_EXTENSION_ACTIVATION_STATES),
  generation: z.number().int().min(0),
  hostApi: z.object({
    minimum: z.string(),
    maximumExclusive: z.string()
  }).strict().nullable(),
  permission: z.object({
    requested: z.array(z.string()),
    approved: z.array(z.string()),
    denied: z.array(z.string()),
    status: z.enum(['approved', 'denied', 'unknown', 'needs-approval']),
    allowed: z.boolean()
  }).strict(),
  hostApiStatus: z.enum(['compatible', 'incompatible', 'unknown', 'adapter-required']),
  diagnostic: z.string().nullable(),
  restartRequired: z.boolean(),
  candidateVersion: z.string().nullable().optional()
}).strict()

const extensionStatusOutputSchema = z.object({
  extensions: z.array(extensionStatusItemSchema).max(1_024)
}).strict()

export function extensionStatusCapabilities(dependencies: AppCapabilityDependencies) {
  const createDefinition = (id: typeof APP_CAPABILITY_IDS.extensionsList | typeof APP_CAPABILITY_IDS.extensionStatus) =>
    defineCapability({
      id,
      version: '1.0.0',
      title: id === APP_CAPABILITY_IDS.extensionsList ? 'List SciForge extensions' : 'Read SciForge extension status',
      description: 'Reads the canonical extension manager projection without scanning worktrees, static composition, or credentials.',
      audiences: ['agent', 'ui', 'system'],
      scope: 'global',
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['extensions', 'plugins', 'status', 'read-only'],
      inputSchema: extensionStatusInputSchema,
      outputSchema: extensionStatusOutputSchema,
      handler: async ({ packageName }) => {
        if (!dependencies.extensionsApi) throw new Error('Extension status service is unavailable.')
        const listed = await dependencies.extensionsApi.list()
        const selected = packageName
          ? listed.filter((extension) => extension.packageName === packageName)
          : listed
        return {
          output: {
            extensions: selected.map((extension) => ({
              packageName: extension.packageName,
              version: extension.version,
              enabled: extension.enabled ?? ['active', 'installed', 'restart-required'].includes(extension.status),
              status: extension.status,
              activationState: extension.activationState ?? 'not-loaded',
              generation: extension.generation ?? 0,
              hostApi: extension.hostApi ?? null,
              hostApiStatus: extension.hostApiStatus ?? 'unknown',
              permission: {
                requested: [...extension.permissions],
                approved: [...(extension.approvedPermissions ?? [])],
                denied: [...(extension.deniedPermissions ?? [])],
                status: extension.permissionStatus ?? 'unknown',
                allowed: extension.permissionAllowed ?? false
              },
              diagnostic: extension.diagnostic ?? null,
              restartRequired: extension.status === 'restart-required',
              ...(extension.candidateVersion ? { candidateVersion: extension.candidateVersion } : {})
            }))
          },
          changed: false
        }
      }
    })
  const candidateInputSchema = z.object({
    packageName: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(4_096)
  }).strict()
  const candidatePackageInputSchema = z.object({
    packageName: z.string().trim().min(1).max(256)
  }).strict()
  const candidateOutputSchema = z.object({
    extensions: z.array(extensionStatusItemSchema).length(1)
  }).strict()
  const projectCandidateResult = (extension: DomainExtensionSummary) => ({
    extensions: [{
      packageName: extension.packageName,
      version: extension.version,
      enabled: extension.enabled ?? ['active', 'installed', 'restart-required'].includes(extension.status),
      status: extension.status,
      activationState: extension.activationState ?? 'not-loaded',
      generation: extension.generation ?? 0,
      hostApi: extension.hostApi ?? null,
      hostApiStatus: extension.hostApiStatus ?? 'unknown',
      permission: {
        requested: [...extension.permissions],
        approved: [...(extension.approvedPermissions ?? [])],
        denied: [...(extension.deniedPermissions ?? [])],
        status: extension.permissionStatus ?? 'unknown',
        allowed: extension.permissionAllowed ?? false
      },
      diagnostic: extension.diagnostic ?? null,
      restartRequired: extension.status === 'restart-required',
      ...(extension.candidateVersion ? { candidateVersion: extension.candidateVersion } : {})
    }]
  })
  const requireCandidateApi = () => {
    if (!dependencies.extensionCandidateApi) throw new Error('Conversational UI plugin updates are unavailable.')
    return dependencies.extensionCandidateApi
  }
  const candidateCheck = defineCapability({
    id: APP_CAPABILITY_IDS.extensionCandidateCheck,
    version: '1.0.0',
    title: 'Check a conversational UI plugin candidate',
    description: 'Stages and validates a generated development UI plugin without activating it. The candidate path must be inside the configured development plugin root. Use this before asking the user to apply the change.',
    audiences: ['agent', 'ui', 'system'],
    scope: 'global',
    effect: 'workspace-write',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'required' },
    tags: ['extensions', 'plugins', 'ui', 'candidate', 'validate'],
    inputSchema: candidateInputSchema,
    outputSchema: candidateOutputSchema,
    handler: async (input) => ({
      output: projectCandidateResult(await requireCandidateApi().checkCandidate(input)),
      changed: false
    })
  })
  const candidateApply = defineCapability({
    id: APP_CAPABILITY_IDS.extensionCandidateApply,
    version: '1.0.0',
    title: 'Apply a conversational UI plugin candidate',
    description: 'Applies the previously checked UI plugin candidate through the canonical lifecycle. This changes the running SciForge UI and always requires explicit user confirmation.',
    audiences: ['agent', 'ui', 'system'],
    scope: 'global',
    effect: 'workspace-write',
    approval: 'confirmation',
    concurrency: { revision: 'none', idempotency: 'required' },
    tags: ['extensions', 'plugins', 'ui', 'candidate', 'apply', 'confirmation'],
    inputSchema: candidatePackageInputSchema,
    outputSchema: candidateOutputSchema,
    handler: async (input) => ({
      output: projectCandidateResult(await requireCandidateApi().applyCandidate(input)),
      changed: false
    })
  })
  const candidateCancel = defineCapability({
    id: APP_CAPABILITY_IDS.extensionCandidateCancel,
    version: '1.0.0',
    title: 'Cancel a conversational UI plugin candidate',
    description: 'Removes a checked but unapplied conversational UI plugin candidate without changing the active plugin.',
    audiences: ['agent', 'ui', 'system'],
    scope: 'global',
    effect: 'workspace-write',
    approval: 'none',
    concurrency: { revision: 'none', idempotency: 'required' },
    tags: ['extensions', 'plugins', 'ui', 'candidate', 'cancel'],
    inputSchema: candidatePackageInputSchema,
    outputSchema: candidateOutputSchema,
    handler: async (input) => ({
      output: projectCandidateResult(await requireCandidateApi().cancelCandidate(input)),
      changed: false
    })
  })
  return [
    createDefinition(APP_CAPABILITY_IDS.extensionsList),
    createDefinition(APP_CAPABILITY_IDS.extensionStatus),
    candidateCheck,
    candidateApply,
    candidateCancel
  ]
}

function controlledProcessResource(
  dependencies: AppCapabilityDependencies,
  ownerId: string,
  resourceId: string,
  workspaceId: string
): CapabilityResourceRegistration {
  return {
    resourceId,
    resourceKind: CONTROLLED_PROCESS_RESOURCE_KIND,
    workspaceId,
    audiences: ['ui'],
    semanticRevision: '1',
    observe: (caller) => {
      if (
        caller.callerId !== ownerId ||
        !dependencies.controlledProcessService.has(ownerId, resourceId)
      ) {
        throw new Error('Controlled process session is unavailable to this caller.')
      }
      return {
        semanticRevision: '1',
        state: capabilityJsonValueSchema.parse({ profile: 'system-shell' }),
        operationIds: [
          CONTROLLED_PROCESS_READ_ACTION_ID,
          CONTROLLED_PROCESS_WRITE_ACTION_ID,
          CONTROLLED_PROCESS_RESIZE_ACTION_ID,
          CONTROLLED_PROCESS_DISPOSE_ACTION_ID
        ]
      }
    }
  }
}

function controlledProcessCapabilities(dependencies: AppCapabilityDependencies) {
  return [
    defineCapability({
      id: CONTROLLED_PROCESS_CREATE_ACTION_ID,
      version: '1.0.0',
      title: 'Create controlled process',
      description: 'Starts a host-controlled system shell inside the active workspace.',
      audiences: ['ui'],
      scope: 'workspace',
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['process', 'terminal', 'workspace'],
      inputSchema: controlledProcessCreateInputSchema,
      outputSchema: controlledProcessCreateOutputSchema,
      handler: async (input, context) => {
        const workspaceId = context.caller.workspaceId
        if (!workspaceId) throw new Error('Controlled process requires an active workspace.')
        const created = await dependencies.controlledProcessService.create({
          ownerId: context.caller.callerId,
          workspaceRoot: workspaceId,
          ...(context.caller.workspaceLocator
            ? { workspaceLocator: context.caller.workspaceLocator }
            : {}),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.terminal
            ? {
                columns: input.terminal.columns,
                rows: input.terminal.rows
              }
            : {})
        })
        const resource = context.issueResource(controlledProcessResource(
          dependencies,
          context.caller.callerId,
          created.resourceId,
          workspaceId
        ))
        return {
          output: {
            resourceKind: CONTROLLED_PROCESS_RESOURCE_KIND,
            resource,
            cursor: created.cursor
          },
          changed: false
        }
      }
    }),
    defineCapability({
      id: CONTROLLED_PROCESS_READ_ACTION_ID,
      version: '1.0.0',
      title: 'Read controlled process output',
      description: 'Reads a bounded output stream from an owned controlled process.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [CONTROLLED_PROCESS_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['process', 'terminal', 'stream'],
      inputSchema: controlledProcessReadInputSchema,
      outputSchema: controlledProcessReadOutputSchema,
      handler: async (input, context) => ({
        output: await dependencies.controlledProcessService.read({
          ownerId: context.caller.callerId,
          resourceId: resourceSessionId(context.resource),
          cursor: input.cursor,
          maxCharacters: input.maxCharacters ?? 64 * 1024,
          waitMilliseconds: input.waitMilliseconds ?? 0,
          ...(context.signal ? { signal: context.signal } : {})
        })
      })
    }),
    defineCapability({
      id: CONTROLLED_PROCESS_WRITE_ACTION_ID,
      version: '1.0.0',
      title: 'Write controlled process input',
      description: 'Writes bounded input to an owned controlled process.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [CONTROLLED_PROCESS_RESOURCE_KIND],
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['process', 'terminal', 'input'],
      inputSchema: controlledProcessWriteInputSchema,
      outputSchema: controlledProcessWriteOutputSchema,
      handler: async (input, context) => ({
        output: {
          acceptedCharacters: await dependencies.controlledProcessService.write(
            context.caller.callerId,
            resourceSessionId(context.resource),
            input.data
          )
        },
        changed: false
      })
    }),
    defineCapability({
      id: CONTROLLED_PROCESS_RESIZE_ACTION_ID,
      version: '1.0.0',
      title: 'Resize controlled process terminal',
      description: 'Updates terminal dimensions for an owned controlled process.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [CONTROLLED_PROCESS_RESOURCE_KIND],
      effect: 'compute',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['process', 'terminal', 'layout'],
      inputSchema: controlledProcessResizeInputSchema,
      outputSchema: controlledProcessMutationOutputSchema,
      handler: async (input, context) => {
        await dependencies.controlledProcessService.resize(
          context.caller.callerId,
          resourceSessionId(context.resource),
          input.columns,
          input.rows
        )
        return { output: { ok: true as const }, changed: false }
      }
    }),
    defineCapability({
      id: CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
      version: '1.0.0',
      title: 'Dispose controlled process',
      description: 'Stops and releases an owned controlled process.',
      audiences: ['ui'],
      scope: 'resource',
      resourceKinds: [CONTROLLED_PROCESS_RESOURCE_KIND],
      effect: 'external-write',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'required' },
      tags: ['process', 'terminal', 'lifecycle'],
      inputSchema: controlledProcessDisposeInputSchema,
      outputSchema: controlledProcessMutationOutputSchema,
      handler: async (_input, context) => {
        await dependencies.controlledProcessService.dispose(
          context.caller.callerId,
          resourceSessionId(context.resource)
        )
        return { output: { ok: true as const }, changed: false }
      }
    })
  ]
}

const resourceActionInputSchema = z.object({}).strict()
const workspacePreviewOpenWireSchema = z.object({
  path: z.string().min(1).max(4_096),
  workspaceRoot: z.string().min(1).max(4_096).optional(),
  workspaceLocator: workspaceLocatorSchema.optional(),
  mimeType: z.string().min(1).max(256).optional(),
  mode: z.enum(['preview', 'edit', 'inspect']).optional(),
  line: z.number().int().positive().max(1_000_000).optional(),
  column: z.number().int().positive().max(1_000_000).optional(),
  selection: z.unknown().optional(),
  anchor: z.unknown().optional(),
  integrity: z.unknown().optional()
}).strict()
const workspacePreviewReadRangeInputSchema = z.object({ range: workspacePreviewReadRangeSchema }).strict()
const workspacePreviewPrepareArtifactInputSchema = z.object({
  request: workspacePreviewPrepareArtifactRequestSchema
}).strict()
const workspacePreviewReadArtifactRangeInputSchema = z.object({
  request: workspacePreviewReadArtifactRangeRequestSchema
}).strict()
const workspacePreviewBrokerEditOperationOptions = workspacePreviewEditOperationSchema.options
  .filter((schema) => !schema.shape.kind.value.startsWith('annotation.')) as [
    (typeof workspacePreviewEditOperationSchema.options)[number],
    (typeof workspacePreviewEditOperationSchema.options)[number],
    ...(typeof workspacePreviewEditOperationSchema.options)[number][]
  ]
const workspacePreviewBrokerEditOperationSchema: z.ZodType<WorkspacePreviewEditOperation> =
  z.discriminatedUnion('kind', workspacePreviewBrokerEditOperationOptions)
const workspacePreviewApplyEditInputSchema = z.object({
  operation: workspacePreviewBrokerEditOperationSchema
}).strict()
const workspacePreviewExportInputSchema = z.object({ target: workspacePreviewExportTargetSchema }).strict()
const workspacePreviewInvokeActionInputSchema = z.object({ action: workspacePreviewPluginActionInputSchema }).strict()
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

type AppResourceRegistrationBinding = Pick<CapabilityResourceRegistration, 'observe' | 'dispose'>

function createWorkspacePreviewResourceFactory(dependencies: AppCapabilityDependencies) {
  const bindings = new StableResourceBindingRegistry<AppResourceRegistrationBinding>(
    MAX_APP_RESOURCE_REGISTRATION_BINDINGS,
    'Workspace Preview'
  )
  return Object.freeze({
    reserve: () => bindings.reserve(),
    create: (
      reservation: StableResourceBindingReservation<AppResourceRegistrationBinding>,
      sessionId: string,
      workspaceId: string,
      caller: CapabilityCallerContext
    ) => {
      const initial = dependencies.workspacePreviewHost.getSession(sessionId)
      if (!initial) throw new Error('Workspace Preview session was not found.')
      const key = JSON.stringify([
        workspaceId,
        sessionId,
        principalContextBindingKey(caller)
      ])
      const committed = reservation.commit(key, () => {
        let created: AppResourceRegistrationBinding
        created = {
          dispose: async () => {
            await dependencies.workspacePreviewHost.releaseSession(sessionId)
            bindings.deleteExact(key, created)
          },
          observe: async (observerCaller) => {
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
                observerCaller.audience
              )
            }
          }
        }
        return created
      })
      return Object.freeze({
        registration: {
          resourceId: sessionId,
          resourceKind: WORKSPACE_PREVIEW_RESOURCE_KIND,
          workspaceId,
          audiences: ['ui', 'agent', 'system'],
          semanticRevision: workspacePreviewRevision(initial),
          contentTransport: {
            describeActionId: APP_CAPABILITY_IDS.workspacePreviewDescribeAsset,
            readRangeActionId: APP_CAPABILITY_IDS.workspacePreviewReadRange
          },
          observe: committed.binding.observe,
          dispose: committed.binding.dispose,
          retireAfterLastHandleExpires: true
        } satisfies CapabilityResourceRegistration
      })
    }
  })
}

function requireWorkspacePreviewSession(
  dependencies: AppCapabilityDependencies,
  sessionId: string
): WorkspacePreviewSession {
  const session = dependencies.workspacePreviewHost.getSession(sessionId)
  if (!session) throw new Error('Workspace Preview session was not found.')
  return session
}

function resourceSessionId(resource: { resourceId: string } | undefined): string {
  if (!resource) throw new Error('Capability resource is required.')
  return resource.resourceId
}

type CurrentSurface = Awaited<ReturnType<VisibleContextService['currentSurface']>>

function createSurfaceResourceFactory(
  service: Pick<VisibleContextService, 'currentSurface'>
): (
  current: CurrentSurface,
  caller: CapabilityCallerContext
) => CapabilityResourceRegistration {
  const bindings = new StableResourceBindingRegistry<AppResourceRegistrationBinding>(
    MAX_APP_RESOURCE_REGISTRATION_BINDINGS,
    'current Surface'
  )
  return (current, caller) => {
    const key = JSON.stringify([
      current.workspaceId ?? null,
      current.resourceId,
      principalContextBindingKey(caller)
    ])
    const reservation = bindings.reserve(key)
    const committed = reservation.commit(key, () => {
      const resourceId = current.resourceId
      let created: AppResourceRegistrationBinding
      created = {
        observe: async (observerCaller) => {
          const latest = await service.currentSurface(
            observerCaller.audience === 'agent' ? observerCaller.callerId : undefined
          )
          if (latest.resourceId !== resourceId) {
            throw new Error('The visible SciForge surface is no longer available.')
          }
          return {
            semanticRevision: latest.semanticRevision,
            layoutRevision: latest.layoutRevision,
            state: latest.state,
            operationIds: []
          }
        },
        dispose: () => {
          bindings.deleteExact(key, created)
        }
      }
      return created
    })
    return {
      resourceId: current.resourceId,
      resourceKind: SURFACE_RESOURCE_KIND,
      ...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
      audiences: ['ui', 'agent', 'system'],
      semanticRevision: current.semanticRevision,
      layoutRevision: current.layoutRevision,
      observe: committed.binding.observe,
      dispose: committed.binding.dispose,
      retireAfterLastHandleExpires: true
    }
  }
}

function surfaceCapabilities(
  service: Pick<VisibleContextService, 'currentSurface'> | undefined
) {
  if (!service) return []
  const surfaceResource = createSurfaceResourceFactory(service)
  return [defineCapability({
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
      const surface = context.issueResource(surfaceResource(current, context.caller))
      return {
        output: capabilityJsonValueSchema.parse({
          surface,
          current: current.state
        })
      }
    }
  })]
}

function workspacePreviewCapabilities(dependencies: AppCapabilityDependencies) {
  const workspacePreviewResource = createWorkspacePreviewResourceFactory(dependencies)
  return [
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
      description: 'Opens a workspace file with the canonical Workspace Preview host and returns a scoped resource handle. When workspaceRoot is omitted, the caller-bound workspace is used. Agents pass the returned resourceRef to sciforge_look as its sourceRef, or observe the resource for authorized follow-up operations.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      producedResourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview'],
      inputSchema: workspacePreviewOpenWireSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const reservation = workspacePreviewResource.reserve()
        try {
          const { workspaceRoot, ...openInput } = input
          const result = await dependencies.workspacePreviewHost.open(
            workspacePreviewOpenPayloadSchema.parse({
              ...openInput,
              workspaceRoot: workspaceRoot ?? context.caller.workspaceId
            })
          )
          if (!result.ok) {
            reservation.release()
            return { output: capabilityJsonValueSchema.parse(result) }
          }
          const prepared = workspacePreviewResource.create(
            reservation,
            result.session.id,
            context.caller.workspaceId ?? result.session.workspaceRoot,
            context.caller
          )
          const resource = context.issueResource(prepared.registration)
          return { output: capabilityJsonValueSchema.parse({ ...result, resource }) }
        } catch (error) {
          reservation.release()
          throw error
        }
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
      version: '1.1.0',
      title: 'Read Workspace Preview source range',
      description: 'Reads the current preview source. For text use range: {start: {line: 1, column: 1}, maxCharacters: 12000}; returns plain UTF-8 text and one-based UTF-16 start/end coordinates matching text.replaceRange, plus nextStart when truncated. Read around an annotation anchor, then apply the authorized edit through Apply Workspace Preview edit using the observed revision. Do not reconstruct source from tool history. For binary assets use range: {offset, length} to receive Base64 bytes.',
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
      version: '2.1.0',
      title: 'List document annotations',
      description: 'Resource-scoped operation: pass the exact Workspace Preview resourceRef returned by sciforge_observe. Returns canonical document annotations directly from the active preview. Agent callers receive a bounded, paginated view that preserves anchor quotes, text ranges, and comment source text; when truncated, call this same operation again with the returned nextCursor. Do not search workspace files or sidecars for annotations. UI callers receive the complete sidecar.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [WORKSPACE_PREVIEW_RESOURCE_KIND],
      effect: 'read',
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['workspace', 'preview', 'annotation'],
      inputSchema: workspacePreviewAnnotationListInputSchema,
      outputSchema: capabilityOutputSchema,
      handler: async (input, context) => {
        const result = await dependencies.workspacePreviewHost.listAnnotations(resourceSessionId(context.resource))
        if (!result.ok || context.caller.audience !== 'agent') {
          return { output: capabilityJsonValueSchema.parse(result) }
        }
        return {
          output: capabilityJsonValueSchema.parse({
            ok: true,
            annotations: projectPdfAnnotationsForAgent(result.sidecar, input)
          })
        }
      }
    }),
    defineCapability({
      id: APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate,
      version: '2.0.0',
      title: 'Update a document annotation',
      description: 'Resource-scoped operation: pass the exact Workspace Preview resourceRef returned by sciforge_observe. Creates or updates an annotation through the canonical document annotation provider.',
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
      description: 'Resource-scoped operation: pass the exact Workspace Preview resourceRef returned by sciforge_observe. Changes thread resolution state through the canonical document annotation provider.',
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
      description: 'Resource-scoped operation: pass the exact Workspace Preview resourceRef returned by sciforge_observe. Deletes one annotation thread through the canonical document annotation provider.',
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
      handler: () => ({
        output: true,
        changed: false,
        retireResource: 'defer-while-retained'
      })
    })
  ]
}

export const WORKSPACE_PREVIEW_CAPABILITY_CONTRIBUTION_FACTORY =
  defineAppCapabilityContribution<AppCapabilityDependencies>(
    'sciforge.workspace-preview',
    workspacePreviewCapabilities,
    {
      id: 'workspace-preview',
      title: 'Workspace Preview',
      directTransportPrefixes: ['workspacePreview:'],
      allowedDirectTransports: []
    }
  )

export const SURFACE_CAPABILITY_CONTRIBUTION_FACTORY =
  defineAppCapabilityContribution<AppCapabilityDependencies>(
    'sciforge.surface',
    (dependencies) => surfaceCapabilities(dependencies.visibleContextService),
    {
      id: 'surface',
      title: 'Surface Context',
      directTransportPrefixes: [],
      allowedDirectTransports: []
    }
  )

export const EXTENSIONS_CAPABILITY_CONTRIBUTION_FACTORY =
  defineAppCapabilityContribution<AppCapabilityDependencies>(
    'sciforge.extensions',
    extensionStatusCapabilities,
    {
      id: 'extensions',
      title: 'Extensions',
      directTransportPrefixes: [],
      allowedDirectTransports: []
    }
  )

export const CONTROLLED_PROCESS_CAPABILITY_CONTRIBUTION_FACTORY =
  defineAppCapabilityContribution<AppCapabilityDependencies>(
    'sciforge.controlled-process',
    controlledProcessCapabilities,
    {
      id: 'controlled-process',
      title: 'Controlled Process',
      directTransportPrefixes: [],
      allowedDirectTransports: []
    }
  )
