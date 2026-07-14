import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRouter } from './routes/index.js'
import type { ServerRuntime } from './routes/server-runtime.js'
import { startDeferredNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import { FileAttachmentStore } from '../attachments/attachment-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileSessionStore, FileThreadStore } from '../adapters/file/index.js'
import { HybridSessionStore, HybridThreadStore } from '../adapters/hybrid/index.js'
import { ModelRouterModelClient } from '../adapters/model/model-router-model-client.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import {
  buildBioGymDesignToolProviderFromConfig,
  type BioGymPrivateBridgeConfig
} from '../adapters/tool/biogym-design-tool.js'
import { buildGoalLocalTools } from '../adapters/tool/goal-tools.js'
import { buildTodoLocalTools } from '../adapters/tool/todo-tools.js'
import { LocalToolHost, buildDefaultLocalTools } from '../adapters/tool/local-tool-host.js'
import { buildMcpToolProviders } from '../adapters/tool/mcp-tool-provider.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { buildDelegationToolProviders } from '../adapters/tool/delegation-tool-provider.js'
import { buildWebToolProviders } from '../adapters/tool/web-tool-provider.js'
import { LocalWorkspaceInspector } from '../adapters/workspace/local-workspace-inspector.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import {
  buildRuntimeCapabilityManifest,
  DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG,
  type LocalRuntimeCapabilitiesConfig
} from '../contracts/capabilities.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig
} from '../loop/model-context-profile.js'
import {
  DEFAULT_STORAGE_CONFIG,
  expandHomePath,
  type RuntimeTuningConfig,
  type StorageConfig
} from '../config/kun-config.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { SCIFORGE_RUNTIME_SYSTEM_PROMPT } from '../prompt/kun-system-prompt.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { ReviewService } from '../services/review-service.js'
import { UsageService } from '../services/usage-service.js'
import type { UsageEvent } from '../contracts/events.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import { SkillRuntime } from '../skills/skill-runtime.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import {
  FileMultiAgentStore,
  MultiAgentRuntime,
  type MultiAgentChildEvent,
  type MultiAgentUsage
} from '@sciforge/multi-agent'
import { createChildAgentExecutor } from '../delegation/child-agent-executor.js'

const GUI_RESEARCH_MCP_SERVER_NAME = 'gui_research'
const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_owl_computer_use'
const DEFAULT_RESEARCH_SOURCES = ['arxiv', 'biorxiv', 'europe_pmc', 'semantic_scholar'] as const
const DEFAULT_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'

export type LocalRuntimeServeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  runtimeToken: string
  apiKey: string
  modelRouterBaseUrl: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  storage?: StorageConfig
  capabilities?: LocalRuntimeCapabilitiesConfig
  startedAt?: string
  /** Private one-shot bootstrap value; never sourced from argv or process.env. */
  bioGymBridge?: BioGymPrivateBridgeConfig
}

export type LocalRuntimeServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

/**
 * Composition root for serve mode. This is intentionally the only
 * place that wires concrete adapters to ports; domain, services, loop,
 * and HTTP handlers stay constructor-injected and testable.
 */
