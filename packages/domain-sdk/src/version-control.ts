import { z } from 'zod'

import {
  domainPackageJsonValueSchema
} from './contract.js'
import {
  domainCapabilityResourceHandleSchema
} from './renderer-contributions.js'
import type { DomainCapabilityContract } from './host.js'

export const VERSION_CONTROL_WORKSPACE_RESOURCE_KIND =
  'host.version-control.workspace' as const
export const VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID =
  'version-control.open-workspace' as const
export const VERSION_CONTROL_STATUS_ACTION_ID = 'version-control.status' as const
export const VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID =
  'version-control.create-snapshot' as const
export const VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID =
  'version-control.create-reference' as const
export const VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID =
  'version-control.list-snapshots' as const
export const VERSION_CONTROL_DIFF_ACTION_ID = 'version-control.diff' as const
export const VERSION_CONTROL_READ_FILE_ACTION_ID = 'version-control.read-file' as const
export const VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID =
  'version-control.preview-restore' as const
export const VERSION_CONTROL_RESTORE_ACTION_ID = 'version-control.restore' as const

export const VERSION_CONTROL_LIMITS = Object.freeze({
  maxPaths: 10_000,
  maxResultItems: 10_000,
  maxTextCharacters: 1_000_000,
  maxReferenceNameCharacters: 256
} as const)

const versionControlRevisionSchema = z.string().trim().min(1).max(512)
const versionControlPathSchema = z.string().min(1).max(4_096)
const versionControlPathListSchema = z.array(versionControlPathSchema)
  .max(VERSION_CONTROL_LIMITS.maxPaths)

export const versionControlOpenWorkspaceInputSchema = z.object({
  workspaceRoot: versionControlPathSchema
}).strict()

export const versionControlOpenWorkspaceOutputSchema = z.object({
  resourceKind: z.literal(VERSION_CONTROL_WORKSPACE_RESOURCE_KIND),
  resource: domainCapabilityResourceHandleSchema,
  provider: z.string().trim().min(1).max(128)
}).strict()

export const versionControlEmptyInputSchema = z.object({}).strict()

export const versionControlChangeSchema = z.object({
  path: versionControlPathSchema,
  status: z.enum([
    'added',
    'modified',
    'deleted',
    'renamed',
    'copied',
    'untracked',
    'conflicted'
  ]),
  previousPath: versionControlPathSchema.optional()
}).strict()

export const versionControlStatusOutputSchema = z.object({
  revision: versionControlRevisionSchema,
  clean: z.boolean(),
  changes: z.array(versionControlChangeSchema).max(VERSION_CONTROL_LIMITS.maxResultItems),
  truncated: z.boolean()
}).strict()

export const versionControlCreateSnapshotInputSchema = z.object({
  label: z.string().trim().min(1).max(500).optional(),
  metadata: domainPackageJsonValueSchema.optional()
}).strict()

export const versionControlSnapshotSchema = z.object({
  id: versionControlRevisionSchema,
  revision: versionControlRevisionSchema,
  createdAt: z.string().min(1).max(128),
  label: z.string().trim().min(1).max(500).optional(),
  metadata: domainPackageJsonValueSchema.optional()
}).strict()

export const versionControlCreateReferenceInputSchema = z.object({
  name: z.string().trim().min(1).max(VERSION_CONTROL_LIMITS.maxReferenceNameCharacters),
  target: versionControlRevisionSchema,
  force: z.boolean().default(false)
}).strict()

export const versionControlCreateReferenceOutputSchema = z.object({
  name: z.string().trim().min(1).max(VERSION_CONTROL_LIMITS.maxReferenceNameCharacters),
  target: versionControlRevisionSchema
}).strict()

export const versionControlListSnapshotsInputSchema = z.object({
  limit: z.number().int().min(1).max(1_000).default(100),
  cursor: z.string().min(1).max(512).optional()
}).strict()

export const versionControlListSnapshotsOutputSchema = z.object({
  snapshots: z.array(versionControlSnapshotSchema).max(1_000),
  nextCursor: z.string().min(1).max(512).optional()
}).strict()

const versionControlCompareInputSchema = z.object({
  from: versionControlRevisionSchema,
  to: versionControlRevisionSchema.optional(),
  paths: versionControlPathListSchema.optional(),
  maxCharacters: z.number().int().min(1)
    .max(VERSION_CONTROL_LIMITS.maxTextCharacters)
    .optional()
}).strict()

export const versionControlDiffInputSchema = versionControlCompareInputSchema
export const versionControlPreviewRestoreInputSchema = versionControlCompareInputSchema

export const versionControlTextOutputSchema = z.object({
  text: z.string().max(VERSION_CONTROL_LIMITS.maxTextCharacters),
  truncated: z.boolean()
}).strict()

export const versionControlReadFileInputSchema = z.object({
  revision: versionControlRevisionSchema,
  path: versionControlPathSchema,
  maxCharacters: z.number().int().min(1)
    .max(VERSION_CONTROL_LIMITS.maxTextCharacters)
    .optional()
}).strict()

