import { z } from 'zod'

export const REMOTE_SSH_SCHEMA_VERSION = 2
export const REMOTE_SSH_TARGET_RESOURCE_KIND = 'remote-ssh-target'
export const REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS = 256 * 1_024
export const REMOTE_SSH_DEFAULT_ENVIRONMENT_PROVIDER = 'vm' as const

export const REMOTE_SSH_CAPABILITY_IDS = Object.freeze({
  listLabs: 'remote-ssh.labs.list',
  listVirtualBoxMachines: 'remote-ssh.virtualbox-machines.list',
  saveLab: 'remote-ssh.labs.save',
  deleteLab: 'remote-ssh.labs.delete',
  getLabEnvironment: 'remote-ssh.lab-environment.get',
  ensureLabEnvironment: 'remote-ssh.lab-environment.ensure',
  openLabEnvironmentConsole: 'remote-ssh.lab-environment.console.open',
  stopLabEnvironment: 'remote-ssh.lab-environment.stop',
  getBinding: 'remote-ssh.bindings.get',
  saveBinding: 'remote-ssh.bindings.save',
  listTargetCatalog: 'remote-ssh.targets.catalog',
  listTargets: 'remote-ssh.targets.list',
  probeTarget: 'remote-ssh.target.probe',
  saveTarget: 'remote-ssh.target.save',
  deleteTarget: 'remote-ssh.target.delete',
  executeCommand: 'remote-ssh.command.execute',
  cancelCommand: 'remote-ssh.command.cancel',
  uploadFile: 'remote-ssh.file.upload',
  downloadFile: 'remote-ssh.file.download'
} as const)

const isoDateTimeSchema = z.string().datetime({ offset: true })
const nonNegativeIntegerSchema = z.number().int().nonnegative()
const positiveConcurrencySchema = z.number().int().min(1).max(128)
const displayNameSchema = z.string().trim().min(1).max(160)
  .refine((value) => !/[\0\r\n]/.test(value), 'Display name contains unsupported control separators.')

export const remoteSshIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Remote SSH IDs may only contain letters, numbers, dots, underscores, and hyphens.')
  .refine((value) => value !== '.' && value !== '..', 'Remote SSH ID is invalid.')

export const remoteSshAliasSchema = z.string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use one literal OpenSSH Host alias without patterns or options.')
  .refine((value) => value !== '.' && value !== '..', 'OpenSSH Host alias is invalid.')

export const remoteSshExecutionIdSchema = z.string()
  .trim()
  .regex(/^ssh_exec_[A-Za-z0-9_-]{16,128}$/, 'Use a caller-generated Remote SSH execution ID.')
  .describe('Caller-generated unique ID matching ssh_exec_ followed by 16-128 letters, digits, underscores, or hyphens.')

export const remoteSshTransferIdSchema = z.string()
  .trim()
  .regex(/^ssh_xfer_[A-Za-z0-9_-]{16,128}$/, 'Use a caller-generated Remote SSH transfer ID.')
  .describe('Caller-generated unique ID matching ssh_xfer_ followed by 16-128 letters, digits, underscores, or hyphens.')

export const remoteSshWorkspaceRelativePathSchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .regex(
    /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$)(?!.*\\).+$/,
    'Use a normalized workspace-relative path without parent traversal.'
  )
  .refine(
    (value) => value !== '.' && !/[\0\r\n]/.test(value),
    'Workspace-relative path is invalid.'
  )

export const remoteSshRemotePathSchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) => !value.startsWith('-') && !/[\0\r\n]/.test(value),
    'Remote paths cannot start with an option prefix or contain control separators.'
  )

export const remoteSshTargetCapabilitySchema = z.enum(['shell', 'file-transfer'])

export const remoteSshContainerImageSchema = z.string()
  .trim()
  .min(1)
  .max(512)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/,
    'Use one Docker image reference without whitespace or command options.'
  )

export const remoteSshLabEnvironmentProviderSchema = z.enum(['vm', 'docker'])

export const remoteSshVmLocatorSchema = z.string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) => !value.startsWith('-') && !/[\0\r\n]/.test(value),
    'Use a VirtualBox VM UUID or name without an option prefix or control separators.'
  )

export const remoteSshVirtualBoxUuidSchema = z.string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'Use the canonical VirtualBox VM UUID.'
  ))

