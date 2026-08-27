import { z } from 'zod'

import {
  domainPackageContributionIdSchema,
  domainPackageNameSchema,
  domainPackageVersionSchema,
  type DomainPackageJsonValue
} from './contract.js'
import type { DomainRuntimeContributionOwner } from './host.js'
import {
  versionControlDiffInputSchema,
  versionControlStatusOutputSchema,
  versionControlTextOutputSchema,
  type VersionControlDiffInput,
  type VersionControlStatusOutput,
  type VersionControlTextOutput
} from './version-control.js'

export const WORKSPACE_HOST_PROTOCOL_VERSION = 1 as const
export const MAIN_WORKSPACE_HOST_PROVIDER_CONTRIBUTION_KIND =
  'main.workspace-host-provider' as const

export const WORKSPACE_HOST_LIMITS = Object.freeze({
  maxIdentifierCharacters: 256,
  maxPathCharacters: 4_096,
  maxOperationCharacters: 192,
  maxCapabilities: 1_000,
  maxContributions: 1_000,
  maxPayloadBytes: 16 * 1024 * 1024,
  maxInlineBinaryBytes: 8 * 1024 * 1024,
  maxPayloadStringCharacters: 12 * 1024 * 1024,
  maxPayloadArrayItems: 10_000,
  maxPayloadObjectKeys: 10_000,
  maxPayloadDepth: 32,
  maxPayloadNodes: 100_000,
  maxFailureMessageCharacters: 2_000,
  maxCloseReasonCharacters: 500,
  maxEgressTokenCharacters: 4_096,
  maxEgressAllowlistRules: 128,
  maxEgressPortsPerRule: 32,
  maxReplayEvents: 100_000,
  maxRequestTimeoutMilliseconds: 10 * 60 * 1_000
} as const)

const identifierSchema = z.string().trim().min(1)
  .max(WORKSPACE_HOST_LIMITS.maxIdentifierCharacters)
const absolutePathSchema = z.string().min(1).max(WORKSPACE_HOST_LIMITS.maxPathCharacters)
const sequenceSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const dateTimeSchema = z.string().datetime({ offset: true })

export type WorkspaceHostPayload =
  | null
  | boolean
  | number
  | string
  | WorkspaceHostPayload[]
  | { [key: string]: WorkspaceHostPayload }

const workspaceHostPayloadValueSchema: z.ZodType<WorkspaceHostPayload> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(WORKSPACE_HOST_LIMITS.maxPayloadStringCharacters),
  z.array(workspaceHostPayloadValueSchema).max(WORKSPACE_HOST_LIMITS.maxPayloadArrayItems),
  z.record(z.string().trim().min(1).max(192), workspaceHostPayloadValueSchema)
]))

export const workspaceHostPayloadSchema: z.ZodType<WorkspaceHostPayload> =
  workspaceHostPayloadValueSchema.superRefine((payload, context) => {
    const inspection = inspectPayload(payload)
    if (inspection.depth > WORKSPACE_HOST_LIMITS.maxPayloadDepth) {
      context.addIssue({
        code: 'custom',
        message: `Workspace Host payload depth cannot exceed ${WORKSPACE_HOST_LIMITS.maxPayloadDepth}.`
      })
    }
    if (inspection.nodes > WORKSPACE_HOST_LIMITS.maxPayloadNodes) {
      context.addIssue({
        code: 'custom',
        message: `Workspace Host payload nodes cannot exceed ${WORKSPACE_HOST_LIMITS.maxPayloadNodes}.`
      })
    }
    if (inspection.maxObjectKeys > WORKSPACE_HOST_LIMITS.maxPayloadObjectKeys) {
      context.addIssue({
        code: 'custom',
        message: `Workspace Host payload objects cannot exceed ${WORKSPACE_HOST_LIMITS.maxPayloadObjectKeys} keys.`
      })
    }
    if (inspection.bytes > WORKSPACE_HOST_LIMITS.maxPayloadBytes) {
      context.addIssue({
        code: 'custom',
        message: `Workspace Host payload cannot exceed ${WORKSPACE_HOST_LIMITS.maxPayloadBytes} bytes.`
      })
    }
  })

export const workspaceHostOperationSchema = z.string()
  .trim()
  .min(3)
  .max(WORKSPACE_HOST_LIMITS.maxOperationCharacters)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/,
    'Use a namespaced lowercase Workspace Host operation.'
  )

export const workspaceHostEventKindSchema = workspaceHostOperationSchema

export type WorkspaceHostOperation = z.infer<typeof workspaceHostOperationSchema>
export type WorkspaceHostEventKind = z.infer<typeof workspaceHostEventKindSchema>

export const WORKSPACE_HOST_OPERATIONS = Object.freeze({
  health: 'workspace-host.health',
  status: 'workspace-host.status',
  directoryList: 'workspace.fs.list',
  fileStat: 'workspace.fs.stat',
  fileRead: 'workspace.fs.read',
  fileReadRange: 'workspace.fs.read-range',
  fileWrite: 'workspace.fs.write',
  fileWatch: 'workspace.fs.watch',
  fileUnwatch: 'workspace.fs.unwatch',
  textSearch: 'workspace.search.text',
  processCreate: 'workspace.process.create',
  processRead: 'workspace.process.read',
  processWrite: 'workspace.process.write',
  processResize: 'workspace.process.resize',
  processDispose: 'workspace.process.dispose',
  versionControlStatus: 'workspace.version-control.status',
  versionControlDiff: 'workspace.version-control.diff',
  runtimeInvoke: 'agent-runtime.invoke',
  runtimeReplayEvents: 'agent-runtime.replay-events',
  previewInvoke: 'workspace.preview.invoke'
} as const satisfies Readonly<Record<string, WorkspaceHostOperation>>)

export const WORKSPACE_HOST_EVENT_KINDS = Object.freeze({
  fileChanged: 'workspace.fs.changed',
  processOutput: 'workspace.process.output',
  processExit: 'workspace.process.exit',
  runtimeEvent: 'agent-runtime.event',
  egressChanged: 'workspace-egress.changed',
  sessionChanged: 'workspace-host.session-changed'
} as const satisfies Readonly<Record<string, WorkspaceHostEventKind>>)

const workspaceHostPathSchema = z.string().min(1).max(WORKSPACE_HOST_LIMITS.maxPathCharacters)
const workspaceHostRevisionSchema = z.string().trim().min(1).max(512)
const workspaceHostCursorSchema = z.string().trim().min(1).max(512)
const workspaceHostBase64Schema = z.string()
  .max(Math.ceil(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes / 3) * 4)
  .superRefine((value, context) => {
    if (isCanonicalBase64(value)) return
    context.addIssue({
      code: 'custom',
      message: 'Expected canonical base64 content.'
    })
  })

