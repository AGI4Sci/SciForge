import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { z } from 'zod'
import type {
  DomainMainHost,
  DomainMainRuntimeLifecycleContribution,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT,
  VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
  VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT,
  VERSION_CONTROL_RESTORE_CONTRACT,
  VERSION_CONTROL_STATUS_CONTRACT
} from '@sciforge/domain-sdk/version-control'
import {
  GIT_CHECKPOINTS_CAPABILITY_IDS,
  gitCheckpointCreateInputSchema,
  gitCheckpointCreateResultSchema,
  gitCheckpointListInputSchema,
  gitCheckpointListResultSchema,
  gitCheckpointPreviewInputSchema,
  gitCheckpointPreviewResultSchema,
  gitCheckpointRestoreInputSchema,
  gitCheckpointRestoreResultSchema
} from './contract.js'
import {
  GIT_CHECKPOINTS_CAPABILITY_FACTORY_CONTRIBUTION,
  GIT_CHECKPOINTS_DOMAIN_MODULE_ID,
  GIT_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'
import { GitCheckpointRuntime } from './runtime.js'
import {
  GitCheckpointService,
  type GitCheckpointVcsPort
} from './service.js'

type CapabilityAudience = 'ui' | 'agent' | 'system'
type CapabilityEffect = 'read' | 'workspace-write' | 'destructive'

type GitCheckpointsCapabilityHandlerContext = Readonly<{
  caller: Readonly<{ workspaceId?: string }>
}>

export type GitCheckpointsCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly CapabilityAudience[]
  scope: 'workspace'
  effect: CapabilityEffect
  approval: 'none' | 'confirmation'
  concurrency: Readonly<{
    revision: 'none'
    idempotency: 'none' | 'required'
  }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (
    input: unknown,
    context: GitCheckpointsCapabilityHandlerContext
  ) => Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type GitCheckpointsCapabilityFactory<CapabilityDefinition = unknown> =
  Readonly<{
    moduleId: typeof GIT_CHECKPOINTS_DOMAIN_MODULE_ID
    policy: Readonly<{
      id: 'git-checkpoints'
      title: 'Git Checkpoints'
      directTransportPrefixes: readonly []
      allowedDirectTransports: readonly []
    }>
    createDefinitions: () => readonly CapabilityDefinition[]
  }>

export function createDomainMainEntry<CapabilityDefinition = unknown>(
  host: DomainMainHost
): TrustedDomainProcessEntryInput<
  GitCheckpointsCapabilityFactory<CapabilityDefinition> |
  DomainMainRuntimeLifecycleContribution
> {
  const runtime = new GitCheckpointRuntime({
    createService: ({ userDataDir, capabilities }) => new GitCheckpointService({
      userDataDir,
      vcs: createVersionControlCheckpointPort(capabilities)
    })
  })
  const lifecycle: DomainMainRuntimeLifecycleContribution = Object.freeze({
    activate: (context) => runtime.activate(context)
  })
  const capabilityFactory = createGitCheckpointsCapabilityFactory({
    defineCapability: host.defineCapability as (
      options: GitCheckpointsCapabilityOptions
    ) => CapabilityDefinition,
    getService: () => runtime.service()
  })

  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...GIT_CHECKPOINTS_CAPABILITY_FACTORY_CONTRIBUTION,
        value: capabilityFactory
      },
      {
        ...GIT_CHECKPOINTS_RUNTIME_LIFECYCLE_CONTRIBUTION,
        value: lifecycle,
        onDispose: () => runtime.dispose()
      }
    ]
  }
}

