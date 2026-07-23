import { randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isDeepStrictEqual } from 'node:util'
import {
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  writeSafeWorkspaceFile
} from '@sciforge/domain-sdk/node/workspace-paths'
import { resolveElectronRunAsNodeExecutable } from '@sciforge/domain-sdk/node/electron-node-executable'
import { z } from 'zod'
import {
  REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS,
  REMOTE_SSH_SCHEMA_VERSION,
  remoteSshBindingSaveInputSchema,
  remoteSshCommandCancelInputSchema,
  remoteSshCommandExecuteInputSchema,
  remoteSshFileDownloadInputSchema,
  remoteSshFileUploadInputSchema,
  remoteSshLabDeleteInputSchema,
  remoteSshLabSaveInputSchema,
  remoteSshLabSchema,
  remoteSshTargetDeleteInputSchema,
  remoteSshTargetSaveInputSchema,
  remoteSshTargetSchema,
  remoteSshWorkspaceBindingSchema,
  type RemoteSshBindingGetResult,
  type RemoteSshBindingSaveInput,
  type RemoteSshBindingSaveResult,
  type RemoteSshCommandCancelInput,
  type RemoteSshCommandCancelResult,
  type RemoteSshCommandExecuteInput,
  type RemoteSshCommandExecuteResult,
  type RemoteSshFailure,
  type RemoteSshFileDownloadInput,
  type RemoteSshFileDownloadResult,
  type RemoteSshFileUploadInput,
  type RemoteSshFileUploadResult,
  type RemoteSshFileTransferResult,
  type RemoteSshLab,
  type RemoteSshLabDeleteInput,
  type RemoteSshLabDeleteResult,
  type RemoteSshLabEnvironmentOpenConsoleResult,
  type RemoteSshLabEnvironmentResult,
  type RemoteSshLabListResult,
  type RemoteSshLabSaveInput,
  type RemoteSshLabSaveResult,
  type RemoteSshProbeEndpoint,
  type RemoteSshTarget,
  type RemoteSshTargetDeleteInput,
  type RemoteSshTargetDeleteResult,
  type RemoteSshTargetProbeResult,
  type RemoteSshTargetSaveInput,
  type RemoteSshTargetSaveResult,
  type RemoteSshWorkspaceBinding
} from '../contract.js'
import { RemoteSshConcurrencyController } from './concurrency-controller.js'
import {
  DockerLabEnvironmentProvider
} from './docker-environment.js'
import {
  RoutingRemoteSshLabEnvironmentManager,
  type RemoteSshLabEnvironmentManager
} from './lab-environment.js'
import { VirtualBoxLabEnvironmentProvider } from './vm-environment.js'
import {
  SystemOpenSshProcessRunner,
  type ProcessRequest,
  type ProcessResult,
  type RemoteSshProcessRunner
} from './process-runner.js'
import {
  Socks5ProxyHelper,
  type Socks5ProxyEndpoint,
  type Socks5TargetEndpoint
} from './socks5-proxy-helper.js'
import {
  OpenSshTargetResolutionError,
  SystemOpenSshTargetResolver,
  type RemoteSshTargetResolver
} from './ssh-target-resolver.js'
import {
  quoteSftpPath,
  redactProcessOutput,
  requireDisplayName,
  requireIdentifier,
  requirePositiveLimit,
  requireRemotePath,
  requireScript,
  requireSshAlias,
  requireTimeout,
  requireWorkspaceId
} from './validation.js'

const REGISTRY_DIRECTORY = 'remote-ssh'
const REGISTRY_FILE = 'registry.json'
const DEFAULT_TIMEOUT_MS = 5 * 60_000
const PROBE_TIMEOUT_MS = 15_000
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024
const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const DEFAULT_GLOBAL_CONCURRENCY = 16
const MAX_REMEMBERED_OPERATION_IDS = 10_000
const MAX_REGISTRY_BYTES = 16 * 1024 * 1024

const persistedStateSchema = z.object({
  schemaVersion: z.literal(REMOTE_SSH_SCHEMA_VERSION),
  labs: z.array(remoteSshLabSchema).max(512),
  targets: z.array(remoteSshTargetSchema).max(512),
  bindings: z.array(remoteSshWorkspaceBindingSchema).max(2_048)
}).strict().superRefine((state, context) => {
  addDuplicateIssues(state.labs.map((lab) => lab.id), ['labs'], 'lab ID', context)
  addDuplicateIssues(state.targets.map((target) => target.id), ['targets'], 'target ID', context)
  addDuplicateIssues(
    state.targets.map((target) => target.sshAlias.toLowerCase()),
    ['targets'],
    'SSH alias',
    context
  )
  addDuplicateIssues(
    state.bindings.map((binding) => binding.workspaceId),
    ['bindings'],
    'workspace binding',
    context
  )
  const virtualBoxVmIds = new Map<string, number>()
  state.labs.forEach((lab, index) => {
    if (lab.environment.provider !== 'vm') return
    const firstIndex = virtualBoxVmIds.get(lab.environment.vmId)
    if (firstIndex !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['labs', index, 'environment', 'vmId'],
        message: `VirtualBox VM is already assigned to lab at index ${firstIndex}.`
      })
      return
    }
    virtualBoxVmIds.set(lab.environment.vmId, index)
  })
  const labIds = new Set(state.labs.map((lab) => lab.id))
  const targetIds = new Set(state.targets.map((target) => target.id))
  state.targets.forEach((target, index) => {
    if (!labIds.has(target.labId)) {
      context.addIssue({
        code: 'custom',
        path: ['targets', index, 'labId'],
        message: 'Remote SSH target references an unknown lab.'
      })
    }
  })
  state.bindings.forEach((binding, bindingIndex) => {
    binding.allowedTargetIds.forEach((targetId, targetIndex) => {
      if (!targetIds.has(targetId)) {
        context.addIssue({
          code: 'custom',
          path: ['bindings', bindingIndex, 'allowedTargetIds', targetIndex],
          message: 'Workspace binding references an unknown target.'
        })
      }
    })
  })
})

type PersistedState = z.infer<typeof persistedStateSchema>

export type RemoteSshServiceOptions = Readonly<{
  userDataDir: string
  processRunner?: RemoteSshProcessRunner
  environmentManager?: RemoteSshLabEnvironmentManager
  proxyHelper?: RemoteSshProxyHelper
  targetResolver?: RemoteSshTargetResolver
  now?: () => Date
  globalConcurrency?: number
  defaultTimeoutMs?: number
  maxOutputBytes?: number
  maxUploadBytes?: number
  maxDownloadBytes?: number
}>

export type RemoteSshProxyHelper = Readonly<{
  ensureInstalled(): Promise<string>
  command(proxy: Socks5ProxyEndpoint, target: Socks5TargetEndpoint): string
}>

type ActiveExecution = {
  workspaceId: string
  controller: AbortController
}

type PreparedTransfer = Readonly<{
  batch: string
  size: () => Promise<number>
  afterSuccess?: () => Promise<void>
  downloadLimit?: Readonly<{
    path: string
    maxBytes: number
    controller: AbortController
  }>
}>

export type RemoteSshServiceTargetObservation = Readonly<{
  target: RemoteSshTarget
  activeExecutions: number
  observedAt: string
  recentFailure?: RemoteSshFailure
}>