export const workspaceHostFileEntrySchema = z.object({
  name: z.string().min(1).max(1_024),
  path: workspaceHostPathSchema,
  kind: z.enum(['file', 'directory', 'symbolic-link', 'other']),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mtimeMs: z.number().finite().min(0),
  revision: workspaceHostRevisionSchema.optional()
}).strict()

export type WorkspaceHostFileEntry = z.infer<typeof workspaceHostFileEntrySchema>

export const workspaceHostDirectoryListInputSchema = z.object({
  path: workspaceHostPathSchema,
  cursor: workspaceHostCursorSchema.optional(),
  limit: z.number().int().min(1).max(10_000).default(1_000)
}).strict()

export const workspaceHostDirectoryListOutputSchema = z.object({
  entries: z.array(workspaceHostFileEntrySchema).max(10_000),
  nextCursor: workspaceHostCursorSchema.optional()
}).strict()

export const workspaceHostFileStatInputSchema = z.object({
  path: workspaceHostPathSchema
}).strict()

export const workspaceHostFileStatOutputSchema = z.object({
  entry: workspaceHostFileEntrySchema
}).strict()

export const workspaceHostFileReadInputSchema = z.object({
  path: workspaceHostPathSchema,
  maxBytes: z.number().int().min(1)
    .max(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes)
    .default(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes)
}).strict()

export const workspaceHostFileReadRangeInputSchema = z.object({
  path: workspaceHostPathSchema,
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  length: z.number().int().min(1).max(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes)
}).strict()

export const workspaceHostFileReadOutputSchema = z.object({
  contentBase64: workspaceHostBase64Schema,
  bytesRead: z.number().int().min(0).max(WORKSPACE_HOST_LIMITS.maxInlineBinaryBytes),
  truncated: z.boolean(),
  revision: workspaceHostRevisionSchema
}).strict()

export const workspaceHostFileWriteInputSchema = z.object({
  path: workspaceHostPathSchema,
  contentBase64: workspaceHostBase64Schema,
  expectedRevision: workspaceHostRevisionSchema.optional(),
  create: z.boolean().default(true)
}).strict()

export const workspaceHostFileWriteOutputSchema = z.object({
  revision: workspaceHostRevisionSchema,
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mtimeMs: z.number().finite().min(0)
}).strict()

export const workspaceHostFileWatchInputSchema = z.object({
  path: workspaceHostPathSchema,
  recursive: z.boolean().default(false)
}).strict()

export const workspaceHostFileWatchOutputSchema = z.object({
  watchId: identifierSchema,
  sequence: sequenceSchema
}).strict()

export const workspaceHostFileUnwatchInputSchema = z.object({
  watchId: identifierSchema
}).strict()

export const workspaceHostMutationOutputSchema = z.object({
  ok: z.literal(true)
}).strict()

export const workspaceHostTextSearchInputSchema = z.object({
  query: z.string().min(1).max(10_000),
  path: workspaceHostPathSchema.optional(),
  glob: z.string().min(1).max(1_024).optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(10_000).default(1_000)
}).strict()

export const workspaceHostTextSearchMatchSchema = z.object({
  path: workspaceHostPathSchema,
  line: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  column: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  preview: z.string().max(20_000)
}).strict()

export const workspaceHostTextSearchOutputSchema = z.object({
  matches: z.array(workspaceHostTextSearchMatchSchema).max(10_000),
  truncated: z.boolean()
}).strict()

export const workspaceHostProcessCreateInputSchema = z.object({
  profile: z.literal('system-shell'),
  cwd: workspaceHostPathSchema.optional(),
  terminal: z.object({
    columns: z.number().int().min(1).max(1_000),
    rows: z.number().int().min(1).max(1_000)
  }).strict().optional()
}).strict()

export const workspaceHostProcessCreateOutputSchema = z.object({
  processId: identifierSchema,
  cursor: workspaceHostCursorSchema
}).strict()

export const workspaceHostProcessReadInputSchema = z.object({
  processId: identifierSchema,
  cursor: workspaceHostCursorSchema,
  maxCharacters: z.number().int().min(1).max(1_000_000).default(100_000),
  waitMilliseconds: z.number().int().min(0).max(30_000).default(0)
}).strict()

export const workspaceHostProcessReadOutputSchema = z.object({
  cursor: workspaceHostCursorSchema,
  chunks: z.array(z.object({
    stream: z.enum(['stdout', 'stderr']),
    data: z.string().max(1_000_000)
  }).strict()).max(10_000),
  truncated: z.boolean(),
  exit: z.object({
    code: z.number().int().nullable(),
    signal: z.string().min(1).max(128).nullable()
  }).strict().optional()
}).strict().superRefine((output, context) => {
  if (output.chunks.reduce((total, chunk) => total + chunk.data.length, 0) <= 1_000_000) return
  context.addIssue({
    code: 'custom',
    path: ['chunks'],
    message: 'Workspace process read output cannot exceed 1000000 characters.'
  })
})

export const workspaceHostProcessWriteInputSchema = z.object({
  processId: identifierSchema,
  data: z.string().min(1).max(100_000)
}).strict()

export const workspaceHostProcessWriteOutputSchema = z.object({
  acceptedCharacters: z.number().int().min(0).max(100_000)
}).strict()

export const workspaceHostProcessResizeInputSchema = z.object({
  processId: identifierSchema,
  columns: z.number().int().min(1).max(1_000),
  rows: z.number().int().min(1).max(1_000)
}).strict()

export const workspaceHostProcessResizeOutputSchema = z.object({
  supported: z.literal(false),
  behavior: z.enum(['sigwinch-notification', 'unsupported'])
}).strict()

export const workspaceHostProcessDisposeInputSchema = z.object({
  processId: identifierSchema,
  reason: z.string().trim().min(1)
    .max(WORKSPACE_HOST_LIMITS.maxCloseReasonCharacters)
    .optional()
}).strict()

export const workspaceHostRuntimeMethodSchema = z.enum([
  'connect',
  'capabilities',
  'listThreads',
  'startThread',
  'readThreadStatus',
  'readThreadPage',
  'readToolArtifact',
  'startTurn',
  'interruptTurn',
  'steerTurn',
  'renameThread',
  'deleteThread',
  'publishSyntheticEvent',
  'updateTurnGovernanceSnapshot',
  'resolveApproval',
  'resolveUserInput',
  'compactThread',
  'forkThread',
  'resumeSession',
  'updateThreadRelation',
  'usage',
  'auxiliary',
  'subscribeEvents',
  'unsubscribeEvents'
])

