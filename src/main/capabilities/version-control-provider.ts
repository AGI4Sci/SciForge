import { resolve } from 'node:path'
import {
  VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
  VERSION_CONTROL_CREATE_REFERENCE_CONTRACT,
  VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
  VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT,
  VERSION_CONTROL_DIFF_ACTION_ID,
  VERSION_CONTROL_DIFF_CONTRACT,
  VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
  VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT,
  VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
  VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT,
  VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
  VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT,
  VERSION_CONTROL_READ_FILE_ACTION_ID,
  VERSION_CONTROL_READ_FILE_CONTRACT,
  VERSION_CONTROL_RESTORE_ACTION_ID,
  VERSION_CONTROL_RESTORE_CONTRACT,
  VERSION_CONTROL_STATUS_ACTION_ID,
  VERSION_CONTROL_STATUS_CONTRACT,
  VERSION_CONTROL_WORKSPACE_RESOURCE_KIND
} from '@sciforge/domain-sdk/version-control'
import { capabilityJsonValueSchema } from '../../shared/capability-broker'
import type {
  VersionControlWorkspaceService,
  VersionControlWorkspaceSession
} from '../services/version-control-workspace-service'
import { defineAppCapabilityContribution } from './app-contributions/composition'
import {
  defineCapability,
  type CapabilityHandlerContext,
  type CapabilityResourceRegistration
} from './registry'

const VERSION_CONTROL_RESOURCE_OPERATIONS = Object.freeze([
  VERSION_CONTROL_STATUS_ACTION_ID,
  VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
  VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
  VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
  VERSION_CONTROL_DIFF_ACTION_ID,
  VERSION_CONTROL_READ_FILE_ACTION_ID,
  VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
  VERSION_CONTROL_RESTORE_ACTION_ID
])

const REMOTE_VERSION_CONTROL_RESOURCE_OPERATIONS = Object.freeze([
  VERSION_CONTROL_STATUS_ACTION_ID,
  VERSION_CONTROL_DIFF_ACTION_ID,
  VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID
])

export type VersionControlCapabilityDependencies = Readonly<{
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
}>

function workspaceResource(
  dependencies: VersionControlCapabilityDependencies,
  session: VersionControlWorkspaceSession,
  callerAudience: 'ui' | 'agent' | 'system'
): CapabilityResourceRegistration {
  return {
    resourceId: session.resourceId,
    resourceKind: VERSION_CONTROL_WORKSPACE_RESOURCE_KIND,
    workspaceId: session.workspaceId,
    audiences: [callerAudience],
    semanticRevision: 'opening',
    observe: async (caller) => {
      const owned = dependencies.versionControlWorkspaceService.requireSession(
        caller.callerId,
        caller.audience,
        session.resourceId,
        caller.workspaceId ?? ''
      )
      const status = await dependencies.versionControlWorkspaceService.status(owned)
      return {
        state: capabilityJsonValueSchema.parse(status),
        semanticRevision: status.revision,
        operationIds: [
          ...(session.workspaceLocator
            ? REMOTE_VERSION_CONTROL_RESOURCE_OPERATIONS
            : VERSION_CONTROL_RESOURCE_OPERATIONS)
        ]
      }
    }
  }
}

function requireSession(
  dependencies: VersionControlCapabilityDependencies,
  context: CapabilityHandlerContext
): VersionControlWorkspaceSession {
  const resource = context.resource
  if (!resource || !resource.workspaceId) {
    throw new Error('Version-control action requires a workspace resource.')
  }
  return dependencies.versionControlWorkspaceService.requireSession(
    context.caller.callerId,
    context.caller.audience,
    resource.resourceId,
    resource.workspaceId
  )
}

function requireLocalSession(
  dependencies: VersionControlCapabilityDependencies,
  context: CapabilityHandlerContext,
  action: string
): VersionControlWorkspaceSession {
  const session = requireSession(dependencies, context)
  if (session.workspaceLocator) {
    throw new Error(`${action} is not supported by the Workspace Host contract.`)
  }
  return session
}