type RemoteSshProbeOutcome = Readonly<{
  endpoint: RemoteSshProbeEndpoint
  failure?: RemoteSshFailure
}>

export class RemoteSshService {
  private readonly registryPath: string
  private readonly processRunner: RemoteSshProcessRunner
  private readonly environmentManager: RemoteSshLabEnvironmentManager
  private readonly proxyHelper: RemoteSshProxyHelper
  private readonly targetResolver: RemoteSshTargetResolver
  private readonly now: () => Date
  private readonly scheduler: RemoteSshConcurrencyController
  private readonly defaultTimeoutMs: number
  private readonly maxOutputBytes: number
  private readonly maxUploadBytes: number
  private readonly maxDownloadBytes: number
  private readonly activeExecutions = new Map<string, ActiveExecution>()
  private readonly activeExecutionCountByTarget = new Map<string, number>()
  private readonly activeTransferControllers = new Map<string, AbortController>()
  private readonly activeTransferCountByTarget = new Map<string, number>()
  private readonly activeProbeControllers = new Set<AbortController>()
  private readonly activeProbeCountByTarget = new Map<string, number>()
  private readonly recentFailureByTarget = new Map<string, RemoteSshFailure>()
  private readonly rememberedOperationIds = new Set<string>()
  private readonly deletingTargetIds = new Set<string>()
  private loadPromise?: Promise<PersistedState>
  private state?: PersistedState
  private mutationQueue: Promise<void> = Promise.resolve()
  private environmentConfigurationQueue: Promise<void> = Promise.resolve()
  private readonly labEnvironmentQueues = new Map<string, Promise<void>>()
  private closed = false

