import { cp, mkdir, readFile, realpath, rename, writeFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { developmentPluginUiUrl, type DevelopmentPluginUiAsset } from './development-plugin-ui-protocol'
import { HOST_BUSINESS_INVOKE_TIMEOUT_MS } from './invocation-budgets'
import { z } from 'zod'
import {
  PluginHost,
  ContributionHost,
  ProcessExtensionHost,
  ProcessExtensionRuntime,
  PluginUpdateCoordinator,
  manifestMainEntry,
  RendererContributionRegistry,
  ManagedRuntimeRegistry,
  WorkflowLifecycleRegistry,
  WorkflowLifecycleAdapter,
  ManagedRuntimeAdapter,
  RendererContributionAdapter,
  requireHostAuthorizedRenderer,
  PluginVersionStore,
  pluginDirectoryIntegrity,
  parsePluginManifest,
  validatePluginDirectory,
  discoverPlugins,
  resolvePluginAdapterContract,
  type DiscoveredPlugin,
  type PluginAdapterContract,
  type HostPortsRequest,
  type HostPortsResult,
  type PluginLifecycleHooks,
  HostServiceProviderRegistry,
  type HostServiceProvider,
  type HostServiceClientFactory,
  type ManagedRuntimeContribution,
  type WorkflowLifecycleContribution,
  type WorkflowLifecycleOperation,
  type ManagedRuntimeOperationConfig
} from '@sciforge/plugin-sdk'
import { defineCapability } from '../capabilities/registry'
import { CapabilityBrokerError } from '../capabilities/broker'
import type { CapabilityDefinition, CapabilityHandlerContext, CapabilityRegistry } from '../capabilities/registry'
import { capabilityDescriptorSchema } from '../../shared/capability-broker'
import type { DomainExtensionRendererContribution, DomainExtensionSummary } from '../../shared/domain-extensions'
import {
  workspacePreviewSlotWireSchema,
  type PluginWorkspacePreviewSlot,
  type WorkspacePreviewMethod
} from '@sciforge/plugin-sdk'
import type { WorkspacePreviewPluginRegistrationInput } from '../services/workspace-preview/composition'
import { createRemoteWorkspacePreviewProvider, type WorkspacePreviewBridgeCall } from './workspace-preview-bridge'
import { publishCapabilitySnapshot } from './capability-ownership'

const execFileAsync = promisify(execFile)
const AGENT_CHECK_MAX_OUTPUT = 8_000
const AGENT_CHECK_TIMEOUT_MS = 120_000

/**
 * Sink for the workspace-preview contribution channel: the Host's preview
 * host (WorkspacePreviewHost) registers/unregisters remote plugin providers
 * here. Attached after host construction; the service flushes its buffered
 * per-package state on attach so plugins activated earlier are not lost.
 */
export type WorkspacePreviewPluginSink = Readonly<{
  sync: (packageName: string, plugins: readonly WorkspacePreviewPluginRegistrationInput[] | undefined) => void
}>

export const DEVELOPMENT_PLUGIN_AGENT_CAPABILITY_IDS = Object.freeze([
  'plugin.dev.prepare',
  'plugin.dev.check',
  'plugin.dev.submit',
  'plugin.update.request',
  'plugin.update.status'
] as const)

export type DevelopmentPluginAgentCapabilityId = typeof DEVELOPMENT_PLUGIN_AGENT_CAPABILITY_IDS[number]

export type DevelopmentPluginAgentCandidateState =
  | 'prepared'
  | 'checked'
  | 'submitted'
  | 'approval-pending'
  | 'applied'
  | 'failed'
  | 'cancelled'

export type DevelopmentPluginAgentCommandResult = Readonly<{
  command: string
  ok: boolean
  output: string
}>

export type DevelopmentPluginAgentCandidateSummary = Readonly<{
  candidateId: string
  packageName: string
  workspaceDirectory: string
  baseVersion: string
  state: DevelopmentPluginAgentCandidateState
  check?: Readonly<{
    checkId: string
    version: string
    integrity: string
    checkedAt: string
    passed: boolean
    diagnostics?: string
    commands: readonly DevelopmentPluginAgentCommandResult[]
  }>
  updateRequest?: Readonly<{
    requestId: string
    status: 'pending' | 'applied' | 'failed' | 'cancelled'
    requestedAt: string
    diagnostic?: string
  }>
  plugin: DomainExtensionSummary
}>

type AgentCandidateRecord = {
  candidateId: string
  packageName: string
  workspaceDirectory: string
  baseVersion: string
  state: DevelopmentPluginAgentCandidateState
  check?: {
    checkId: string
    artifactDirectory: string
    version: string
    integrity: string
    checkedAt: string
    passed: boolean
    diagnostics?: string
    commands: DevelopmentPluginAgentCommandResult[]
  }
  updateRequest?: {
    requestId: string
    status: 'pending' | 'applied' | 'failed' | 'cancelled'
    requestedAt: string
    diagnostic?: string
  }
}

type AgentCommandRunner = (input: Readonly<{
  cwd: string
  script: 'check' | 'test' | 'build'
  command: string
  signal?: AbortSignal
}>) => Promise<Readonly<{ ok: boolean; output: string }>>

function boundedAgentOutput(value: string): string {
  return value.length <= AGENT_CHECK_MAX_OUTPUT
    ? value
    : `${value.slice(0, AGENT_CHECK_MAX_OUTPUT)}\n[output truncated]`
}

async function defaultAgentCommandRunner(input: Parameters<AgentCommandRunner>[0]): Promise<Readonly<{ ok: boolean; output: string }>> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const environment: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key]) environment[key] = process.env[key]
  }
  try {
    const result = await execFileAsync(process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npm,
      process.platform === 'win32' ? ['/d', '/c', `npm.cmd run ${input.script}`] : ['run', input.script], {
      cwd: input.cwd,
      env: environment,
      timeout: AGENT_CHECK_TIMEOUT_MS,
      maxBuffer: AGENT_CHECK_MAX_OUTPUT * 4,
      windowsHide: true,
      signal: input.signal
    })
    return { ok: true, output: boundedAgentOutput(`${result.stdout}${result.stderr}`) }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      output: boundedAgentOutput(`${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`)
    }
  }
}

type PersistedState = Readonly<{
  schemaVersion: 1 | 2 | 3 | 4
  enabled: readonly string[]
  dshConfigs?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  pendingRestart?: Readonly<Record<string, { version: string; stagedDirectory: string; integrity: string }>>
  candidates?: Readonly<Record<string, { version: string; stagedDirectory: string; integrity: string }>>
  previousActive?: Readonly<Record<string, { packageName: string; version: string; integrity: string; directory: string }>>
  agentCandidates?: Readonly<Record<string, AgentCandidateRecord>>
}>
/**
 * Development-only bridge used to exercise PR-1 end to end. It requires an
 * explicit absolute root and is never constructed in packaged builds.
 */
export class DevelopmentExternalPluginService {
  readonly #root: string
  readonly #versionRoot: string
  readonly #candidateRoot: string
  readonly #statePath: string
  readonly #host: PluginHost
  /** Single owner of every plugin runtime (lifecycle + hot-update). */
  readonly #extensionHost: ProcessExtensionHost
  readonly #enabled = new Set<string>()
  readonly #dshConfigs = new Map<string, Readonly<Record<string, unknown>>>()
  #stateWriteTail: Promise<void> = Promise.resolve()
  #capabilitySyncTail: Promise<void> = Promise.resolve()
  #capabilityRegistry: CapabilityRegistry | undefined
  readonly #contributions = new ContributionHost()
  readonly #rendererContributions = new RendererContributionRegistry()
  readonly #managedRuntimes = new ManagedRuntimeRegistry()
  readonly #workflowContributions = new WorkflowLifecycleRegistry()
  /** Fail-closed record of whether a plugin's typed contribution registered and reached the Broker. */
  readonly #contributionRegistration = new Map<string, { ok: boolean; diagnostic?: string; capabilityCount?: number }>()
  /**
   * Workspace-preview channel state (gap-1b): the last synced remote provider
   * set per package plus the Host preview sink. Buffered until the sink
   * attaches because the preview host is constructed after this service.
   */
  #workspacePreviewSink: WorkspacePreviewPluginSink | undefined
  readonly #workspacePreviewSyncState = new Map<string, WorkspacePreviewPluginRegistrationInput[]>()
  /** Versions staged but not drainable now; applied on restart (restart-required). */
  readonly #pendingRestart = new Map<string, { version: string; stagedDirectory: string; integrity: string }>()
  /** Checked-but-not-applied candidate versions awaiting user confirmation. */
  readonly #candidates = new Map<string, { version: string; stagedDirectory: string; integrity: string }>()
  readonly #previousActive = new Map<string, { packageName: string; version: string; integrity: string; directory: string }>()
  readonly #agentCandidates = new Map<string, AgentCandidateRecord>()
  #agentCapabilityRegistry: CapabilityRegistry | undefined
  /** Generation whose candidate publication is owned by the coordinator commit transaction. */
  readonly #publicationTransactions = new Map<string, number>()
  readonly #versionStore: PluginVersionStore
  /** Canonical update chain: PluginVersionStore -> PluginUpdateCoordinator -> ProcessExtensionHost prepare/commit. */
  readonly #updateCoordinator: PluginUpdateCoordinator
  readonly #hostApiVersion: string
  readonly #dshRuntimeVersion: string | undefined
  /**
   * Development-seam approval contracts, passed through exactly as configured —
   * including `undefined`, so the development path keeps its original semantics.
   */
  readonly #devAdapterContracts: ReadonlyMap<string, PluginAdapterContract> | undefined
  /**
   * Contracts for plugins installed through the market, keyed by `package@version`
   * (with a package-name fallback). Kept apart from the seam so an installed
   * approval never changes how the development seam behaves.
   */
  readonly #installedAdapterContracts = new Map<string, PluginAdapterContract>()
  /**
   * The exact options object handed to `PluginHost`. The host re-reads
   * `adapterContracts` from it on every `discover()`, so refreshing the property
   * makes a contract registered at install time visible without rebuilding the
   * host.
   */
  #hostOptions: { adapterContracts?: ReadonlyMap<string, PluginAdapterContract> }
  /**
   * Contracts for plugins installed through the market, keyed by `package@version`
   * (with a package-name fallback). Kept apart from the development seam: an
   * installed approval never changes how the development seam behaves.
   */

  readonly #allowedPermissionIds: ReadonlySet<string>
  readonly #runAgentCommand: AgentCommandRunner
  /** Host-owned executor for approved ports operations; effects stay in the Host. */
  readonly #portsExecutor: ((execution: Readonly<{ operation: string; input: unknown; workspaceId: string }>) => Promise<unknown>) | undefined
  readonly #hostServices: HostServiceProviderRegistry | undefined
  readonly #hostServiceIds: readonly string[]
  readonly #hostServiceClients: ReadonlyMap<string, readonly HostServiceClientFactory[]>
  readonly #resolveHostServiceClients?: (packageName: string, version: string, generation: number) => readonly HostServiceClientFactory[]