export const remoteSshVmEnvironmentLocatorConfigSchema = z.object({
  provider: z.literal('vm'),
  driver: z.literal('virtualbox'),
  vmId: remoteSshVmLocatorSchema,
  gatewaySshAlias: remoteSshAliasSchema
}).strict()

export const remoteSshVmEnvironmentConfigSchema = z.object({
  provider: z.literal('vm'),
  driver: z.literal('virtualbox'),
  vmId: remoteSshVirtualBoxUuidSchema,
  gatewaySshAlias: remoteSshAliasSchema
}).strict()

export const remoteSshDockerEnvironmentConfigSchema = z.object({
  provider: z.literal('docker'),
  image: remoteSshContainerImageSchema
}).strict()

export const remoteSshLabEnvironmentConfigSchema = z.discriminatedUnion('provider', [
  remoteSshVmEnvironmentConfigSchema,
  remoteSshDockerEnvironmentConfigSchema
])

export const remoteSshLabEnvironmentLocatorConfigSchema = z.discriminatedUnion('provider', [
  remoteSshVmEnvironmentLocatorConfigSchema,
  remoteSshDockerEnvironmentConfigSchema
])

export const remoteSshLabEnvironmentStateSchema = z.enum([
  'provider-unavailable',
  'configuration-required',
  'stopped',
  'starting',
  'login-required',
  'ready',
  'failed'
])

const labelKeySchema = z.string().trim().min(1).max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const labelValueSchema = z.string().trim().max(256)
  .refine((value) => !/[\0\r\n]/.test(value), 'Label value contains unsupported control separators.')
const labelsSchema = z.record(labelKeySchema, labelValueSchema)
  .superRefine((labels, context) => {
    if (Object.keys(labels).length > 32) {
      context.addIssue({ code: 'custom', message: 'A target may define at most 32 labels.' })
    }
  })