export type WorkspaceHostRuntimeMethod = z.infer<typeof workspaceHostRuntimeMethodSchema>

export const workspaceHostRuntimeInvokeInputSchema = z.object({
  contractVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  runtimeId: identifierSchema,
  method: workspaceHostRuntimeMethodSchema,
  input: workspaceHostPayloadSchema.optional(),
  context: z.object({
    turnGovernanceSnapshot: workspaceHostPayloadSchema.optional()
  }).strict().optional(),
  streamId: identifierSchema.optional()
}).strict()

export const workspaceHostRuntimeInvokeOutputSchema = z.object({
  contractVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  runtimeId: identifierSchema,
  method: workspaceHostRuntimeMethodSchema,
  result: workspaceHostPayloadSchema
}).strict()

export const workspaceHostRuntimeReplayEventsInputSchema = z.object({
  contractVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  runtimeId: identifierSchema,
  threadId: identifierSchema,
  sinceSeq: sequenceSchema,
  streamId: identifierSchema.optional()
}).strict()

export const workspaceHostRuntimeEventPayloadSchema = z.object({
  contractVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  runtimeId: identifierSchema,
  threadId: identifierSchema,
  streamId: identifierSchema,
  event: workspaceHostPayloadSchema
}).strict()

export const workspaceHostPreviewInvokeInputSchema = z.object({
  pluginId: identifierSchema,
  method: z.string().trim().min(1).max(192),
  input: workspaceHostPayloadSchema
}).strict()

export type WorkspaceHostDirectoryListInput = z.input<
  typeof workspaceHostDirectoryListInputSchema
>
export type WorkspaceHostDirectoryListOutput = z.infer<
  typeof workspaceHostDirectoryListOutputSchema
>
export type WorkspaceHostFileStatInput = z.infer<typeof workspaceHostFileStatInputSchema>
export type WorkspaceHostFileStatOutput = z.infer<typeof workspaceHostFileStatOutputSchema>
export type WorkspaceHostFileReadInput = z.input<typeof workspaceHostFileReadInputSchema>
export type WorkspaceHostFileReadRangeInput = z.infer<
  typeof workspaceHostFileReadRangeInputSchema
>
export type WorkspaceHostFileReadOutput = z.infer<typeof workspaceHostFileReadOutputSchema>
export type WorkspaceHostFileWriteInput = z.input<typeof workspaceHostFileWriteInputSchema>
export type WorkspaceHostFileWriteOutput = z.infer<typeof workspaceHostFileWriteOutputSchema>
export type WorkspaceHostFileWatchInput = z.input<typeof workspaceHostFileWatchInputSchema>
export type WorkspaceHostFileWatchOutput = z.infer<typeof workspaceHostFileWatchOutputSchema>
export type WorkspaceHostFileUnwatchInput = z.infer<typeof workspaceHostFileUnwatchInputSchema>
export type WorkspaceHostMutationOutput = z.infer<typeof workspaceHostMutationOutputSchema>
export type WorkspaceHostTextSearchInput = z.input<typeof workspaceHostTextSearchInputSchema>
export type WorkspaceHostTextSearchOutput = z.infer<typeof workspaceHostTextSearchOutputSchema>
export type WorkspaceHostProcessCreateInput = z.input<typeof workspaceHostProcessCreateInputSchema>
export type WorkspaceHostProcessCreateOutput = z.infer<typeof workspaceHostProcessCreateOutputSchema>
export type WorkspaceHostProcessReadInput = z.input<typeof workspaceHostProcessReadInputSchema>
export type WorkspaceHostProcessReadOutput = z.infer<typeof workspaceHostProcessReadOutputSchema>
export type WorkspaceHostProcessWriteInput = z.infer<typeof workspaceHostProcessWriteInputSchema>
export type WorkspaceHostProcessWriteOutput = z.infer<typeof workspaceHostProcessWriteOutputSchema>
export type WorkspaceHostProcessResizeInput = z.infer<typeof workspaceHostProcessResizeInputSchema>
export type WorkspaceHostProcessResizeOutput = z.infer<
  typeof workspaceHostProcessResizeOutputSchema
>
export type WorkspaceHostProcessDisposeInput = z.infer<typeof workspaceHostProcessDisposeInputSchema>
export type WorkspaceHostRuntimeInvokeInput = z.infer<typeof workspaceHostRuntimeInvokeInputSchema>
export type WorkspaceHostRuntimeInvokeOutput = z.infer<typeof workspaceHostRuntimeInvokeOutputSchema>
export type WorkspaceHostRuntimeReplayEventsInput = z.infer<
  typeof workspaceHostRuntimeReplayEventsInputSchema
>
export type WorkspaceHostRuntimeEventPayload = z.infer<
  typeof workspaceHostRuntimeEventPayloadSchema
>
export type WorkspaceHostPreviewInvokeInput = z.infer<typeof workspaceHostPreviewInvokeInputSchema>

export type WorkspaceHostBuiltInOperationTypeMap = Readonly<{
  [WORKSPACE_HOST_OPERATIONS.health]: {
    input: Record<string, never>
    output: WorkspaceHostPayload
  }
  [WORKSPACE_HOST_OPERATIONS.status]: {
    input: Record<string, never>
    output: WorkspaceHostPayload
  }
  [WORKSPACE_HOST_OPERATIONS.directoryList]: {
    input: WorkspaceHostDirectoryListInput
    output: WorkspaceHostDirectoryListOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileStat]: {
    input: WorkspaceHostFileStatInput
    output: WorkspaceHostFileStatOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileRead]: {
    input: WorkspaceHostFileReadInput
    output: WorkspaceHostFileReadOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileReadRange]: {
    input: WorkspaceHostFileReadRangeInput
    output: WorkspaceHostFileReadOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileWrite]: {
    input: WorkspaceHostFileWriteInput
    output: WorkspaceHostFileWriteOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileWatch]: {
    input: WorkspaceHostFileWatchInput
    output: WorkspaceHostFileWatchOutput
  }
  [WORKSPACE_HOST_OPERATIONS.fileUnwatch]: {
    input: WorkspaceHostFileUnwatchInput
    output: WorkspaceHostMutationOutput
  }
  [WORKSPACE_HOST_OPERATIONS.textSearch]: {
    input: WorkspaceHostTextSearchInput
    output: WorkspaceHostTextSearchOutput
  }
  [WORKSPACE_HOST_OPERATIONS.processCreate]: {
    input: WorkspaceHostProcessCreateInput
    output: WorkspaceHostProcessCreateOutput
  }
  [WORKSPACE_HOST_OPERATIONS.processRead]: {
    input: WorkspaceHostProcessReadInput
    output: WorkspaceHostProcessReadOutput
  }
  [WORKSPACE_HOST_OPERATIONS.processWrite]: {
    input: WorkspaceHostProcessWriteInput
    output: WorkspaceHostProcessWriteOutput
  }
  [WORKSPACE_HOST_OPERATIONS.processResize]: {
    input: WorkspaceHostProcessResizeInput
    output: WorkspaceHostProcessResizeOutput
  }
  [WORKSPACE_HOST_OPERATIONS.processDispose]: {
    input: WorkspaceHostProcessDisposeInput
    output: WorkspaceHostMutationOutput
  }
  [WORKSPACE_HOST_OPERATIONS.versionControlStatus]: {
    input: Record<string, never>
    output: VersionControlStatusOutput
  }
  [WORKSPACE_HOST_OPERATIONS.versionControlDiff]: {
    input: VersionControlDiffInput
    output: VersionControlTextOutput
  }
  [WORKSPACE_HOST_OPERATIONS.runtimeInvoke]: {
    input: WorkspaceHostRuntimeInvokeInput
    output: WorkspaceHostRuntimeInvokeOutput
  }
  [WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents]: {
    input: WorkspaceHostRuntimeReplayEventsInput
    output: WorkspaceHostPayload
  }
  [WORKSPACE_HOST_OPERATIONS.previewInvoke]: {
    input: WorkspaceHostPreviewInvokeInput
    output: WorkspaceHostPayload
  }
}>

