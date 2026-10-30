import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { domainExecutionEventSchema } from '@sciforge/domain-sdk/reproducibility'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeDiscoveryResult,
  type AgentRuntimeEvent,
  type AgentRuntimeThread,
  type AgentRuntimeThreadListInput,
  type AgentRuntimeThreadPage,
  type AgentRuntimeThreadStatus,
  type AgentRuntimeUsageResponse
} from '../../shared/agent-runtime-contract'
import type { AppCapabilityDependencies } from '../capabilities/app-registry'
import { CapabilityBroker } from '../capabilities/broker'
import type { AgentRuntimeAdapter } from '../runtime/agent-runtime/adapter'
import { createAgentRuntimeHost } from '../runtime/agent-runtime/host'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from './application-composition'
import { TurnArtifactHandoffService } from '../services/turn-artifact-handoff-service'
import { TurnArtifactOutbox } from '../services/turn-artifact-outbox'
import {
  activateMainRuntimeContributions,
  createMainSystemCapabilityInvokerFactory,
  listMainArtifactConsumers
} from './runtime-contributions'
import { createNonSecretPackageStorageForTest } from './domain-package-storage.test-helper'
import { createUnavailablePortableResourcesForTest } from './domain-main-host.test-helper'

/**
 * Regression for the user-visible failure:
 *
 *   "The durable chat thread does not belong to the caller workspace."
 *   -> runtime_before_turn_barrier_failed
 *
 * A durable thread that was never warmed into the Host summary cache (because the
 * renderer only lists a bounded window of threads, and never lists side/child
 * threads at all) must still resolve its authoritative workspace through the
 * single canonical Host path, so the research-checkpoints required before-turn
 * barrier accepts a real turn for it.
 *
 * The composition below binds `agentThreads.read`/`list` and the turn-event
 * subscription directly to the real `createAgentRuntimeHost` methods, so the
 * defect is exercised end-to-end instead of through a stubbed thread detail.
 */

const THREAD_ID = 'thread-2c9f1a7b'
const TURN_ID = 'turn-thread-workspace-regression'
const CLIENT_DIRECTIVE_ID = 'directive-thread-workspace-regression'
const PROMPT = 'Continue the durable research thread.'
const OCCURRED_AT = '2099-08-20T08:00:00.000Z'
const THREAD_TITLE = 'Quarterly assay review notes'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  ))
})

describe('research checkpoints durable thread workspace resolution', () => {
  it('accepts a turn for a durable thread resolved outside the Host summary cache', async () => {
    const userDataDir = await realpath(await mkdtemp(join(tmpdir(), 'sciforge-thread-workspace-')))
    temporaryDirectories.push(userDataDir)
    const workspaceRoot = join(userDataDir, 'workspace')
    await mkdir(workspaceRoot, { recursive: true })

    const composition = await createThreadWorkspaceComposition(userDataDir, workspaceRoot)

    try {
      // The provider's free-text search is never a thread identity filter, so a
      // lookup that passes the thread id as `search` cannot find this thread.
      // That is the deterministic trigger of the cold-cache resolution below.
      const searched = await composition.adapter.listThreads(
        { settings: threadWorkspaceSettings(workspaceRoot) },
        {
          runtimeId: 'codex',
          includeArchived: true,
          includeSide: true,
          search: THREAD_ID,
          limit: 10
        }
      )
      expect.soft(searched.map((thread) => thread.id)).toEqual([])

      // The thread was never created or listed through the Host, so the Host has
      // no cached summary for it: this is the renderer's 80/200-item window case
      // (862 stored threads) and the side/child-thread case.
      const snapshot = await composition.host.readThreadSnapshot({
        runtimeId: 'codex',
        threadId: THREAD_ID
      })
      expect.soft(snapshot.workspace).toBe(workspaceRoot)

      // A real turn start must clear the research-checkpoints required before-turn
      // barrier instead of being rejected wholesale.
      const startFailure = await composition.host.startTurn({
        runtimeId: 'codex',
        threadId: THREAD_ID,
        text: PROMPT,
        displayText: PROMPT,
        workspace: workspaceRoot,
        clientDirectiveId: CLIENT_DIRECTIVE_ID
      }).then(() => null, (error: unknown) => error)

      expect(
        startFailure ? describeTurnStartFailure(startFailure) : null
      ).toBeNull()
    } finally {
      await composition.dispose()
    }
  }, 10_000)
})