export async function createLocalRuntimeServeRuntime(
  options: LocalRuntimeServeOptions
): Promise<ServerRuntime> {
  const modelRouter = resolveModelRouterRuntimeEndpoint(options)
  await mkdir(options.dataDir, { recursive: true })
  const eventBus = new InMemoryEventBus()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
  })
  const sessionStore = stores.sessionStore
  const threadStore = stores.threadStore
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const workspaceInspector = new LocalWorkspaceInspector()
  const usageService = new UsageService()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq, nowIso })
  const prefix = createImmutablePrefix({
    systemPrompt: SCIFORGE_RUNTIME_SYSTEM_PROMPT,
    pinnedConstraints: [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable SciForge Runtime prefix byte-stable for prompt-cache reuse'
    ]
  })
  const turnService = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threadService = new ThreadService({ threadStore, sessionStore, events, ids, nowIso })
  await turnService.reconcileStaleRunningTurns()
  await seedUsageCarryover({ threadStore, sessionStore, usageService })
  const modelClient = new ModelRouterModelClient({
    baseUrl: modelRouter.baseUrl,
    apiKey: options.apiKey,
    endpointFormat: 'responses',
    model: options.model,
    streamIdleTimeoutMs: options.runtime?.modelStreamIdleTimeoutMs
  })
  const modelProfiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const reviewService = new ReviewService({
    threadStore,
    turns: turnService,
    model: modelClient,
    defaultModel: options.model,
    nowIso,
    modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(tokenEconomy ? { tokenEconomy } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {})
  })
  const capabilityConfig = options.capabilities ?? DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG
  const mcpProviders = await buildMcpToolProviders(capabilityConfig.mcp)
  const webProviders = buildWebToolProviders(capabilityConfig.web)
  const skillRuntime = await SkillRuntime.create(capabilityConfig.skills)
  const attachmentStore = capabilityConfig.attachments.enabled
    ? new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config: capabilityConfig.attachments,
        nowIso
      })
    : undefined
  const memoryStore = capabilityConfig.memory.enabled
    ? new FileMemoryStore({
        rootDir: join(options.dataDir, 'memory'),
        config: capabilityConfig.memory,
        nowIso
      })
    : undefined
  const baseToolProviders = [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    },
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore)
  ]
  const computerUseAvailable = mcpProviders.diagnostics.some((diagnostic) =>
    diagnostic.id === GUI_COMPUTER_USE_MCP_SERVER_NAME &&
    diagnostic.status === 'connected' &&
    diagnostic.toolCount > 0
  )
  const childRegistry = new CapabilityRegistry(baseToolProviders)
  const childToolHost = new LocalToolHost({ registry: childRegistry, readTracker: true })
  const delegationRuntime = capabilityConfig.subagents.enabled
    ? new MultiAgentRuntime({
        config: multiAgentConfigForSubagents(capabilityConfig.subagents),
        store: new FileMultiAgentStore(join(options.dataDir, 'child-runs')),
        events: {
          onChildEvent: (event) => recordMultiAgentChildEvent(events, event)
        },
        nowIso,
        executor: createChildAgentExecutor({
          model: modelClient,
          toolHost: childToolHost,
          prefix,
          defaultModel: options.model,
          models: options.models,
          contextCompaction: options.contextCompaction,
          approvalPolicy: options.approvalPolicy,
          sandboxMode: options.sandboxMode,
          modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
          skillRuntime,
          tokenEconomy,
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(memoryStore ? { memoryStore } : {}),
          nowIso
        }),
        recordUsage: (threadId, usage) => {
          usageService.record(threadId, usageSnapshotFromMultiAgentUsage(usage))
        }
      })
    : undefined
  const capabilities = buildRuntimeCapabilityManifest({
    config: capabilityConfig,
    model: modelCapabilitiesForModel(options.model, modelProfiles),
    mcp: {
      configuredServers: Object.keys(capabilityConfig.mcp.servers).length,
      connectedServers: mcpProviders.connectedServers,
      toolCount: mcpProviders.toolCount,
      lastError: mcpProviders.diagnostics.find((diagnostic) => diagnostic.lastError)?.lastError,
      search: {
        active: mcpProviders.search.active,
        indexedToolCount: mcpProviders.search.indexedToolCount,
        advertisedToolCount: mcpProviders.search.advertisedToolCount
      }
    },
    web: {
      fetchAvailable: webProviders.fetchAvailable,
      searchAvailable: webProviders.searchAvailable,
      provider: webProviders.provider,
      reason: webProviders.diagnostics.find((diagnostic) => diagnostic.reason)?.reason
    },
    research: researchCapabilityInput(capabilityConfig, mcpProviders.diagnostics),
    computerUse: {
      available: computerUseAvailable
    },
    skills: {
      configuredRoots: capabilityConfig.skills.roots.length,
      discoveredSkills: skillRuntime.count(),
      reason: skillRuntime.diagnostics().validationErrors[0]?.message
    },
    attachments: {
      available: Boolean(attachmentStore)
    },
    memory: {
      available: Boolean(memoryStore)
    },
    subagents: {
      available: Boolean(delegationRuntime)
    }
  })
  // Keep BioGym out of `baseToolProviders`: that registry is also inherited by
  // delegated child agents. It is intentionally wired only into the native
  // SciForge agent below.
  const bioGymDesign = buildBioGymDesignToolProviderFromConfig(options.bioGymBridge)
  const registry = new CapabilityRegistry([
    ...baseToolProviders,
    bioGymDesign.provider,
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(threadService)
    },
    ...buildDelegationToolProviders(delegationRuntime)
  ])
  const toolHost = new LocalToolHost({ registry, readTracker: true })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate,
    userInputGate,
    model: modelClient,
    toolHost,
    usage: usageService,
    events,
    turns: turnService,
    inflight,
    steering,
    compactor,
    prefix,
    ids,
    nowIso,
    modelCapabilities: (model) => modelCapabilitiesForModel(model, modelProfiles),
    skillRuntime,
    tokenEconomy,
    contextCompaction: options.contextCompaction,
    ...(options.runtime?.maxTurnModelSteps ? { maxTurnModelSteps: options.runtime.maxTurnModelSteps } : {}),
    ...(options.runtime?.maxToolCallsPerTurn ? { maxToolCallsPerTurn: options.runtime.maxToolCallsPerTurn } : {}),
    ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
    ...(options.runtime?.toolBudget ? { toolBudget: options.runtime.toolBudget } : {}),
    ...(options.runtime?.parallelism ? { parallelism: options.runtime.parallelism } : {}),
    ...(options.runtime?.stuckDetection ? { stuckDetection: options.runtime.stuckDetection } : {}),
    ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {}),
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    onPlanWritten: async ({ threadId, planId, relativePath, markdown, guiPlan }) => {
      await threadService.syncTodosFromPlan(threadId, {
        planId,
        relativePath,
        markdown,
        preserveCompleted: true
      })
      if (guiPlan) {
        await threadService.update(threadId, { guiPlan })
      }
    }
  })
  const startedAt = options.startedAt ?? nowIso()
  return {
    threadService,
    turnService,
    reviewService,
    usageService,
    eventBus,
    sessionStore,
    events,
    approvalGate,
    userInputGate,
    workspaceInspector,
    toolHost,
    ...(attachmentStore ? { attachmentStore } : {}),
    ...(memoryStore ? { memoryStore } : {}),
    ...(delegationRuntime ? { delegationRuntime } : {}),
    runTurn(threadId, turnId) {
      return loop.runTurn(threadId, turnId)
    },
    runReview(input) {
      return reviewService.runReview(input)
    },
    runtimeToken: options.runtimeToken,
    insecure: options.insecure,
    allocateSeq,
    nowIso,
    info: () => ({
      host: options.host,
      port: options.port,
      configPath: options.configPath,
      dataDir: options.dataDir,
      model: options.model,
      endpointFormat: 'responses',
      approvalPolicy: options.approvalPolicy,
      sandboxMode: options.sandboxMode,
      tokenEconomyMode: options.tokenEconomyMode,
      insecure: options.insecure,
      startedAt,
      pid: process.pid,
      capabilities
    }),
    toolDiagnostics: async () => ({
      providers: registry.diagnostics(),
      mcpServers: mcpProviders.diagnostics,
      mcpSearch: mcpProviders.search,
      webProviders: webProviders.diagnostics,
      skills: skillRuntime.diagnostics(),
      attachments: attachmentStore
        ? await attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: memoryStore
        ? await memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
    }),
    skills: () => skillRuntime.diagnostics(),
    shutdown: async () => {
      try {
        await mcpProviders.close()
      } finally {
        await stores.shutdown?.()
      }
    }
  }
}

