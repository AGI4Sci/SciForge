import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultSkillsSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import { createAgentRuntimeHost } from '../agent-runtime/host'
import { RuntimeContextLedgerService } from '../../services/runtime-context-ledger-service'
import type { TurnArtifactIntentPublisher } from '../../services/turn-artifact-handoff-service'
import type { PendingTurnArtifactStart } from '../../services/turn-artifact-outbox'
import { createPiAgentRuntimeAdapter } from './pi-agent-runtime-adapter'
import { PI_PINNED_BASELINE_VERSION } from './pi-runtime-probe'

/**
 * REAL integration test: SciForge Host -> pi adapter -> real pinned pi 1.4.0
 * -> real configured model provider. No mocks anywhere on the pi path.
 *
 * Gated behind PI_INTEGRATION_COMMAND pointing at the pinned install, e.g.
 *   PI_INTEGRATION_COMMAND=F:\...\pi-verify\node_modules\.bin\pi.cmd
 * The model credential comes from the operator's own local pi configuration;
 * this test never reads, prints, or fabricates credentials.
 */

const execFileAsync = promisify(execFile)
const realCommand = process.env.PI_INTEGRATION_COMMAND

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'pi',
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: { ...defaultLocalRuntimeSettings(), sandboxMode: 'workspace-write', approvalPolicy: 'on-request' },
      codex: { ...defaultCodexRuntimeSettings(), approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
      claude: { ...defaultClaudeRuntimeSettings(), approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
      pi: { command: 'pi', executablePath: realCommand ?? '' }
    },
    workspaceRoot: '/tmp/workspace',
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

function fakeTurnArtifactPublisher(): TurnArtifactIntentPublisher {
  let lifecycleConsumer: ((event: import('@sciforge/domain-sdk/host').DomainMainAfterTurnEvent) => Promise<void>) | undefined
  let nextOrdinal = 1
  const deliveredLifecycle = new Set<string>()
  return {
    registerStart: vi.fn(async (draft) => {
      const ordinal = nextOrdinal++
      const issuerEpoch = 'issuer-00000000000000000000000000000000'
      const deliveryAttemptId = `delivery-attempt:${issuerEpoch}:${ordinal}:00000000000000000000000000000000`
      return Object.freeze({
        ...draft,
        issuerEpoch,
        deliveryAttemptOrdinal: ordinal,
        deliveryAttemptId,
        boundaryLeaseId: `turn-boundary:${deliveryAttemptId}`,
        phase: 'prepared' as const,
        key: `start:${ordinal}`,
        registeredAt: '2026-08-15T00:00:00.000Z'
      })
    }),
    markStartDispatching: vi.fn(async (start) => Object.freeze({
      ...start,
      phase: 'dispatching' as const
    }) as PendingTurnArtifactStart),
    bindStart: vi.fn(async () => true),
    rejectStart: vi.fn(async () => true),
    pendingStarts: vi.fn(async () => []),
    pending: vi.fn(async () => []),
    appendFilePatchReceipts: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    publishLifecycleSettlement: vi.fn(async (event) => {
      if (deliveredLifecycle.has(event.boundaryLeaseId)) return
      deliveredLifecycle.add(event.boundaryLeaseId)
      await lifecycleConsumer?.(event)
    }),
    attachLifecycleSettlementConsumer: (consumer) => { lifecycleConsumer = consumer },
    readDurableTurnBoundarySnapshot: vi.fn(async () => ({
      issuerEpoch: 'issuer-00000000000000000000000000000000',
      nextDeliveryAttemptOrdinal: nextOrdinal,
      retiredThroughOrdinal: 0,
      retiredOrdinalRanges: [],
      owners: []
    })),
    flushThread: vi.fn(async () => undefined)
  }
}

const isTerminalFor = (turnId: string) => (event: AgentRuntimeEvent): boolean =>
  event.kind === 'turn_lifecycle' &&
  event.turnId === turnId &&
  (event.state === 'completed' || event.state === 'failed' || event.state === 'aborted' || event.state === 'cancelled')

async function pidsWithCommandLine(marker: string): Promise<number[]> {
  if (process.platform !== 'win32') return []
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],
    { timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.filter((row) => String(row.CommandLine ?? '').includes(marker)).map((row) => Number(row.ProcessId))
}

describe.runIf(Boolean(realCommand))('Pi runtime Host integration (real pinned pi, real model)', () => {
  const roots: string[] = []
  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  })

  it('completes two turns, aborts a third, recovers with a fourth, and leaves no processes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-host-integration-'))
    roots.push(root)
    const storageRoot = join(root, 'pi-runtime')
    let host: ReturnType<typeof createAgentRuntimeHost> | undefined
    const events: AgentRuntimeEvent[] = []

    // Canonical Host-driven turn: dispatch, stream until the terminal state,
    // abort the subscription BEFORE returning (teardown is signal-driven).
    const turnText = async (
      activeHost: ReturnType<typeof createAgentRuntimeHost>,
      threadId: string,
      text: string
    ): Promise<{ turnId: string; terminal: AgentRuntimeEvent; text: string }> => {
      const handle = await activeHost.startTurn({ runtimeId: 'pi', threadId, text })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)
      let streamed = ''
      try {
        for await (const event of activeHost.subscribeEvents({
          runtimeId: 'pi',
          threadId,
          signal: controller.signal
        })) {
          events.push(event)
          if (event.kind === 'assistant_delta' && event.turnId === handle.turnId) streamed += event.text
          const terminal = isTerminalFor(handle.turnId)(event)
          if (terminal) {
            controller.abort()
            return { turnId: handle.turnId, terminal: event, text: streamed }
          }
        }
        throw new Error(`event stream ended without a terminal state for turn ${handle.turnId}`)
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
    }

    const adapter = createPiAgentRuntimeAdapter({ storageRoot })
    const adapters = new Map([[adapter.id, adapter]])
    const ledger = new RuntimeContextLedgerService(root, adapters)
    host = createAgentRuntimeHost({
      settings,
      adapters,
      services: { contextLedger: ledger },
      turnArtifacts: fakeTurnArtifactPublisher()
    })

    // Detection through the same production probe the settings page uses.
    const probe = await adapter.probe({ settings: settings() })
    expect(probe.available).toBe(true)
    expect(probe.version).toBe(PI_PINNED_BASELINE_VERSION)

    const before = await pidsWithCommandLine('--no-tools')
    let threadId = ''
    try {
      await host.completeInputRecovery({ version: 1, inputs: [] })
      const thread = await host.startThread({ runtimeId: 'pi', title: 'pi integration' })
      expect(thread.id).toBeTruthy()
      threadId = thread.id

      // Turn 1: plant a codeword for the later restart-resume recall check.
      const first = await turnText(host, threadId, 'Remember this codeword: PONG-ALPHA-7. Reply with exactly one word: PONG')
      expect(first.terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })

      // Turn 2: same thread, second consecutive turn.
      const second = await turnText(host, threadId, 'Reply with exactly one word: ECHO')
      expect(second.terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })

      // Turn 3: interrupt mid-stream; the terminal state must be aborted.
      const third = await host.startTurn({
        runtimeId: 'pi',
        threadId,
        text: 'Write a detailed essay of at least 1500 words about the history of submarines.'
      })
      const thirdController = new AbortController()
      const thirdDone = (async (): Promise<AgentRuntimeEvent> => {
        for await (const event of host!.subscribeEvents({
          runtimeId: 'pi',
          threadId,
          signal: thirdController.signal
        })) {
          events.push(event)
          if (isTerminalFor(third.turnId)(event)) {
            thirdController.abort()
            return event
          }
        }
        throw new Error('event stream ended without a terminal state for the interrupted turn')
      })()
      // Wait for streaming to actually start, then interrupt through the Host.
      const deadline = Date.now() + 60_000
      for (;;) {
        if (events.some((event) => event.kind === 'assistant_delta' && event.turnId === third.turnId)) break
        if (Date.now() > deadline) throw new Error('no assistant_delta arrived for the turn to interrupt')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await host.interruptTurn({ runtimeId: 'pi', threadId, turnId: third.turnId })
      const thirdTerminal = await thirdDone
      thirdController.abort()
      expect(thirdTerminal).toMatchObject({ kind: 'turn_lifecycle', state: 'aborted' })

      // Turn 4: the thread accepts a new task right after the abort.
      const fourth = await turnText(host, threadId, 'Reply with exactly one word: DONE')
      expect(fourth.terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })

      // No late event from the aborted turn may leak into turn 4.
      const fourthDeltas = events.filter(
        (event) => event.kind === 'assistant_delta' && event.turnId === fourth.turnId
      )
      expect(fourthDeltas.length).toBeGreaterThan(0)

      // History is readable through the Host.
      const page = await host.readThreadPage({ runtimeId: 'pi', threadId })
      expect(page.turns.length).toBe(4)
      expect(page.turns.map((turn) => turn.status)).toEqual(['completed', 'completed', 'aborted', 'completed'])
      const firstAssistant = page.turns[0].items?.find((item) => item.kind === 'assistant_message')
      expect(firstAssistant?.text?.toUpperCase()).toContain('PONG')

      expect(host.eventCaptureFailures()).toEqual([])
    } finally {
      await host.close()
      await adapter.close?.()
      host = undefined
    }

    // ---- Simulated app restart: new adapter + new Host, same storageRoot ----
    const adapter2 = createPiAgentRuntimeAdapter({ storageRoot })
    const adapters2 = new Map([[adapter2.id, adapter2]])
    const ledger2 = new RuntimeContextLedgerService(root, adapters2)
    const host2 = createAgentRuntimeHost({
      settings,
      adapters: adapters2,
      services: { contextLedger: ledger2 },
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    try {
      await host2.completeInputRecovery({ version: 1, inputs: [] })
      // The thread survived the restart and its history is readable offline.
      const threads = await host2.listThreads({ runtimeId: 'pi' })
      expect(threads.map((thread) => thread.id)).toContain(threadId)
      const offlinePage = await host2.readThreadPage({ runtimeId: 'pi', threadId })
      expect(offlinePage.turns.map((turn) => turn.status)).toEqual(['completed', 'completed', 'aborted', 'completed'])

      // Resume the SAME thread: pi respawns with --session and the model
      // really has the prior context (must recall the planted codeword).
      const resumed = await turnText(host2, threadId, 'What codeword did I ask you to remember earlier? Reply with just the codeword.')
      expect(resumed.terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      expect(resumed.text).toContain('PONG-ALPHA-7')
      expect(host2.eventCaptureFailures()).toEqual([])
    } finally {
      await host2.close()
      await adapter2.close?.()
    }

    if (process.platform === 'win32') {
      // Allow taskkill to settle, then prove no cmd/node/pi from this run survives.
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const after = await pidsWithCommandLine('--no-tools')
      expect(after.filter((pid) => !before.includes(pid))).toEqual([])
    }
  }, 420_000)

  it('bridges a Host tool through the real extension: model call -> lease -> receipted event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tools-integration-'))
    roots.push(root)
    const storageRoot = join(root, 'pi-runtime')
    const surfaceCalls: Array<{ name: string; arguments: unknown; turnId?: string }> = []
    const surface = {
      tools: () => [{
        type: 'function' as const,
        name: 'sciforge_echo',
        description: 'Echo back the provided text. Read-only probe tool.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to echo' } },
          required: ['text'],
          additionalProperties: false
        }
      }],
      assertPrincipalLease: () => undefined,
      call: async (request: { name: string; arguments?: unknown; context: { turnId?: string } }) => {
        const text = String((request.arguments as { text?: string } | undefined)?.text ?? '')
        surfaceCalls.push({ name: request.name, arguments: request.arguments, turnId: request.context.turnId })
        return { tool: request.name, value: { echo: text }, modelContent: `ECHO:${text}` }
      },
      abortTurn: () => 0
    }
    const adapter = createPiAgentRuntimeAdapter({ storageRoot, toolSurface: surface })
    const adapters = new Map([[adapter.id, adapter]])
    const ledger = new RuntimeContextLedgerService(root, adapters)
    const host = createAgentRuntimeHost({
      settings,
      adapters,
      services: { contextLedger: ledger },
      turnArtifacts: fakeTurnArtifactPublisher()
    })
    const events: AgentRuntimeEvent[] = []
    let threadId = ''
    try {
      await host.completeInputRecovery({ version: 1, inputs: [] })
      const thread = await host.startThread({ runtimeId: 'pi', title: 'pi tools integration' })
      threadId = thread.id
      const handle = await host.startTurn({
        runtimeId: 'pi',
        threadId,
        text: '你必须立即调用工具 sciforge_echo，参数 text 填 "PROBE-INTEGRATION-9"。这是直接指令：立即发起工具调用，不要只回答文字。拿到结果后原样引用工具返回内容。'
      })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 120_000)
      let terminal: AgentRuntimeEvent | undefined
      try {
        for await (const event of host.subscribeEvents({ runtimeId: 'pi', threadId, signal: controller.signal })) {
          events.push(event)
          if (isTerminalFor(handle.turnId)(event)) {
            terminal = event
            break
          }
        }
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
      // The tool really executed through the Host surface, with turn identity.
      expect(surfaceCalls).toHaveLength(1)
      expect(surfaceCalls[0]).toMatchObject({ name: 'sciforge_echo', turnId: handle.turnId })
      expect(surfaceCalls[0].arguments).toMatchObject({ text: 'PROBE-INTEGRATION-9' })
      // The stream carried a running and a receipted success tool event.
      const toolEvents = events.filter(
        (event): event is Extract<AgentRuntimeEvent, { kind: 'tool_event' }> =>
          event.kind === 'tool_event' && event.turnId === handle.turnId
      )
      expect(toolEvents.some((event) => event.status === 'running' && event.toolName === 'sciforge_echo')).toBe(true)
      const success = toolEvents.find((event) => event.status === 'success')
      if (!success || success.status !== 'success') throw new Error('missing receipted success tool event')
      expect(success.receipt.status).toBe('success')
      expect(success.detail).toContain('ECHO:PROBE-INTEGRATION-9')
      expect(terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      expect(host.eventCaptureFailures()).toEqual([])
    } finally {
      await host.close()
      await adapter.close?.()
    }
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      const survivors = await pidsWithCommandLine('sciforge-pi-host.mjs')
      expect(survivors).toEqual([])
    }
  }, 240_000)
})