export type WorkspaceHostBuiltInOperation = keyof WorkspaceHostBuiltInOperationTypeMap
export type WorkspaceHostOperationInput<Operation extends WorkspaceHostOperation> =
  Operation extends WorkspaceHostBuiltInOperation
    ? WorkspaceHostBuiltInOperationTypeMap[Operation]['input']
    : WorkspaceHostPayload
export type WorkspaceHostOperationOutput<Operation extends WorkspaceHostOperation> =
  Operation extends WorkspaceHostBuiltInOperation
    ? WorkspaceHostBuiltInOperationTypeMap[Operation]['output']
    : WorkspaceHostPayload

export type WorkspaceHostOperationContract<
  Operation extends WorkspaceHostBuiltInOperation = WorkspaceHostBuiltInOperation
> = Readonly<{
  operation: Operation
  inputSchema: z.ZodType<WorkspaceHostBuiltInOperationTypeMap[Operation]['input']>
  outputSchema: z.ZodType<WorkspaceHostBuiltInOperationTypeMap[Operation]['output']>
}>

const emptyPayloadSchema = z.object({}).strict()

export const WORKSPACE_HOST_BUILT_IN_OPERATION_CONTRACTS = Object.freeze([
  operationContract(WORKSPACE_HOST_OPERATIONS.health, emptyPayloadSchema, workspaceHostPayloadSchema),
  operationContract(WORKSPACE_HOST_OPERATIONS.status, emptyPayloadSchema, workspaceHostPayloadSchema),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.directoryList,
    workspaceHostDirectoryListInputSchema,
    workspaceHostDirectoryListOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileStat,
    workspaceHostFileStatInputSchema,
    workspaceHostFileStatOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileRead,
    workspaceHostFileReadInputSchema,
    workspaceHostFileReadOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileReadRange,
    workspaceHostFileReadRangeInputSchema,
    workspaceHostFileReadOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileWrite,
    workspaceHostFileWriteInputSchema,
    workspaceHostFileWriteOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileWatch,
    workspaceHostFileWatchInputSchema,
    workspaceHostFileWatchOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.fileUnwatch,
    workspaceHostFileUnwatchInputSchema,
    workspaceHostMutationOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.textSearch,
    workspaceHostTextSearchInputSchema,
    workspaceHostTextSearchOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.processCreate,
    workspaceHostProcessCreateInputSchema,
    workspaceHostProcessCreateOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.processRead,
    workspaceHostProcessReadInputSchema,
    workspaceHostProcessReadOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.processWrite,
    workspaceHostProcessWriteInputSchema,
    workspaceHostProcessWriteOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.processResize,
    workspaceHostProcessResizeInputSchema,
    workspaceHostProcessResizeOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.processDispose,
    workspaceHostProcessDisposeInputSchema,
    workspaceHostMutationOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.versionControlStatus,
    emptyPayloadSchema,
    versionControlStatusOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.versionControlDiff,
    versionControlDiffInputSchema,
    versionControlTextOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.runtimeInvoke,
    workspaceHostRuntimeInvokeInputSchema,
    workspaceHostRuntimeInvokeOutputSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.runtimeReplayEvents,
    workspaceHostRuntimeReplayEventsInputSchema,
    workspaceHostPayloadSchema
  ),
  operationContract(
    WORKSPACE_HOST_OPERATIONS.previewInvoke,
    workspaceHostPreviewInvokeInputSchema,
    workspaceHostPayloadSchema
  )
] as const)

export function workspaceHostOperationContract(
  operation: WorkspaceHostOperation
): WorkspaceHostOperationContract | undefined {
  return WORKSPACE_HOST_BUILT_IN_OPERATION_CONTRACTS.find(
    (contract) => contract.operation === operation
  ) as WorkspaceHostOperationContract | undefined
}

export function parseWorkspaceHostOperationInput<Operation extends WorkspaceHostBuiltInOperation>(
  operation: Operation,
  input: unknown
): WorkspaceHostBuiltInOperationTypeMap[Operation]['input'] {
  const contract = requireWorkspaceHostOperationContract(operation)
  return contract.inputSchema.parse(input) as WorkspaceHostBuiltInOperationTypeMap[Operation]['input']
}

export function parseWorkspaceHostOperationOutput<Operation extends WorkspaceHostBuiltInOperation>(
  operation: Operation,
  output: unknown
): WorkspaceHostBuiltInOperationTypeMap[Operation]['output'] {
  const contract = requireWorkspaceHostOperationContract(operation)
  return contract.outputSchema.parse(output) as WorkspaceHostBuiltInOperationTypeMap[Operation]['output']
}

export const workspaceLocatorSchema = z.object({
  contractVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  hostSessionId: identifierSchema,
  path: absolutePathSchema
}).strict()

export type WorkspaceLocator = z.infer<typeof workspaceLocatorSchema>

export const workspaceHostLifecycleModeSchema = z.enum([
  'persistent-daemon',
  'connection-session'
])

export type WorkspaceHostLifecycleMode = z.infer<typeof workspaceHostLifecycleModeSchema>