function versionControlCapabilities(dependencies: VersionControlCapabilityDependencies) {
  return [
    defineCapability({
      id: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
      version: '1.0.0',
      title: 'Open version-control workspace',
      description: 'Opens an owner-bound Git workspace through the host version-control provider.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'workspace',
      effect: VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'workspace'],
      inputSchema: VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT.outputSchema,
      handler: async (input, context) => {
        const workspaceId = context.caller.workspaceId?.trim()
        if (!workspaceId) {
          throw new Error('Version-control workspace requires a workspace-scoped caller.')
        }
        const workspaceMatches = context.caller.workspaceLocator
          ? input.workspaceRoot.trim() === workspaceId
          : resolve(input.workspaceRoot) === resolve(workspaceId)
        if (!workspaceMatches) {
          throw new Error('Version-control workspace cannot open another workspace.')
        }
        const session = await dependencies.versionControlWorkspaceService.open(
          context.caller.callerId,
          context.caller.audience,
          workspaceId,
          context.caller.workspaceLocator
        )
        const status = await dependencies.versionControlWorkspaceService.status(session)
        const registration = workspaceResource(
          dependencies,
          session,
          context.caller.audience
        )
        const resource = context.issueResource({
          ...registration,
          semanticRevision: status.revision
        })
        return {
          output: {
            resourceKind: VERSION_CONTROL_WORKSPACE_RESOURCE_KIND,
            resource,
            provider: 'git'
          },
          changed: false
        }
      }
    }),
    defineCapability({
      id: VERSION_CONTROL_STATUS_ACTION_ID,
      version: '1.0.0',
      title: 'Read version-control status',
      description: 'Reads the bounded change status of an owned Git workspace.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_STATUS_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'status'],
      inputSchema: VERSION_CONTROL_STATUS_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_STATUS_CONTRACT.outputSchema,
      handler: async (_input, context) => ({
        output: await dependencies.versionControlWorkspaceService.status(
          requireSession(dependencies, context)
        )
      })
    }),
    defineCapability({
      id: VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
      version: '1.0.0',
      title: 'Create version-control snapshot',
      description: 'Captures the current owned workspace without changing its files or index.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['git', 'version-control', 'snapshot'],
      inputSchema: VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT.outputSchema,
      handler: async (input, context) => {
        const session = requireLocalSession(
          dependencies,
          context,
          'Creating remote snapshots'
        )
        return {
          output: await dependencies.versionControlWorkspaceService.createSnapshot(
            session,
            input,
            context.resource!.semanticRevision
          ),
          changed: false
        }
      }
    }),
    defineCapability({
      id: VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
      version: '1.0.0',
      title: 'Create version-control reference',
      description: 'Creates or updates a package-safe reference in the owned Git repository.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_CREATE_REFERENCE_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['git', 'version-control', 'reference'],
      inputSchema: VERSION_CONTROL_CREATE_REFERENCE_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_CREATE_REFERENCE_CONTRACT.outputSchema,
      handler: async (input, context) => {
        const session = requireLocalSession(
          dependencies,
          context,
          'Creating remote references'
        )
        return {
          output: await dependencies.versionControlWorkspaceService.createReference(
            session,
            input,
            context.resource!.semanticRevision
          ),
          changed: false
        }
      }
    }),
    defineCapability({
      id: VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
      version: '1.0.0',
      title: 'List version-control snapshots',
      description: 'Lists bounded SciForge snapshots in the owned Git repository.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'snapshot'],
      inputSchema: VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT.outputSchema,
      handler: async (input, context) => ({
        output: await dependencies.versionControlWorkspaceService.listSnapshots(
          requireLocalSession(dependencies, context, 'Listing remote snapshots'),
          input
        )
      })
    }),
    defineCapability({
      id: VERSION_CONTROL_DIFF_ACTION_ID,
      version: '1.0.0',
      title: 'Read version-control diff',
      description: 'Reads a bounded diff between revisions in the owned Git workspace.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_DIFF_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'diff'],
      inputSchema: VERSION_CONTROL_DIFF_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_DIFF_CONTRACT.outputSchema,
      handler: async (input, context) => ({
        output: await dependencies.versionControlWorkspaceService.diff(
          requireSession(dependencies, context),
          input
        )
      })
    }),
    defineCapability({
      id: VERSION_CONTROL_READ_FILE_ACTION_ID,
      version: '1.0.0',
      title: 'Read version-controlled file',
      description: 'Reads bounded file content from a revision in the owned Git workspace.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_READ_FILE_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'file'],
      inputSchema: VERSION_CONTROL_READ_FILE_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_READ_FILE_CONTRACT.outputSchema,
      handler: async (input, context) => ({
        output: await dependencies.versionControlWorkspaceService.readFile(
          requireLocalSession(
            dependencies,
            context,
            'Reading files from remote revisions'
          ),
          input
        )
      })
    }),
    defineCapability({
      id: VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
      version: '1.0.0',
      title: 'Preview version-control restore',
      description: 'Reads the bounded patch for a prospective workspace restore.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT.effect,
      approval: 'none',
      concurrency: { revision: 'none', idempotency: 'none' },
      tags: ['git', 'version-control', 'restore', 'preview'],
      inputSchema: VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT.outputSchema,
      handler: async (input, context) => ({
        output: await dependencies.versionControlWorkspaceService.diff(
          requireSession(dependencies, context),
          input
        )
      })
    }),
    defineCapability({
      id: VERSION_CONTROL_RESTORE_ACTION_ID,
      version: '1.0.0',
      title: 'Restore version-control workspace',
      description: 'Destructively restores the owned workspace to a selected revision.',
      audiences: ['ui', 'agent', 'system'],
      scope: 'resource',
      resourceKinds: [VERSION_CONTROL_WORKSPACE_RESOURCE_KIND],
      effect: VERSION_CONTROL_RESTORE_CONTRACT.effect,
      approval: 'confirmation',
      concurrency: { revision: 'optimistic', idempotency: 'required' },
      tags: ['git', 'version-control', 'restore'],
      inputSchema: VERSION_CONTROL_RESTORE_CONTRACT.inputSchema,
      outputSchema: VERSION_CONTROL_RESTORE_CONTRACT.outputSchema,
      handler: async (input, context) => {
        const session = requireLocalSession(
          dependencies,
          context,
          'Restoring remote version-control workspaces'
        )
        const beforeRevision = context.resource!.semanticRevision
        const output = await dependencies.versionControlWorkspaceService.restore(
          session,
          input,
          beforeRevision
        )
        const changed = output.revision !== beforeRevision
        return {
          output,
          changed,
          ...(changed ? { semanticRevision: output.revision } : {})
        }
      }
    })
  ]
}

export const VERSION_CONTROL_CAPABILITY_CONTRIBUTION_FACTORY =
  defineAppCapabilityContribution<VersionControlCapabilityDependencies>(
    'sciforge.version-control',
    versionControlCapabilities,
    {
      id: 'version-control',
      title: 'Version Control',
      directTransportPrefixes: [],
      allowedDirectTransports: []
    }
  )