export function resolveModelRouterRuntimeEndpoint(options: LocalRuntimeServeOptions): {
  baseUrl: string
} {
  const baseUrl = normalizeModelRouterBaseUrl(options.modelRouterBaseUrl || DEFAULT_MODEL_ROUTER_BASE_URL)
  if (!isLocalModelRouterBaseUrl(baseUrl)) {
    throw new Error(`SciForge Runtime must use the local Model Router /v1 endpoint, got ${redactUrlForError(baseUrl)}.`)
  }
  return { baseUrl }
}

function normalizeModelRouterBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_MODEL_ROUTER_BASE_URL
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function isLocalModelRouterBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:') return false
    if (url.pathname.replace(/\/+$/, '') !== '/v1') return false
    const host = url.hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

function redactUrlForError(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return '[invalid url]'
  }
}

function researchCapabilityInput(
  capabilities: LocalRuntimeServeOptions['capabilities'],
  diagnostics: Awaited<ReturnType<typeof buildMcpToolProviders>>['diagnostics']
) {
  const server = capabilities?.mcp.servers[GUI_RESEARCH_MCP_SERVER_NAME]
  const diagnostic = diagnostics.find((item) => item.id === GUI_RESEARCH_MCP_SERVER_NAME)
  const enabled = server?.enabled === true
  return {
    enabled,
    available: enabled && diagnostic?.status === 'connected',
    reason: diagnostic?.lastError,
    toolName: 'research_search',
    sources: [
      ...DEFAULT_RESEARCH_SOURCES,
      ...(server?.env.SCIFORGE_RESEARCH_TAVILY_API_KEY || server?.env.TAVILY_API_KEY ? ['web' as const, 'cns' as const] : [])
    ],
    maxResults: maxResultsFromResearchEnv(server?.env.SCIFORGE_RESEARCH_MAX_RESULTS)
  }
}