  constructor(options: RemoteSshServiceOptions) {
    const userDataDir = options.userDataDir.trim()
    if (!userDataDir) throw new Error('Remote SSH user data directory is required.')
    this.registryPath = join(userDataDir, REGISTRY_DIRECTORY, REGISTRY_FILE)
    this.processRunner = options.processRunner ?? new SystemOpenSshProcessRunner()
    this.environmentManager = options.environmentManager ??
      new RoutingRemoteSshLabEnvironmentManager([
        new VirtualBoxLabEnvironmentProvider(),
        new DockerLabEnvironmentProvider()
      ])
    this.proxyHelper = options.proxyHelper ?? new Socks5ProxyHelper({
      storageDirectory: join(userDataDir, REGISTRY_DIRECTORY),
      executablePath: resolveElectronRunAsNodeExecutable(process.execPath)
    })
    this.targetResolver = options.targetResolver ?? new SystemOpenSshTargetResolver(this.processRunner)
    this.now = options.now ?? (() => new Date())
    this.defaultTimeoutMs = requireTimeout(options.defaultTimeoutMs, DEFAULT_TIMEOUT_MS)
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1 || this.maxOutputBytes > 2_000_000) {
      throw new Error('Remote SSH output limit must be between 1 byte and 2,000,000 bytes.')
    }
    this.maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
    if (!Number.isSafeInteger(this.maxUploadBytes) || this.maxUploadBytes < 1) {
      throw new Error('Remote SSH upload limit must be a positive integer.')
    }
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES
    if (!Number.isSafeInteger(this.maxDownloadBytes) || this.maxDownloadBytes < 1) {
      throw new Error('Remote SSH download limit must be a positive integer.')
    }
    this.scheduler = new RemoteSshConcurrencyController(
      requirePositiveLimit(options.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY, 'Global SSH concurrency', 256)
    )
  }

  async listLabs(): Promise<RemoteSshLabListResult> {
    const state = await this.load()
    return { labs: state.labs.map(clone).sort(byDisplayNameThenId) }
  }

  async saveLab(input: RemoteSshLabSaveInput): Promise<RemoteSshLabSaveResult> {
    const parsed = remoteSshLabSaveInputSchema.parse(input)
    const id = parsed.id ? requireIdentifier(parsed.id, 'Lab ID') : `lab-${randomUUID()}`
    return this.runEnvironmentConfiguration(() =>
      this.runLabEnvironmentOperation(id, async () => {
        const state = await this.load()
        const existing = state.labs.find((lab) => lab.id === id)
        assertExpectedRevision(existing?.revision, parsed.expectedRevision, 'Lab')
        // Provider identity resolution can invoke VBoxManage and therefore runs
        // outside the registry mutation queue. The outer configuration and
        // per-lab gates still prevent another save from claiming the same
        // canonical environment identity before the commit recheck.
        const environment = await this.environmentManager.canonicalize(
          clone(parsed.environment)
        )
        assertUniqueVirtualBoxVmId(state.labs, id, environment)

        const environmentChanged = existing !== undefined &&
          !isDeepStrictEqual(existing.environment, environment)
        if (environmentChanged) {
          await this.environmentManager.remove(clone(existing))
        }

        return this.mutate(async (draft) => {
          const existingIndex = draft.labs.findIndex((lab) => lab.id === id)
          const current = draft.labs[existingIndex]
          if (current?.revision !== existing?.revision) {
            throw new Error('Lab revision conflict.')
          }
          assertExpectedRevision(current?.revision, parsed.expectedRevision, 'Lab')
          assertUniqueVirtualBoxVmId(draft.labs, id, environment)
          const timestamp = this.timestamp()
          const lab = remoteSshLabSchema.parse({
            schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
            id,
            displayName: requireDisplayName(parsed.displayName, 'Lab display name'),
            environment,
            maxConcurrentExecutions: requirePositiveLimit(
              parsed.maxConcurrentExecutions,
              'Lab concurrency',
              256
            ),
            revision: nextRevision(),
            createdAt: current?.createdAt ?? timestamp,
            updatedAt: timestamp
          })
          if (existingIndex >= 0) draft.labs[existingIndex] = lab
          else draft.labs.push(lab)
          return { lab: clone(lab) }
        })
      })
    )
  }

  async deleteLab(input: RemoteSshLabDeleteInput): Promise<RemoteSshLabDeleteResult> {
    const parsed = remoteSshLabDeleteInputSchema.parse(input)
    return this.runEnvironmentConfiguration(() =>
      this.runLabEnvironmentOperation(parsed.labId, async () => {
        const state = await this.load()
        const lab = state.labs.find((candidate) => candidate.id === parsed.labId)
        if (!lab) throw new Error(`Remote SSH lab not found: ${parsed.labId}`)
        assertExpectedRevision(lab.revision, parsed.expectedRevision, 'Lab')
        if (state.targets.some((target) => target.labId === lab.id)) {
          throw new Error('Delete the lab targets before deleting the lab.')
        }

        // Provider cleanup may start a hypervisor/Docker subprocess and must
        // never hold the canonical registry mutation queue. Both the global
        // configuration gate and per-lab gate remain held so a new environment
        // cannot be created under the same identity before the commit recheck.
        await this.environmentManager.remove(clone(lab))
        return this.mutate(async (draft) => {
          const index = draft.labs.findIndex((lab) => lab.id === parsed.labId)
          const current = draft.labs[index]
          if (!current) throw new Error(`Remote SSH lab not found: ${parsed.labId}`)
          if (current.revision !== lab.revision) {
            throw new Error('Lab revision conflict.')
          }
          if (draft.targets.some((target) => target.labId === current.id)) {
            throw new Error('Delete the lab targets before deleting the lab.')
          }
          draft.labs.splice(index, 1)
          return { deletedLabId: current.id }
        })
      })
    )
  }

  async getLabEnvironment(labId: string): Promise<RemoteSshLabEnvironmentResult> {
    const normalizedLabId = requireIdentifier(labId, 'Lab ID')
    return this.runLabEnvironmentOperation(normalizedLabId, async () => {
      return this.environmentManager.get(await this.requireLab(normalizedLabId))
    })
  }

  async ensureLabEnvironment(
    labId: string,
    expectedRevision: string
  ): Promise<RemoteSshLabEnvironmentResult> {
    const normalizedLabId = requireIdentifier(labId, 'Lab ID')
    return this.runLabEnvironmentOperation(normalizedLabId, async () => {
      const lab = await this.requireLab(normalizedLabId, expectedRevision)
      return this.environmentManager.ensure(lab)
    })
  }

  async openLabEnvironmentConsole(
    labId: string,
    expectedRevision: string
  ): Promise<RemoteSshLabEnvironmentOpenConsoleResult> {
    const normalizedLabId = requireIdentifier(labId, 'Lab ID')
    return this.runLabEnvironmentOperation(normalizedLabId, async () => {
      const lab = await this.requireLab(normalizedLabId, expectedRevision)
      return this.environmentManager.openConsole(lab)
    })
  }

  async stopLabEnvironment(
    labId: string,
    expectedRevision: string
  ): Promise<RemoteSshLabEnvironmentResult> {
    const normalizedLabId = requireIdentifier(labId, 'Lab ID')
    return this.runLabEnvironmentOperation(normalizedLabId, async () => {
      const lab = await this.requireLab(normalizedLabId, expectedRevision)
      return this.environmentManager.stop(lab)
    })
  }

  async getBinding(workspaceId: string): Promise<RemoteSshBindingGetResult> {
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const state = await this.load()
    const binding = state.bindings.find((candidate) => candidate.workspaceId === normalizedWorkspaceId)
    return { binding: clone(binding ?? emptyBinding(normalizedWorkspaceId)) }
  }

  async saveBinding(
    workspaceId: string,
    input: RemoteSshBindingSaveInput
  ): Promise<RemoteSshBindingSaveResult> {
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const parsed = remoteSshBindingSaveInputSchema.parse(input)
    return this.mutate(async (draft) => {
      const existingIndex = draft.bindings.findIndex(
        (binding) => binding.workspaceId === normalizedWorkspaceId
      )
      const existing = draft.bindings[existingIndex]
      assertExpectedRevision(existing?.revision ?? '0', parsed.expectedRevision, 'Workspace binding')
      const targetIds = new Set(draft.targets.map((target) => target.id))
      for (const targetId of parsed.allowedTargetIds) {
        if (!targetIds.has(targetId)) throw new Error(`Remote SSH target not found: ${targetId}`)
      }
      const binding = remoteSshWorkspaceBindingSchema.parse({
        schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
        workspaceId: normalizedWorkspaceId,
        allowedTargetIds: [...parsed.allowedTargetIds],
        revision: nextRevision(),
        updatedAt: this.timestamp()
      })
      if (existingIndex >= 0) draft.bindings[existingIndex] = binding
      else draft.bindings.push(binding)
      return { binding: clone(binding) }
    })
  }

  async listTargets(workspaceId: string): Promise<RemoteSshTarget[]> {
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const state = await this.load()
    const allowed = new Set(
      state.bindings.find((binding) => binding.workspaceId === normalizedWorkspaceId)?.allowedTargetIds ?? []
    )
    return state.targets
      .filter((target) => allowed.has(target.id))
      .map(clone)
      .sort(byDisplayNameThenId)
  }

  async listTargetCatalog(): Promise<RemoteSshTarget[]> {
    const state = await this.load()
    return state.targets.map(clone).sort(byDisplayNameThenId)
  }

  async saveTarget(input: RemoteSshTargetSaveInput): Promise<RemoteSshTargetSaveResult> {
    const parsed = remoteSshTargetSaveInputSchema.parse(input)
    return this.mutate(async (draft) => {
      if (!draft.labs.some((lab) => lab.id === parsed.labId)) {
        throw new Error(`Remote SSH lab not found: ${parsed.labId}`)
      }
      const id = parsed.id ? requireIdentifier(parsed.id, 'Target ID') : `target-${randomUUID()}`
      const existingIndex = draft.targets.findIndex((target) => target.id === id)
      const existing = draft.targets[existingIndex]
      assertExpectedRevision(existing?.revision, parsed.expectedRevision, 'Target')
      const sshAlias = requireSshAlias(parsed.sshAlias)
      const duplicateAlias = draft.targets.find(
        (target) => target.id !== id && target.sshAlias.toLowerCase() === sshAlias.toLowerCase()
      )
      if (duplicateAlias) throw new Error(`SSH alias is already registered by target ${duplicateAlias.id}.`)
      const timestamp = this.timestamp()
      const target = remoteSshTargetSchema.parse({
        schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
        id,
        labId: parsed.labId,
        displayName: requireDisplayName(parsed.displayName, 'Target display name'),
        sshAlias,
        labels: { ...parsed.labels },
        capabilities: [...parsed.capabilities],
        maxConcurrentExecutions: requirePositiveLimit(
          parsed.maxConcurrentExecutions,
          'Target concurrency',
          256
        ),
        revision: nextRevision(),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      })
      if (existingIndex >= 0) draft.targets[existingIndex] = target
      else draft.targets.push(target)
      return { target: clone(target) }
    })
  }

  async deleteTarget(input: RemoteSshTargetDeleteInput): Promise<RemoteSshTargetDeleteResult> {
    const parsed = remoteSshTargetDeleteInputSchema.parse(input)
    if (this.deletingTargetIds.has(parsed.targetId)) throw new Error('Remote SSH target deletion is already in progress.')
    this.deletingTargetIds.add(parsed.targetId)
    try {
      return await this.mutate(async (draft) => {
        const index = draft.targets.findIndex((target) => target.id === parsed.targetId)
        const target = draft.targets[index]
        if (!target) throw new Error(`Remote SSH target not found: ${parsed.targetId}`)
        assertExpectedRevision(target.revision, parsed.expectedRevision, 'Target')
        if (
          (this.activeExecutionCountByTarget.get(target.id) ?? 0) > 0 ||
          (this.activeTransferCountByTarget.get(target.id) ?? 0) > 0 ||
          (this.activeProbeCountByTarget.get(target.id) ?? 0) > 0
        ) {
          throw new Error('Cannot delete a target while it has active operations.')
        }
        draft.targets.splice(index, 1)
        const timestamp = this.timestamp()
        for (let bindingIndex = 0; bindingIndex < draft.bindings.length; bindingIndex += 1) {
          const binding = draft.bindings[bindingIndex]
          if (!binding?.allowedTargetIds.includes(target.id)) continue
          draft.bindings[bindingIndex] = remoteSshWorkspaceBindingSchema.parse({
            ...binding,
            allowedTargetIds: binding.allowedTargetIds.filter((targetId) => targetId !== target.id),
            revision: nextRevision(),
            updatedAt: timestamp
          })
        }
        this.recentFailureByTarget.delete(target.id)
        return { deletedTargetId: target.id }
      })
    } finally {
      this.deletingTargetIds.delete(parsed.targetId)
    }
  }

  async observeTarget(
    workspaceId: string,
    targetId: string
  ): Promise<RemoteSshServiceTargetObservation> {
    const { target } = await this.authorizedTarget(workspaceId, targetId)
    return {
      target: clone(target),
      activeExecutions: this.activeExecutionCountByTarget.get(target.id) ?? 0,
      observedAt: this.timestamp(),
      ...(this.recentFailureByTarget.has(target.id)
        ? { recentFailure: clone(this.recentFailureByTarget.get(target.id)!) }
        : {})
    }
  }

  async probeTarget(
    workspaceId: string,
    targetId: string,
    signal?: AbortSignal
  ): Promise<RemoteSshTargetProbeResult> {
    const { target, lab } = await this.authorizedTarget(workspaceId, targetId)
    this.assertTargetAvailable(target.id)
    const linked = linkedAbortController(signal)
    this.activeProbeControllers.add(linked.controller)
    increment(this.activeProbeCountByTarget, target.id)
    try {
      return await this.scheduler.run({
        labId: lab.id,
        targetId: target.id,
        labLimit: lab.maxConcurrentExecutions,
        targetLimit: target.maxConcurrentExecutions,
        signal: linked.controller.signal
      }, async () => {
        const current = await this.authorizedTarget(workspaceId, targetId)
        this.assertTargetAvailable(current.target.id)
        const probe = await this.probeAlias(
          current.target.sshAlias,
          current.lab,
          false,
          linked.controller.signal
        )
        if (probe.endpoint.status === 'reachable') this.recentFailureByTarget.delete(target.id)
        else {
          this.recentFailureByTarget.set(
            target.id,
            probe.failure ?? probeEndpointFailure(probe.endpoint)
          )
        }
        return {
          targetId: target.id,
          target: probe.endpoint,
          ready: probe.endpoint.status === 'reachable',
          checkedAt: this.timestamp()
        }
      })
    } finally {
      linked.dispose()
      this.activeProbeControllers.delete(linked.controller)
      decrement(this.activeProbeCountByTarget, target.id)
    }
  }

  async executeCommand(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshCommandExecuteInput,
    signal?: AbortSignal
  ): Promise<RemoteSshCommandExecuteResult> {
    const parsed = remoteSshCommandExecuteInputSchema.parse(input)
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const { target, lab } = await this.authorizedTarget(
      normalizedWorkspaceId,
      targetId,
      expectedRevision
    )
    this.assertTargetAvailable(target.id)
    requireCapability(target, 'shell')
    requireScript(parsed.script)
    this.reserveOperationId(normalizedWorkspaceId, parsed.executionId)

    const linked = linkedAbortController(signal)
    const controller = linked.controller
    const activeKey = operationKey(normalizedWorkspaceId, parsed.executionId)
    if (this.activeExecutions.has(activeKey)) throw new Error('Execution ID is already active.')
    this.activeExecutions.set(activeKey, {
      workspaceId: normalizedWorkspaceId,
      controller
    })
    increment(this.activeExecutionCountByTarget, target.id)
    let startedAt: string | undefined
    try {
      const result = await this.scheduler.run({
        labId: lab.id,
        targetId: target.id,
        labLimit: lab.maxConcurrentExecutions,
        targetLimit: target.maxConcurrentExecutions,
        signal: controller.signal
      }, async () => {
        const current = await this.authorizedTarget(
          normalizedWorkspaceId,
          targetId,
          expectedRevision
        )
        this.assertTargetAvailable(current.target.id)
        requireCapability(current.target, 'shell')
        startedAt = this.timestamp()
        const proxyCommand = await this.proxyCommand(
          current.target.sshAlias,
          current.lab,
          true,
          controller.signal
        )
        return this.runOpenSsh({
          executable: 'ssh',
          args: commandArgs(current.target.sshAlias, proxyCommand),
          stdin: parsed.script,
          timeoutMs: requireTimeout(parsed.timeoutMs, this.defaultTimeoutMs),
          maxOutputBytes: this.maxOutputBytes,
          signal: controller.signal
        })
      })
      const completedAt = this.timestamp()
      const sensitiveAliases = [target.sshAlias]
      const stdout = redactAndBoundOutput(result.stdout, sensitiveAliases)
      const stderr = redactAndBoundOutput(result.stderr, sensitiveAliases)
      const outputTruncated = result.truncated || stdout.truncated || stderr.truncated
      if (result.exitCode === 0 && !result.timedOut) {
        this.recentFailureByTarget.delete(target.id)
        return {
          ok: true,
          executionId: parsed.executionId,
          targetId: target.id,
          exitCode: 0,
          stdout: stdout.text,
          stderr: stderr.text,
          outputTruncated,
          startedAt: startedAt!,
          completedAt
        }
      }
      const failure = failureFromProcess(result)
      this.recentFailureByTarget.set(target.id, failure)
      const hidesTransportDetails = failure.code !== 'remote_exit_nonzero'
      return commandFailureResult(parsed.executionId, target.id, failure, {
        stdout: hidesTransportDetails ? '' : stdout.text,
        stderr: hidesTransportDetails ? '' : stderr.text,
        outputTruncated,
        startedAt,
        completedAt
      })
    } catch (error) {
      const failure = failureFromError(error)
      this.recentFailureByTarget.set(target.id, failure)
      return commandFailureResult(parsed.executionId, target.id, failure, {
        stdout: '',
        stderr: '',
        outputTruncated: false,
        startedAt,
        completedAt: this.timestamp()
      })
    } finally {
      linked.dispose()
      this.activeExecutions.delete(activeKey)
      decrement(this.activeExecutionCountByTarget, target.id)
    }
  }

  async cancelCommand(
    workspaceId: string,
    input: RemoteSshCommandCancelInput
  ): Promise<RemoteSshCommandCancelResult> {
    const parsed = remoteSshCommandCancelInputSchema.parse(input)
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const active = this.activeExecutions.get(operationKey(normalizedWorkspaceId, parsed.executionId))
    if (!active || active.workspaceId !== normalizedWorkspaceId) {
      return { executionId: parsed.executionId, cancelled: false }
    }
    active.controller.abort()
    return { executionId: parsed.executionId, cancelled: true }
  }

  async uploadFile(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshFileUploadInput,
    signal?: AbortSignal
  ): Promise<RemoteSshFileUploadResult> {
    const parsed = remoteSshFileUploadInputSchema.parse(input)
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const { target, lab } = await this.authorizedTarget(
      normalizedWorkspaceId,
      targetId,
      expectedRevision
    )
    this.assertTargetAvailable(target.id)
    requireCapability(target, 'file-transfer')
    this.reserveOperationId(normalizedWorkspaceId, parsed.transferId)
    const remotePath = requireRemotePath(parsed.remotePath)
    const linked = linkedAbortController(signal)
    const transferKey = operationKey(normalizedWorkspaceId, parsed.transferId)
    this.activeTransferControllers.set(transferKey, linked.controller)
    increment(this.activeTransferCountByTarget, target.id)
    let stagingDirectory = ''
    try {
      return await this.runTransfer({
        workspaceId: normalizedWorkspaceId,
        expectedRevision,
        target,
        lab,
        transferId: parsed.transferId,
        direction: 'upload',
        localPath: parsed.localPath,
        remotePath,
        timeoutMs: requireTimeout(parsed.timeoutMs, this.defaultTimeoutMs),
        signal: linked.controller.signal,
        prepare: async () => {
          const stagingRoot = dirname(this.registryPath)
          await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
          stagingDirectory = await mkdtemp(join(stagingRoot, 'upload-'))
          const staged = await stageWorkspaceUpload({
            localPath: parsed.localPath,
            workspaceRoot: normalizedWorkspaceId,
            stagingPath: join(stagingDirectory, 'upload'),
            maxBytes: this.maxUploadBytes,
            signal: linked.controller.signal
          })
          return {
            batch: `put ${quoteSftpPath(staged.path)} ${quoteSftpPath(remotePath)}\n`,
            size: async () => staged.size
          }
        }
      })
    } catch (error) {
      return transferFailureResult(parsed.transferId, target.id, 'upload', failureFromError(error), this.timestamp())
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true })
      linked.dispose()
      this.activeTransferControllers.delete(transferKey)
      decrement(this.activeTransferCountByTarget, target.id)
    }
  }

  async downloadFile(
    workspaceId: string,
    targetId: string,
    expectedRevision: string,
    input: RemoteSshFileDownloadInput,
    signal?: AbortSignal
  ): Promise<RemoteSshFileDownloadResult> {
    const parsed = remoteSshFileDownloadInputSchema.parse(input)
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const { target, lab } = await this.authorizedTarget(
      normalizedWorkspaceId,
      targetId,
      expectedRevision
    )
    this.assertTargetAvailable(target.id)
    requireCapability(target, 'file-transfer')
    this.reserveOperationId(normalizedWorkspaceId, parsed.transferId)
    const remotePath = requireRemotePath(parsed.remotePath)
    const linked = linkedAbortController(signal)
    const transferKey = operationKey(normalizedWorkspaceId, parsed.transferId)
    this.activeTransferControllers.set(transferKey, linked.controller)
    increment(this.activeTransferCountByTarget, target.id)
    let stagingDirectory = ''
    try {
      const result = await this.runTransfer({
        workspaceId: normalizedWorkspaceId,
        expectedRevision,
        target,
        lab,
        transferId: parsed.transferId,
        direction: 'download',
        localPath: parsed.localPath,
        remotePath,
        timeoutMs: requireTimeout(parsed.timeoutMs, this.defaultTimeoutMs),
        signal: linked.controller.signal,
        prepare: async () => {
          await resolveSafeWorkspaceWriteTarget(parsed.localPath, normalizedWorkspaceId, {
            createParentDirectories: true,
            targetKind: 'file'
          })
          const stagingRoot = dirname(this.registryPath)
          await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
          stagingDirectory = await mkdtemp(join(stagingRoot, 'download-'))
          const stagingPath = join(stagingDirectory, 'download')
          return {
            batch: `get ${quoteSftpPath(remotePath)} ${quoteSftpPath(stagingPath)}\n`,
            size: async () => {
              const info = await stat(stagingPath)
              if (!info.isFile()) throw new Error('Downloaded artifact is not a regular file.')
              if (info.size > this.maxDownloadBytes) {
                throw new TransferLimitError('Downloaded artifact', this.maxDownloadBytes)
              }
              return info.size
            },
            afterSuccess: async () => {
              const content = await readFile(stagingPath)
              if (content.byteLength > this.maxDownloadBytes) {
                throw new TransferLimitError('Downloaded artifact', this.maxDownloadBytes)
              }
              const freshTarget = await resolveSafeWorkspaceWriteTarget(
                parsed.localPath,
                normalizedWorkspaceId,
                { createParentDirectories: true, targetKind: 'file' }
              )
              await writeSafeWorkspaceFile(freshTarget, content)
            },
            downloadLimit: {
              path: stagingPath,
              maxBytes: this.maxDownloadBytes,
              controller: linked.controller
            }
          }
        }
      })
      return result
    } catch (error) {
      return transferFailureResult(
        parsed.transferId,
        target.id,
        'download',
        failureFromError(error),
        this.timestamp()
      )
    } finally {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true })
      linked.dispose()
      this.activeTransferControllers.delete(transferKey)
      decrement(this.activeTransferCountByTarget, target.id)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const active of this.activeExecutions.values()) active.controller.abort()
    for (const controller of this.activeTransferControllers.values()) controller.abort()
    for (const controller of this.activeProbeControllers) controller.abort()
    this.scheduler.close()
    this.environmentManager.close()
  }

  private async runTransfer(input: Readonly<{
    workspaceId: string
    expectedRevision: string
    target: RemoteSshTarget
    lab: RemoteSshLab
    transferId: string
    direction: 'upload' | 'download'
    localPath: string
    remotePath: string
    timeoutMs: number
    signal?: AbortSignal
    prepare: () => Promise<PreparedTransfer>
  }>): Promise<RemoteSshFileTransferResult> {
    let limitMonitor: ReturnType<typeof monitorFileSize> | undefined
    let downloadLimit: PreparedTransfer['downloadLimit']
    try {
      return await this.scheduler.run({
        labId: input.lab.id,
        targetId: input.target.id,
        labLimit: input.lab.maxConcurrentExecutions,
        targetLimit: input.target.maxConcurrentExecutions,
        signal: input.signal
      }, async () => {
        let current = await this.authorizedTarget(
          input.workspaceId,
          input.target.id,
          input.expectedRevision
        )
        this.assertTargetAvailable(current.target.id)
        requireCapability(current.target, 'file-transfer')
        const proxyCommand = await this.proxyCommand(
          current.target.sshAlias,
          current.lab,
          true,
          input.signal
        )
        const prepared = await input.prepare()
        current = await this.authorizedTarget(
          input.workspaceId,
          input.target.id,
          input.expectedRevision
        )
        this.assertTargetAvailable(current.target.id)
        requireCapability(current.target, 'file-transfer')
        downloadLimit = prepared.downloadLimit
        limitMonitor = downloadLimit ? monitorFileSize(downloadLimit) : undefined
        const result = await this.runOpenSsh({
          executable: 'sftp',
          args: transferArgs(current.target.sshAlias, proxyCommand),
          stdin: prepared.batch,
          timeoutMs: input.timeoutMs,
          maxOutputBytes: this.maxOutputBytes,
          signal: input.signal
        })
        if (result.exitCode !== 0 || result.timedOut || limitMonitor?.exceeded()) {
          const failure = limitMonitor?.exceeded()
            ? downloadLimitFailure(downloadLimit!.maxBytes)
            : failureFromProcess(result)
          this.recentFailureByTarget.set(input.target.id, failure)
          return transferFailureResult(
            input.transferId,
            input.target.id,
            input.direction,
            failure,
            this.timestamp()
          )
        }
        const sizeBytes = await prepared.size()
        await prepared.afterSuccess?.()
        this.recentFailureByTarget.delete(input.target.id)
        return {
          ok: true,
          transferId: input.transferId,
          targetId: input.target.id,
          direction: input.direction,
          localPath: input.localPath,
          remotePath: input.remotePath,
          sizeBytes,
          completedAt: this.timestamp()
        }
      })
    } catch (error) {
      const failure = limitMonitor?.exceeded()
        ? downloadLimitFailure(downloadLimit!.maxBytes)
        : failureFromError(error)
      this.recentFailureByTarget.set(input.target.id, failure)
      return transferFailureResult(
        input.transferId,
        input.target.id,
        input.direction,
        failure,
        this.timestamp()
      )
    } finally {
      limitMonitor?.stop()
    }
  }

  private async probeAlias(
    alias: string,
    lab: RemoteSshLab,
    startIfStopped: boolean,
    signal?: AbortSignal
  ): Promise<RemoteSshProbeOutcome> {
    const startedAt = Date.now()
    try {
      const proxyCommand = await this.proxyCommand(alias, lab, startIfStopped, signal)
      const result = await this.runOpenSsh({
        executable: 'ssh',
        args: probeArgs(alias, proxyCommand),
        timeoutMs: PROBE_TIMEOUT_MS,
        maxOutputBytes: this.maxOutputBytes,
        signal
      })
      if (result.exitCode === 0 && !result.timedOut) {
        return {
          endpoint: { status: 'reachable', latencyMs: Date.now() - startedAt }
        }
      }
      const failure = failureFromProcess(result)
      return {
        endpoint: probeEndpointFromFailure(failure, Date.now() - startedAt),
        failure
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      const failure = failureFromError(error)
      return {
        endpoint: probeEndpointFromFailure(failure, Date.now() - startedAt),
        failure
      }
    }
  }

  private async runOpenSsh(request: ProcessRequest): Promise<ProcessResult> {
    this.assertOpen()
    try {
      return await this.processRunner.run(request)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new OpenSshExecutableMissingError()
      throw error
    }
  }

  private async proxyCommand(
    alias: string,
    lab: RemoteSshLab,
    startIfStopped: boolean,
    signal?: AbortSignal
  ): Promise<string> {
    const [proxy, target] = await Promise.all([
      this.environmentProxyEndpoint(lab, startIfStopped, signal),
      this.targetResolver.resolve(alias, signal),
      this.proxyHelper.ensureInstalled()
    ])
    return this.proxyHelper.command(proxy, target)
  }

  private async environmentProxyEndpoint(
    lab: RemoteSshLab,
    startIfStopped: boolean,
    signal?: AbortSignal
  ): Promise<Socks5ProxyEndpoint> {
    return this.runLabEnvironmentOperation(lab.id, async () => {
      // An operation may have loaded its target before a queued environment
      // reconfiguration committed. Refuse that stale configuration instead of
      // recreating a resource that the reconfiguration just removed.
      await this.requireLab(lab.id, lab.revision)
      try {
        return await this.environmentManager.proxyEndpoint(lab, {
          startIfStopped,
          ...(signal ? { signal } : {})
        })
      } catch (error) {
        if (isAbortError(error)) throw error
        const status = await this.environmentManager.get(lab).catch(() => undefined)
        if (status?.state === 'starting') {
          throw new EnvironmentBusyError()
        }
        throw new EnvironmentUnavailableError({ cause: error })
      }
    })
  }

  private async authorizedTarget(
    workspaceId: string,
    targetId: string,
    expectedRevision?: string
  ): Promise<{ target: RemoteSshTarget; lab: RemoteSshLab }> {
    const normalizedWorkspaceId = requireWorkspaceId(workspaceId)
    const normalizedTargetId = requireIdentifier(targetId, 'Target ID')
    const state = await this.load()
    const binding = state.bindings.find((candidate) => candidate.workspaceId === normalizedWorkspaceId)
    if (!binding?.allowedTargetIds.includes(normalizedTargetId)) {
      throw new Error('Remote SSH target is not authorized for this workspace.')
    }
    const target = state.targets.find((candidate) => candidate.id === normalizedTargetId)
    if (!target) throw new Error(`Remote SSH target not found: ${normalizedTargetId}`)
    if (expectedRevision !== undefined && target.revision !== expectedRevision) {
      throw new Error('Remote SSH target revision conflict. Observe the target again before retrying.')
    }
    const lab = state.labs.find((candidate) => candidate.id === target.labId)
    if (!lab) throw new Error(`Remote SSH lab not found: ${target.labId}`)
    return { target: clone(target), lab: clone(lab) }
  }

  private async requireLab(labId: string, expectedRevision?: string): Promise<RemoteSshLab> {
    const normalizedLabId = requireIdentifier(labId, 'Lab ID')
    const state = await this.load()
    const lab = state.labs.find((candidate) => candidate.id === normalizedLabId)
    if (!lab) throw new Error(`Remote SSH lab not found: ${normalizedLabId}`)
    assertExpectedRevision(lab.revision, expectedRevision, 'Lab')
    return clone(lab)
  }

  private reserveOperationId(workspaceId: string, operationId: string): void {
    const key = operationKey(workspaceId, operationId)
    if (this.rememberedOperationIds.has(key)) {
      throw new Error('Remote SSH operation ID has already been used.')
    }
    this.rememberedOperationIds.add(key)
    if (this.rememberedOperationIds.size > MAX_REMEMBERED_OPERATION_IDS) {
      const oldest = this.rememberedOperationIds.values().next().value
      if (oldest) this.rememberedOperationIds.delete(oldest)
    }
  }

  private async load(): Promise<PersistedState> {
    this.assertOpen()
    if (this.state) return this.state
    this.loadPromise ??= loadState(this.registryPath)
    this.state = await this.loadPromise
    return this.state
  }

  private runEnvironmentConfiguration<Value>(
    operation: () => Promise<Value>
  ): Promise<Value> {
    this.assertOpen()
    const run = this.environmentConfigurationQueue.then(operation)
    this.environmentConfigurationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private runLabEnvironmentOperation<Value>(
    labId: string,
    operation: () => Promise<Value>
  ): Promise<Value> {
    this.assertOpen()
    const previous = this.labEnvironmentQueues.get(labId) ?? Promise.resolve()
    const run = previous.then(operation)
    const tail = run.then(() => undefined, () => undefined)
    this.labEnvironmentQueues.set(labId, tail)
    void tail.then(() => {
      if (this.labEnvironmentQueues.get(labId) === tail) {
        this.labEnvironmentQueues.delete(labId)
      }
    })
    return run
  }

  private mutate<T>(operation: (draft: PersistedState) => Promise<T>): Promise<T> {
    this.assertOpen()
    const run = this.mutationQueue.then(async () => {
      const current = await this.load()
      const draft = clone(current)
      const result = await operation(draft)
      const validated = persistedStateSchema.parse(draft)
      await persistState(this.registryPath, validated)
      this.state = validated
      return result
    })
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private assertTargetAvailable(targetId: string): void {
    if (this.deletingTargetIds.has(targetId)) {
      throw new Error('Remote SSH target deletion is in progress.')
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Remote SSH service is closed.')
  }
}

export function createRemoteSshService(options: RemoteSshServiceOptions): RemoteSshService {
  return new RemoteSshService(options)
}

async function stageWorkspaceUpload(input: Readonly<{
  localPath: string
  workspaceRoot: string
  stagingPath: string
  maxBytes: number
  signal?: AbortSignal
}>): Promise<Readonly<{ path: string; size: number }>> {
  let sourcePath: string
  try {
    sourcePath = await resolveOpenTargetPath(input.localPath, input.workspaceRoot, {
      allowBasenameFallback: false
    })
  } catch {
    throw new LocalFileUnavailableError()
  }
  const handle = await open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Upload source must be a regular file.')
    if (before.size > input.maxBytes) {
      throw new TransferLimitError('Uploaded artifact', input.maxBytes)
    }
    let copiedBytes = 0
    const byteLimiter = new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        copiedBytes += chunk.byteLength
        if (copiedBytes > input.maxBytes) {
          callback(new TransferLimitError('Uploaded artifact', input.maxBytes))
          return
        }
        callback(null, chunk)
      }
    })
    await pipeline(
      handle.createReadStream({ autoClose: false }),
      byteLimiter,
      createWriteStream(input.stagingPath, { flags: 'wx', mode: 0o600 }),
      input.signal ? { signal: input.signal } : {}
    )
    const after = await handle.stat()
    const currentPath = await resolveOpenTargetPath(input.localPath, input.workspaceRoot, {
      allowBasenameFallback: false
    })
    const current = await stat(currentPath)
    if (
      currentPath !== sourcePath ||
      !sameFileIdentity(before, current) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('Upload source changed while it was being staged.')
    }
    const staged = await stat(input.stagingPath)
    if (!staged.isFile() || staged.size !== before.size) {
      throw new Error('Upload staging did not preserve the source file.')
    }
    return { path: input.stagingPath, size: staged.size }
  } finally {
    await handle.close()
  }
}