export const versionControlReadFileOutputSchema = z.object({
  content: z.string().max(VERSION_CONTROL_LIMITS.maxTextCharacters),
  truncated: z.boolean()
}).strict()

export const versionControlRestoreInputSchema = z.object({
  target: versionControlRevisionSchema,
  paths: versionControlPathListSchema.optional()
}).strict()

export const versionControlRestoreOutputSchema = z.object({
  ok: z.literal(true),
  revision: versionControlRevisionSchema
}).strict()

export type VersionControlOpenWorkspaceInput = z.infer<
  typeof versionControlOpenWorkspaceInputSchema
>
export type VersionControlOpenWorkspaceOutput = z.infer<
  typeof versionControlOpenWorkspaceOutputSchema
>
export type VersionControlStatusOutput = z.infer<typeof versionControlStatusOutputSchema>
export type VersionControlCreateSnapshotInput = z.infer<
  typeof versionControlCreateSnapshotInputSchema
>
export type VersionControlSnapshot = z.infer<typeof versionControlSnapshotSchema>
export type VersionControlCreateReferenceInput = z.input<
  typeof versionControlCreateReferenceInputSchema
>
export type VersionControlCreateReferenceOutput = z.infer<
  typeof versionControlCreateReferenceOutputSchema
>
export type VersionControlListSnapshotsInput = z.input<
  typeof versionControlListSnapshotsInputSchema
>
export type VersionControlListSnapshotsOutput = z.infer<
  typeof versionControlListSnapshotsOutputSchema
>
export type VersionControlDiffInput = z.infer<typeof versionControlDiffInputSchema>
export type VersionControlTextOutput = z.infer<typeof versionControlTextOutputSchema>
export type VersionControlReadFileInput = z.infer<typeof versionControlReadFileInputSchema>
export type VersionControlReadFileOutput = z.infer<typeof versionControlReadFileOutputSchema>
export type VersionControlRestoreInput = z.infer<typeof versionControlRestoreInputSchema>
export type VersionControlRestoreOutput = z.infer<typeof versionControlRestoreOutputSchema>

export const VERSION_CONTROL_OPEN_WORKSPACE_CONTRACT: DomainCapabilityContract<
  VersionControlOpenWorkspaceInput,
  VersionControlOpenWorkspaceOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_OPEN_WORKSPACE_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlOpenWorkspaceInputSchema,
  outputSchema: versionControlOpenWorkspaceOutputSchema
})

export const VERSION_CONTROL_STATUS_CONTRACT: DomainCapabilityContract<
  Record<string, never>,
  VersionControlStatusOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_STATUS_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlEmptyInputSchema,
  outputSchema: versionControlStatusOutputSchema
})

export const VERSION_CONTROL_CREATE_SNAPSHOT_CONTRACT: DomainCapabilityContract<
  VersionControlCreateSnapshotInput,
  VersionControlSnapshot
> = Object.freeze({
  actionId: VERSION_CONTROL_CREATE_SNAPSHOT_ACTION_ID,
  effect: 'workspace-write',
  inputSchema: versionControlCreateSnapshotInputSchema,
  outputSchema: versionControlSnapshotSchema
})

export const VERSION_CONTROL_CREATE_REFERENCE_CONTRACT: DomainCapabilityContract<
  VersionControlCreateReferenceInput,
  VersionControlCreateReferenceOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_CREATE_REFERENCE_ACTION_ID,
  effect: 'workspace-write',
  inputSchema: versionControlCreateReferenceInputSchema,
  outputSchema: versionControlCreateReferenceOutputSchema
})

export const VERSION_CONTROL_LIST_SNAPSHOTS_CONTRACT: DomainCapabilityContract<
  VersionControlListSnapshotsInput,
  VersionControlListSnapshotsOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_LIST_SNAPSHOTS_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlListSnapshotsInputSchema,
  outputSchema: versionControlListSnapshotsOutputSchema
})

export const VERSION_CONTROL_DIFF_CONTRACT: DomainCapabilityContract<
  VersionControlDiffInput,
  VersionControlTextOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_DIFF_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlDiffInputSchema,
  outputSchema: versionControlTextOutputSchema
})

export const VERSION_CONTROL_READ_FILE_CONTRACT: DomainCapabilityContract<
  VersionControlReadFileInput,
  VersionControlReadFileOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_READ_FILE_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlReadFileInputSchema,
  outputSchema: versionControlReadFileOutputSchema
})

export const VERSION_CONTROL_PREVIEW_RESTORE_CONTRACT: DomainCapabilityContract<
  VersionControlDiffInput,
  VersionControlTextOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_PREVIEW_RESTORE_ACTION_ID,
  effect: 'read',
  inputSchema: versionControlPreviewRestoreInputSchema,
  outputSchema: versionControlTextOutputSchema
})

export const VERSION_CONTROL_RESTORE_CONTRACT: DomainCapabilityContract<
  VersionControlRestoreInput,
  VersionControlRestoreOutput
> = Object.freeze({
  actionId: VERSION_CONTROL_RESTORE_ACTION_ID,
  effect: 'destructive',
  inputSchema: versionControlRestoreInputSchema,
  outputSchema: versionControlRestoreOutputSchema
})