async function createThreadWorkspaceComposition(userDataDir: string, workspaceRoot: string) {
  let capabilityInvokers: ReturnType<typeof createMainSystemCapabilityInvokerFactory> | undefined
  const catalog = createApplicationDomainCatalog({
    getUserDataDir: () => userDataDir,
    getDeviceId: () => 'device-thread-workspace-test',
    humanActions: {
      capture: (input) => broker.captureHumanAction(input),
      validate: (input) => broker.validateHumanAction(input)
    },
    portableResourcesFor: createUnavailablePortableResourcesForTest(),
    getAppVersion: () => '0.1.0',
    textSanitizer: { sanitizeText: (value) => value },
    packageStorageFor: createNonSecretPackageStorageForTest(),
    capabilityInvokerFor: (owner) => Object.freeze({
      invoke: (contract, input, options) => {
        if (!capabilityInvokers) throw new Error('Test capability broker is not ready.')
        return capabilityInvokers.forDomain(owner).invoke(contract, input, options)
      },
      createApprovedBatch: (plan) => {
        if (!capabilityInvokers) throw new Error('Test capability broker is not ready.')
        return capabilityInvokers.forDomain(owner).createApprovedBatch(plan)
      }
    })
  })
  const broker = new CapabilityBroker(
    createApplicationCapabilityRegistry(catalog, unavailableCoreDependencies())
  )
  capabilityInvokers = createMainSystemCapabilityInvokerFactory(broker)
  const adapter = createThreadWorkspaceAdapter(workspaceRoot)
  let host!: ReturnType<typeof createAgentRuntimeHost>
  const handoff = new TurnArtifactHandoffService({
    outbox: new TurnArtifactOutbox(userDataDir),
    consumers: listMainArtifactConsumers(catalog),
    materialize: (intent) => host.materializeCompletedTurnArtifact(intent),
    retryBaseMs: 10,
    retryMaxMs: 20
  })
  host = createAgentRuntimeHost({
    settings: async () => threadWorkspaceSettings(workspaceRoot),
    adapters: [adapter],
    turnArtifacts: handoff
  })
  const activated = await activateMainRuntimeContributions(catalog, {
    userDataDir,
    appRoot: '/app',
    environment: Object.freeze({ NODE_ENV: 'test' }),
    agentExecution: {
      prepareSession: async () => ({ runtimeId: 'codex', threadId: THREAD_ID }),
      run: async () => {
        throw new Error('Agent execution is unavailable in this thread-resolution test.')
      }
    },
    // The canonical production binding: the domain reads durable threads and
    // turn boundaries straight from the real Host.
    agentThreads: {
      list: async (input) => {
        const threads = await host.listThreads(input as AgentRuntimeThreadListInput)
        return Object.freeze(threads.map((thread) => Object.freeze({
          id: thread.id,
          runtimeId: thread.runtimeId,
          ...(thread.workspace?.trim() ? { workspaceRoot: thread.workspace.trim() } : {}),
          ...(thread.archived === undefined ? {} : { archived: thread.archived })
        })))
      },
      read: async ({ runtimeId, threadId }) => {
        // This composition registers exactly one codex-like adapter; the domain
        // passes the runtime id through as plain text.
        if (runtimeId !== 'codex') throw new Error(`Unexpected runtime: ${runtimeId}`)
        const detail = await host.readThreadSnapshot({ runtimeId, threadId })
        return Object.freeze({
          id: detail.id,
          runtimeId: detail.runtimeId,
          ...(detail.workspace?.trim() ? { workspaceRoot: detail.workspace.trim() } : {}),
          ...(detail.archived === undefined ? {} : { archived: detail.archived }),
          watermark: String(detail.latestSeq),
          turns: Object.freeze((detail.turns ?? []).map((turn) => Object.freeze({
            id: turn.id,
            status: turn.status,
            ...(turn.completedAt ? { completedAt: turn.completedAt } : {}),
            messages: Object.freeze([]),
            artifacts: Object.freeze([...(turn.items ?? [])])
          }))),
          artifacts: Object.freeze(detail.turns.flatMap((turn) => turn.items ?? []))
        })
      },
      subscribeMessages: async function* () {},
      hasActiveTurns: () => host.hasActiveTurns()
    },
    turnEvents: {
      subscribe: (listener) => host.subscribeTurnLifecycle(listener),
      subscribeRequiredBeforeTurn: (listener) => host.subscribeRequiredBeforeTurn(listener),
      readDurableTurnBoundarySnapshot: () => host.readDurableTurnBoundarySnapshot()
    },
    capabilityInvokers,
    modelAccess: { textReasoner: async () => null },
    executionEvents: {
      publish: async (owner, event) => domainExecutionEventSchema.parse({
        ...event,
        schemaVersion: 'sciforge.execution-event.v1' as const,
        eventId: event.eventId ?? 'execution-event-thread-workspace',
        producer: owner,
        occurredAt: event.occurredAt ?? OCCURRED_AT,
        artifacts: event.artifacts ?? []
      })
    },
    enablement: {
      isEnabled: async (moduleId) => moduleId === 'sciforge.research-checkpoints',
      subscribe: () => () => undefined
    },
    log: () => undefined
  })
  return Object.freeze({
    host,
    adapter,
    dispose: async () => {
      host.dispose()
      await activated.dispose()
      await handoff.close()
      catalog.dispose()
    }
  })
}