function maxResultsFromResearchEnv(value: string | undefined): number {
  if (!value) return 10
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 50) : 10
}

function tokenEconomyConfigForOptions(
  options: Pick<LocalRuntimeServeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

function multiAgentConfigForSubagents(config: LocalRuntimeCapabilitiesConfig['subagents']) {
  return {
    enabled: config.enabled,
    maxParallel: config.maxParallel,
    maxChildren: config.maxChildRuns
  }
}

function recordMultiAgentChildEvent(
  events: RuntimeEventRecorder,
  event: MultiAgentChildEvent
): Promise<void> {
  return events.record({
    kind: childRunRuntimeEventKind(event.status),
    threadId: event.parentThreadId,
    turnId: event.parentTurnId,
    status: event.status,
    text: event.summary ?? event.error?.message,
    child: {
      parentThreadId: event.parentThreadId,
      parentTurnId: event.parentTurnId,
      childId: event.childId,
      ...(event.label ? { childLabel: event.label } : {}),
      childStatus: event.status,
      childSeq: event.seq
    }
  }).then(() => undefined)
}

function usageSnapshotFromMultiAgentUsage(usage: MultiAgentUsage): UsageSnapshot {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.cachedTokens !== undefined ? { cachedTokens: usage.cachedTokens } : {}),
    ...(usage.cacheHitTokens !== undefined ? { cacheHitTokens: usage.cacheHitTokens } : {}),
    ...(usage.cacheMissTokens !== undefined ? { cacheMissTokens: usage.cacheMissTokens } : {}),
    cacheHitRate: usage.cacheHitRate ?? null,
    turns: usage.turns ?? 1,
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {}),
    ...(usage.cacheSavingsUsd !== undefined ? { cacheSavingsUsd: usage.cacheSavingsUsd } : {}),
    ...(usage.cacheSavingsCny !== undefined ? { cacheSavingsCny: usage.cacheSavingsCny } : {}),
    ...(usage.tokenEconomySavingsTokens !== undefined
      ? { tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens }
      : {}),
    ...(usage.tokenEconomySavingsUsd !== undefined
      ? { tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd }
      : {}),
    ...(usage.tokenEconomySavingsCny !== undefined
      ? { tokenEconomySavingsCny: usage.tokenEconomySavingsCny }
      : {})
  }
}

function childRunRuntimeEventKind(
  status: MultiAgentChildEvent['status']
): 'turn_started' | 'turn_completed' | 'turn_failed' | 'turn_aborted' {
  switch (status) {
    case 'completed':
      return 'turn_completed'
    case 'failed':
      return 'turn_failed'
    case 'aborted':
      return 'turn_aborted'
    case 'queued':
    case 'running':
      return 'turn_started'
  }
}

async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
}): Promise<{ threadStore: ThreadStore; sessionStore: SessionStore; shutdown?: () => Promise<void> }> {
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    return {
      sessionStore: new FileSessionStore({ dataDir: input.dataDir }),
      threadStore: new FileThreadStore({ dataDir: input.dataDir })
    }
  }

  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso
  })
  await threadStore.ready()
  return {
    threadStore,
    sessionStore: new HybridSessionStore({
      dataDir: input.dataDir,
      index: threadStore
    }),
    shutdown: async () => {
      threadStore.close()
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  const threadSummaries = await input.threadStore.list()
  await Promise.all(threadSummaries.map(async (thread) => {
    const events = await input.sessionStore.loadEventsSince(thread.id, 0)
    const latestUsage = events.reduce<UsageEvent | null>((latest, event) => {
      if (event.kind !== 'usage') return latest
      if (!latest || event.seq > latest.seq) return event
      return latest
    }, null)
    if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
  }))
}

export async function startLocalRuntimeServe(
  options: LocalRuntimeServeOptions
): Promise<LocalRuntimeServeHandle> {
  const server = await startDeferredNodeHttpServer({
    host: options.host,
    port: options.port
  })
  let runtime: ServerRuntime | undefined
  try {
    runtime = await createLocalRuntimeServeRuntime(options)
    server.setRouter(buildRouter(runtime))
  } catch (error) {
    await server.close().catch(() => undefined)
    await runtime?.shutdown?.().catch(() => undefined)
    throw error
  }
  return {
    server: server.server,
    host: server.host,
    port: server.port,
    runtime,
    close: async () => {
      try {
        await server.close()
      } finally {
        await runtime.shutdown?.()
      }
    }
  }
}