  constructor(options: Readonly<{
    root: string
    userDataPath: string
    hostApiVersion: string
    dshRuntimeVersion?: string
    adapterContracts?: ReadonlyMap<string, PluginAdapterContract>
    allowedPermissionIds?: ReadonlySet<string>
    /**
     * Host-vendored dependencies for installed plugins. The SDK resolves these
     * bare specifiers from this deployment instead of the plugin directory, so
     * an installed plugin can use a native addon the host provides without
     * carrying it in the artifact.
     */
    pluginRuntimeDeps?: Readonly<{ packages: readonly string[]; baseUrl: string }>
    /**
     * Explicit, host-approved environment for the plugin child process; an
     * allowlist, never ambient forwarding.
     */
    pluginRuntimeEnv?: Readonly<Record<string, string>>
    /**
     * Child-local ordinary Agent resolver for plugin tool calls. The runner
     * refuses to invoke a tool when the host has not supplied one, so an installed
     * plugin would be listed but uncallable without it.
     */
    dshAgentResolver?: Readonly<{ path: string }>
    runAgentCommand?: AgentCommandRunner
    portsExecutor?: (execution: Readonly<{ operation: string; input: unknown; workspaceId: string }>) => Promise<unknown>
    hostServiceProviders?: Readonly<Record<string, HostServiceProvider>>
    resolveHostServiceProviders?: (packageName: string, version: string, generation: number) => Readonly<Record<string, HostServiceProvider>> | undefined
    hostServiceIds?: readonly string[]
    hostServiceClients?: ReadonlyMap<string, readonly HostServiceClientFactory[]>
    resolveHostServiceClients?: (packageName: string, version: string, generation: number) => readonly HostServiceClientFactory[]
    invokeTimeoutMs?: number
  }>) {
    if (!isAbsolute(options.root)) throw new Error('Development plugin root must be absolute.')
    if (!isAbsolute(options.userDataPath)) throw new Error('Development user profile root must be absolute.')
    this.#root = resolve(options.root)
    const userDataPath = resolve(options.userDataPath)
    this.#statePath = join(userDataPath, 'extensions', 'development-external-state.json')
    this.#versionRoot = join(userDataPath, 'extensions', 'plugin-versions')
    this.#candidateRoot = join(userDataPath, 'extensions', 'plugin-candidates')
    this.#versionStore = new PluginVersionStore(this.#versionRoot)
    this.#hostApiVersion = options.hostApiVersion
    this.#dshRuntimeVersion = options.dshRuntimeVersion
    this.#devAdapterContracts = options.adapterContracts
    this.#allowedPermissionIds = options.allowedPermissionIds ?? new Set()
    this.#runAgentCommand = options.runAgentCommand ?? defaultAgentCommandRunner
    this.#portsExecutor = options.portsExecutor
    this.#hostServiceClients = options.hostServiceClients ?? new Map()
    this.#resolveHostServiceClients = options.resolveHostServiceClients
    this.#hostServices = options.hostServiceProviders ? new HostServiceProviderRegistry(options.hostServiceProviders) : undefined
    this.#hostServiceIds = Object.freeze(options.hostServiceIds ?? this.#hostServices?.serviceIds ?? [])
    this.#extensionHost = new ProcessExtensionHost({ invokeTimeoutMs: options.invokeTimeoutMs ?? HOST_BUSINESS_INVOKE_TIMEOUT_MS, hostServices: this.#hostServices, resolveHostServices: options.resolveHostServiceProviders
      ? (packageName, version, generation) => {
          const providers = options.resolveHostServiceProviders!(packageName, version, generation)
          return providers ? new HostServiceProviderRegistry(providers) : undefined
        }
      : undefined, onCapabilitiesChanged: (runtime: ProcessExtensionRuntime) => {
      const packageName = runtime.snapshot.packageName
      void this.#queueCapabilitySync(async () => {
        if (!this.#enabled.has(packageName) || this.#extensionHost.runtime(packageName) !== runtime) return
        const plugin = this.#host.plugins.find((item) => item.manifest.name === packageName)
        if (plugin) {
          const published = this.#contributions.list(packageName).filter((item) => item.kind === 'capability')
          const publicationGeneration = this.#publicationTransactions.get(packageName)
          // A generation switch is published by the coordinator's afterCommit hook,
          // where registration failure must roll back rather than be swallowed.
          if (publicationGeneration === runtime.snapshot.generation || published.some((item) => item.generation !== runtime.snapshot.generation)) return
          await this.#reconcileCapabilities(plugin, runtime)
        }
      }).catch((error) => { this.#markContribution(packageName, false, error) })
    }, resolveServiceClients: (packageName, version, generation) => this.#serviceClientsFor(packageName, version, generation), resolveDshToolGrants: (packageName, version) => {
      const contract = this.#contract(packageName, version)
      const authorization = contract?.dshAuthorization
      if (contract?.approved !== true || authorization?.packageName !== packageName ||
        authorization.packageVersion !== version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion) return {}
      return authorization.tools ?? {}
    }, resolveDshStorage: (packageName, version) => {
      const contract = this.#contract(packageName, version)
      const authorization = contract?.dshAuthorization
      if (contract?.approved !== true || authorization?.packageName !== packageName ||
        authorization.packageVersion !== version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion ||
        authorization.storage !== 'plugin-private') return undefined
      return { profileRoot: resolve(options.userDataPath), packageName }
    }, resolveDshConfig: (packageName) => this.#dshConfigs.get(packageName) ?? {},
      pluginRuntimeDeps: options.pluginRuntimeDeps,
      pluginRuntimeEnv: options.pluginRuntimeEnv,
      dshAgentResolver: options.dshAgentResolver })
    this.#updateCoordinator = new PluginUpdateCoordinator(this.#versionStore, this.#extensionHost,
      ({ packageName, version }) => ({
        onPortsRequest: (request, boundWorkspace) => this.#authorizeHostPort(packageName, version, request, boundWorkspace),
        onPortsCancel: async () => undefined
      }))
    // The host keeps this exact object and re-reads `adapterContracts` from it on
    // every discovery, so a contract registered at install time becomes visible
    // without rebuilding the host.
    const hostOptions = {
      root: this.#root,
      hostApiVersion: options.hostApiVersion,
      dshRuntimeVersion: options.dshRuntimeVersion,
      adapterContracts: this.#adapterContractMap(),
      allowedPermissionIds: options.allowedPermissionIds,
      resolvePluginDirectory: async (packageName: string, directory: string) => (await this.#versionStore.active(packageName))?.directory ?? directory,
      createLifecycleHooks: (plugin: DiscoveredPlugin) => this.#hooks(plugin)
    }
    this.#hostOptions = hostOptions
    this.#host = new PluginHost(hostOptions)
  }

  async initialize(): Promise<void> {
    await this.#loadState()
    // Establish installed identities through public discovery before executing any
    // restart candidate. A persisted pointer does not resurrect an uninstalled package.
    const installed = await discoverPlugins(this.#root, {
      root: this.#root, hostApiVersion: this.#hostApiVersion,
      dshRuntimeVersion: this.#dshRuntimeVersion, adapterContracts: this.#adapterContractMap(),
      allowedPermissionIds: this.#allowedPermissionIds
    })
    // Resolve pending candidates first so discovery, lifecycle and summaries inspect the
    // same canonical active version, not the original installation directory.
    for (const [packageName, pending] of this.#pendingRestart) {
      if (!this.#enabled.has(packageName)) continue
      const previousPointer = await this.#versionStore.active(packageName)
      try {
        if (!installed.some((plugin) => plugin.manifest.name === packageName)) throw new Error(`Pending restart installation not found or invalid: ${packageName}`)
        await this.#assertCandidateIdentity(packageName, pending.stagedDirectory)
        await this.#assertStagedIntegrity({ directory: pending.stagedDirectory, version: pending.version, integrity: pending.integrity })
        await this.#updateCoordinator.stageAndActivate(pending.stagedDirectory)
        if (previousPointer) this.#previousActive.set(packageName, previousPointer)
        this.#contributionRegistration.delete(packageName)
      } catch (error) {
        await this.#extensionHost.rollbackPrepared(packageName).catch(() => undefined)
        if (previousPointer) await this.#versionStore.restore(packageName, previousPointer).catch(() => undefined)
        this.#markContribution(packageName, false, error)
      }
      this.#pendingRestart.delete(packageName)
      await this.#persistState()
    }
    const plugins = await this.#host.discover()
    for (const plugin of plugins) {
      const packageName = plugin.manifest.name
      if (!this.#enabled.has(packageName)) continue
      if (!plugin.compatibility.compatible || !plugin.permissions.allowed) continue
      try {
        await this.#host.registry.activate(packageName)
        if (!await this.#versionStore.active(packageName)) await this.#recordInitialVersion(plugin)
      } catch {
        // Failed lifecycle state is retained and projected to the UI.
      }
    }
  }

  has(packageName: string): boolean {
    return this.#host.plugins.some((plugin) => plugin.manifest.name === packageName)
  }

  inventoryAdmission(input: Readonly<{ pluginId: string; contributionId: string; generation: number; version: string }>): Readonly<{
    caller: string; packageName: string; version: string; generation: number; lease: object; signal: AbortSignal
  }> | undefined {
    const plugin = this.#host.plugins.find(({ manifest }) => manifest.name === input.pluginId)
    const runtime = this.#extensionHost.runtime(input.pluginId)
    const contribution = this.#rendererContributions.list(input.pluginId).find(({ id }) => id === input.contributionId)
    if (!plugin || !runtime || !contribution || !this.#enabled.has(input.pluginId) ||
      runtime.snapshot.state !== 'active' || runtime.snapshot.generation !== input.generation ||
      runtime.snapshot.version !== input.version) return undefined
    const lease = Object.defineProperty({}, 'current', {
      enumerable: true,
      get: () => this.#enabled.has(input.pluginId) && this.#extensionHost.runtime(input.pluginId) === runtime &&
        runtime.snapshot.state === 'active' && runtime.snapshot.generation === input.generation && runtime.snapshot.version === input.version
    })
    return { caller: `renderer:${input.pluginId}:${input.contributionId}`, packageName: input.pluginId,
      version: input.version, generation: input.generation, lease, signal: new AbortController().signal }
  }

  async list(): Promise<DomainExtensionSummary[]> {
    return Promise.all(this.#host.plugins.map((plugin) => this.#summary(plugin)))
  }

  rendererContributions() { return this.#rendererContributions.list() }
  /** Renderer-safe descriptors for the active version. The UI entry is validated during discovery. */
  async rendererContributionDescriptors(): Promise<DomainExtensionRendererContribution[]> {
    const descriptors: DomainExtensionRendererContribution[] = []
    for (const plugin of this.#host.plugins) {
      if (plugin.adapter?.kind !== 'renderer' || !this.#enabled.has(plugin.manifest.name)) continue
      const runtime = this.#extensionHost.runtime(plugin.manifest.name)
      if (!runtime || runtime.snapshot.state !== 'active' || !plugin.layout.rendererEntry) continue
      const active = await this.#versionStore.active(plugin.manifest.name)
      const directory = active?.directory ?? plugin.directory
      const entryPath = resolve(directory, plugin.layout.rendererEntry)
      const escaped = relative(directory, entryPath)
      if (escaped.startsWith(`..${sep}`) || escaped === '..' || isAbsolute(escaped)) continue
      for (const contribution of this.#rendererContributions.list(plugin.manifest.name)) {
        descriptors.push({
          pluginId: plugin.manifest.name,
          contributionId: contribution.id,
          kind: contribution.kind,
          title: contribution.title,
          generation: runtime.snapshot.generation,
          version: runtime.snapshot.version,
          entryUrl: developmentPluginUiUrl({ pluginId: plugin.manifest.name, generation: runtime.snapshot.generation, path: plugin.layout.rendererEntry }),
          stateVersion: plugin.adapter.ui?.stateVersion ?? 1
        })
      }
    }
    return descriptors
  }

  /** Resolve public UI assets through the same active-version owner as the iframe descriptor. */
  async rendererAssetPath(asset: DevelopmentPluginUiAsset): Promise<string | undefined> {
    const plugin = this.#host.plugins.find(({ manifest }) => manifest.name === asset.pluginId)
    const runtime = this.#extensionHost.runtime(asset.pluginId)
    if (!plugin || plugin.adapter?.kind !== 'renderer' || !plugin.layout.rendererEntry ||
      !this.#enabled.has(asset.pluginId) || runtime?.snapshot.state !== 'active' ||
      runtime.snapshot.generation !== asset.generation || isAbsolute(asset.path)) return undefined
    try {
      const active = await this.#versionStore.active(asset.pluginId)
      const directory = active?.directory ?? plugin.directory
      const [root, uiRoot, file] = await Promise.all([
        realpath(directory), realpath(resolve(directory, dirname(plugin.layout.rendererEntry))),
        realpath(resolve(directory, asset.path))
      ])
      const inside = (base: string, target: string): boolean => {
        const path = relative(base, target)
        return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
      }
      if (!inside(root, uiRoot) || !inside(uiRoot, file) || !(await stat(file)).isFile()) return undefined
      // An update or disable may have completed while the filesystem was being read.
      if (!this.#enabled.has(asset.pluginId) || this.#extensionHost.runtime(asset.pluginId) !== runtime ||
        runtime.snapshot.state !== 'active') return undefined
      return file
    } catch {
      return undefined
    }
  }
  managedRuntimeContributions() { return this.#managedRuntimes.list() }
  workflowContributions() { return this.#workflowContributions.list() }

  async setEnabled(packageName: string, enabled: boolean): Promise<DomainExtensionSummary> {
    const plugin = this.#findPlugin(packageName)
    if (!plugin.compatibility.compatible) throw new Error(plugin.compatibility.reason)
    if (!plugin.permissions.allowed) throw new Error(plugin.permissions.reason)

    if (enabled) {
      // Activation failure is terminal for the lifecycle instance. Retire it
      // before retrying; otherwise activate() resolves a failed snapshot without
      // restarting the child or reacquiring any publication owners.
      if (this.#host.registry.get(packageName)?.snapshot.state === 'failed') await this.#host.registry.dispose(packageName)
      if (this.#host.registry.remove(packageName)) await this.#host.discover()
      this.#enabled.add(packageName)
      await this.#persistState()
      await this.#host.registry.activate(packageName)
      await this.#recordInitialVersion(plugin)
    } else {
      this.#enabled.delete(packageName)
      await this.#host.registry.deactivate(packageName)
      await this.#host.registry.dispose(packageName)
      await this.#persistState()
    }
    return await this.#summary(plugin)
  }

  /**
   * Host-side configuration. Cordis validates Config at activation; changes require
   * a stopped plugin. A persistence failure rejects but retains the validated
   * desired config in memory; a subsequent save retries it, without rollback.
   */
  async setDshConfig(packageName: string, config: Readonly<Record<string, unknown>>): Promise<void> {
    this.#findPlugin(packageName)
    if (this.#enabled.has(packageName) || this.#extensionHost.runtime(packageName) || this.#extensionHost.pending(packageName)) {
      throw new Error('Stop the plugin before changing its DSH configuration.')
    }
    const value = z.record(z.string(), z.json()).parse(config)
    this.#dshConfigs.set(packageName, value)
    await this.#persistState()
  }

  async dispose(): Promise<void> {
    await Promise.all(this.#host.registry.snapshots().map(({ packageName }) =>
      this.#host.registry.dispose(packageName).catch(() => undefined)
    ))
    await this.#extensionHost.disposeAll()
    if (this.#agentCapabilityRegistry) {
      for (const id of DEVELOPMENT_PLUGIN_AGENT_CAPABILITY_IDS) {
        this.#agentCapabilityRegistry.unregister(id)
      }
      this.#agentCapabilityRegistry = undefined
    }
  }

  /** Attach the host broker after application composition is created. */
  async attachCapabilityRegistry(registry: CapabilityRegistry): Promise<void> {
    this.#capabilityRegistry = registry
    this.#agentCapabilityRegistry = registry
    await Promise.all(
      this.#host.plugins
        .filter((plugin) => this.#enabled.has(plugin.manifest.name) && plugin.compatibility.compatible && plugin.permissions.allowed)
        .map(async (plugin) => {
          await this.#publishInitialRuntime(plugin)
        }),
    )
    this.#registerAgentDevelopmentCapabilities(registry)
  }

  /**
   * Attaches the Host's workspace-preview sink and flushes every package's
   * buffered contribution set. Sync failures mark that package's contribution
   * failed (fail-closed) without breaking other packages.
   */
  setWorkspacePreviewSink(sink: WorkspacePreviewPluginSink): void {
    this.#workspacePreviewSink = sink
    for (const [packageName, inputs] of this.#workspacePreviewSyncState) {
      try {
        sink.sync(packageName, inputs)
      } catch (error) {
        this.#markContribution(packageName, false, error)
      }
    }
  }

  #syncWorkspacePreviewPlugins(packageName: string, inputs: readonly WorkspacePreviewPluginRegistrationInput[]): void {
    this.#workspacePreviewSyncState.set(packageName, [...inputs])
    this.#workspacePreviewSink?.sync(packageName, inputs)
  }

  #hooks(plugin: DiscoveredPlugin): PluginLifecycleHooks {
    const packageName = plugin.manifest.name
    return {
      activate: async () => {
        await this.#publishInitialRuntime(plugin)
      },
      deactivate: async () => {
        await this.#unregisterCapabilities(packageName)
        this.#rendererContributions.unregisterPlugin(packageName)
        this.#managedRuntimes.unregisterPlugin(packageName)
        this.#workflowContributions.unregisterPlugin(packageName)
        await this.#extensionHost.runtime(packageName)?.deactivate()
      },
      unregister: async () => {
        await this.#unregisterCapabilities(packageName)
        this.#rendererContributions.unregisterPlugin(packageName)
        this.#managedRuntimes.unregisterPlugin(packageName)
        this.#workflowContributions.unregisterPlugin(packageName)
        await this.#extensionHost.runtime(packageName)?.unregister()
      },
      dispose: async () => {
        await this.#unregisterCapabilities(packageName)
        await this.#extensionHost.dispose(packageName)
      }
    }
  }

  /**
   * Hot-update MVP (BUG-026): swap a running plugin to a candidate version
   * WITHOUT restarting the SciForge main process. Only idle / safely-drainable
   * plugins (capability-type, e.g. P1) are replaced live. Workflow /
   * managed-runtime plugins are only staged and flagged restart-required
   * (their in-flight tasks must not be migrated). On candidate activation
   * failure the previous version is kept and the plugin reverts to `invalid`
   * with a diagnostic. No Agent context, model stream, mailbox or multi-agent
   * state migration is performed.
   */
  async replacePlugin(packageName: string, sourceDirectory: string): Promise<DomainExtensionSummary> {
    const plugin = this.#findPlugin(packageName)
    if (!this.#enabled.has(packageName) || this.#host.registry.get(packageName)?.snapshot?.state !== 'active') {
      throw new Error(`Plugin ${packageName} is not enabled and active; cannot hot-replace.`)
    }
    await this.#assertCandidateIdentity(packageName, sourceDirectory)
    await this.#assertCandidateVersionChanged(packageName, sourceDirectory)
    const staged = await this.#versionStore.stage(sourceDirectory)
    if (!await this.#versionStore.verify(staged)) {
      throw new Error(`Plugin ${packageName} candidate version integrity verification failed.`)
    }
    return this.#applyStaged(packageName, staged)
  }

  /** Candidate identity + safety validation: local built dir, name matches, entry present + no escape, Host API compatible. */
  async #assertCandidateIdentity(packageName: string, sourceDirectory: string): Promise<void> {
    const requestedDirectory = resolve(sourceDirectory)
    const directory = await realpath(requestedDirectory).catch(() => {
      throw new Error(`Candidate directory not found: ${sourceDirectory}`)
    })
    const directoryStat = await stat(directory)
    if (!directoryStat.isDirectory()) {
      throw new Error(`Candidate path is not a directory: ${sourceDirectory}`)
    }
    const [managedRoot, versionRoot, candidateRoot] = await Promise.all([
      realpath(this.#root),
      realpath(this.#versionRoot).catch(() => resolve(this.#versionRoot)),
      realpath(this.#candidateRoot).catch(() => resolve(this.#candidateRoot))
    ])
    const insideManagedRoot = (root: string): boolean => {
      const escaped = relative(root, directory)
      return escaped === '' || (!escaped.startsWith(`..${sep}`) && escaped !== '..' && !isAbsolute(escaped))
    }
    if (!insideManagedRoot(managedRoot) && !insideManagedRoot(versionRoot) && !insideManagedRoot(candidateRoot)) {
      throw new Error('Candidate directory must be inside the configured development plugin root.')
    }
    const validated = await validatePluginDirectory(directory, {
      root: this.#root,
      hostApiVersion: this.#hostApiVersion,
      dshRuntimeVersion: this.#dshRuntimeVersion,
      adapterContracts: this.#adapterContractMap(),
      allowedPermissionIds: this.#allowedPermissionIds
    }, packageName)
    const { manifest, compatibility, permissions } = validated
    if (!compatibility.compatible) throw new Error(`Candidate Host API incompatible: ${compatibility.reason}`)
    if (!permissions.allowed) throw new Error(`Candidate permission not approved: ${permissions.reason ?? 'Adapter permissions require host approval.'}`)
    const entry = manifestMainEntry(manifest)
    if (!entry) {
      throw new Error(`Candidate "${manifest.name}" has no DSH main entrypoint.`)
    }
  }

  /** A persisted candidate is accepted only when its staged bytes still match the checked digest. */
  async #assertStagedIntegrity(staged: { directory: string; version: string; integrity: string }): Promise<void> {
    const restaged = await this.#versionStore.stage(staged.directory)
    if (restaged.version !== staged.version || restaged.integrity !== staged.integrity) {
      throw new Error(`Plugin ${restaged.packageName} candidate integrity changed after it was checked.`)
    }
  }

  /** Host-controlled candidate check: stage + verify, do NOT apply yet. */
  async checkCandidate(packageName: string, sourceDirectory: string): Promise<DomainExtensionSummary> {
    const plugin = this.#findPlugin(packageName)
    if (!this.#enabled.has(packageName) || this.#host.registry.get(packageName)?.snapshot?.state !== 'active') {
      throw new Error(`Plugin ${packageName} is not enabled and active; cannot check a candidate.`)
    }
    await this.#assertCandidateIdentity(packageName, sourceDirectory)
    await this.#assertCandidateVersionChanged(packageName, sourceDirectory)
    const staged = await this.#versionStore.stage(sourceDirectory)
    if (!await this.#versionStore.verify(staged)) {
      throw new Error(`Plugin ${packageName} candidate version integrity verification failed.`)
    }
    this.#candidates.set(packageName, { version: staged.version, stagedDirectory: staged.directory, integrity: staged.integrity })
    await this.#persistState()
    return await this.#summary(plugin)
  }

  /** Create an Agent-owned source workspace copied from the currently active version. */
  async prepareAgentCandidate(packageName: string): Promise<DevelopmentPluginAgentCandidateSummary> {
    const plugin = this.#findPlugin(packageName)
    const active = await this.#versionStore.active(packageName)
    const sourceDirectory = active?.directory ?? plugin.directory
    await this.#assertCandidateIdentity(packageName, sourceDirectory)
    const candidateId = randomUUID()
    const workspaceDirectory = join(this.#candidateRoot, candidateId, 'source')
    await mkdir(dirname(workspaceDirectory), { recursive: true })
    await cp(sourceDirectory, workspaceDirectory, { recursive: true, errorOnExist: true })
    await this.#assertCandidateIdentity(packageName, workspaceDirectory)
    const record: AgentCandidateRecord = {
      candidateId,
      packageName,
      workspaceDirectory,
      baseVersion: active?.version ?? plugin.manifest.version,
      state: 'prepared'
    }
    this.#agentCandidates.set(candidateId, record)
    await this.#persistState()
    return await this.#agentCandidateSummary(record)
  }

  /** Check an Agent workspace and freeze an immutable artifact for later submission. */
  async checkAgentCandidate(candidateId: string, signal?: AbortSignal): Promise<DevelopmentPluginAgentCandidateSummary> {
    const record = this.#requireAgentCandidate(candidateId)
    if (record.state === 'submitted' || record.state === 'approval-pending' || record.state === 'applied') {
      return await this.#agentCandidateSummary(record)
    }
    const plugin = this.#findPlugin(record.packageName)
    const commands: DevelopmentPluginAgentCommandResult[] = []
    try {
      await this.#assertCandidateIdentity(record.packageName, record.workspaceDirectory)
      const packageJson = JSON.parse(await readFile(join(record.workspaceDirectory, 'package.json'), 'utf8')) as Record<string, unknown>
      const scripts = packageJson.scripts && typeof packageJson.scripts === 'object'
        ? packageJson.scripts as Record<string, unknown>
        : {}
      for (const script of ['check', 'test', 'build'] as const) {
        if (typeof scripts[script] !== 'string' || !scripts[script].trim()) continue
        const command = `npm run ${script}`
        const result = await this.#runAgentCommand({ cwd: record.workspaceDirectory, script, command, signal })
        commands.push({ command, ok: result.ok, output: boundedAgentOutput(result.output) })
        if (!result.ok) {
          record.state = 'failed'
          record.check = {
            checkId: randomUUID(),
            artifactDirectory: '',
            version: typeof packageJson.version === 'string' ? packageJson.version : '',
            integrity: '',
            checkedAt: new Date().toISOString(),
            passed: false,
            diagnostics: boundedAgentOutput(result.output),
            commands
          }
          await this.#persistState()
          return await this.#agentCandidateSummary(record)
        }
      }
      await this.#assertCandidateIdentity(record.packageName, record.workspaceDirectory)
      const manifest = parsePluginManifest(JSON.parse(await readFile(join(record.workspaceDirectory, 'package.json'), 'utf8')))
      if (manifest.version === record.baseVersion) {
        throw new Error(`Candidate version must change from active ${record.baseVersion}.`)
      }
      const checkId = randomUUID()
      const artifactDirectory = join(this.#candidateRoot, record.candidateId, 'checks', checkId)
      await mkdir(dirname(artifactDirectory), { recursive: true })
      await cp(record.workspaceDirectory, artifactDirectory, { recursive: true, errorOnExist: true })
      const integrity = await pluginDirectoryIntegrity(artifactDirectory)
      const artifactManifest = parsePluginManifest(JSON.parse(await readFile(join(artifactDirectory, 'package.json'), 'utf8')))
      if (artifactManifest.name !== record.packageName || artifactManifest.version !== manifest.version) {
        throw new Error('Candidate artifact identity changed while it was being frozen.')
      }
      record.check = {
        checkId,
        artifactDirectory,
        version: manifest.version,
        integrity,
        checkedAt: new Date().toISOString(),
        passed: true,
        commands
      }
      record.state = 'checked'
    } catch (error) {
      record.state = 'failed'
      record.check = {
        checkId: randomUUID(),
        artifactDirectory: '',
        version: '',
        integrity: '',
        checkedAt: new Date().toISOString(),
        passed: false,
        diagnostics: boundedAgentOutput(error instanceof Error ? error.message : String(error)),
        commands
      }
    }
    await this.#persistState()
    return await this.#agentCandidateSummary(record, plugin)
  }

  /** Submit exactly the frozen check artifact to the existing host candidate path. */
  async submitAgentCandidate(candidateId: string): Promise<DevelopmentPluginAgentCandidateSummary> {
    const record = this.#requireAgentCandidate(candidateId)
    if (record.state !== 'checked' || !record.check?.passed) {
      throw new Error(`Candidate ${candidateId} must pass check before it can be submitted.`)
    }
    await this.#assertFrozenAgentArtifact(record)
    await this.checkCandidate(record.packageName, record.check.artifactDirectory)
    record.state = 'submitted'
    await this.#persistState()
    return await this.#agentCandidateSummary(record)
  }

  /** Create a user-facing application request without changing the running plugin. */
  async requestAgentUpdate(candidateId: string): Promise<DevelopmentPluginAgentCandidateSummary> {
    const record = this.#requireAgentCandidate(candidateId)
    if (record.state !== 'submitted' || !record.check?.passed) {
      throw new Error(`Candidate ${candidateId} must be submitted before requesting an update.`)
    }
    await this.#assertFrozenAgentArtifact(record)
    record.updateRequest = {
      requestId: randomUUID(),
      status: 'pending',
      requestedAt: new Date().toISOString()
    }
    record.state = 'approval-pending'
    await this.#persistState()
    return await this.#agentCandidateSummary(record)
  }

  async agentUpdateStatus(candidateId: string): Promise<DevelopmentPluginAgentCandidateSummary> {
    return await this.#agentCandidateSummary(this.#requireAgentCandidate(candidateId))
  }

  /** Backward-friendly aliases for host-side tests and integrations. */
  prepareCandidate(packageName: string) { return this.prepareAgentCandidate(packageName) }
  checkAgentCandidateVersion(candidateId: string) { return this.checkAgentCandidate(candidateId) }
  submitCandidate(candidateId: string) { return this.submitAgentCandidate(candidateId) }
  requestUpdate(candidateId: string) { return this.requestAgentUpdate(candidateId) }

  /** Host-controlled apply: use a checked candidate; P1 hot-swaps, P2/P3/P4 stay restart-required. */
  async applyCandidate(packageName: string): Promise<DomainExtensionSummary> {
    const candidate = this.#candidates.get(packageName)
    if (!candidate) throw new Error(`No checked candidate for ${packageName}; call checkCandidate first.`)
    if (!this.#enabled.has(packageName) || this.#host.registry.get(packageName)?.snapshot?.state !== 'active') {
      throw new Error(`Plugin ${packageName} is not enabled and active; cannot apply a candidate.`)
    }
    try {
      await this.#applyStaged(packageName, { directory: candidate.stagedDirectory, version: candidate.version, integrity: candidate.integrity })
    } catch (error) {
      const diagnostic = boundedAgentOutput(error instanceof Error ? error.message : String(error))
      for (const record of this.#agentCandidates.values()) {
        if (record.packageName !== packageName || record.state !== 'approval-pending' || !record.updateRequest) continue
        if (record.check?.version !== candidate.version || record.check.integrity !== candidate.integrity) continue
        record.state = 'failed'
        record.updateRequest.status = 'failed'
        record.updateRequest.diagnostic = diagnostic
      }
      await this.#persistState()
      throw error
    }
    this.#candidates.delete(packageName)
    for (const record of this.#agentCandidates.values()) {
      if (record.packageName !== packageName || record.state !== 'approval-pending' || !record.updateRequest) continue
      if (record.check?.version !== candidate.version || record.check.integrity !== candidate.integrity) continue
      record.state = 'applied'
      record.updateRequest.status = 'applied'
    }
    await this.#persistState()
    return await this.#summary(this.#findPlugin(packageName))
  }

  /** Host-controlled cancel of a checked candidate / pending restart. */
  async cancelCandidate(packageName: string): Promise<DomainExtensionSummary> {
    this.#candidates.delete(packageName)
    this.#pendingRestart.delete(packageName)
    for (const record of this.#agentCandidates.values()) {
      if (record.packageName !== packageName || record.state === 'applied') continue
      record.state = 'cancelled'
      if (record.updateRequest) record.updateRequest.status = 'cancelled'
    }
    await this.#persistState()
    return await this.#summary(this.#findPlugin(packageName))
  }

  /**
   * Registers the host-owned approval contract for one exact installed DSH
   * plugin version. The contract is host policy, never artifact input: an
   * artifact cannot approve itself, and the caller must already have verified
   * the artifact's digests and decided the tool grants.
   */
  async registerInstalledContract(contract: PluginAdapterContract): Promise<void> {
    const authorization = contract.dshAuthorization
    if (!authorization) {
      throw new Error('An installed plugin contract must carry a DSH authorization.')
    }
    if (contract.approved !== true) {
      throw new Error(`Installed plugin contract for ${authorization.packageName} must be explicitly approved.`)
    }
    if (this.#dshRuntimeVersion !== undefined && authorization.dshRuntimeVersion !== this.#dshRuntimeVersion) {
      throw new Error(
        `Installed plugin contract for ${authorization.packageName}@${authorization.packageVersion} ` +
        `targets DSH runtime ${authorization.dshRuntimeVersion}; this host runs ${this.#dshRuntimeVersion}.`
      )
    }
    this.#installedAdapterContracts.set(
      `${authorization.packageName}@${authorization.packageVersion}`,
      Object.freeze(contract)
    )
    this.#refreshHostAdapterContracts()
  }

  /**
   * Installs and activates a plugin directory that already lives under the
   * discovery root. Discovery, approval, activation and version recording all
   * run through the existing canonical paths; nothing here bypasses policy.
   */
  async installFromDirectory(
    sourceDirectory: string,
    contract: PluginAdapterContract
  ): Promise<DomainExtensionSummary> {
    const absolute = resolve(sourceDirectory)
    const relativeToRoot = relative(this.#root, absolute)
    if (!relativeToRoot || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
      throw new Error(`Installed plugin directory must live under the plugin root: ${absolute}`)
    }
    await this.registerInstalledContract(contract)
    await this.#host.discover()
    const packageName = contract.dshAuthorization!.packageName
    const plugin = this.#host.plugins.find((candidate) => candidate.manifest.name === packageName)
    if (!plugin) {
      throw new Error(`Installed plugin ${packageName} was not discovered under ${this.#root}.`)
    }
    return await this.setEnabled(packageName, true)
  }

  /**
   * Removes every installed version of a plugin and stops loading it. The
   * caller removes the plugin directory itself; this method owns the version
   * store, the runtime and the approval contract.
   */
  async uninstall(packageName: string): Promise<void> {
    const plugin = this.#host.plugins.find((candidate) => candidate.manifest.name === packageName)
    if (!plugin) throw new Error(`Installed plugin ${packageName} was not found.`)
    if (this.#enabled.has(packageName)) await this.setEnabled(packageName, false)
    this.#host.registry.remove(packageName)
    // The store refuses to remove the active version, so drop the pointer first:
    // the runtime is already deactivated above, and the directory is removed by
    // the caller once the store no longer claims a running version.
    const versions = await this.#versionStore.versions(packageName)
    await this.#versionStore.clearActive(packageName)
    for (const version of versions) {
      await this.#versionStore.removeVersion(packageName, version)
    }
    this.#enabled.delete(packageName)
    for (const key of [...this.#installedAdapterContracts.keys()]) {
      if (key === packageName || key.startsWith(`${packageName}@`)) this.#installedAdapterContracts.delete(key)
    }
    this.#refreshHostAdapterContracts()
    this.#pendingRestart.delete(packageName)
    this.#candidates.delete(packageName)
    this.#previousActive.delete(packageName)
    this.#contributionRegistration.delete(packageName)
    await this.#persistState()
    await this.#host.discover()
  }

  /**
   * Re-runs discovery over the plugin root. The owner of the directory (the
   * installer, or the extensions surface) calls this after adding or removing a
   * plugin directory, so the listing reflects the file system again.
   */
  async refreshDiscoveredPlugins(): Promise<void> {
    await this.#host.discover()
  }

  #contract(packageName: string, version: string): PluginAdapterContract | undefined {
    return resolvePluginAdapterContract(this.#installedAdapterContracts, packageName, version) ??
      resolvePluginAdapterContract(this.#devAdapterContracts, packageName, version)
  }

  /**
   * What the SDK sees: with nothing installed this is the development value
   * unchanged (including `undefined`, which the SDK treats differently from an
   * empty map); once a market install exists it is a merged view, installed
   * winning for its own exact version.
   */
  #adapterContractMap(): ReadonlyMap<string, PluginAdapterContract> | undefined {
    if (this.#installedAdapterContracts.size === 0) return this.#devAdapterContracts
    return new Map<string, PluginAdapterContract>([
      ...(this.#devAdapterContracts ?? []),
      ...this.#installedAdapterContracts
    ])
  }

  /** Re-points the host at the current contract view; call after any change. */
  #refreshHostAdapterContracts(): void {
    this.#hostOptions.adapterContracts = this.#adapterContractMap()
  }

  /** Called by the host after changing its version-bound approval map. Not plugin IPC. */
  async reconcileDshAuthorization(packageName: string): Promise<DomainExtensionSummary> {
    const plugin = this.#findPlugin(packageName)
    const runtime = this.#extensionHost.runtime(packageName)
    let revoked = false
    try {
      const effective = await this.#entryFor(plugin)
      await this.#assertCandidateIdentity(packageName, effective.directory)
      if (runtime?.snapshot.privateStorage) {
        const authorization = this.#contract(packageName, runtime.snapshot.version)?.dshAuthorization
        revoked = authorization?.storage !== 'plugin-private' || authorization.packageVersion !== runtime.snapshot.version
      }
    } catch { revoked = true }
    if (revoked) return this.setEnabled(packageName, false)
    return this.#summary(plugin)
  }

  async updateStatus(packageName: string): Promise<DomainExtensionSummary> {
    return await this.#summary(this.#findPlugin(packageName))
  }

  #registerAgentDevelopmentCapabilities(registry: CapabilityRegistry): void {
    const candidateInput = z.object({ candidateId: z.string().uuid() }).strict()
    const candidateOutput = z.object({
      candidateId: z.string().uuid(),
      packageName: z.string(),
      workspaceDirectory: z.string(),
      baseVersion: z.string(),
      state: z.enum(['prepared', 'checked', 'submitted', 'approval-pending', 'applied', 'failed', 'cancelled']),
      check: z.record(z.string(), z.unknown()).optional(),
      updateRequest: z.record(z.string(), z.unknown()).optional(),
      plugin: z.record(z.string(), z.unknown())
    }).passthrough()
    const register = (definition: Parameters<CapabilityRegistry['register']>[0]): void => {
      if (!registry.has(definition.descriptor.id)) registry.register(definition)
    }
    const requireAgent = (context: CapabilityHandlerContext): void => {
      if (context.caller.audience !== 'agent') throw new Error('Plugin development tools are Agent-only.')
    }
    const descriptor = (id: DevelopmentPluginAgentCapabilityId, title: string, description: string, effect: 'read' | 'compute' | 'workspace-write', approval: 'none' | 'confirmation', concurrency: { revision: 'none'; idempotency: 'none' | 'required' }) => ({
      id,
      version: '1.0.0',
      title,
      description,
      audiences: ['agent' as const],
      scope: 'global' as const,
      effect,
      approval,
      concurrency,
      tags: ['plugin', 'development', 'hotplug']
    })
    register(defineCapability({
      ...descriptor('plugin.dev.prepare', 'Prepare plugin candidate', 'Create an isolated mutable source workspace copied from the active local plugin version.', 'workspace-write', 'none', { revision: 'none', idempotency: 'required' }),
      inputSchema: z.object({ packageName: z.string().min(1).max(192) }).strict(),
      outputSchema: candidateOutput,
      handler: async (input, context) => { requireAgent(context); return { output: await this.prepareAgentCandidate(input.packageName), changed: true } }
    }))
    register(defineCapability({
      ...descriptor('plugin.dev.check', 'Check plugin candidate', 'Run the candidate check, test, and build scripts in a bounded environment and freeze the resulting artifact.', 'compute', 'none', { revision: 'none', idempotency: 'required' }),
      inputSchema: candidateInput,
      outputSchema: candidateOutput,
      handler: async (input, context) => { requireAgent(context); return { output: await this.checkAgentCandidate(input.candidateId, context.signal), changed: true } }
    }))
    register(defineCapability({
      ...descriptor('plugin.dev.submit', 'Submit checked plugin candidate', 'Bind a passed check to its immutable artifact and expose it as a host candidate without applying it.', 'workspace-write', 'none', { revision: 'none', idempotency: 'required' }),
      inputSchema: candidateInput,
      outputSchema: candidateOutput,
      handler: async (input, context) => { requireAgent(context); return { output: await this.submitAgentCandidate(input.candidateId), changed: true } }
    }))
    register(defineCapability({
      ...descriptor('plugin.update.request', 'Request plugin update approval', 'Ask the user to approve applying the exact checked plugin artifact; this operation never changes the running plugin itself.', 'workspace-write', 'confirmation', { revision: 'none', idempotency: 'required' }),
      inputSchema: candidateInput,
      outputSchema: candidateOutput,
      handler: async (input, context) => { requireAgent(context); return { output: await this.requestAgentUpdate(input.candidateId), changed: true } }
    }))
    register(defineCapability({
      ...descriptor('plugin.update.status', 'Read plugin update status', 'Read the bounded state, check result, approval request, and host summary for an Agent candidate.', 'read', 'none', { revision: 'none', idempotency: 'none' }),
      inputSchema: candidateInput,
      outputSchema: candidateOutput,
      handler: async (input, context) => { requireAgent(context); return { output: await this.agentUpdateStatus(input.candidateId), changed: false } }
    }))
  }

  async #assertCandidateVersionChanged(packageName: string, directory: string): Promise<void> {
    const manifest = parsePluginManifest(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
    const active = await this.#versionStore.active(packageName)
    const version = this.#extensionHost.runtime(packageName)?.snapshot.version ?? active?.version ?? this.#findPlugin(packageName).manifest.version
    if (manifest.version === version) throw new Error(`Candidate version must change from active ${version}.`)
  }

  async #applyStaged(packageName: string, staged: { directory: string; version: string; integrity: string }): Promise<DomainExtensionSummary> {
    await this.#assertCandidateIdentity(packageName, staged.directory)
    await this.#assertCandidateVersionChanged(packageName, staged.directory)
    await this.#assertStagedIntegrity(staged)
    const plugin = this.#findPlugin(packageName)
    if (plugin.adapter?.reloadPolicy === 'restart' && plugin.adapter.kind !== 'renderer') {
      // Not safely drainable live: keep running old, apply on restart.
      this.#pendingRestart.set(packageName, { version: staged.version, stagedDirectory: staged.directory, integrity: staged.integrity })
      await this.#persistState()
      return await this.#summary(plugin)
    }
    // Capability plugin (P1): rollbackable transaction. The candidate is started and health-checked
    // BEFORE the old instance is touched; the old runtime, its broker/typed contributions, generation
    // and active pointer all remain valid until commit succeeds. On failure the candidate is disposed
    // and the old contribution set + pointer are restored.
    const previousPointer = await this.#versionStore.active(packageName)
    let candidateGeneration: number | undefined
    try {
      await this.#updateCoordinator.stageAndActivate(staged.directory, {
        beforeCommit: async () => {
          const candidate = this.#extensionHost.pending(packageName)
          if (!candidate) throw new Error(`Plugin ${packageName} candidate runtime failed to start.`)
          candidateGeneration = candidate.snapshot.generation
          this.#publicationTransactions.set(packageName, candidateGeneration)
          await this.#registerCapabilities(plugin, candidate, true)
        },
        afterCommit: async () => {
          await this.#capabilitySyncTail
          const current = this.#extensionHost.runtime(packageName)
          if (!current) throw new Error('Committed candidate is unavailable.')
          await this.#registerCapabilities(plugin, current)
          await this.#registerTypedContributions(plugin, current)
        },
        afterRollback: async () => {
          // A rejected pre-commit candidate never owned the active snapshot. Only
          // release the candidate generation; do not tear down untouched peers or
          // use rollback as authority to delete/reclaim another current owner.
          if (candidateGeneration !== undefined) await this.#contributions.unregisterPlugin(packageName, candidateGeneration)
          const previousRuntime = this.#extensionHost.runtime(packageName)
          if (previousRuntime?.snapshot.state === 'active') {
            await this.#registerCapabilities(plugin, previousRuntime)
            await this.#registerTypedContributions(plugin, previousRuntime)
          }
        }
      })
      if (previousPointer) this.#previousActive.set(packageName, previousPointer)
      this.#pendingRestart.delete(packageName)
      this.#markContribution(packageName, true, undefined, this.#contributions.list(packageName).length)
    } catch (error) {
      this.#markContribution(packageName, false, error)
      await this.#persistState()
      throw error
    } finally {
      this.#publicationTransactions.delete(packageName)
      // The marker defers notifications through finalizeCommit (or rollback).
      // Always reconcile once after release, using the current runtime and its
      // latest snapshot, not the candidate captured before the transaction.
      // Queue the operation, not #registerCapabilities, to avoid a nested-tail deadlock.
      await this.#queueCapabilitySync(async () => {
        const current = this.#extensionHost.runtime(packageName)
        if (!this.#enabled.has(packageName) || !current) return
        await this.#reconcileCapabilities(plugin, current)
      }).catch((error) => { this.#markContribution(packageName, false, error) })
    }
    await this.#persistState()
    return await this.#summary(plugin)
  }

  /**
   * Rollback a development plugin in its OWN version store / canonical coordinator
   * (never the SignedExtensionStore.rollback path). Only succeeds if a real previous
   * version exists (the original discovered version, or another staged non-active version).
   */
  async rollback(packageName: string): Promise<DomainExtensionSummary> {
    const plugin = this.#findPlugin(packageName)
    if (!this.#enabled.has(packageName)) throw new Error(`Plugin ${packageName} is not enabled; cannot roll back.`)
    const previous = this.#previousActive.get(packageName)
    if (!previous) throw new Error(`No previous version to roll back to for ${packageName}.`)
    this.#pendingRestart.delete(packageName)
    await this.#applyStaged(packageName, previous)
    await this.#persistState()
    return await this.#summary(this.#findPlugin(packageName))
  }

  async #recordInitialVersion(plugin: DiscoveredPlugin): Promise<void> {
    if (await this.#versionStore.active(plugin.manifest.name)) return
    const staged = await this.#versionStore.stage(plugin.directory)
    await this.#versionStore.activate(staged)
  }

  #queueCapabilitySync<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#capabilitySyncTail.then(operation)
    this.#capabilitySyncTail = result.then(() => undefined, () => undefined)
    return result
  }

  #publishInitialRuntime(plugin: DiscoveredPlugin): Promise<void> {
    return this.#queueCapabilitySync(async () => {
      const runtime = await this.#ensureRuntime(plugin)
      try {
        await this.#reconcileCapabilities(plugin, runtime)
        await this.#registerTypedContributions(plugin, runtime)
      } catch (error) {
        // Release only this attempt's generation. Queued notifications cannot
        // republish its partial work after it stops being the current runtime.
        const failures: unknown[] = [error]
        try { await this.#contributions.unregisterPlugin(plugin.manifest.name, runtime.snapshot.generation) }
        catch (cleanupError) { failures.push(cleanupError) }
        if (this.#extensionHost.runtime(plugin.manifest.name) === runtime) {
          try { await this.#extensionHost.dispose(plugin.manifest.name) }
          catch (disposeError) { failures.push(disposeError) }
        }
        if (failures.length > 1) throw new AggregateError(failures, failures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; '))
        throw error
      }
    })
  }

  #registerCapabilities(plugin: DiscoveredPlugin, runtime: ProcessExtensionRuntime | undefined = this.#extensionHost.runtime(plugin.manifest.name), validateOnly = false): Promise<void> {
    return this.#queueCapabilitySync(() => this.#reconcileCapabilities(plugin, runtime, validateOnly))
  }

  #serviceClientsFor(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[] {
    const clients = this.#resolveHostServiceClients?.(packageName, version, generation) ?? this.#hostServiceClients.get(packageName) ?? []
    // Resolve trusted descriptors only; importing/instantiating clients belongs to
    // activation in the runner. A resolver's presence or an empty map entry is not a grant.
    if (!Array.isArray(clients) || !clients.every((client) => client &&
      typeof client.serviceId === 'string' && client.serviceId.length > 0 && client.serviceId === client.serviceId.trim() &&
      typeof client.modulePath === 'string' && isAbsolute(client.modulePath) &&
      typeof client.exportName === 'string' && client.exportName.trim().length > 0 &&
      client.config !== null && typeof client.config === 'object' && !Array.isArray(client.config))) return []
    return clients
  }

  async #reconcileCapabilities(plugin: DiscoveredPlugin, runtime: ProcessExtensionRuntime | undefined, validateOnly = false): Promise<void> {
    if (!this.#capabilityRegistry) return
    if (!runtime) throw new Error(`Plugin ${plugin.manifest.name} runtime is not active.`)
    // A rollback can retain a failed generation solely to retry cleanup. Ownership
    // and cached descriptors do not authorize publishing that generation again.
    if (runtime.snapshot.state !== 'active') {
      if (!validateOnly) await this.#contributions.unregisterPlugin(plugin.manifest.name, runtime.snapshot.generation)
      return
    }
    const definitions = runtime.capabilityDescriptors
    const generation = runtime.snapshot.generation
    const prepared: Array<{remote: (typeof definitions)[number]; definition: CapabilityDefinition}> = []
    const ids = new Set<string>()
    let firstReadDshTool: (typeof definitions)[number] | undefined
    const sessionResourceId = (context: CapabilityHandlerContext) => context.ordinarySession
      ? `dsh-session:${JSON.stringify([plugin.manifest.name, runtime.snapshot.version, generation, context.caller.callerId, context.caller.workspaceId, context.ordinarySession.runtimeId, context.ordinarySession.threadId])}`
      : undefined
    // Resolve once per snapshot, not once per remote descriptor. Do not cache
    // across invocations: the current exact-version composition may be revoked.
    let hasHostServiceClients: boolean | undefined
    const workspaceResourceId = (actionId: string, caller: CapabilityHandlerContext['caller']) =>
      `dsh-workspace:${JSON.stringify([plugin.manifest.name, runtime.snapshot.version, generation, actionId, caller.audience, caller.callerId, caller.workspaceId])}`
    const hasResourceKind = (remote: (typeof definitions)[number], kind: string) => Array.isArray(remote.resourceKinds) && remote.resourceKinds.includes(kind)
    const validReadResource = (grant: { effect: string; readResource?: string }, remote: (typeof definitions)[number]) =>
      grant.readResource === undefined ? !hasResourceKind(remote, 'dsh-workspace') :
        grant.readResource === 'workspace' && grant.effect === 'read' && Array.isArray(remote.resourceKinds) && remote.resourceKinds.length === 1 && remote.resourceKinds[0] === 'dsh-workspace'
    for (const remote of definitions) {
      if (ids.has(remote.id)) throw new Error(`Duplicate capability ID: ${remote.id}`)
      ids.add(remote.id)
      const { runtimeRevision: _revision, ...descriptor } = remote
      capabilityDescriptorSchema.parse(descriptor)
      const inputSchema = z.fromJSONSchema(remote.inputSchema as never)
      const outputSchema = z.fromJSONSchema(remote.outputSchema as never)
      const namedTool = Array.isArray(remote.tags) && remote.tags.includes('dsh-tool')
        ? Object.entries(this.#contract(plugin.manifest.name, runtime.snapshot.version)?.dshAuthorization?.tools ?? {}).find(([name, grant]) => name === remote.title && grant.id === remote.id)?.[0]
        : undefined
      if (Array.isArray(remote.tags) && remote.tags.includes('dsh-tool')) {
        const contract = this.#contract(plugin.manifest.name, runtime.snapshot.version)
        const authorization = contract?.dshAuthorization
        const grant = namedTool !== undefined ? authorization?.tools?.[namedTool] : undefined
        if (contract?.approved !== true || authorization?.packageName !== plugin.manifest.name ||
          authorization.packageVersion !== runtime.snapshot.version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion ||
          !grant || grant.id !== remote.id || grant.effect !== remote.effect || !validReadResource(grant, remote) || (grant.effect !== 'compute' && !(hasHostServiceClients ??= this.#serviceClientsFor(plugin.manifest.name, runtime.snapshot.version, generation).length > 0))) continue
      }
      if (Array.isArray(remote.tags) && remote.tags.includes('dsh-tool') && hasResourceKind(remote, 'dsh-session') && remote.effect === 'read' && firstReadDshTool === undefined) firstReadDshTool = remote
      const { runtimeRevision, ...brokerDescriptor } = remote
      const definition = {
        descriptor: { ...brokerDescriptor,
          inputSchema: z.toJSONSchema(inputSchema, { target: 'draft-07', unrepresentable: 'throw' }),
          outputSchema: z.toJSONSchema(outputSchema, { target: 'draft-07', unrepresentable: 'throw' }) },
        inputSchema,
        outputSchema,
        handler: async (input: unknown, context: CapabilityHandlerContext) => {
          if (Array.isArray(remote.tags) && remote.tags.includes('dsh-tool')) {
            const effective = await this.#entryFor(plugin)
            await this.#assertCandidateIdentity(plugin.manifest.name, effective.directory)
            const contract = this.#contract(plugin.manifest.name, runtime.snapshot.version)
            const authorization = contract?.dshAuthorization
            const grant = namedTool !== undefined ? authorization?.tools?.[namedTool] : undefined
            if (contract?.approved !== true || authorization?.packageName !== plugin.manifest.name ||
              authorization.packageVersion !== runtime.snapshot.version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion ||
              !grant || grant.id !== remote.id || grant.effect !== remote.effect || !validReadResource(grant, remote) || (grant.effect !== 'compute' && this.#serviceClientsFor(plugin.manifest.name, runtime.snapshot.version, generation).length === 0)) {
              throw new Error(`DSH tool ${remote.id} host grant is no longer authorized.`)
            }
          }
          try {
            // Workspace-scoped extension capabilities bind the caller's
            // workspace into the input, mirroring the static adapter path
            // (which always takes context.caller.workspaceId over any client
            // field). Without this binding a workspace-scoped caller could
            // name an arbitrary directory and the plugin child would trust it.
            const callerWorkspace = context.caller?.workspaceId
            if (Array.isArray(remote.tags) && remote.tags.includes('dsh-tool') && remote.scope === 'resource') {
              const workspaceRead = hasResourceKind(remote, 'dsh-workspace')
              const expectedResourceId = workspaceRead ? workspaceResourceId(remote.id, context.caller) : sessionResourceId(context)
              if (!context.resource || context.resource.resourceKind !== (workspaceRead ? 'dsh-workspace' : 'dsh-session') || context.resource.resourceId !== expectedResourceId) {
                throw new Error(`DSH read capability ${remote.id} requires its authenticated dsh-session resource.`)
              }
            }
            if (remote.scope === 'workspace' && !callerWorkspace) {
              throw new Error(`Extension capability ${remote.id} requires a workspace-scoped caller.`)
            }
            const effectiveInput = remote.scope === 'workspace'
              ? { ...(input as Record<string, unknown> | null | undefined), workspaceRoot: callerWorkspace }
              : input
            const hostServices = this.#hostServiceIds.length ? {
              authority: {
                caller: context.caller,
                capabilityId: remote.id,
                effect: remote.effect,
                ...(context.resource && hasResourceKind(remote, 'dsh-workspace') ? { resource: { resourceId: context.resource.resourceId, resourceKind: context.resource.resourceKind } } : {}),
                ...(context.invocationId ? { invocationId: context.invocationId } : {}),
                ...(context.ordinarySession ? { ordinarySession: context.ordinarySession } : {}),
                ...(context.originalContext ? { originalContext: context.originalContext } : {}),
              },
              services: this.#hostServiceIds,
              assertCurrent: context.assertPrincipalCurrent,
            } : undefined
            // The generic service lane retains the actual Host Session facts.
            // It does not invent a DSH native sessionId or child-local Agent.
            return await runtime.invoke(remote.id, effectiveInput, generation, context.signal, runtimeRevision as number | undefined, undefined, hostServices)
          } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'request_cancelled') {
              throw new CapabilityBrokerError('invocation_cancelled', 'Extension invocation was explicitly cancelled.', { cause: error })
            }
            throw error
          }
        }
      } as unknown as CapabilityDefinition
      capabilityDescriptorSchema.parse(definition.descriptor)
      prepared.push({remote, definition})
      if (Array.isArray(remote.tags) && remote.tags.includes('dsh-workspace-read') && remote.effect === 'read' && hasResourceKind(remote, 'dsh-workspace')) {
        const openerId = `${remote.id}.open`
        if (ids.has(openerId) || definitions.some(candidate => candidate.id === openerId)) throw new Error(`Duplicate capability ID: ${openerId}`)
        ids.add(openerId)
        const registrations = new Map<string, Parameters<CapabilityHandlerContext['issueResource']>[0]>()
        const assertReadGrant = async () => {
          const effective = await this.#entryFor(plugin)
          await this.#assertCandidateIdentity(plugin.manifest.name, effective.directory)
          const contract = this.#contract(plugin.manifest.name, runtime.snapshot.version)
          const authorization = contract?.dshAuthorization
          const grant = namedTool ? authorization?.tools?.[namedTool] : undefined
          if (this.#extensionHost.runtime(plugin.manifest.name) !== runtime || runtime.snapshot.state !== 'active' || runtime.snapshot.generation !== generation ||
            contract?.approved !== true || authorization?.packageName !== plugin.manifest.name || authorization.packageVersion !== runtime.snapshot.version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion ||
            !grant || grant.id !== remote.id || grant.effect !== 'read' || !validReadResource(grant, remote) || this.#serviceClientsFor(plugin.manifest.name, runtime.snapshot.version, generation).length === 0 || !this.#capabilityRegistry?.get(remote.id)) throw new Error('DSH workspace read grant is no longer authorized.')
        }
        const openerInput = z.object({}), openerOutput = z.object({ token: z.string(), semanticRevision: z.string(), expiresAt: z.string() })
        const openerRemote = { contractVersion: 3, id: openerId, version: remote.version, title: 'Open authenticated DSH workspace read', description: 'Issue a caller-bound workspace resource for one approved read operation.',
          audiences: remote.audiences, scope: 'workspace', resourceKinds: [], producedResourceKinds: ['dsh-workspace'], effect: 'read', approval: 'none', concurrency: { revision: 'none', idempotency: 'none' },
          inputSchema: z.toJSONSchema(openerInput, { target: 'draft-07', unrepresentable: 'throw' }), outputSchema: z.toJSONSchema(openerOutput, { target: 'draft-07', unrepresentable: 'throw' }), tags: ['dsh-workspace-opener'] }
        const openerDefinition = { descriptor: openerRemote, inputSchema: openerInput, outputSchema: openerOutput,
          handler: async (_input: unknown, context: CapabilityHandlerContext) => {
            if (!context.caller.workspaceId || !context.caller.callerId) throw new Error('Authenticated workspace and caller are required.')
            await assertReadGrant(); context.assertPrincipalCurrent()
            const resourceId = workspaceResourceId(remote.id, context.caller)
            let registration = registrations.get(resourceId)
            if (!registration) {
              const caller = context.caller
              registration = { resourceId, resourceKind: 'dsh-workspace', workspaceId: caller.workspaceId, semanticRevision: String(generation), retireAfterLastHandleExpires: true,
                observe: async observedCaller => {
                  if (observedCaller.callerId !== caller.callerId || observedCaller.audience !== caller.audience || observedCaller.workspaceId !== caller.workspaceId) throw new Error('DSH workspace caller mismatch.')
                  await assertReadGrant()
                  return { state: {}, semanticRevision: String(generation), operationIds: [remote.id] }
                } }
              registrations.set(resourceId, registration)
            }
            return { output: context.issueResource(registration) }
          } } as unknown as CapabilityDefinition
        prepared.push({ remote: openerRemote as (typeof definitions)[number], definition: openerDefinition })
      }
    }
    if (firstReadDshTool !== undefined) {
      // Package identifiers are not capability namespaces (scopes contain @/).
      // Hash unsupported/reserved/long names so scopes remain distinct and bounded.
      const packageName = plugin.manifest.name
      const namespace = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(packageName) && packageName.length <= 175 && !packageName.startsWith('package-')
        ? packageName
        : `package-${createHash('sha256').update(packageName).digest('hex')}`
      const openerId = `${namespace}.dsh-session.open`
      if (ids.has(openerId)) throw new Error(`Duplicate capability ID: ${openerId}`)
      ids.add(openerId)
      const openerInputSchema = z.object({})
      const openerOutputSchema = z.object({ token: z.string(), semanticRevision: z.string(), expiresAt: z.string() })
      const openerRemote = {
        contractVersion: 3, id: openerId, version: firstReadDshTool.version,
        title: 'Open authenticated DSH Session',
        description: 'Open the caller-bound authenticated DSH Session resource for read operations.',
        audiences: ['agent'] as const, scope: 'global' as const, resourceKinds: [] as const,
        producedResourceKinds: ['dsh-session'] as const, effect: 'read' as const, approval: 'none' as const,
        concurrency: { revision: 'none' as const, idempotency: 'none' as const },
        inputSchema: z.toJSONSchema(openerInputSchema, { target: 'draft-07', unrepresentable: 'throw' }),
        outputSchema: z.toJSONSchema(openerOutputSchema, { target: 'draft-07', unrepresentable: 'throw' }), tags: ['dsh-session-opener'] as const
      }
      // Reuse the exact registration for repeated opens; the Broker rejects
      // rebinding a live identity to a newly allocated observer.
      const registrations = new Map<string, Parameters<CapabilityHandlerContext['issueResource']>[0]>()
      const currentReadOperations = async () => {
        const effective = await this.#entryFor(plugin)
        await this.#assertCandidateIdentity(plugin.manifest.name, effective.directory)
        const active = this.#extensionHost.runtime(plugin.manifest.name)
        const contract = this.#contract(plugin.manifest.name, runtime.snapshot.version)
        const authorization = contract?.dshAuthorization
        if (active !== runtime || runtime.snapshot.state !== 'active' || runtime.snapshot.generation !== generation ||
          contract?.approved !== true || authorization?.packageName !== plugin.manifest.name ||
          authorization.packageVersion !== runtime.snapshot.version || authorization.dshRuntimeVersion !== this.#dshRuntimeVersion ||
          this.#serviceClientsFor(plugin.manifest.name, runtime.snapshot.version, generation).length === 0) {
          throw new Error('DSH Session opener host grant is no longer authorized.')
        }
        const operationIds = prepared.filter(({ remote }) => remote.scope === 'resource' && remote.effect === 'read' && hasResourceKind(remote, 'dsh-session') &&
          Array.isArray(remote.tags) && remote.tags.includes('dsh-tool') && this.#capabilityRegistry?.get(remote.id) !== undefined &&
          Object.entries(authorization.tools ?? {}).some(([name, grant]) => name === remote.title && grant.id === remote.id && grant.effect === 'read'))
          .map(({ remote }) => remote.id)
        if (operationIds.length === 0) throw new Error('DSH Session has no currently approved registered read operations.')
        return operationIds
      }
      const openerDefinition = {
        descriptor: openerRemote,
        inputSchema: openerInputSchema,
        outputSchema: openerOutputSchema,
        handler: async (_input: unknown, context: CapabilityHandlerContext) => {
          const session = context.ordinarySession
          const workspaceId = context.caller.workspaceId
          if (!session || !workspaceId || context.caller.audience !== 'agent' || !context.caller.callerId) throw new Error('An authenticated ordinary Session with a workspace and caller is required.')
          await currentReadOperations()
          context.assertPrincipalCurrent()
          const resourceId = sessionResourceId(context)!
          let registration = registrations.get(resourceId)
          if (!registration) {
            registration = { resourceId, resourceKind: 'dsh-session', workspaceId, semanticRevision: String(generation),
              observe: async caller => {
                if (caller.callerId !== context.caller.callerId || caller.workspaceId !== workspaceId || caller.audience !== context.caller.audience) throw new Error('DSH Session caller does not match its opener.')
                const operationIds = await currentReadOperations()
                return { state: { runtimeId: session.runtimeId, threadId: session.threadId }, semanticRevision: String(generation), operationIds }
              }, retireAfterLastHandleExpires: true }
            registrations.set(resourceId, registration)
          }
          return { output: context.issueResource(registration) }
        }
      } as unknown as CapabilityDefinition
      prepared.push({ remote: openerRemote as (typeof definitions)[number], definition: openerDefinition })
    }
    const current = this.#contributions.list(plugin.manifest.name).filter((item) => item.kind === 'capability')
    const retained = new Set(prepared.flatMap(({ remote }) => {
      const existing = current.find((item) => item.id === remote.id)
      const value = existing?.value as { remote: unknown; registered: CapabilityDefinition } | undefined
      return existing?.generation === generation && JSON.stringify(value?.remote) === JSON.stringify(remote)
        && this.#capabilityRegistry?.get(remote.id) === value?.registered ? [remote.id] : []
    }))
    const replaced = current.filter((item) => !retained.has(item.id))
    const incoming = prepared.filter(({ remote }) => !retained.has(remote.id))
    const previous = replaced.map((item) => (item.value as { registered: CapabilityDefinition }).registered)
    const candidates = incoming.map(({ definition }) => definition)
    // Even an equivalent descriptor is never a grant to replace an unrelated owner.
    // Host-selected domain composition must retire native registrations before this point.
    if (validateOnly) {
      this.#capabilityRegistry.replaceOwned(previous, candidates, { validateOnly: true })
      return
    }
    if (this.#extensionHost.runtime(plugin.manifest.name) !== runtime || runtime.snapshot.state !== 'active' || !this.#enabled.has(plugin.manifest.name)) return
    if (replaced.length === 0 && incoming.length === 0) return
    // Both write sets stay detached through all synchronous Host policy callbacks.
    // Contribution transfer commits last, followed only by the registry map swap;
    // no await, disposer, or fallible callback sits between those publications.
    publishCapabilitySnapshot(this.#capabilityRegistry, candidates, previous, (publication) => {
      const commit = this.#contributions.prepareOwned(replaced, incoming.map(({ remote, definition }) => ({
        pluginId: plugin.manifest.name,
        generation,
        kind: 'capability' as const,
        id: remote.id,
        value: { remote, definition, registered: publication.definitions.find((item) => item.descriptor.id === remote.id)! },
        unregister: () => publication.release(remote.id)
      })))
      return commit
    })
    // These capability disposers release only obsolete identity-bound leases.
    // They cannot remove the new definitions or resurrect an old/native handler.
    for (const existing of replaced) await existing.unregister()
  }

  async #unregisterCapabilities(packageName: string): Promise<void> {
    this.#syncWorkspacePreviewPlugins(packageName, [])
    const plugin = this.#host.plugins.find(({ manifest }) => manifest.name === packageName)
    if (plugin) await this.#contributions.unregisterPlugin(plugin.manifest.name)
  }

  async #registerTypedContributions(plugin: DiscoveredPlugin, runtime: ProcessExtensionRuntime): Promise<void> {
    const packageName = plugin.manifest.name
    const generation = runtime.snapshot.generation
    const adapterKind = plugin.adapter?.kind
    if (adapterKind === 'renderer') {
      try {
        // A new runtime generation owns a fresh descriptor set. Removing the
        // previous generation first prevents stale panels from surviving a UI
        // hot swap or a failed reactivation.
        this.#rendererContributions.unregisterPlugin(packageName)
        const descriptors = await runtime.rendererContributions(generation) as Array<{ id: string; kind?: 'panel' | 'tab'; title: string }>
        for (const descriptor of descriptors) {
          this.#rendererContributions.register({ pluginId: packageName, generation, id: descriptor.id, kind: descriptor.kind ?? 'panel', title: descriptor.title, open: () => descriptor, dispose: () => undefined })
        }
        const count = await this.#registerRendererCapabilities(packageName, generation)
        this.#markContribution(packageName, true, undefined, count)
      } catch (error) {
        this.#markContribution(packageName, false, error)
        throw error
      }
    }
    if (adapterKind === 'managed-runtime') {
      try {
        let contribution = this.#managedRuntimes.list(packageName)[0]
        if (!contribution) {
          contribution = {
            pluginId: packageName,
            generation,
            id: `${packageName}:managed-mcp`,
            discover: () => runtime.managedDiscover(generation),
            invoke: (operation: string, input?: unknown) => runtime.managedInvoke(operation, input, generation),
            dispose: async () => { await runtime.dispose() }
          }
          this.#managedRuntimes.register(contribution)
        }
        const count = await this.#registerManagedCapabilities(packageName, contribution, generation)
        this.#markContribution(packageName, true, undefined, count)
      } catch (error) {
        this.#markContribution(packageName, false, error)
        throw error
      }
    }
    if (adapterKind === 'workflow') {
      try {
        let contribution = this.#workflowContributions.list(packageName)[0]
        if (!contribution) {
          const invoke = (operation: string, input?: unknown) => runtime.workflowInvoke(operation, input, generation)
          contribution = {
            pluginId: packageName,
            generation,
            id: `${packageName}:workflow`,
            start: (input: unknown) => invoke('start', input),
            status: (input: unknown) => invoke('status', input),
            advance: (input: unknown) => invoke('advance', input),
            cancel: (input: unknown) => invoke('cancel', input),
            dispose: async () => { await runtime.dispose() }
          }
          this.#workflowContributions.register(contribution)
        }
        const count = await this.#registerWorkflowCapabilities(packageName, contribution, generation)
        this.#markContribution(packageName, true, undefined, count)
      } catch (error) {
        this.#markContribution(packageName, false, error)
        throw error
      }
    }
    if (adapterKind === 'workspace-preview') {
      try {
        await this.#registerWorkspacePreviewPlugins(plugin, runtime, generation)
      } catch (error) {
        this.#syncWorkspacePreviewPlugins(packageName, [])
        this.#markContribution(packageName, false, error)
        throw error
      }
    }
  }

  /**
   * Registers the workspace-preview slot contributions (gap-1b channel) into
   * the Host preview sink. Layer 1 governance lives here: the exact-version
   * contract must be approved, every returned slot must be named in the
   * adapter declaration's previewSlots allowlist with a matching artifactKind
   * subset, and each returned manifest must parse and match its slotId.
   * Double registration (slot id already owned by a bundled domain or another
   * plugin) fails closed in the preview host registries and rolls back here.
   */
  async #registerWorkspacePreviewPlugins(plugin: DiscoveredPlugin, runtime: ProcessExtensionRuntime, generation: number): Promise<void> {
    const packageName = plugin.manifest.name
    const contract = this.#contract(packageName, runtime.snapshot.version)
    const authorization = contract?.dshAuthorization
    const approved = contract?.approved === true &&
      authorization?.packageName === packageName &&
      authorization.packageVersion === runtime.snapshot.version &&
      authorization.dshRuntimeVersion === this.#dshRuntimeVersion
    if (!approved) {
      throw new Error(`Plugin ${packageName} workspace-preview contribution requires an approved exact-version adapter contract.`)
    }
    const declaredSlots = plugin.adapter?.previewSlots ?? []
    const remoteSlots = z.array(workspacePreviewSlotWireSchema).parse(await runtime.workspacePreviewSlots(generation))
    if (remoteSlots.length === 0) {
      throw new Error(`Plugin ${packageName} declares workspace-preview but provides no slots.`)
    }
    const inputs: WorkspacePreviewPluginRegistrationInput[] = []
    for (const slot of remoteSlots) {
      const declared = declaredSlots.find((candidate) => candidate.slotId === slot.slotId)
      if (!declared) {
        throw new Error(`Plugin ${packageName} returned workspace-preview slot ${slot.slotId}, which its adapter declaration does not name.`)
      }
      if (slot.manifest.id !== slot.slotId) {
        throw new Error(`Plugin ${packageName} workspace-preview slot ${slot.slotId} returned a manifest for ${slot.manifest.id}.`)
      }
      for (const artifactKind of slot.artifactKinds) {
        if (!declared.artifactKinds.includes(artifactKind)) {
          throw new Error(`Plugin ${packageName} workspace-preview slot ${slot.slotId} returned undeclared artifact kind ${artifactKind}.`)
        }
      }
      const provider = createRemoteWorkspacePreviewProvider({
        pluginId: slot.slotId,
        request: (call) => this.#authorizeWorkspacePreviewRequest(packageName, slot.slotId, declared, call)
      })
      inputs.push(Object.freeze({
        ownerId: packageName,
        manifest: slot.manifest,
        order: -slot.manifest.priority,
        provider
      }))
    }
    this.#syncWorkspacePreviewPlugins(packageName, inputs)
    for (const existing of this.#contributions.list(packageName).filter((item) => item.kind === 'workspace-preview')) {
      await this.#contributions.unregisterContribution(packageName, 'workspace-preview', existing.id, existing.generation)
    }
    for (const input of inputs) {
      this.#contributions.register({
        pluginId: packageName,
        generation,
        kind: 'workspace-preview',
        id: input.manifest.id,
        value: input
      })
    }
    this.#markContribution(packageName, true, undefined, inputs.length)
  }

  /**
   * Per-call governance for the host-initiated preview channel, mirroring the
   * HOST-PORTS three-layer model in the reverse direction. Layer 1: the slot
   * must be in the declared allowlist and (for prepareArtifact) the requested
   * artifact kind must be declared for it. Layer 2: the runtime object is
   * bound here and asserts its own current generation. Layer 3: the declared
   * render-target workspaceRoot must be present and consistent with the
   * request's own file state (the runner re-checks the equality child-side).
   */
  async #authorizeWorkspacePreviewRequest(
    packageName: string,
    slotId: string,
    declared: PluginWorkspacePreviewSlot,
    call: WorkspacePreviewBridgeCall
  ): Promise<unknown> {
    const deny = (code: string, message: string): never => {
      throw Object.assign(new Error(message), { code })
    }
    if (call.method === 'prepareArtifact') {
      const artifactKind = (call.input as { request?: { kind?: unknown } } | null | undefined)?.request?.kind
      if (typeof artifactKind !== 'string' || !declared.artifactKinds.includes(artifactKind as PluginWorkspacePreviewSlot['artifactKinds'][number])) {
        return deny('unsupported_artifact', `Workspace preview slot ${slotId} does not declare artifact kind ${String(artifactKind)}.`)
      }
    }
    if (typeof call.workspaceRoot !== 'string' || !call.workspaceRoot.trim()) {
      return deny('workspace_required', 'Workspace preview requests require an explicit render-target workspace.')
    }
    const inputWorkspace = (call.input as { file?: { workspaceRoot?: unknown } } | null | undefined)?.file?.workspaceRoot
    if (inputWorkspace !== call.workspaceRoot) {
      return deny('workspace_mismatch', 'Workspace preview render-target workspace does not match the request file workspace.')
    }
    const runtime = this.#extensionHost.runtime(packageName)
    if (!runtime || runtime.snapshot.state !== 'active') {
      return deny('stale_generation', `Plugin ${packageName} has no active runtime for workspace preview calls.`)
    }
    return runtime.workspacePreviewRequest(slotId, call.method as WorkspacePreviewMethod, call.workspaceRoot, call.input, runtime.snapshot.generation)
  }

  /**
   * Broker bridge for the managed-runtime contract (BUG-025). Registers each
   * local fixture operation as a discoverable capability carrying
   * managed-runtime / managed-mcp / local-fixture tags; never enters the real
   * runtimeMcpToolGateway.
   */
  async #registerManagedCapabilities(
    packageName: string,
    contribution: ManagedRuntimeContribution,
    generation: number,
  ): Promise<number> {
    if (!this.#capabilityRegistry) return 0
    const plugin = this.#findPlugin(packageName)
    const operations = await contribution.discover() as string[]
    const adapter = new ManagedRuntimeAdapter({
      namespace: this.#namespaceFor(packageName),
      version: contribution.generation === generation ? this.#extensionHost.runtime(packageName)?.snapshot.version ?? plugin.manifest.version : plugin.manifest.version,
      operations: this.#managedOperationConfig(plugin)
    })
    let count = 0
    for (const contract of adapter.contracts(operations)) {
      const definition = defineCapability({
        id: contract.capabilityId,
        version: contract.version,
        title: contract.title,
        description: contract.description,
        audiences: [...contract.audiences],
        scope: 'global',
        resourceKinds: [],
        effect: contract.effect,
        approval: contract.approval,
        concurrency: contract.effect === 'read'
          ? { revision: 'none', idempotency: 'none' }
          : { revision: 'none', idempotency: 'required' },
        tags: [...contract.tags],
        inputSchema: contract.inputSchema,
        outputSchema: contract.outputSchema,
        handler: async (input) => ({ output: await contribution.invoke(contract.operation, input), changed: false })
      })
      if (!this.#capabilityRegistry.has(contract.capabilityId)) {
        this.#capabilityRegistry.register(definition)
        this.#contributions.register({
          pluginId: packageName,
          generation,
          kind: 'managed-runtime',
          id: contract.capabilityId,
          value: definition,
          unregister: () => { this.#capabilityRegistry?.unregister(contract.capabilityId) }
        })
      }
      count += 1
    }
    return count
  }

  /**
   * Broker bridge for the renderer contract (BUG-025). Exposes read-only
   * status plus a host-controlled open command, both tagged renderer /
   * ui-contribution.
   */
  async #registerRendererCapabilities(packageName: string, generation: number): Promise<number> {
    if (!this.#capabilityRegistry) return 0
    const plugin = this.#findPlugin(packageName)
    const adapter = new RendererContributionAdapter({ namespace: this.#namespaceFor(packageName), version: this.#extensionHost.runtime(packageName)?.snapshot.version ?? plugin.manifest.version })
    let count = 0
    for (const contract of adapter.contracts()) {
      const definition = defineCapability({
        id: contract.capabilityId,
        version: contract.version,
        title: contract.title,
        description: contract.description,
        audiences: [...contract.audiences],
        scope: 'global',
        resourceKinds: [],
        effect: contract.effect,
        approval: contract.approval,
        concurrency: contract.effect === 'read'
          ? { revision: 'none', idempotency: 'none' }
          : { revision: 'none', idempotency: 'required' },
        tags: [...contract.tags],
        inputSchema: contract.inputSchema,
        outputSchema: contract.outputSchema,
        handler: async (input, context) => {
          if (contract.kind === 'open') {
            requireHostAuthorizedRenderer(context.caller.audience)
            const id = (input as { id: string }).id
            const panel = this.#rendererContributions.list(packageName).find((contribution) => contribution.id === id)
            if (!panel) throw new Error(`Renderer contribution ${packageName}:${id} is not registered.`)
            return { output: panel.open(), changed: false }
          }
          return {
            output: this.#rendererContributions.list(packageName).map(({ id, kind, title }) => ({ id, kind, title })),
            changed: false
          }
        }
      })
      if (!this.#capabilityRegistry.has(contract.capabilityId)) {
        this.#capabilityRegistry.register(definition)
        this.#contributions.register({
          pluginId: packageName,
          generation,
          kind: 'renderer',
          id: contract.capabilityId,
          value: definition,
          unregister: () => { this.#capabilityRegistry?.unregister(contract.capabilityId) }
        })
      }
      count += 1
    }
    return count
  }

  /**
   * Broker bridge for the unified Workflow/Lifecycle contract (BUG-024).
   * Registers namespaced workflow/lifecycle operations as discoverable
   * capabilities; `dispose` stays host-controlled (system audience only).
   */
  async #registerWorkflowCapabilities(
    packageName: string,
    contribution: WorkflowLifecycleContribution,
    generation: number,
  ): Promise<number> {
    if (!this.#capabilityRegistry) return 0
    const plugin = this.#findPlugin(packageName)
    const adapter = new WorkflowLifecycleAdapter({
      namespace: this.#namespaceFor(packageName),
      version: this.#extensionHost.runtime(packageName)?.snapshot.version ?? plugin.manifest.version,
      inputSchemas: this.#workflowInputSchemas(packageName)
    })
    let count = 0
    for (const contract of adapter.contracts()) {
      const definition = defineCapability({
        id: contract.capabilityId,
        version: contract.version,
        title: contract.title,
        description: contract.description,
        audiences: [...contract.audiences],
        scope: 'global',
        resourceKinds: [],
        effect: contract.effect,
        approval: contract.approval,
        concurrency: contract.effect === 'read'
          ? { revision: 'none', idempotency: 'none' }
          : { revision: 'none', idempotency: 'required' },
        tags: [...contract.tags],
        inputSchema: contract.inputSchema,
        outputSchema: contract.outputSchema,
        handler: async (input, context) => {
          adapter.requireHostAuthorized(contract.operation, context.caller.audience)
          const validated = adapter.validate(contract.operation, input)
          const result = contract.operation === 'dispose'
            ? await contribution.dispose()
            : await contribution[contract.operation](validated)
          return { output: result, changed: false }
        }
      })
      this.#capabilityRegistry.register(definition)
      this.#contributions.register({
        pluginId: packageName,
        generation,
        kind: 'workflow',
        id: contract.capabilityId,
        value: definition,
        unregister: () => { this.#capabilityRegistry?.unregister(contract.capabilityId) }
      })
      count += 1
    }
    return count
  }

  /** Contribution namespace for a plugin, declared by the plugin's adapter options (fallback: slugified name). */
  #namespaceFor(packageName: string): string {
    const declared = this.#findPlugin(packageName).adapter?.namespace
    if (declared) return declared
    return packageName.replace(/^@/u, '').replace(/[/.]/gu, '-').toLowerCase()
  }

  /** Per-plugin workflow input-schema override, declared by the plugin's adapter options. */
  #workflowInputSchemas(packageName: string): Partial<Record<WorkflowLifecycleOperation, z.ZodType>> | undefined {
    const operations = this.#findPlugin(packageName).adapter?.operations ?? {}
    return Object.fromEntries(Object.entries(operations)
      .filter(([, config]) => config.inputSchema !== undefined)
      .map(([operation, config]) => [operation, z.fromJSONSchema(config.inputSchema as never)])) as Partial<Record<WorkflowLifecycleOperation, z.ZodType>>
  }

  #managedOperationConfig(plugin: DiscoveredPlugin): Readonly<Record<string, ManagedRuntimeOperationConfig>> {
    return Object.fromEntries(Object.entries(plugin.adapter?.operations ?? {}).map(([operation, config]) => [operation, {
      ...(config.effect ? { effect: config.effect } : {}),
      ...(config.approval ? { approval: config.approval } : {}),
      ...(config.audiences ? { audiences: config.audiences } : {}),
      ...(config.inputSchema ? { inputSchema: z.fromJSONSchema(config.inputSchema as never) } : {}),
      ...(config.outputSchema ? { outputSchema: z.fromJSONSchema(config.outputSchema as never) } : {}),
      ...(config.title ? { title: config.title } : {}),
      ...(config.description ? { description: config.description } : {})
    }]))
  }


  #rendererNamespace(packageName: string): string {
    return this.#namespaceFor(packageName)
  }

  #markContribution(packageName: string, ok: boolean, error?: unknown, capabilityCount?: number): void {
    this.#contributionRegistration.set(packageName, {
      ok,
      ...(ok ? {} : { diagnostic: error instanceof Error ? error.message : String(error) }),
      ...(capabilityCount !== undefined ? { capabilityCount } : {})
    })
  }

  /** Contribution readiness: active requires a registered typed contribution that is Broker-visible. */
  #contributionReady(packageName: string): boolean {
    const registration = this.#contributionRegistration.get(packageName)
    if (registration !== undefined && !registration.ok) return false
    if (registration !== undefined && (registration.capabilityCount ?? 0) <= 0) return false
    const kind = this.#findPlugin(packageName).adapter?.kind
    if (kind === 'renderer') return this.#rendererContributions.list(packageName).length > 0 && this.#capabilityRegistry?.has(`${this.#rendererNamespace(packageName)}.status`) === true
    if (kind === 'managed-runtime') return this.#managedRuntimes.list(packageName).length > 0 && (registration?.capabilityCount ?? 0) > 0
    if (kind === 'workflow') return this.#workflowContributions.list(packageName).length > 0 && this.#capabilityRegistry?.has(`${this.#namespaceFor(packageName)}.start`) === true
    if (kind === 'workspace-preview') return (registration?.capabilityCount ?? 0) > 0 && (this.#workspacePreviewSyncState.get(packageName)?.length ?? 0) > 0
    return true
  }

  async #ensureRuntime(plugin: DiscoveredPlugin): Promise<ProcessExtensionRuntime> {
    const packageName = plugin.manifest.name
    const { directory, entryPath } = await this.#entryFor(plugin)
    await this.#assertCandidateIdentity(packageName, directory)
    const existing = this.#extensionHost.runtime(packageName)
    if (existing?.snapshot.state === 'active') return existing
    const version = (await this.#versionStore.active(packageName))?.version ?? plugin.manifest.version
    await this.#extensionHost.prepare({ pluginId: packageName, packageName, version, entryPath,
      onPortsRequest: (request, boundWorkspace) => this.#authorizeHostPort(packageName, version, request, boundWorkspace),
      onPortsCancel: async () => undefined })
    let committed = false
    try {
      await this.#extensionHost.commit(packageName)
      committed = true
      await this.#extensionHost.finalizeCommit(packageName)
    } catch (error) {
      if (committed) await this.#extensionHost.rollbackCommitted(packageName).catch(() => undefined)
      else await this.#extensionHost.rollbackPrepared(packageName).catch(() => undefined)
      throw error
    }
    const runtime = this.#extensionHost.runtime(packageName)
    if (!runtime) throw new Error(`Plugin ${packageName} runtime could not be started.`)
    return runtime
  }

  /**
   * Three-layer, fail-closed authorization for Host ports requests. Layer 1
   * checks the exact approved contract allowlist; layer 2 (identity) is bound
   * by the runtime before this runs; layer 3 pins scope.workspaceRoot to the
   * runner-attested in-flight invocation workspace.
   */
  async #authorizeHostPort(packageName: string, version: string, request: HostPortsRequest, boundWorkspace: string | undefined): Promise<HostPortsResult> {
    const deny = (code: string, message: string): HostPortsResult => ({ ok: false, error: { code, message } })
    // Resolve through the same exact-version -> package-name fallback the
    // rest of the service uses (#63), so name@version-keyed approvals work.
    const contract = this.#contract(packageName, version)
    const authorization = contract?.dshAuthorization
    const approved = contract?.approved === true &&
      authorization?.packageName === packageName && authorization.packageVersion === version &&
      authorization.dshRuntimeVersion === this.#dshRuntimeVersion
    const ports = authorization?.ports
    if (!approved || !ports || !ports.includes(request.operation)) {
      return deny('unsupported_operation', `Host port operation ${request.operation} is not approved for ${packageName}@${version}.`)
    }
    if (boundWorkspace === undefined) {
      return deny('no_active_invocation', 'Host ports require an in-flight workspace-bound invocation.')
    }
    const scopeWorkspace = request.scope?.workspaceRoot
    if (scopeWorkspace !== undefined && scopeWorkspace !== boundWorkspace) {
      return deny('scope_mismatch', 'Host ports scope.workspaceRoot does not match the bound invocation workspace.')
    }
    const executor = this.#portsExecutor
    if (!executor) {
      return deny('ports_unavailable', 'Host ports executor is not configured.')
    }
    try {
      const value = await executor({ operation: request.operation, input: request.input, workspaceId: boundWorkspace })
      return { ok: true, value }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && error.code
        ? error.code
        : 'execution_failed'
      return deny(code, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Resolve the entrypoint of the effective (possibly hot-updated) version.
   * The PluginVersionStore active pointer is the single source of truth.
   */
  async #entryFor(plugin: DiscoveredPlugin): Promise<{ directory: string; entryPath: string }> {
    const active = await this.#versionStore.active(plugin.manifest.name)
    const directory = active?.directory ?? plugin.directory
    const manifest = active
      ? parsePluginManifest(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))
      : plugin.manifest
    const entry = manifestMainEntry(manifest)
    if (!entry) throw new Error(`Plugin ${plugin.manifest.name} has no DSH main entrypoint.`)
    const entryPath = resolve(directory, entry)
    const escaped = relative(directory, entryPath)
    if (escaped.startsWith('..') || isAbsolute(escaped)) {
      throw new Error(`Plugin ${plugin.manifest.name} entrypoint escapes its version directory.`)
    }
    return { directory, entryPath }
  }

  async #summary(plugin: DiscoveredPlugin): Promise<DomainExtensionSummary> {
    const packageName = plugin.manifest.name
    const moduleId = packageName.replace(/^@/u, '').replace('/', '.')
    const lifecycle = this.#host.registry.get(packageName)?.snapshot
    const runtime = this.#extensionHost.runtime(packageName)?.snapshot
    const activationState = runtime?.state === 'failed' ? 'failed' : lifecycle?.state ?? 'discovered'
    const contributionRegistration = this.#contributionRegistration.get(packageName)
    const contributionDiagnostic = contributionRegistration && !contributionRegistration.ok
      ? contributionRegistration.diagnostic
      : undefined
    const diagnostic = contributionDiagnostic ?? this.#extensionHost.runtime(packageName)?.snapshot.diagnostics?.join('; ') ?? plugin.compatibility.reason ?? plugin.permissions.reason ?? lifecycle?.error
    const enabled = this.#enabled.has(packageName)
    const contributionReady = this.#contributionReady(packageName)
    const active = await this.#versionStore.active(packageName)
    const restartRequired = this.#pendingRestart.has(packageName)
    // version always reflects the currently RUNNING version (the active pointer wins).
    const version = active?.version ?? plugin.manifest.version
    // canRollback is true only when a real previous version exists to fall back to
    // (either the original discovered version, or another staged, non-active version).
    const versions = await this.#versionStore.versions(packageName)
    const canRollback = version !== plugin.manifest.version || versions.some((candidate) => candidate !== version)
    return {
      packageName,
      moduleId,
      moduleDisplayName: plugin.manifest.description ?? plugin.manifest.name,
      version,
      publisher: { id: 'sciforge-dev', displayName: 'SciForge development plugin' },
      source: 'development',
      verification: 'development-local',
      execution: 'sandboxed-runtime',
      status: diagnostic || activationState === 'failed'
        ? 'invalid'
        : restartRequired
          ? 'restart-required'
          : enabled
            ? activationState === 'active' && contributionReady ? 'active' : 'installed'
            : 'disabled',
      permissions: [...plugin.permissions.requested],
      contributionKinds: [...plugin.layout.contributionKinds].sort(),
      contributionCount: plugin.layout.patchIds.length,
      canRollback,
      enabled,
      generation: this.#extensionHost.runtime(packageName)?.snapshot.generation ?? lifecycle?.generation ?? 0,
      candidateVersion: this.#candidates.get(packageName)?.version ?? this.#pendingRestart.get(packageName)?.version,
      restartRequired,
      permissionAllowed: plugin.permissions.allowed,
      hostApi: plugin.compatibility.hostApi.required ? { minimum: plugin.compatibility.hostApi.required, maximumExclusive: '*' } : undefined,
      permissionStatus: plugin.permissions.status,
      approvedPermissions: [...plugin.permissions.approved],
      deniedPermissions: [...plugin.permissions.denied],
      hostApiStatus: plugin.compatibility.hostApi.status,
      activationState,
      ...(diagnostic ? { diagnostic } : {})
    }
  }

  #requireAgentCandidate(candidateId: string): AgentCandidateRecord {
    const normalized = candidateId.trim()
    if (!/^[0-9a-f-]{36}$/iu.test(normalized)) throw new Error('Plugin candidate id is invalid.')
    const record = this.#agentCandidates.get(normalized)
    if (!record) throw new Error(`Plugin candidate ${candidateId} was not found.`)
    return record
  }

  async #assertFrozenAgentArtifact(record: AgentCandidateRecord): Promise<void> {
    const check = record.check
    if (!check?.passed || !check.artifactDirectory || !check.integrity) {
      throw new Error(`Plugin candidate ${record.candidateId} has no passed immutable check.`)
    }
    const root = await realpath(this.#candidateRoot)
    const expectedWorkspace = resolve(this.#candidateRoot, record.candidateId, 'source')
    if (resolve(record.workspaceDirectory) !== expectedWorkspace) {
      throw new Error('Agent candidate workspace is outside its immutable candidate record.')
    }
    const artifact = await realpath(check.artifactDirectory)
    const escaped = relative(root, artifact)
    if (escaped.startsWith(`..${sep}`) || escaped === '..' || isAbsolute(escaped)) {
      throw new Error('Checked plugin artifact is outside the Agent candidate store.')
    }
    // Compare canonical-to-canonical: artifact is realpath'd above, so the
    // expected frozen location must be canonicalized too (symlinked parents
    // such as macOS /var vs /private/var must not look like a mismatch).
    const expectedArtifact = await realpath(resolve(this.#candidateRoot, record.candidateId, 'checks', check.checkId)).catch(() => undefined)
    if (!expectedArtifact || resolve(artifact) !== expectedArtifact) {
      throw new Error('Checked plugin artifact does not belong to this Agent candidate.')
    }
    const actual = await pluginDirectoryIntegrity(artifact)
    if (actual !== check.integrity) {
      throw new Error(`Plugin candidate ${record.candidateId} changed after it was checked.`)
    }
    await this.#assertCandidateIdentity(record.packageName, artifact)
    const manifest = parsePluginManifest(JSON.parse(await readFile(join(artifact, 'package.json'), 'utf8')))
    if (manifest.version !== check.version) {
      throw new Error(`Checked plugin artifact version changed from ${check.version} to ${manifest.version}.`)
    }
  }

  async #agentCandidateSummary(
    record: AgentCandidateRecord,
    knownPlugin?: DiscoveredPlugin
  ): Promise<DevelopmentPluginAgentCandidateSummary> {
    const plugin = knownPlugin ?? this.#findPlugin(record.packageName)
    const summary = await this.#summary(plugin)
    return {
      candidateId: record.candidateId,
      packageName: record.packageName,
      workspaceDirectory: record.workspaceDirectory,
      baseVersion: record.baseVersion,
      state: record.state,
      ...(record.check ? {
        check: {
          checkId: record.check.checkId,
          version: record.check.version,
          integrity: record.check.integrity,
          checkedAt: record.check.checkedAt,
          passed: record.check.passed,
          ...(record.check.diagnostics ? { diagnostics: record.check.diagnostics } : {}),
          commands: record.check.commands
        }
      } : {}),
      ...(record.updateRequest ? { updateRequest: { ...record.updateRequest } } : {}),
      plugin: summary
    }
  }

  #findPlugin(packageName: string): DiscoveredPlugin {
    const plugin = this.#host.plugins.find((candidate) => candidate.manifest.name === packageName)
    if (!plugin) throw new Error(`Development plugin ${packageName} was not found.`)
    return plugin
  }

  async #loadState(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, 'utf8')) as PersistedState
      if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4) return
      if (!Array.isArray(parsed.enabled)) return
      for (const [packageName, config] of Object.entries(parsed.dshConfigs ?? {})) {
        this.#dshConfigs.set(packageName, z.record(z.string(), z.json()).parse(config))
      }
      for (const packageName of parsed.enabled) if (typeof packageName === 'string') this.#enabled.add(packageName)
      if (parsed.schemaVersion === 2 || parsed.schemaVersion === 3 || parsed.schemaVersion === 4) {
        for (const [packageName, pending] of Object.entries(parsed.pendingRestart ?? {})) {
          if (pending?.version && pending.stagedDirectory && pending.integrity) this.#pendingRestart.set(packageName, { version: pending.version, stagedDirectory: pending.stagedDirectory, integrity: pending.integrity })
        }
        for (const [packageName, candidate] of Object.entries(parsed.candidates ?? {})) {
          if (candidate?.version && candidate.stagedDirectory && candidate.integrity) this.#candidates.set(packageName, { version: candidate.version, stagedDirectory: candidate.stagedDirectory, integrity: candidate.integrity })
        }
        for (const [packageName, pointer] of Object.entries(parsed.previousActive ?? {})) {
          if (pointer?.packageName === packageName && pointer.version && pointer.directory && pointer.integrity) this.#previousActive.set(packageName, pointer)
        }
      }
      if (parsed.schemaVersion === 4) {
        for (const [candidateId, candidate] of Object.entries(parsed.agentCandidates ?? {})) {
          if (!candidate || !/^[0-9a-f-]{36}$/iu.test(candidateId) || candidate.candidateId !== candidateId || !candidate.packageName || !candidate.workspaceDirectory || !candidate.baseVersion) continue
          if (!['prepared', 'checked', 'submitted', 'approval-pending', 'applied', 'failed', 'cancelled'].includes(candidate.state)) continue
          if (resolve(candidate.workspaceDirectory) !== resolve(this.#candidateRoot, candidateId, 'source')) continue
          if (candidate.check?.artifactDirectory && candidate.check.checkId &&
            resolve(candidate.check.artifactDirectory) !== resolve(this.#candidateRoot, candidateId, 'checks', candidate.check.checkId)) continue
          this.#agentCandidates.set(candidateId, candidate)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  /**
   * One service-wide writer for every state field. Snapshot only when the write
   * reaches the queue head, so queued work never restores an older state.
   * Mutations remain desired in-memory state on failure (no rollback); the caller
   * receives the error and the next save retries the latest complete state.
   */
  #persistState(): Promise<void> {
    const write = this.#stateWriteTail.then(() => this.#writeState())
    this.#stateWriteTail = write.catch(() => undefined)
    return write
  }

  async #writeState(): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true })
    const temporary = `${this.#statePath}.tmp`
    const pendingRestart = Object.fromEntries([...this.#pendingRestart.entries()].map(([k, v]) => [k, v]))
    const candidates = Object.fromEntries([...this.#candidates.entries()].map(([k, v]) => [k, v]))
    const previousActive = Object.fromEntries([...this.#previousActive.entries()].map(([k, v]) => [k, v]))
    const state: PersistedState = {
      schemaVersion: 4,
      enabled: [...this.#enabled].sort(),
      dshConfigs: Object.fromEntries(this.#dshConfigs),
      pendingRestart,
      candidates,
      previousActive,
      agentCandidates: Object.fromEntries(this.#agentCandidates)
    }
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#statePath)
  }
}