/**
 * Mirrors the installed codex runtime's thread-list semantics: a free-text search
 * over title/preview/workspace/model (`filterThreadList` in
 * `src/main/runtime/codex/codex-service.ts`), `limit` applied after filtering, and
 * no identity matching through `search`. `threadId` is the Host-internal exact
 * identity filter, so when the Host supplies it the requested identity is
 * authoritative.
 */
function createThreadWorkspaceAdapter(workspaceRoot: string): AgentRuntimeAdapter {
  const record = (): AgentRuntimeThread => ({
    id: THREAD_ID,
    runtimeId: 'codex',
    title: THREAD_TITLE,
    preview: 'Assay results for the durable research thread.',
    workspace: workspaceRoot,
    model: 'gpt-5-codex',
    updatedAt: OCCURRED_AT
  })
  const status = (): AgentRuntimeThreadStatus => ({
    id: THREAD_ID,
    runtimeId: 'codex',
    status: 'idle',
    latestSeq: 0
  })
  const page = (): AgentRuntimeThreadPage => ({
    runtimeId: 'codex',
    threadId: THREAD_ID,
    latestSeq: 0,
    turns: [],
    nextCursor: null
  })
  return {
    id: 'codex',
    transport: 'jsonrpc_stdio',
    probe: async (): Promise<AgentRuntimeDiscoveryResult> => ({
      runtimeId: 'codex',
      available: true,
      executablePath: '/usr/local/bin/codex',
      source: 'process-path',
      version: '1.0.0',
      protocol: { id: 'app-server', supported: true }
    }),
    connect: async () => undefined,
    capabilities: async () => createDefaultAgentRuntimeCapabilities({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio'
    }),
    listThreads: async (_context, input) => {
      const identity = input.threadId?.trim()
      let output = [record()]
      if (input.includeSide !== true) output = output.filter((thread) => !isSideOrChildThread(thread))
      if (input.archivedOnly === true) {
        output = output.filter((thread) => thread.archived === true)
      } else if (input.includeArchived !== true) {
        output = output.filter((thread) => thread.archived !== true)
      }
      if (identity) {
        output = output.filter((thread) => thread.id === identity)
      } else {
        const search = input.search?.trim().toLowerCase() ?? ''
        if (search) {
          output = output.filter((thread) =>
            [thread.title, thread.preview, thread.workspace, thread.model].some((value) =>
              value?.toLowerCase().includes(search)
            )
          )
        }
      }
      if (typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0) {
        output = output.slice(0, Math.floor(input.limit))
      }
      return output
    },
    startThread: async () => record(),
    readThreadStatus: async () => status(),
    readThreadPage: async () => page(),
    readToolArtifact: async (_context, input) => ({ ...input, content: '' }),
    startTurn: async (_context, input) => ({
      threadId: input.threadId,
      turnId: TURN_ID,
      userMessageItemId: 'user-thread-workspace-regression'
    }),
    interruptTurn: async () => undefined,
    steerTurn: async () => undefined,
    renameThread: async () => undefined,
    deleteThread: async () => undefined,
    usage: async (_context, input) => ({
      supported: true,
      groupBy: input.groupBy,
      buckets: [],
      totals: { totalTokens: 0 }
    }) satisfies AgentRuntimeUsageResponse,
    subscribeEvents: (_context, input) => ({
      // This provider stays silent until the Host disposes the turn: the
      // regression is about turn admission, not about provider output.
      [Symbol.asyncIterator]: (): AsyncIterator<AgentRuntimeEvent> => ({
        next: async (): Promise<IteratorResult<AgentRuntimeEvent>> => {
          await waitForAbort(input.signal)
          return { done: true, value: undefined }
        }
      })
    })
  }
}

function isSideOrChildThread(thread: AgentRuntimeThread): boolean {
  if (thread.sidebarVisibility === 'main') return false
  if (thread.sidebarVisibility === 'side' || thread.sidebarVisibility === 'hidden') return true
  return thread.relation === 'side' || Boolean(thread.parentThreadId?.trim())
}

function describeTurnStartFailure(error: unknown): string {
  const record = error as { name?: string; code?: string } | null
  const name = record?.name ?? 'Error'
  const code = record?.code ? ` [${record.code}]` : ''
  return `${name}${code}: ${error instanceof Error ? error.message : String(error)}`
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal || signal.aborted) return
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function threadWorkspaceSettings(workspaceRoot: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot,
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    skills: defaultSkillsSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function unavailableCoreDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, { get: () => unavailable }) as AppCapabilityDependencies
}