function sameFileIdentity(
  left: Readonly<{ dev: number; ino: number }>,
  right: Readonly<{ dev: number; ino: number }>
): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function loadState(path: string): Promise<PersistedState> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_REGISTRY_BYTES) {
      throw new Error('Remote SSH registry exceeds its safe read limit.')
    }
    const content = await readFile(path, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > MAX_REGISTRY_BYTES) {
      throw new Error('Remote SSH registry exceeds its safe read limit.')
    }
    const decoded: unknown = JSON.parse(content)
    const schemaVersion = registrySchemaVersion(decoded)
    if (schemaVersion !== REMOTE_SSH_SCHEMA_VERSION) {
      throw new UnsupportedRegistrySchemaVersionError(path, schemaVersion)
    }
    return persistedStateSchema.parse(decoded)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { schemaVersion: REMOTE_SSH_SCHEMA_VERSION, labs: [], targets: [], bindings: [] }
    }
    if (error instanceof UnsupportedRegistrySchemaVersionError) throw error
    throw new Error('Remote SSH registry could not be loaded.', { cause: error })
  }
}

function registrySchemaVersion(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value
    ? (value as { schemaVersion?: unknown }).schemaVersion
    : undefined
}

class UnsupportedRegistrySchemaVersionError extends Error {
  constructor(path: string, actualVersion: unknown) {
    const actual = typeof actualVersion === 'number' || typeof actualVersion === 'string'
      ? String(actualVersion)
      : 'missing'
    super(
      `Remote SSH configuration version ${actual} is unsupported (expected ${REMOTE_SSH_SCHEMA_VERSION}). ` +
      `SciForge left the existing file unchanged at "${path}". Back it up and move it aside before configuring VM labs.`
    )
    this.name = 'UnsupportedRegistrySchemaVersionError'
  }
}