export const remoteSshLabSchema = z.object({
  schemaVersion: z.literal(REMOTE_SSH_SCHEMA_VERSION),
  id: remoteSshIdSchema,
  displayName: displayNameSchema,
  environment: remoteSshLabEnvironmentConfigSchema,
  maxConcurrentExecutions: positiveConcurrencySchema,
  revision: z.string().trim().min(1).max(128),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict()

export const remoteSshTargetSchema = z.object({
  schemaVersion: z.literal(REMOTE_SSH_SCHEMA_VERSION),
  id: remoteSshIdSchema,
  labId: remoteSshIdSchema,
  displayName: displayNameSchema,
  sshAlias: remoteSshAliasSchema,
  labels: labelsSchema,
  capabilities: z.array(remoteSshTargetCapabilitySchema).min(1).max(2),
  maxConcurrentExecutions: positiveConcurrencySchema,
  revision: z.string().trim().min(1).max(128),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
}).strict().superRefine((target, context) => {
  if (new Set(target.capabilities).size !== target.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Target capabilities must be unique.' })
  }
})

export const remoteSshTargetSummarySchema = z.object({
  id: remoteSshIdSchema,
  labId: remoteSshIdSchema,
  displayName: displayNameSchema,
  labels: labelsSchema,
  capabilities: z.array(remoteSshTargetCapabilitySchema).min(1).max(2),
  maxConcurrentExecutions: positiveConcurrencySchema
}).strict().superRefine((target, context) => {
  if (new Set(target.capabilities).size !== target.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Target capabilities must be unique.' })
  }
})

export const remoteSshWorkspaceBindingSchema = z.object({
  schemaVersion: z.literal(REMOTE_SSH_SCHEMA_VERSION),
  workspaceId: z.string().trim().min(1).max(4_096),
  allowedTargetIds: z.array(remoteSshIdSchema).max(512),
  revision: z.string().trim().min(1).max(128),
  updatedAt: isoDateTimeSchema
}).strict().superRefine((binding, context) => {
  if (new Set(binding.allowedTargetIds).size !== binding.allowedTargetIds.length) {
    context.addIssue({ code: 'custom', path: ['allowedTargetIds'], message: 'Allowed target IDs must be unique.' })
  }
})

/** Structurally matches the host-issued opaque capability resource handle. */
export const remoteSshTargetHandleSchema = z.object({
  token: z.string().regex(/^cap_[A-Za-z0-9_-]{20,}$/),
  semanticRevision: z.string().trim().min(1).max(256),
  expiresAt: isoDateTimeSchema
}).strict()

export const remoteSshTargetBindingSchema = z.object({
  target: remoteSshTargetSummarySchema,
  resource: remoteSshTargetHandleSchema
}).strict()

export const remoteSshFailureCodeSchema = z.enum([
  'ssh_executable_missing',
  'ssh_config_invalid',
  'target_unreachable',
  'target_auth_failed',
  'host_key_rejected',
  'environment_unavailable',
  'vpn_login_required',
  'environment_busy',
  'transfer_limit_exceeded',
  'local_file_unavailable',
  'timeout',
  'remote_exit_nonzero',
  'cancelled'
])

export const remoteSshFailureSchema = z.object({
  code: remoteSshFailureCodeSchema,
  message: z.string().trim().min(1).max(2_000),
  exitCode: z.number().int().min(0).max(255).optional()
}).strict()

export const remoteSshProbeStatusSchema = z.enum([
  'reachable',
  'unreachable',
  'auth-failed',
  'host-key-rejected',
  'not-configured',
  'not-tested'
])

export const remoteSshProbeEndpointSchema = z.object({
  status: remoteSshProbeStatusSchema,
  latencyMs: nonNegativeIntegerSchema.optional(),
  message: z.string().trim().min(1).max(2_000).optional()
}).strict()

export const remoteSshEmptyInputSchema = z.object({}).strict()

export const remoteSshLabListInputSchema = remoteSshEmptyInputSchema
export const remoteSshLabListResultSchema = z.object({ labs: z.array(remoteSshLabSchema).max(512) }).strict()
export const remoteSshVirtualBoxMachineSchema = z.object({
  uuid: remoteSshVirtualBoxUuidSchema,
  name: z.string().trim().min(1).max(512)
    .refine((value) => !/[\0\r\n]/.test(value), 'VirtualBox VM name contains unsupported control separators.'),
  state: z.string().trim().min(1).max(128),
  osType: z.string().trim().min(1).max(256).optional(),
  architecture: z.string().trim().min(1).max(128).optional()
}).strict()
export const remoteSshVirtualBoxMachineListInputSchema = remoteSshEmptyInputSchema
export const remoteSshVirtualBoxMachineListResultSchema = z.object({
  available: z.boolean(),
  machines: z.array(remoteSshVirtualBoxMachineSchema).max(512)
}).strict()
export const remoteSshLabSaveInputSchema = z.object({
  id: remoteSshIdSchema.optional(),
  displayName: displayNameSchema,
  environment: remoteSshLabEnvironmentLocatorConfigSchema,
  maxConcurrentExecutions: positiveConcurrencySchema,
  expectedRevision: z.string().trim().min(1).max(128).optional()
}).strict()
export const remoteSshLabSaveResultSchema = z.object({ lab: remoteSshLabSchema }).strict()
export const remoteSshLabDeleteInputSchema = z.object({
  labId: remoteSshIdSchema,
  expectedRevision: z.string().trim().min(1).max(128).optional()
}).strict()
export const remoteSshLabDeleteResultSchema = z.object({ deletedLabId: remoteSshIdSchema }).strict()

export const remoteSshLabEnvironmentGetInputSchema = z.object({
  labId: remoteSshIdSchema
}).strict()
export const remoteSshLabEnvironmentEnsureInputSchema = z.object({
  labId: remoteSshIdSchema,
  expectedRevision: z.string().trim().min(1).max(128)
}).strict()
export const remoteSshLabEnvironmentOpenConsoleInputSchema = remoteSshLabEnvironmentEnsureInputSchema
export const remoteSshLabEnvironmentStopInputSchema = remoteSshLabEnvironmentEnsureInputSchema
export const remoteSshLabEnvironmentResultSchema = z.object({
  labId: remoteSshIdSchema,
  provider: remoteSshLabEnvironmentProviderSchema,
  state: remoteSshLabEnvironmentStateSchema,
  consoleAvailable: z.boolean(),
  message: z.string().trim().min(1).max(2_000).optional(),
  checkedAt: isoDateTimeSchema
}).strict()
export const remoteSshLabEnvironmentConsolePresentationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('opened')
  }).strict(),
  z.object({
    kind: z.literal('external-url'),
    url: z.string().url().refine((value) => {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') &&
        !url.username &&
        !url.password
      )
    }, 'Environment console URL must use loopback HTTP without URL credentials.')
  }).strict()
])
export const remoteSshLabEnvironmentOpenConsoleResultSchema = z.object({
  labId: remoteSshIdSchema,
  presentation: remoteSshLabEnvironmentConsolePresentationSchema
}).strict()