const workspaceAuthorizedSessionIdSchema = identifierSchema

export const workspaceNetworkEgressAllowlistRuleSchema = z.object({
  host: z.string()
    .trim()
    .min(1)
    .max(253)
    .regex(
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      'Use one exact lowercase DNS host or IPv4 address without a wildcard or port.'
    ),
  ports: z.array(z.number().int().min(1).max(65_535))
    .min(1)
    .max(WORKSPACE_HOST_LIMITS.maxEgressPortsPerRule)
}).strict().superRefine((rule, context) => {
  const ports = new Set<number>()
  for (const [index, port] of rule.ports.entries()) {
    if (!ports.has(port)) {
      ports.add(port)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: ['ports', index],
      message: `Duplicate egress port ${port}.`
    })
  }
})

export type WorkspaceNetworkEgressAllowlistRule = z.infer<
  typeof workspaceNetworkEgressAllowlistRuleSchema
>

export const workspaceNetworkEgressAllowlistSchema = z.object({
  rules: z.array(workspaceNetworkEgressAllowlistRuleSchema)
    .min(1)
    .max(WORKSPACE_HOST_LIMITS.maxEgressAllowlistRules)
}).strict().superRefine((allowlist, context) => {
  const hosts = new Set<string>()
  for (const [index, rule] of allowlist.rules.entries()) {
    if (!hosts.has(rule.host)) {
      hosts.add(rule.host)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: ['rules', index, 'host'],
      message: `Duplicate egress host ${rule.host}; combine its ports in one rule.`
    })
  }
})

export type WorkspaceNetworkEgressAllowlist = z.infer<
  typeof workspaceNetworkEgressAllowlistSchema
>

export const workspaceNetworkEgressSelectionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('none')
  }).strict(),
  z.object({
    mode: z.literal('local'),
    allowlist: workspaceNetworkEgressAllowlistSchema
  }).strict(),
  z.object({
    mode: z.literal('remote-target'),
    authorizedSessionId: workspaceAuthorizedSessionIdSchema,
    allowlist: workspaceNetworkEgressAllowlistSchema
  }).strict()
])

export type WorkspaceNetworkEgressSelection = z.infer<
  typeof workspaceNetworkEgressSelectionSchema
>

export const workspaceNetworkEgressStateSchema = z.object({
  mode: z.enum(['none', 'local', 'remote-target']),
  status: z.enum(['disabled', 'connecting', 'ready', 'unavailable', 'expired', 'revoked']),
  leaseExpiresAt: dateTimeSchema.optional(),
  failureCode: z.string().trim().min(1).max(128).optional()
}).strict()

export type WorkspaceNetworkEgressState = z.infer<typeof workspaceNetworkEgressStateSchema>

const workspaceHostLoopbackProxyEndpointSchema = z.string()
  .trim()
  .min(1)
  .max(512)
  .url()
  .superRefine((value, context) => {
    const endpoint = new URL(value)
    const loopbackHost = endpoint.hostname === '[::1]' ||
      isIpv4LoopbackHost(endpoint.hostname)
    if (
      endpoint.protocol === 'http:' &&
      loopbackHost &&
      endpoint.port !== '' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      endpoint.pathname === '/' &&
      endpoint.search === '' &&
      endpoint.hash === ''
    ) return
    context.addIssue({
      code: 'custom',
      message: 'Egress access must use an explicit HTTP loopback proxy port without URL credentials.'
    })
  })

export const workspaceHostEgressAuthorizationSchema = z.object({
  scheme: z.literal('bearer'),
  token: z.string()
    .min(24)
    .max(WORKSPACE_HOST_LIMITS.maxEgressTokenCharacters)
    .regex(/^[A-Za-z0-9._~-]+$/)
}).strict()

/**
 * Sensitive first-frame material. It may be written only to the authenticated
 * Workspace Host transport; never place this value in argv, logs, events,
 * responses, observations, or persisted session metadata.
 */
export const workspaceHostEgressAccessSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('none')
  }).strict(),
  z.object({
    mode: z.literal('local'),
    proxyEndpoint: workspaceHostLoopbackProxyEndpointSchema,
    authorization: workspaceHostEgressAuthorizationSchema,
    expiresAt: dateTimeSchema
  }).strict(),
  z.object({
    mode: z.literal('remote-target'),
    proxyEndpoint: workspaceHostLoopbackProxyEndpointSchema,
    authorization: workspaceHostEgressAuthorizationSchema,
    expiresAt: dateTimeSchema
  }).strict()
])

export type WorkspaceHostEgressAccess = z.infer<typeof workspaceHostEgressAccessSchema>
export type WorkspaceHostEgressAuthorization = z.infer<
  typeof workspaceHostEgressAuthorizationSchema
>

const workspaceHostLoopbackModelBaseUrlSchema = z.string()
  .trim()
  .min(1)
  .max(512)
  .url()
  .superRefine((value, context) => {
    const endpoint = new URL(value)
    const loopbackHost = endpoint.hostname === '[::1]' ||
      isIpv4LoopbackHost(endpoint.hostname)
    if (
      endpoint.protocol === 'http:' &&
      loopbackHost &&
      endpoint.port !== '' &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      (endpoint.pathname === '/v1' || endpoint.pathname === '/v1/') &&
      endpoint.search === '' &&
      endpoint.hash === ''
    ) return
    context.addIssue({
      code: 'custom',
      message: 'Model access must use an explicit HTTP loopback /v1 base URL without credentials.'
    })
  })

/**
 * Sensitive, scoped access to a user-authorized Model Router bridge. This is
 * distinct from general CONNECT egress and must never contain an upstream or
 * desktop-static provider key.
 */
export const workspaceHostModelAccessSchema = z.object({
  baseUrl: workspaceHostLoopbackModelBaseUrlSchema,
  authorization: workspaceHostEgressAuthorizationSchema,
  expiresAt: dateTimeSchema
}).strict()

export type WorkspaceHostModelAccess = z.infer<typeof workspaceHostModelAccessSchema>

export const workspaceHostModelAccessLeaseSchema = z.object({
  leaseId: identifierSchema,
  workspaceId: identifierSchema,
  endpoint: z.object({
    protocol: z.literal('http'),
    host: z.enum(['127.0.0.1', '::1']),
    port: z.number().int().min(1).max(65_535),
    basePath: z.literal('/v1')
  }).strict(),
  authorization: workspaceHostEgressAuthorizationSchema,
  issuedAt: dateTimeSchema,
  expiresAt: dateTimeSchema
}).strict()

export type WorkspaceHostModelAccessLease = z.infer<
  typeof workspaceHostModelAccessLeaseSchema