async function persistState(path: string, state: PersistedState): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

function commandArgs(alias: string, proxyCommand: string): string[] {
  return [
    '-T',
    ...sshSafetyOptions(15),
    '-o', `ProxyCommand=${proxyCommand}`,
    '--', requireSshAlias(alias),
    'sh', '-s'
  ]
}

function probeArgs(alias: string, proxyCommand: string): string[] {
  return [
    '-T',
    ...sshSafetyOptions(10),
    '-o', `ProxyCommand=${proxyCommand}`,
    '--', requireSshAlias(alias),
    'true'
  ]
}

function transferArgs(alias: string, proxyCommand: string): string[] {
  return [
    '-b', '-',
    ...sshSafetyOptions(15),
    '-o', `ProxyCommand=${proxyCommand}`,
    '--', requireSshAlias(alias)
  ]
}

function sshSafetyOptions(connectTimeoutSeconds: number): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'NumberOfPasswordPrompts=0',
    '-o', 'RequestTTY=no',
    '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no',
    '-o', 'PermitLocalCommand=no',
    '-o', 'ClearAllForwardings=yes',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
    '-o', 'ControlPersist=no',
    '-o', 'ConnectionAttempts=1',
    '-o', `ConnectTimeout=${connectTimeoutSeconds}`,
    '-o', 'StrictHostKeyChecking=yes'
  ]
}