export const remoteSshBindingGetInputSchema = remoteSshEmptyInputSchema
export const remoteSshBindingGetResultSchema = z.object({
  binding: remoteSshWorkspaceBindingSchema
}).strict()
export const remoteSshBindingSaveInputSchema = z.object({
  allowedTargetIds: z.array(remoteSshIdSchema).max(512),
  expectedRevision: z.string().trim().min(1).max(128).optional()
}).strict().superRefine((binding, context) => {
  if (new Set(binding.allowedTargetIds).size !== binding.allowedTargetIds.length) {
    context.addIssue({ code: 'custom', path: ['allowedTargetIds'], message: 'Allowed target IDs must be unique.' })
  }
})
export const remoteSshBindingSaveResultSchema = remoteSshBindingGetResultSchema

export const remoteSshTargetListInputSchema = remoteSshEmptyInputSchema
export const remoteSshTargetListResultSchema = z.object({
  targets: z.array(remoteSshTargetBindingSchema).max(512)
}).strict()
export const remoteSshTargetCatalogInputSchema = remoteSshEmptyInputSchema
export const remoteSshTargetCatalogResultSchema = z.object({
  targets: z.array(remoteSshTargetSchema).max(512)
}).strict()
export const remoteSshTargetObserveResultSchema = z.object({
  target: remoteSshTargetSummarySchema,
  activeExecutions: nonNegativeIntegerSchema,
  observedAt: isoDateTimeSchema,
  recentFailure: remoteSshFailureSchema.optional()
}).strict()
export const remoteSshTargetProbeInputSchema = remoteSshEmptyInputSchema
export const remoteSshTargetProbeResultSchema = z.object({
  targetId: remoteSshIdSchema,
  target: remoteSshProbeEndpointSchema,
  ready: z.boolean(),
  checkedAt: isoDateTimeSchema
}).strict()
export const remoteSshTargetSaveInputSchema = z.object({
  id: remoteSshIdSchema.optional(),
  labId: remoteSshIdSchema,
  displayName: displayNameSchema,
  sshAlias: remoteSshAliasSchema,
  labels: labelsSchema,
  capabilities: z.array(remoteSshTargetCapabilitySchema).min(1).max(2),
  maxConcurrentExecutions: positiveConcurrencySchema,
  expectedRevision: z.string().trim().min(1).max(128).optional()
}).strict().superRefine((target, context) => {
  if (new Set(target.capabilities).size !== target.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'Target capabilities must be unique.' })
  }
})
export const remoteSshTargetSaveResultSchema = z.object({ target: remoteSshTargetSchema }).strict()
export const remoteSshTargetDeleteInputSchema = z.object({
  targetId: remoteSshIdSchema,
  expectedRevision: z.string().trim().min(1).max(128).optional()
}).strict()
export const remoteSshTargetDeleteResultSchema = z.object({ deletedTargetId: remoteSshIdSchema }).strict()

export const remoteSshCommandExecuteInputSchema = z.object({
  executionId: remoteSshExecutionIdSchema,
  script: z.string().min(1).max(1_000_000)
    .refine((value) => !value.includes('\0'), 'Script cannot contain NUL bytes.'),
  timeoutMs: z.number().int().min(1_000).max(86_400_000).optional()
}).strict()

export const remoteSshCommandExecuteResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    executionId: remoteSshExecutionIdSchema,
    targetId: remoteSshIdSchema,
    exitCode: z.literal(0),
    stdout: z.string().max(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS),
    stderr: z.string().max(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS),
    outputTruncated: z.boolean(),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema
  }).strict(),
  z.object({
    ok: z.literal(false),
    executionId: remoteSshExecutionIdSchema,
    targetId: remoteSshIdSchema,
    stdout: z.string().max(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS),
    stderr: z.string().max(REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS),
    outputTruncated: z.boolean(),
    failure: remoteSshFailureSchema,
    startedAt: isoDateTimeSchema.optional(),
    completedAt: isoDateTimeSchema
  }).strict()
])

export const remoteSshCommandCancelInputSchema = z.object({
  executionId: remoteSshExecutionIdSchema
}).strict()
export const remoteSshCommandCancelResultSchema = z.object({
  executionId: remoteSshExecutionIdSchema,
  cancelled: z.boolean()
}).strict()