>

export const workspaceHostModelAccessAcquireInputSchema = z.object({
  workspaceId: identifierSchema,
  ttlMs: z.number().int().min(5_000).max(60 * 60_000).optional()
}).strict()

export type WorkspaceHostModelAccessAcquireInput = z.infer<
  typeof workspaceHostModelAccessAcquireInputSchema
> & Readonly<{
  signal?: AbortSignal
}>

export const workspaceHostModelAccessHeartbeatInputSchema = z.object({
  workspaceId: identifierSchema,
  leaseId: identifierSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token,
  ttlMs: z.number().int().min(5_000).max(60 * 60_000).optional()
}).strict()

export type WorkspaceHostModelAccessHeartbeatInput = z.infer<
  typeof workspaceHostModelAccessHeartbeatInputSchema
>

export const workspaceHostModelAccessLeaseStateSchema = z.object({
  workspaceId: identifierSchema,
  leaseId: identifierSchema,
  expiresAt: dateTimeSchema
}).strict()

export type WorkspaceHostModelAccessLeaseState = z.infer<
  typeof workspaceHostModelAccessLeaseStateSchema
>

export const workspaceHostModelAccessRevokeInputSchema = z.object({
  workspaceId: identifierSchema,
  leaseId: identifierSchema,
  token: workspaceHostEgressAuthorizationSchema.shape.token
}).strict()

export type WorkspaceHostModelAccessRevokeInput = z.infer<
  typeof workspaceHostModelAccessRevokeInputSchema
>

export type WorkspaceHostModelAccessProvider = Readonly<{
  acquire(
    input: WorkspaceHostModelAccessAcquireInput
  ): Promise<WorkspaceHostModelAccessLease | null>
  heartbeat(
    input: WorkspaceHostModelAccessHeartbeatInput
  ): Promise<WorkspaceHostModelAccessLeaseState>
  revoke(input: WorkspaceHostModelAccessRevokeInput): void | Promise<void>
}>

export const workspaceHostCapabilitySchema = z.object({
  operation: workspaceHostOperationSchema,
  version: domainPackageVersionSchema,
  maxRequestBytes: z.number().int().min(1).max(WORKSPACE_HOST_LIMITS.maxPayloadBytes),
  maxResponseBytes: z.number().int().min(1).max(WORKSPACE_HOST_LIMITS.maxPayloadBytes)
}).strict()

export type WorkspaceHostCapability = z.infer<typeof workspaceHostCapabilitySchema>

export const workspaceHostContributionCohortSchema = z.object({
  packageName: domainPackageNameSchema,
  moduleId: z.string().trim().min(3).max(192),
  moduleVersion: domainPackageVersionSchema
}).strict()

export type WorkspaceHostContributionCohort = z.infer<
  typeof workspaceHostContributionCohortSchema
>

const workspaceHostArtifactRelativePathSchema = z.string()
  .trim()
  .min(1)
  .max(WORKSPACE_HOST_LIMITS.maxPathCharacters)
  .superRefine((relativePath, context) => {
    if (
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      relativePath.includes('\0') ||
      relativePath.split('/').some((segment) =>
        segment === '' || segment === '.' || segment === '..'
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workspace server artifact paths must be package-relative POSIX paths.'
      })
    }
  })

export const workspaceHostArtifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  serverVersion: domainPackageVersionSchema,
  platform: z.literal('linux'),
  arch: z.literal('x64'),
  runtime: z.literal('bundled-node@22.18.0'),
  entrypoint: workspaceHostArtifactRelativePathSchema,
  files: z.array(z.object({
    path: workspaceHostArtifactRelativePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    executable: z.boolean()
  }).strict()).min(1).max(10_000),
  readinessProbes: z.array(z.object({
    id: z.string().trim().min(1).max(128).regex(/^[a-z][a-z0-9-]*$/),
    executablePath: workspaceHostArtifactRelativePathSchema,
    arguments: z.array(
      z.string().min(1).max(128).regex(/^--?[A-Za-z0-9][A-Za-z0-9._-]*$/)
    ).max(16),
    expectedStdout: z.string().trim().min(1).max(512)
  }).strict()).max(64),
  contributions: z.array(workspaceHostContributionCohortSchema)
    .max(WORKSPACE_HOST_LIMITS.maxContributions)
    .default([])
}).strict().superRefine((manifest, context) => {
  const filesByPath = new Map<string, { executable: boolean }>()
  for (const [index, file] of manifest.files.entries()) {
    if (filesByPath.has(file.path)) {
      context.addIssue({
        code: 'custom',
        path: ['files', index, 'path'],
        message: `Workspace server artifact repeats ${file.path}.`
      })
    }
    filesByPath.set(file.path, file)
  }
  if (!filesByPath.has(manifest.entrypoint)) {
    context.addIssue({
      code: 'custom',
      path: ['entrypoint'],
      message: 'Workspace server artifact entrypoint must be declared in files.'
    })
  }
  if (filesByPath.get(manifest.entrypoint)?.executable !== true) {
    context.addIssue({
      code: 'custom',
      path: ['entrypoint'],
      message: 'Workspace server artifact entrypoint must be executable.'
    })
  }
  const probeIds = new Set<string>()
  for (const [index, probe] of manifest.readinessProbes.entries()) {
    if (probeIds.has(probe.id)) {
      context.addIssue({
        code: 'custom',
        path: ['readinessProbes', index, 'id'],
        message: `Workspace server artifact repeats readiness probe ${probe.id}.`
      })
    }
    probeIds.add(probe.id)
    if (filesByPath.get(probe.executablePath)?.executable !== true) {
      context.addIssue({
        code: 'custom',
        path: ['readinessProbes', index, 'executablePath'],
        message: 'Workspace server readiness probes must reference declared executable files.'
      })
    }
  }
})

export type WorkspaceHostArtifactManifest = z.input<
  typeof workspaceHostArtifactManifestSchema
>

export type WorkspaceHostArtifact = Readonly<{
  directory: string
  manifest: WorkspaceHostArtifactManifest
}>

export const workspaceHostReplayWindowSchema = z.object({
  earliestSequence: sequenceSchema,
  latestSequence: sequenceSchema
}).strict().superRefine((window, context) => {
  if (window.earliestSequence <= window.latestSequence) return
  context.addIssue({
    code: 'custom',
    path: ['earliestSequence'],
    message: 'Replay earliestSequence cannot exceed latestSequence.'
  })
})

export type WorkspaceHostReplayWindow = z.infer<typeof workspaceHostReplayWindowSchema>