function emptyBinding(workspaceId: string): RemoteSshWorkspaceBinding {
  return {
    schemaVersion: REMOTE_SSH_SCHEMA_VERSION,
    workspaceId,
    allowedTargetIds: [],
    revision: '0',
    updatedAt: new Date(0).toISOString()
  }
}

function assertExpectedRevision(
  currentRevision: string | undefined,
  expectedRevision: string | undefined,
  label: string
): void {
  if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
    throw new Error(`${label} revision conflict.`)
  }
}

function assertUniqueVirtualBoxVmId(
  labs: readonly RemoteSshLab[],
  labId: string,
  environment: RemoteSshLab['environment']
): void {
  if (environment.provider !== 'vm') return
  const conflict = labs.find((lab) =>
    lab.id !== labId &&
    lab.environment.provider === 'vm' &&
    lab.environment.vmId === environment.vmId)
  if (!conflict) return
  throw new Error(
    `VirtualBox VM "${environment.vmId}" is already assigned to ` +
    `Remote SSH lab "${conflict.displayName}" (${conflict.id}).`
  )
}

function nextRevision(): string {
  return `rev-${randomUUID()}`
}

function byDisplayNameThenId(a: { displayName: string; id: string }, b: { displayName: string; id: string }): number {
  return a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1
  if (next <= 0) counts.delete(key)
  else counts.set(key, next)
}