const transferInputFields = {
  transferId: remoteSshTransferIdSchema,
  localPath: remoteSshWorkspaceRelativePathSchema,
  remotePath: remoteSshRemotePathSchema,
  timeoutMs: z.number().int().min(1_000).max(86_400_000).optional()
}

export const remoteSshFileUploadInputSchema = z.object(transferInputFields).strict()
export const remoteSshFileDownloadInputSchema = z.object(transferInputFields).strict()

function remoteSshFileTransferResultFor(direction: 'upload' | 'download') {
  return z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      transferId: remoteSshTransferIdSchema,
      targetId: remoteSshIdSchema,
      direction: z.literal(direction),
      localPath: remoteSshWorkspaceRelativePathSchema,
      remotePath: remoteSshRemotePathSchema,
      sizeBytes: nonNegativeIntegerSchema,
      completedAt: isoDateTimeSchema
    }).strict(),
    z.object({
      ok: z.literal(false),
      transferId: remoteSshTransferIdSchema,
      targetId: remoteSshIdSchema,
      direction: z.literal(direction),
      failure: remoteSshFailureSchema,
      completedAt: isoDateTimeSchema
    }).strict()
  ])
}

export const remoteSshFileUploadResultSchema = remoteSshFileTransferResultFor('upload')
export const remoteSshFileDownloadResultSchema = remoteSshFileTransferResultFor('download')
export const remoteSshFileTransferResultSchema = z.union([
  remoteSshFileUploadResultSchema,
  remoteSshFileDownloadResultSchema
])

export type RemoteSshId = z.infer<typeof remoteSshIdSchema>
export type RemoteSshAlias = z.infer<typeof remoteSshAliasSchema>
export type RemoteSshExecutionId = z.infer<typeof remoteSshExecutionIdSchema>
export type RemoteSshTransferId = z.infer<typeof remoteSshTransferIdSchema>
export type RemoteSshWorkspaceRelativePath = z.infer<typeof remoteSshWorkspaceRelativePathSchema>
export type RemoteSshRemotePath = z.infer<typeof remoteSshRemotePathSchema>
export type RemoteSshTargetCapability = z.infer<typeof remoteSshTargetCapabilitySchema>
export type RemoteSshContainerImage = z.infer<typeof remoteSshContainerImageSchema>
export type RemoteSshLabEnvironmentProvider = z.infer<typeof remoteSshLabEnvironmentProviderSchema>
export type RemoteSshVmLocator = z.infer<typeof remoteSshVmLocatorSchema>
export type RemoteSshVirtualBoxUuid = z.infer<typeof remoteSshVirtualBoxUuidSchema>
export type RemoteSshVmEnvironmentLocatorConfig =
  z.infer<typeof remoteSshVmEnvironmentLocatorConfigSchema>
export type RemoteSshVmEnvironmentConfig = z.infer<typeof remoteSshVmEnvironmentConfigSchema>
export type RemoteSshDockerEnvironmentConfig = z.infer<typeof remoteSshDockerEnvironmentConfigSchema>
export type RemoteSshLabEnvironmentConfig = z.infer<typeof remoteSshLabEnvironmentConfigSchema>
export type RemoteSshLabEnvironmentLocatorConfig =
  z.infer<typeof remoteSshLabEnvironmentLocatorConfigSchema>
export type RemoteSshLabEnvironmentState = z.infer<typeof remoteSshLabEnvironmentStateSchema>
export type RemoteSshLab = z.infer<typeof remoteSshLabSchema>
export type RemoteSshTarget = z.infer<typeof remoteSshTargetSchema>
export type RemoteSshTargetSummary = z.infer<typeof remoteSshTargetSummarySchema>
export type RemoteSshWorkspaceBinding = z.infer<typeof remoteSshWorkspaceBindingSchema>
export type RemoteSshTargetHandle = z.infer<typeof remoteSshTargetHandleSchema>
export type RemoteSshTargetBinding = z.infer<typeof remoteSshTargetBindingSchema>
export type RemoteSshFailureCode = z.infer<typeof remoteSshFailureCodeSchema>
export type RemoteSshFailure = z.infer<typeof remoteSshFailureSchema>
export type RemoteSshProbeStatus = z.infer<typeof remoteSshProbeStatusSchema>
export type RemoteSshProbeEndpoint = z.infer<typeof remoteSshProbeEndpointSchema>
export type RemoteSshLabListInput = z.infer<typeof remoteSshLabListInputSchema>
export type RemoteSshLabListResult = z.infer<typeof remoteSshLabListResultSchema>
export type RemoteSshVirtualBoxMachine =
  z.infer<typeof remoteSshVirtualBoxMachineSchema>