export const workspaceHostSessionSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  serverVersion: domainPackageVersionSchema,
  serverInstanceId: identifierSchema,
  sessionId: identifierSchema,
  lifecycleMode: workspaceHostLifecycleModeSchema,
  locator: workspaceLocatorSchema,
  platform: z.object({
    os: z.enum(['linux', 'darwin', 'win32']),
    architecture: z.enum(['x64', 'arm64'])
  }).strict(),
  capabilities: z.array(workspaceHostCapabilitySchema)
    .max(WORKSPACE_HOST_LIMITS.maxCapabilities),
  contributions: z.array(workspaceHostContributionCohortSchema)
    .max(WORKSPACE_HOST_LIMITS.maxContributions),
  eventSequence: sequenceSchema,
  replay: workspaceHostReplayWindowSchema,
  egress: workspaceNetworkEgressStateSchema
}).strict().superRefine((session, context) => {
  if (session.locator.hostSessionId !== session.sessionId) {
    context.addIssue({
      code: 'custom',
      path: ['locator', 'hostSessionId'],
      message: 'Workspace locator must belong to the enclosing session.'
    })
  }
  if (
    session.eventSequence < session.replay.earliestSequence ||
    session.eventSequence > session.replay.latestSequence
  ) {
    context.addIssue({
      code: 'custom',
      path: ['eventSequence'],
      message: 'Current event sequence must be inside the replay window.'
    })
  }
  const operations = new Set<string>()
  for (const [index, capability] of session.capabilities.entries()) {
    if (!operations.has(capability.operation)) {
      operations.add(capability.operation)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: ['capabilities', index, 'operation'],
      message: `Duplicate Workspace Host operation ${capability.operation}.`
    })
  }
  const modules = new Set<string>()
  for (const [index, contribution] of session.contributions.entries()) {
    if (!modules.has(contribution.moduleId)) {
      modules.add(contribution.moduleId)
      continue
    }
    context.addIssue({
      code: 'custom',
      path: ['contributions', index, 'moduleId'],
      message: `Duplicate Workspace Host contribution module ${contribution.moduleId}.`
    })
  }
})

export type WorkspaceHostSession = z.infer<typeof workspaceHostSessionSchema>

export const workspaceHostFailureCodeSchema = z.enum([
  'compatibility-error',
  'unsupported-operation',
  'invalid-request',
  'not-found',
  'permission-denied',
  'path-outside-workspace',
  'conflict',
  'payload-too-large',
  'replay-gap',
  'session-expired',
  'disconnected',
  'egress-unavailable',
  'model-access-unavailable',
  'cancelled',
  'deadline-exceeded',
  'internal-error'
])

export type WorkspaceHostFailureCode = z.infer<typeof workspaceHostFailureCodeSchema>

export const workspaceHostFailureSchema = z.object({
  code: workspaceHostFailureCodeSchema,
  message: z.string().trim().min(1)
    .max(WORKSPACE_HOST_LIMITS.maxFailureMessageCharacters),
  retryable: z.boolean(),
  details: workspaceHostPayloadSchema.optional()
}).strict()

export type WorkspaceHostFailure = z.infer<typeof workspaceHostFailureSchema>

/**
 * Public fail-closed error for package-owned Workspace Host operation
 * handlers. The host parses this through the canonical failure schema before
 * exposing it on the wire; packages never import host-private error classes.
 */
export class WorkspaceHostOperationError extends Error {
  readonly code: WorkspaceHostFailureCode
  readonly retryable: boolean
  readonly details?: WorkspaceHostPayload

  constructor(failure: WorkspaceHostFailure) {
    const parsed = workspaceHostFailureSchema.parse(failure)
    super(parsed.message)
    this.name = 'WorkspaceHostOperationError'
    this.code = parsed.code
    this.retryable = parsed.retryable
    if (parsed.details !== undefined) this.details = parsed.details
  }
}

export const workspaceHostRequestSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  requestId: identifierSchema,
  operation: workspaceHostOperationSchema,
  payload: workspaceHostPayloadSchema,
  idempotencyKey: identifierSchema.optional(),
  expectedRevision: z.string().trim().min(1).max(512).optional()
}).strict()

export type WorkspaceHostRequest = z.infer<typeof workspaceHostRequestSchema>

export const workspaceHostAcknowledgeSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  sequence: sequenceSchema
}).strict()

export type WorkspaceHostAcknowledge = z.infer<typeof workspaceHostAcknowledgeSchema>

/**
 * Sensitive transport control for extending the lifetime of proxy credentials
 * that were installed by the authenticated handshake. This frame never carries
 * the credential itself and must not be written to the event journal or logs.
 */
export const workspaceHostEgressRenewSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  control: z.literal('egress-renew'),
  expiresAt: dateTimeSchema
}).strict()

export type WorkspaceHostEgressRenew = z.infer<typeof workspaceHostEgressRenewSchema>

export const workspaceHostEgressRevokeSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  control: z.literal('egress-revoke')
}).strict()

export type WorkspaceHostEgressRevoke = z.infer<typeof workspaceHostEgressRevokeSchema>

export const workspaceHostModelAccessRenewSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  control: z.literal('model-access-renew'),
  expiresAt: dateTimeSchema
}).strict()

export type WorkspaceHostModelAccessRenew = z.infer<
  typeof workspaceHostModelAccessRenewSchema
>

export const workspaceHostModelAccessRevokeSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  control: z.literal('model-access-revoke')
}).strict()

export type WorkspaceHostModelAccessRevoke = z.infer<
  typeof workspaceHostModelAccessRevokeSchema
>

export const workspaceHostSensitiveControlSchema = z.discriminatedUnion('control', [
  workspaceHostEgressRenewSchema,
  workspaceHostEgressRevokeSchema,
  workspaceHostModelAccessRenewSchema,
  workspaceHostModelAccessRevokeSchema
])

export type WorkspaceHostSensitiveControl = z.infer<
  typeof workspaceHostSensitiveControlSchema
>

const workspaceHostResponseBaseSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  requestId: identifierSchema
}).strict()

export const workspaceHostResponseSchema = z.discriminatedUnion('ok', [
  workspaceHostResponseBaseSchema.extend({
    ok: z.literal(true),
    result: workspaceHostPayloadSchema
  }).strict(),
  workspaceHostResponseBaseSchema.extend({
    ok: z.literal(false),
    failure: workspaceHostFailureSchema
  }).strict()
])

export type WorkspaceHostResponse = z.infer<typeof workspaceHostResponseSchema>