function operationKey(workspaceId: string, operationId: string): string {
  return `${workspaceId}\0${operationId}`
}

function linkedAbortController(signal?: AbortSignal): Readonly<{
  controller: AbortController
  dispose: () => void
}> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    controller,
    dispose: () => signal?.removeEventListener('abort', onAbort)
  }
}

function requireCapability(target: RemoteSshTarget, capability: 'shell' | 'file-transfer'): void {
  if (!target.capabilities.includes(capability)) {
    throw new Error(`Remote SSH target does not allow ${capability}.`)
  }
}

function monitorFileSize(input: Readonly<{
  path: string
  maxBytes: number
  controller: AbortController
}>): Readonly<{ exceeded: () => boolean; stop: () => void }> {
  let didExceed = false
  let checking = false
  const check = async () => {
    if (checking || didExceed) return
    checking = true
    try {
      const info = await stat(input.path)
      if (info.size > input.maxBytes) {
        didExceed = true
        input.controller.abort()
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    } finally {
      checking = false
    }
  }
  const interval = setInterval(() => {
    void check().catch(() => input.controller.abort())
  }, 25)
  interval.unref?.()
  void check().catch(() => input.controller.abort())
  return {
    exceeded: () => didExceed,
    stop: () => clearInterval(interval)
  }
}

function downloadLimitFailure(maxBytes: number): RemoteSshFailure {
  return {
    code: 'transfer_limit_exceeded',
    message: `Downloaded artifact exceeds the ${maxBytes}-byte limit.`
  }
}

function failureFromProcess(result: ProcessResult): RemoteSshFailure {
  if (result.timedOut) return { code: 'timeout', message: 'Remote SSH operation timed out.' }
  const detail = redactProcessOutput(`${result.stderr}\n${result.stdout}`).trim().slice(0, 2_000)
  const lower = detail.toLowerCase()
  if (lower.includes('host key verification failed') || lower.includes('remote host identification has changed')) {
    return { code: 'host_key_rejected', message: 'SSH host key was rejected.' }
  }
  if (lower.includes('permission denied') || lower.includes('authentication failed')) {
    return {
      code: 'target_auth_failed',
      message: 'SSH authentication failed.',
      ...(result.exitCode !== null ? { exitCode: result.exitCode } : {})
    }
  }
  if (lower.includes('bad configuration option') || lower.includes('terminating, 1 bad configuration options')) {
    return {
      code: 'ssh_config_invalid',
      message: 'OpenSSH configuration is invalid.',
      ...(result.exitCode !== null ? { exitCode: result.exitCode } : {})
    }
  }
  if (
    lower.includes('could not resolve hostname') ||
    lower.includes('connection timed out') ||
    lower.includes('operation timed out') ||
    lower.includes('no route to host') ||
    lower.includes('connection refused') ||
    lower.includes('network is unreachable')
  ) {
    return {
      code: 'target_unreachable',
      message: 'SSH endpoint is unreachable.',
      ...(result.exitCode !== null ? { exitCode: result.exitCode } : {})
    }
  }
  return {
    code: 'remote_exit_nonzero',
    message: 'Remote SSH command exited with a non-zero status.',
    ...(result.exitCode !== null ? { exitCode: result.exitCode } : {})
  }
}

function failureFromError(error: unknown): RemoteSshFailure {
  if (isAbortError(error)) return { code: 'cancelled', message: 'Remote SSH operation was cancelled.' }
  if (error instanceof TransferLimitError) {
    return { code: 'transfer_limit_exceeded', message: error.message }
  }
  if (error instanceof OpenSshExecutableMissingError) {
    return { code: 'ssh_executable_missing', message: 'The required system OpenSSH executable was not found.' }
  }
  if (error instanceof OpenSshTargetResolutionError) {
    return error.reason === 'missing-executable'
      ? { code: 'ssh_executable_missing', message: 'The required system OpenSSH executable was not found.' }
      : { code: 'ssh_config_invalid', message: 'OpenSSH configuration is invalid.' }
  }
  if (error instanceof EnvironmentBusyError) {
    return {
      code: 'environment_busy',
      message: 'The laboratory environment is still starting.'
    }
  }
  if (error instanceof EnvironmentUnavailableError) {
    return {
      code: 'environment_unavailable',
      message: 'The laboratory environment is unavailable.'
    }
  }
  if (error instanceof LocalFileUnavailableError || errorCode(error) === 'ENOENT') {
    return { code: 'local_file_unavailable', message: 'The requested local file is unavailable.' }
  }
  return {
    code: 'target_unreachable',
    message: 'Remote SSH operation failed.'
  }
}

class TransferLimitError extends Error {
  constructor(label: 'Uploaded artifact' | 'Downloaded artifact', maxBytes: number) {
    super(`${label} exceeds the ${maxBytes}-byte limit.`)
    this.name = 'TransferLimitError'
  }
}

class OpenSshExecutableMissingError extends Error {
  constructor() {
    super('The required system OpenSSH executable was not found.')
    this.name = 'OpenSshExecutableMissingError'
  }
}

class LocalFileUnavailableError extends Error {
  constructor() {
    super('The requested local file is unavailable.')
    this.name = 'LocalFileUnavailableError'
  }
}

class EnvironmentUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('The laboratory environment is unavailable.', options)
    this.name = 'EnvironmentUnavailableError'
  }
}