export type RemoteSshVirtualBoxMachineListInput =
  z.infer<typeof remoteSshVirtualBoxMachineListInputSchema>
export type RemoteSshVirtualBoxMachineListResult =
  z.infer<typeof remoteSshVirtualBoxMachineListResultSchema>
export type RemoteSshLabSaveInput = z.infer<typeof remoteSshLabSaveInputSchema>
export type RemoteSshLabSaveResult = z.infer<typeof remoteSshLabSaveResultSchema>
export type RemoteSshLabDeleteInput = z.infer<typeof remoteSshLabDeleteInputSchema>
export type RemoteSshLabDeleteResult = z.infer<typeof remoteSshLabDeleteResultSchema>
export type RemoteSshLabEnvironmentGetInput = z.infer<typeof remoteSshLabEnvironmentGetInputSchema>
export type RemoteSshLabEnvironmentEnsureInput = z.infer<typeof remoteSshLabEnvironmentEnsureInputSchema>
export type RemoteSshLabEnvironmentOpenConsoleInput = z.infer<typeof remoteSshLabEnvironmentOpenConsoleInputSchema>
export type RemoteSshLabEnvironmentStopInput = z.infer<typeof remoteSshLabEnvironmentStopInputSchema>
export type RemoteSshLabEnvironmentResult = z.infer<typeof remoteSshLabEnvironmentResultSchema>
export type RemoteSshLabEnvironmentConsolePresentation =
  z.infer<typeof remoteSshLabEnvironmentConsolePresentationSchema>
export type RemoteSshLabEnvironmentOpenConsoleResult =
  z.infer<typeof remoteSshLabEnvironmentOpenConsoleResultSchema>
export type RemoteSshBindingGetInput = z.infer<typeof remoteSshBindingGetInputSchema>
export type RemoteSshBindingGetResult = z.infer<typeof remoteSshBindingGetResultSchema>
export type RemoteSshBindingSaveInput = z.infer<typeof remoteSshBindingSaveInputSchema>
export type RemoteSshBindingSaveResult = z.infer<typeof remoteSshBindingSaveResultSchema>
export type RemoteSshTargetListInput = z.infer<typeof remoteSshTargetListInputSchema>
export type RemoteSshTargetListResult = z.infer<typeof remoteSshTargetListResultSchema>
export type RemoteSshTargetCatalogInput = z.infer<typeof remoteSshTargetCatalogInputSchema>
export type RemoteSshTargetCatalogResult = z.infer<typeof remoteSshTargetCatalogResultSchema>
export type RemoteSshTargetObserveResult = z.infer<typeof remoteSshTargetObserveResultSchema>
export type RemoteSshTargetProbeInput = z.infer<typeof remoteSshTargetProbeInputSchema>
export type RemoteSshTargetProbeResult = z.infer<typeof remoteSshTargetProbeResultSchema>
export type RemoteSshTargetSaveInput = z.infer<typeof remoteSshTargetSaveInputSchema>
export type RemoteSshTargetSaveResult = z.infer<typeof remoteSshTargetSaveResultSchema>
export type RemoteSshTargetDeleteInput = z.infer<typeof remoteSshTargetDeleteInputSchema>
export type RemoteSshTargetDeleteResult = z.infer<typeof remoteSshTargetDeleteResultSchema>
export type RemoteSshCommandExecuteInput = z.infer<typeof remoteSshCommandExecuteInputSchema>
export type RemoteSshCommandExecuteResult = z.infer<typeof remoteSshCommandExecuteResultSchema>
export type RemoteSshCommandCancelInput = z.infer<typeof remoteSshCommandCancelInputSchema>
export type RemoteSshCommandCancelResult = z.infer<typeof remoteSshCommandCancelResultSchema>
export type RemoteSshFileUploadInput = z.infer<typeof remoteSshFileUploadInputSchema>
export type RemoteSshFileUploadResult = z.infer<typeof remoteSshFileUploadResultSchema>
export type RemoteSshFileDownloadInput = z.infer<typeof remoteSshFileDownloadInputSchema>
export type RemoteSshFileDownloadResult = z.infer<typeof remoteSshFileDownloadResultSchema>
export type RemoteSshFileTransferResult = z.infer<typeof remoteSshFileTransferResultSchema>