export function createGitCheckpointsCapabilityFactory<CapabilityDefinition>(
  options: Readonly<{
    defineCapability: (
      options: GitCheckpointsCapabilityOptions
    ) => CapabilityDefinition
    getService: () => GitCheckpointService
  }>
): GitCheckpointsCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<
      GitCheckpointsCapabilityOptions,
      'version' | 'scope' | 'tags'
    >
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
    scope: 'workspace',
    tags: ['git', 'version-control', 'checkpoint']
  })

  return Object.freeze({
    moduleId: GIT_CHECKPOINTS_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'git-checkpoints' as const,
      title: 'Git Checkpoints' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: GIT_CHECKPOINTS_CAPABILITY_IDS.list,
        title: 'List Git checkpoints',
        description: 'Lists package-owned checkpoints in the caller workspace.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: gitCheckpointListInputSchema,
        outputSchema: gitCheckpointListResultSchema,
        handler: async (rawInput, context) => {
          const workspaceRoot = requireWorkspace(context)
          const input = gitCheckpointListInputSchema.parse(rawInput)
          assertRequestedWorkspace(input.workspaceRoot, workspaceRoot)
          return {
            output: await options.getService().list({
              ...input,
              workspaceRoot
            })
          }
        }
      }),
      define({
        id: GIT_CHECKPOINTS_CAPABILITY_IDS.create,
        title: 'Create Git checkpoint',
        description: 'Creates a manual checkpoint through the controlled version-control provider.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'workspace-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: gitCheckpointCreateInputSchema,
        outputSchema: gitCheckpointCreateResultSchema,
        handler: async (rawInput, context) => {
          const workspaceRoot = requireWorkspace(context)
          const input = gitCheckpointCreateInputSchema.parse(rawInput)
          assertRequestedWorkspace(input.workspaceRoot, workspaceRoot)
          if (input.phase !== 'manual') {
            throw new Error('The public create capability only creates manual checkpoints.')
          }
          const output = await options.getService().create({
            ...input,
            workspaceRoot,
            phase: 'manual'
          })
          return { output, changed: output.ok }
        }
      }),
      define({
        id: GIT_CHECKPOINTS_CAPABILITY_IDS.preview,
        title: 'Preview Git checkpoint',
        description: 'Previews restoring one checkpoint without changing the workspace.',
        audiences: ['ui', 'agent', 'system'],
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        inputSchema: gitCheckpointPreviewInputSchema,
        outputSchema: gitCheckpointPreviewResultSchema,
        handler: async (rawInput, context) => {
          const workspaceRoot = requireWorkspace(context)
          const input = gitCheckpointPreviewInputSchema.parse(rawInput)
          return {
            output: await options.getService().preview(
              input.checkpointId,
              workspaceRoot
            )
          }
        }
      }),
      define({
        id: GIT_CHECKPOINTS_CAPABILITY_IDS.restore,
        title: 'Restore Git checkpoint',
        description: 'Captures a rescue checkpoint, then restores the selected checkpoint.',
        audiences: ['ui', 'agent'],
        effect: 'destructive',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: gitCheckpointRestoreInputSchema,
        outputSchema: gitCheckpointRestoreResultSchema,
        handler: async (rawInput, context) => {
          const workspaceRoot = requireWorkspace(context)
          const input = gitCheckpointRestoreInputSchema.parse(rawInput)
          const output = await options.getService().restore(input, workspaceRoot)
          return { output, changed: output.ok }
        }
      })
    ]
  })
}

export function createVersionControlCheckpointPort(
  invoker: DomainMainSystemCapabilityInvoker
): GitCheckpointVcsPort {
  return Object.freeze({
    capture: async ({ workspaceRoot, snapshotName }) => {
      const opened = await invoker.invoke(
        VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
        { workspaceRoot },
        { workspaceId: workspaceRoot }
      )
      const status = await invoker.invoke(
        VERSION_CONTROL_STATUS_CONTRACT,
        {},
        {
          workspaceId: workspaceRoot,
          resource: opened.resource
        }
      )
      const snapshot = await invoker.invoke(
        VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT,
        {
          label: snapshotName,
          metadata: {
            owner: GIT_CHECKPOINTS_DOMAIN_MODULE_ID,
            checkpointId: snapshotName
          }
        },
        {
          workspaceId: workspaceRoot,
          idempotencyKey: `git-checkpoint:capture:${snapshotName}`,
          resource: opened.resource,
          expectedRevision: status.revision
        }
      )
      return {
        snapshotId: snapshot.id,
        provider: opened.provider,
        revision: snapshot.revision,
        changeSummary: summarizeStatus(status)
      }
    },
    preview: async ({ workspaceRoot, snapshotId }) => {
      const opened = await invoker.invoke(
        VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
        { workspaceRoot },
        { workspaceId: workspaceRoot }
      )
      const preview = await invoker.invoke(
        VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT,
        {
          from: snapshotId,
          maxCharacters: 1_000_000
        },
        {
          workspaceId: workspaceRoot,
          resource: opened.resource
        }
      )
      return {
        patch: preview.text,
        truncated: preview.truncated
      }
    },
    restore: async ({ workspaceRoot, snapshotId }) => {
      const opened = await invoker.invoke(
        VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
        { workspaceRoot },
        { workspaceId: workspaceRoot }
      )
      const status = await invoker.invoke(
        VERSION_CONTROL_STATUS_CONTRACT,
        {},
        {
          workspaceId: workspaceRoot,
          resource: opened.resource
        }
      )
      await invoker.invoke(
        VERSION_CONTROL_RESTORE_CONTRACT,
        { target: snapshotId },
        {
          workspaceId: workspaceRoot,
          idempotencyKey: `git-checkpoint:restore:${randomUUID()}`,
          resource: opened.resource,
          expectedRevision: status.revision,
          authorization: { mode: 'inherit-current-action' }
        }
      )
    }
  })
}

function summarizeStatus(status: z.infer<typeof VERSION_CONTROL_STATUS_CONTRACT.outputSchema>): string {
  if (status.clean) return 'Clean workspace'
  const counts = new Map<string, number>()
  for (const change of status.changes) {
    counts.set(change.status, (counts.get(change.status) ?? 0) + 1)
  }
  const detail = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ')
  const total = status.changes.length
  return `${total}${status.truncated ? '+' : ''} change${total === 1 ? '' : 's'}${
    detail ? ` (${detail})` : ''
  }`
}

function requireWorkspace(context: GitCheckpointsCapabilityHandlerContext): string {
  const workspaceRoot = context.caller.workspaceId?.trim()
  if (!workspaceRoot) {
    throw new Error('Git Checkpoints requires a workspace-scoped caller.')
  }
  return workspaceRoot
}

function assertRequestedWorkspace(
  requested: string | undefined,
  callerWorkspace: string
): void {
  if (!requested) return
  if (resolve(requested) !== resolve(callerWorkspace)) {
    throw new Error('Git Checkpoints cannot access another workspace.')
  }
}