class EnvironmentBusyError extends Error {
  constructor() {
    super('The laboratory environment is still starting.')
    this.name = 'EnvironmentBusyError'
  }
}

function redactAliases(value: string, aliases: string[]): string {
  return aliases.reduce((output, alias) => output.replace(
    new RegExp(escapeRegExp(alias), 'gi'),
    '[REDACTED SSH TARGET]'
  ), value)
}

function redactAndBoundOutput(
  value: string,
  aliases: string[]
): Readonly<{ text: string; truncated: boolean }> {
  const redacted = redactAliases(redactProcessOutput(value), aliases)
  if (redacted.length <= REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS) {
    return { text: redacted, truncated: false }
  }
  return {
    text: redacted.slice(0, REMOTE_SSH_MAX_CAPTURED_OUTPUT_CHARACTERS),
    truncated: true
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function probeEndpointFromFailure(
  failure: RemoteSshFailure,
  latencyMs: number
): RemoteSshProbeEndpoint {
  const status = failure.code === 'host_key_rejected'
    ? 'host-key-rejected'
    : failure.code.endsWith('_auth_failed')
      ? 'auth-failed'
      : failure.code === 'ssh_config_invalid' || failure.code === 'ssh_executable_missing'
        ? 'not-configured'
        : failure.code === 'environment_unavailable' ||
            failure.code === 'environment_busy' ||
            failure.code === 'vpn_login_required'
          ? 'not-tested'
        : 'unreachable'
  return { status, latencyMs, message: failure.message }
}

function probeEndpointFailure(
  endpoint: RemoteSshProbeEndpoint
): RemoteSshFailure {
  if (endpoint.status === 'host-key-rejected') {
    return { code: 'host_key_rejected', message: endpoint.message ?? 'SSH host key was rejected.' }
  }
  if (endpoint.status === 'auth-failed') {
    return {
      code: 'target_auth_failed',
      message: endpoint.message ?? 'SSH authentication failed.'
    }
  }
  return {
    code: 'target_unreachable',
    message: endpoint.message ?? 'SSH endpoint is unreachable.'
  }
}

function commandFailureResult(
  executionId: string,
  targetId: string,
  failure: RemoteSshFailure,
  result: Readonly<{
    stdout: string
    stderr: string
    outputTruncated: boolean
    startedAt?: string
    completedAt: string
  }>
): RemoteSshCommandExecuteResult {
  return {
    ok: false,
    executionId,
    targetId,
    stdout: result.stdout,
    stderr: result.stderr,
    outputTruncated: result.outputTruncated,
    failure,
    ...(result.startedAt ? { startedAt: result.startedAt } : {}),
    completedAt: result.completedAt
  }
}

function transferFailureResult(
  transferId: string,
  targetId: string,
  direction: 'upload' | 'download',
  failure: RemoteSshFailure,
  completedAt: string
): RemoteSshFileTransferResult {
  return { ok: false, transferId, targetId, direction, failure, completedAt }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
}

function addDuplicateIssues(
  values: string[],
  path: (string | number)[],
  label: string,
  context: z.RefinementCtx
): void {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({ code: 'custom', path: [...path, index], message: `Duplicate ${label}.` })
    }
    seen.add(value)
  })
}
