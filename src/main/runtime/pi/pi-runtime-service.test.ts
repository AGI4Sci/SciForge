import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import { PiRuntimeService } from './pi-runtime-service'
import { spawnFakePi, turnEvents, type FakePiScenario } from './pi-test-fakes'

/**
 * Service-level tests: real PiRuntimeService + real PiRpcClient over stdio
 * against a scripted peer. The service under test is production code; only
 * the far end of the pipe is scripted.
 */

function createService(scenario: FakePiScenario): { service: PiRuntimeService; cleanup: () => Promise<void> } {
  const handles: Array<() => Promise<void>> = []
  const service = new PiRuntimeService({
    executablePath: 'fake-pi',
    spawnClient: () => {
      const handle = spawnFakePi(scenario)
      handles.push(() => handle.client.close())
      return handle.client
    }
  })
  return {
    service,
    cleanup: async () => {
      await service.close()
      await Promise.all(handles.map((close) => close()))
    }
  }
}

async function collectEvents(
  service: PiRuntimeService,
  threadId: string,
  until: (event: AgentRuntimeEvent) => boolean,
  timeoutMs = 10_000
): Promise<AgentRuntimeEvent[]> {
  const collected: AgentRuntimeEvent[] = []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for await (const event of service.subscribeEvents(threadId, 0, controller.signal)) {
      collected.push(event)
      if (until(event)) return collected
    }
    return collected
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

const isTerminal = (event: AgentRuntimeEvent): boolean =>
  event.kind === 'turn_lifecycle' &&
  (event.state === 'completed' || event.state === 'failed' || event.state === 'aborted' || event.state === 'cancelled')

describe('PiRuntimeService conversation flow', () => {
  it('runs two consecutive turns on one thread with isolated event streams', async () => {
    const { service, cleanup } = createService({
      commands: {
        get_state: { respond: { success: true, data: { ok: true } } }
      },
      prompts: [
        { respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('first answer') },
        { respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('second answer') }
      ]
    })
    try {
      const thread = await service.startThread({ title: 't' })

      const first = await service.startTurn(thread.id, { text: 'q1' })
      const events1 = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === first.turnId)
      const terminal1 = events1.find((event) => isTerminal(event) && event.turnId === first.turnId)
      expect(terminal1).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      const deltas1 = events1.filter((event) => event.kind === 'assistant_delta' && event.turnId === first.turnId)
      expect(deltas1.map((event) => (event as { text: string }).text).join('')).toContain('first answer')
      const usageEvent = events1.find((event) => event.kind === 'usage')
      expect(usageEvent).toMatchObject({ kind: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 18, cacheReadTokens: 2, cacheWriteTokens: 1 } })

      const second = await service.startTurn(thread.id, { text: 'q2' })
      const events2 = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === second.turnId)
      const terminal2 = events2.find((event) => isTerminal(event) && event.turnId === second.turnId)
      expect(terminal2).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      const deltas2 = events2.filter((event) => event.kind === 'assistant_delta' && event.turnId === second.turnId)
      expect(deltas2.map((event) => (event as { text: string }).text).join('')).toContain('second answer')
      // No cross-talk: turn 2 saw no delta from turn 1.
      expect(deltas2.some((event) => (event as { text: string }).text.includes('first'))).toBe(false)

      const page = await service.readThreadPage(thread.id)
      expect(page.turns).toHaveLength(2)
      expect(page.turns[0].status).toBe('completed')
      expect(page.turns[1].status).toBe('completed')
      expect(page.turns[1].items?.find((item) => item.kind === 'assistant_message')?.text).toBe('second answer')
      expect(page.nextCursor).toBeNull()
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('ignores a late settled record from the previous turn (agent_start pairing)', async () => {
    const { service, cleanup } = createService({
      commands: { get_state: { respond: { success: true } } },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [
            ...turnEvents('one'),
            // A duplicate settled arrives AFTER turn 1 terminated — the exact
            // stale-record failure mode. Turn 2's pump must not consume it.
            { atMs: 250, record: { type: 'agent_settled', aborted: false } }
          ]
        },
        {
          respond: { success: true, data: { disposition: 'started' } },
          // Turn 2 answers slowly: the stale settled at +250ms lands while
          // turn 2 is running, before its own agent_start at +400ms.
          events: [{ atMs: 400, record: { type: 'agent_start' } }, ...turnEvents('two').slice(1).map((entry) => ({ ...entry, atMs: (entry.atMs ?? 0) + 400 }))]
        }
      ]
    })
    try {
      const thread = await service.startThread({})
      const first = await service.startTurn(thread.id, { text: 'q1' })
      await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === first.turnId)

      const second = await service.startTurn(thread.id, { text: 'q2' })
      const events2 = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === second.turnId)
      const terminal2 = events2.find((event) => isTerminal(event) && event.turnId === second.turnId)
      // The stale settled must NOT have terminated turn 2 early: the real
      // agent_start..agent_settled sequence did, with the real answer text.
      expect(terminal2).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
      const page = await service.readThreadPage(thread.id)
      expect(page.turns[1].items?.find((item) => item.kind === 'assistant_message')?.text).toBe('two')
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('maps an aborted run to the aborted terminal state, never to success', async () => {
    const { service, cleanup } = createService({
      commands: {
        get_state: { respond: { success: true } },
        abort: {
          respond: { success: true },
          // Verified wire behavior: after the abort response the run still
          // drains message_end/turn_end/agent_end before settled{aborted:true}.
          events: turnEvents('partial', { aborted: true }).map((entry, index) => ({ ...entry, atMs: index * 10 }))
        }
      },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [
            { record: { type: 'agent_start' } },
            { record: { type: 'turn_start' } },
            { record: { type: 'message_start' } },
            { record: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial', contentIndex: 0 } } }
            // No settled here: only the abort path emits it.
          ]
        }
      ]
    })
    try {
      const thread = await service.startThread({})
      const turn = await service.startTurn(thread.id, { text: 'long task' })
      // Wait for the first delta so the abort lands mid-run.
      await collectEvents(service, thread.id, (event) => event.kind === 'assistant_delta' && event.turnId === turn.turnId)
      await service.interruptTurn(thread.id, turn.turnId)
      const events = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === turn.turnId)
      const terminal = events.find((event) => isTerminal(event) && event.turnId === turn.turnId)
      expect(terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'aborted' })
      const status = await service.readThreadStatus(thread.id)
      expect(status.latestTurnStatus).toBe('aborted')
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('a new turn can start immediately after an abort settled', async () => {
    const { service, cleanup } = createService({
      commands: {
        get_state: { respond: { success: true } },
        abort: {
          respond: { success: true },
          events: turnEvents('', { aborted: true })
        }
      },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [{ record: { type: 'agent_start' } }, { record: { type: 'turn_start' } }]
        },
        { respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('after abort') }
      ]
    })
    try {
      const thread = await service.startThread({})
      const first = await service.startTurn(thread.id, { text: 'q1' })
      await service.interruptTurn(thread.id, first.turnId)
      await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === first.turnId)

      const second = await service.startTurn(thread.id, { text: 'q2' })
      const events = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === second.turnId)
      expect(events.find((event) => isTerminal(event) && event.turnId === second.turnId)).toMatchObject({
        kind: 'turn_lifecycle',
        state: 'completed'
      })
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('synthesizes a failed terminal state when the process dies mid-turn (no fabricated success)', async () => {
    const { service, cleanup } = createService({
      commands: { get_state: { respond: { success: true } } },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [
            { record: { type: 'agent_start' } },
            { record: { type: 'turn_start' } }
          ],
          exitCode: 1,
          exitAfterMs: 100
        }
      ]
    })
    try {
      const thread = await service.startThread({})
      const turn = await service.startTurn(thread.id, { text: 'q1' })
      const events = await collectEvents(service, thread.id, (event) => isTerminal(event) && event.turnId === turn.turnId)
      const terminal = events.find((event) => isTerminal(event) && event.turnId === turn.turnId)
      expect(terminal).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
      expect((terminal as { message?: string }).message).toMatch(/exited/)
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('rejects startTurn and records failed when the peer rejects the prompt', async () => {
    const { service, cleanup } = createService({
      commands: { get_state: { respond: { success: true } } },
      prompts: [
        { respond: { success: false, error: 'prompt rejected by peer' } },
        { respond: { success: false, error: 'prompt rejected by peer' } }
      ]
    })
    try {
      const thread = await service.startThread({})
      await expect(service.startTurn(thread.id, { text: 'q1' })).rejects.toThrow(/prompt rejected/)
      const page = await service.readThreadPage(thread.id)
      expect(page.turns).toHaveLength(1)
      expect(page.turns[0].status).toBe('failed')
      // The thread is usable again after a rejected prompt.
      await expect(service.startTurn(thread.id, { text: 'q2' })).rejects.toThrow(/prompt rejected/)
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('rejects a concurrent startTurn while a turn is active', async () => {
    const { service, cleanup } = createService({
      commands: { get_state: { respond: { success: true } } },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [{ record: { type: 'agent_start' } }] // never settles
        }
      ]
    })
    try {
      const thread = await service.startThread({})
      await service.startTurn(thread.id, { text: 'q1' })
      await expect(service.startTurn(thread.id, { text: 'q2' })).rejects.toThrow(/already has an active turn/)
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('rejects set_model failure at startThread and leaves no thread behind', async () => {
    const { service, cleanup } = createService({
      commands: {
        set_model: { respond: { success: false, error: 'Model not found: bad/x' } },
        get_state: { respond: { success: true } }
      }
    })
    try {
      await expect(service.startThread({ model: 'bad/x' })).rejects.toThrow(/Model not found/)
      expect(await service.listThreads()).toEqual([])
    } finally {
      await cleanup()
    }
  }, 30_000)

  it('deleteThread closes the process and removes the thread', async () => {
    const { service, cleanup } = createService({
      commands: { get_state: { respond: { success: true } } }
    })
    try {
      const thread = await service.startThread({})
      await service.deleteThread(thread.id)
      expect(await service.listThreads()).toEqual([])
      await expect(service.readThreadStatus(thread.id)).rejects.toThrow(/Unknown Pi thread/)
    } finally {
      await cleanup()
    }
  }, 30_000)
})

// ---------------------------------------------------------------------------
// Persistence & resume: storageRoot-backed registry, journal, lazy respawn
// with strict sessionId verification. The fake peer answers get_state with a
// scripted session identity; spawn arguments are captured per launch.
// ---------------------------------------------------------------------------

type SpawnCapture = { args: readonly string[] }

/** Create the fake session file (and its directory) that resume needs. */
function writeFakeSessionFile(storageRoot: string, name = 'fake-session.jsonl'): string {
  const dir = join(storageRoot, 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, '{"type":"session"}\n')
  return file
}

function createPersistentService(options: {
  storageRoot: string
  sessionId?: string
  sessionFileName?: string
  spawns?: SpawnCapture[]
  scenario?: FakePiScenario
  /** Per-spawn scenarios, consumed in launch order (crash/respawn tests). */
  scenarioQueue?: FakePiScenario[]
}): { service: PiRuntimeService; cleanup: () => Promise<void> } {
  const handles: Array<() => Promise<void>> = []
  const sessionId = options.sessionId ?? 'sess-fixed'
  const sessionFile = join(options.storageRoot, 'sessions', options.sessionFileName ?? 'fake-session.jsonl')
  const defaultScenario: FakePiScenario = options.scenario ?? {
    commands: {
      get_state: { respond: { success: true, data: { sessionId, sessionFile } } }
    },
    prompts: [{ respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('persisted answer') }]
  }
  const queue = [...(options.scenarioQueue ?? [])]
  const service = new PiRuntimeService({
    executablePath: 'fake-pi',
    storageRoot: options.storageRoot,
    spawnClient: ({ args }) => {
      options.spawns?.push({ args })
      const scenario = queue.length > 1 ? queue.shift()! : queue[0] ?? defaultScenario
      const handle = spawnFakePi(scenario)
      handles.push(() => handle.client.close())
      return handle.client
    }
  })
  return {
    service,
    cleanup: async () => {
      await service.close()
      await Promise.all(handles.map((close) => close()))
    }
  }
}

describe('PiRuntimeService persistence and resume', () => {
  it('persists threads across service instances and resumes with --session (verified sessionId)', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-'))
    const spawns: SpawnCapture[] = []
    try {
      const first = createPersistentService({ storageRoot, spawns })
      const thread = await first.service.startThread({ title: 'persisted' })
      await first.service.startTurn(thread.id, { text: 'q1' })
      await collectEvents(first.service, thread.id, isTerminal)
      await first.cleanup()
      // The fake session file must exist for the resume precheck.
      const sessionFile = writeFakeSessionFile(storageRoot)

      // "Restart": a brand-new service over the same storage root.
      const second = createPersistentService({ storageRoot, spawns })
      const threads = await second.service.listThreads()
      expect(threads.map((t) => t.id)).toEqual([thread.id])
      // History is readable WITHOUT any process running (offline page).
      const page = await second.service.readThreadPage(thread.id)
      expect(page.turns).toHaveLength(1)
      expect(page.turns[0].status).toBe('completed')
      expect(page.turns[0].items?.find((item) => item.kind === 'assistant_message')?.text).toBe('persisted answer')
      // Event journal replayed for subscribers.
      const replayed = await collectEvents(second.service, thread.id, isTerminal)
      expect(replayed.some((event) => event.kind === 'user_message')).toBe(true)

      // New turn on the old thread: respawns with --session and continues.
      await second.service.startTurn(thread.id, { text: 'q2' })
      await collectEvents(second.service, thread.id, (event) => isTerminal(event) && event.turnId !== page.turns[0].id)
      const resumeSpawn = spawns.at(-1)!
      expect(resumeSpawn.args).toContain('--session')
      expect(resumeSpawn.args).toContain(sessionFile)
      expect(resumeSpawn.args).toContain('--session-dir')
      expect(resumeSpawn.args).not.toContain('--no-session')
      const page2 = await second.service.readThreadPage(thread.id)
      expect(page2.turns).toHaveLength(2)
      expect(page2.turns[1].status).toBe('completed')
      await second.cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('fails loudly when the resumed sessionId does not match (no silent empty session)', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-mismatch-'))
    try {
      const first = createPersistentService({ storageRoot, sessionId: 'sess-original' })
      const thread = await first.service.startThread({})
      await first.cleanup()
      writeFakeSessionFile(storageRoot)

      // The "resumed" process reports a DIFFERENT sessionId — exactly what pi
      // does when the session file vanished (silently starts a fresh one).
      const second = createPersistentService({ storageRoot, sessionId: 'sess-different' })
      await expect(second.service.startTurn(thread.id, { text: 'q' })).rejects.toThrow(/resume verification failed/)
      const page = await second.service.readThreadPage(thread.id)
      expect(page.turns).toHaveLength(0)
      await second.cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('fails loudly when the recorded session file is missing', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-missing-'))
    try {
      const first = createPersistentService({ storageRoot })
      const thread = await first.service.startThread({})
      await first.cleanup()
      // No session file on disk — resume must fail before spawning succeeds.
      const second = createPersistentService({ storageRoot })
      await expect(second.service.startTurn(thread.id, { text: 'q' })).rejects.toThrow(/session file is missing/)
      await second.cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('respawns from the session file after a process crash, and the crashed turn is failed', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-crash-'))
    const spawns: SpawnCapture[] = []
    try {
      const sessionFileValue = join(storageRoot, 'sessions', 'fake-session.jsonl')
      const first = createPersistentService({
        storageRoot,
        spawns,
        scenarioQueue: [
          // Spawn 1: process dies mid-turn.
          {
            commands: {
              get_state: { respond: { success: true, data: { sessionId: 'sess-crash', sessionFile: sessionFileValue } } }
            },
            prompts: [
              {
                respond: { success: true, data: { disposition: 'started' } },
                events: [{ record: { type: 'agent_start' } }],
                exitCode: 1,
                exitAfterMs: 80
              }
            ]
          },
          // Spawn 2 (resume): completes normally.
          {
            commands: {
              get_state: { respond: { success: true, data: { sessionId: 'sess-crash', sessionFile: sessionFileValue } } }
            },
            prompts: [
              { respond: { success: true, data: { disposition: 'started' } }, events: turnEvents('recovered') }
            ]
          }
        ]
      })
      const thread = await first.service.startThread({})
      await first.service.startTurn(thread.id, { text: 'q1' })
      const events1 = await collectEvents(first.service, thread.id, isTerminal)
      expect(events1.find(isTerminal)).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
      writeFakeSessionFile(storageRoot)

      // Same service instance, dead client: next turn must respawn+resume.
      await first.service.startTurn(thread.id, { text: 'q2' })
      const isCompleted = (event: AgentRuntimeEvent): boolean => event.kind === 'turn_lifecycle' && event.state === 'completed'
      const events2 = await collectEvents(first.service, thread.id, isCompleted)
      expect(events2.find(isCompleted)).toBeTruthy()
      expect(spawns).toHaveLength(2)
      expect(spawns[1].args).toContain('--session')
      const page = await first.service.readThreadPage(thread.id)
      expect(page.turns.map((turn) => turn.status)).toEqual(['failed', 'completed'])
      await first.cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('keeps two threads fully isolated, each with its own process and history', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-iso-'))
    try {
      const { service, cleanup } = createPersistentService({
        storageRoot,
        scenario: {
          commands: {
            get_state: { respond: { success: true, data: { sessionId: 's', sessionFile: join(storageRoot, 'sessions', 'x.jsonl') } } }
          },
          // Each thread owns its own fake process; echo proves which process
          // answered, so cross-talk would show up as a wrong echo.
          prompts: [{ echo: true }, { echo: true }]
        }
      })
      const threadA = await service.startThread({ title: 'A' })
      const threadB = await service.startThread({ title: 'B' })
      await service.startTurn(threadA.id, { text: 'question A' })
      await collectEvents(service, threadA.id, isTerminal)
      await service.startTurn(threadB.id, { text: 'question B' })
      await collectEvents(service, threadB.id, isTerminal)
      const pageA = await service.readThreadPage(threadA.id)
      const pageB = await service.readThreadPage(threadB.id)
      expect(pageA.turns[0].items?.find((item) => item.kind === 'user_message')?.text).toBe('question A')
      expect(pageB.turns[0].items?.find((item) => item.kind === 'user_message')?.text).toBe('question B')
      expect(pageA.turns[0].items?.find((item) => item.kind === 'assistant_message')?.text).toBe('question A')
      expect(pageB.turns[0].items?.find((item) => item.kind === 'assistant_message')?.text).toBe('question B')
      await cleanup()
      // Registry persisted both threads independently.
      const second = createPersistentService({ storageRoot })
      expect((await second.service.listThreads()).map((thread) => thread.title).sort()).toEqual(['A', 'B'])
      await second.cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('deleteThread removes registry, journal and the managed session file', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'pi-persist-del-'))
    try {
      const { service, cleanup } = createPersistentService({ storageRoot })
      const thread = await service.startThread({})
      await service.startTurn(thread.id, { text: 'q' })
      await collectEvents(service, thread.id, isTerminal)
      // Flush persistence before asserting on disk state.
      await service.close()
      const sessionFile = writeFakeSessionFile(storageRoot)
      expect(existsSync(join(storageRoot, 'threads', `${thread.id}.json`))).toBe(true)
      await service.deleteThread(thread.id)
      expect(existsSync(join(storageRoot, 'threads', `${thread.id}.json`))).toBe(false)
      expect(existsSync(join(storageRoot, 'events', `${thread.id}.jsonl`))).toBe(false)
      expect(existsSync(sessionFile)).toBe(false)
      const second = createPersistentService({ storageRoot })
      expect(await second.service.listThreads()).toEqual([])
      await second.cleanup()
      await cleanup()
    } finally {
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }, 30_000)
})