export const workspaceHostEventSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  sessionId: identifierSchema,
  eventId: identifierSchema,
  sequence: sequenceSchema,
  kind: workspaceHostEventKindSchema,
  occurredAt: dateTimeSchema,
  payload: workspaceHostPayloadSchema
}).strict()

export type WorkspaceHostEvent = z.infer<typeof workspaceHostEventSchema>

export const workspaceHostResumeSchema = z.object({
  sessionId: identifierSchema,
  lastAcknowledgedSequence: sequenceSchema
}).strict()

export type WorkspaceHostResume = z.infer<typeof workspaceHostResumeSchema>

export const workspaceHostHandshakeRequestSchema = z.object({
  protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  clientVersion: domainPackageVersionSchema,
  workspaceRoot: absolutePathSchema,
  contributions: z.array(workspaceHostContributionCohortSchema)
    .max(WORKSPACE_HOST_LIMITS.maxContributions),
  egressMode: z.enum(['none', 'local', 'remote-target']),
  egressAccess: workspaceHostEgressAccessSchema.optional(),
  modelAccess: workspaceHostModelAccessSchema.optional(),
  resume: workspaceHostResumeSchema.optional()
}).strict().superRefine((request, context) => {
  if (request.egressAccess && request.egressAccess.mode !== request.egressMode) {
    context.addIssue({
      code: 'custom',
      path: ['egressAccess', 'mode'],
      message: 'Sensitive egress access must match the authorized session egress mode.'
    })
  }
  if (request.egressMode === 'none' && request.modelAccess) {
    context.addIssue({
      code: 'custom',
      path: ['modelAccess'],
      message: 'Model access is unavailable when workspace network egress is disabled.'
    })
  }
})

export type WorkspaceHostHandshakeRequest = z.infer<
  typeof workspaceHostHandshakeRequestSchema
>

export const workspaceHostHandshakeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
    ok: z.literal(true),
    session: workspaceHostSessionSchema
  }).strict(),
  z.object({
    protocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
    ok: z.literal(false),
    failure: workspaceHostFailureSchema
  }).strict()
])

export type WorkspaceHostHandshakeResponse = z.infer<
  typeof workspaceHostHandshakeResponseSchema
>

export type WorkspaceHostRequestOptions = Readonly<{
  requestId?: string
  idempotencyKey?: string
  expectedRevision?: string
  timeoutMilliseconds?: number
  signal?: AbortSignal
}>

export type WorkspaceHostReconnectInput = Readonly<{
  lastAcknowledgedSequence: number
  signal?: AbortSignal
}>

export type WorkspaceHostEventListener = (
  event: WorkspaceHostEvent
) => void | Promise<void>

export type WorkspaceHostClient = Readonly<{
  getSession(): WorkspaceHostSession
  request<Operation extends WorkspaceHostOperation>(
    operation: Operation,
    payload: WorkspaceHostOperationInput<Operation>,
    options?: WorkspaceHostRequestOptions
  ): Promise<WorkspaceHostOperationOutput<Operation>>
  subscribe(listener: WorkspaceHostEventListener): () => void
  acknowledge(sequence: number): Promise<void>
  reconnect(input: WorkspaceHostReconnectInput): Promise<WorkspaceHostSession>
  close(reason?: string): Promise<void>
}>

export const workspaceHostProviderAttachInputSchema = z.object({
  authorizedSessionId: workspaceAuthorizedSessionIdSchema,
  resume: workspaceHostResumeSchema.optional()
}).strict()

export type WorkspaceHostProviderAttachInput = z.infer<
  typeof workspaceHostProviderAttachInputSchema
>

export const workspaceHostOpenRemoteSessionInputSchema = z.object({
  providerId: domainPackageContributionIdSchema,
  authorizedSessionId: workspaceAuthorizedSessionIdSchema
}).strict()

export type WorkspaceHostOpenRemoteSessionInput = z.infer<
  typeof workspaceHostOpenRemoteSessionInputSchema
>

export type WorkspaceHostProviderLogEntry = Readonly<{
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  detail?: DomainPackageJsonValue
}>

export type WorkspaceHostProviderContext = Readonly<{
  owner: DomainRuntimeContributionOwner
  signal: AbortSignal
  workspaceModelAccess: WorkspaceHostModelAccessProvider
  log(entry: WorkspaceHostProviderLogEntry): void
}>

export type WorkspaceHostProvider = Readonly<{
  attach(
    input: WorkspaceHostProviderAttachInput,
    context: WorkspaceHostProviderContext
  ): Promise<WorkspaceHostClient>
}>

export function isWorkspaceHostProvider(value: unknown): value is WorkspaceHostProvider {
  return isRecord(value) && typeof value.attach === 'function'
}

function operationContract<
  Operation extends WorkspaceHostBuiltInOperation,
  Input extends WorkspaceHostBuiltInOperationTypeMap[Operation]['input'],
  Output extends WorkspaceHostBuiltInOperationTypeMap[Operation]['output']
>(
  operation: Operation,
  inputSchema: z.ZodType<Input>,
  outputSchema: z.ZodType<Output>
): WorkspaceHostOperationContract<Operation> {
  return Object.freeze({
    operation,
    inputSchema,
    outputSchema
  }) as WorkspaceHostOperationContract<Operation>
}

function requireWorkspaceHostOperationContract<Operation extends WorkspaceHostBuiltInOperation>(
  operation: Operation
): WorkspaceHostOperationContract<Operation> {
  const contract = workspaceHostOperationContract(operation)
  if (!contract) {
    throw new Error(`Unknown built-in Workspace Host operation ${operation}.`)
  }
  return contract as WorkspaceHostOperationContract<Operation>
}

function inspectPayload(payload: WorkspaceHostPayload): Readonly<{
  bytes: number
  depth: number
  nodes: number
  maxObjectKeys: number
}> {
  let depth = 0
  let nodes = 0
  let maxObjectKeys = 0
  const visit = (value: WorkspaceHostPayload, currentDepth: number): void => {
    nodes += 1
    depth = Math.max(depth, currentDepth)
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, currentDepth + 1)
      return
    }
    const values = Object.values(value)
    maxObjectKeys = Math.max(maxObjectKeys, values.length)
    for (const item of values) visit(item, currentDepth + 1)
  }
  visit(payload, 1)
  return {
    bytes: new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    depth,
    nodes,
    maxObjectKeys
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false
  let paddingStart = value.length
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 61) {
      if (paddingStart === value.length) paddingStart = index
      continue
    }
    if (paddingStart !== value.length) return false
    const isAlphabet =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!isAlphabet) return false
  }
  return value.length - paddingStart <= 2
}

function isIpv4LoopbackHost(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  return octets.length === 4 &&
    octets[0] === 127 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
}
