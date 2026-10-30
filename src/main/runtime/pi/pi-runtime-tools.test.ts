import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import type {
  AgentRuntimeToolCall,
  AgentRuntimeToolResult,
  AgentRuntimeToolSurface
} from '../agent-runtime/agent-tool-surface'
import { PiRuntimeService, type PiRuntimeServiceOptions } from './pi-runtime-service'
import { spawnFakePi, type FakePiScenario } from './pi-test-fakes'

/**
 * Tool-bridge tests: production PiRuntimeService + production MCP lease and
 * session endpoint over real HTTP on 127.0.0.1; only the pi peer is scripted.
 * The HTTP calls below play the exact role the host extension plays inside a
 * real pi process (probe-verified against pi 1.4.0: plain tools/call POSTs,
 * no initialize), so these tests exercise the genuine bridge contract.
 */

type SpawnCapture = { args: readonly string[]; env: NodeJS.ProcessEnv }

type Harness = {
  service: PiRuntimeService
  storageRoot: string
  spawns: SpawnCapture[]
  surfaceCalls: AgentRuntimeToolCall[]
  cleanup: () => Promise<void>
}

const ECHO_TOOL = {
  type: 'function' as const,
  name: 'echo_tool',
  description: 'Echo text back (test tool).',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false
  }
}

const OTHER_TOOL = {
  type: 'function' as const,
  name: 'other_tool',
  description: 'Another test tool.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}

function createHarness(
  scenario: FakePiScenario,
  options: {
    surface?: AgentRuntimeToolSurface
    serviceOptions?: Partial<PiRuntimeServiceOptions>
    /** Per-spawn scenario override (a respawned fake re-reads its scenario). */
    scenarioForSpawn?: (index: number) => FakePiScenario
  } = {}
): Harness {
  const storageRoot = mkdtempSync(join(tmpdir(), 'pi-tools-test-'))
  const spawns: SpawnCapture[] = []
  const surfaceCalls: AgentRuntimeToolCall[] = []
  const surface: AgentRuntimeToolSurface = options.surface ?? {
    tools: () => [ECHO_TOOL, OTHER_TOOL],
    assertPrincipalLease: () => undefined,
    call: async (request) => {
      surfaceCalls.push(request)
      const text = String((request.arguments as { text?: string } | undefined)?.text ?? '')
      return { tool: request.name, value: { echo: text }, modelContent: `ECHO:${text}` } satisfies AgentRuntimeToolResult
    },
    abortTurn: () => 0
  }
  const service = new PiRuntimeService({
    executablePath: 'fake-pi',
    storageRoot,
    toolSurface: surface,
    ...options.serviceOptions,
    spawnClient: ({ args, env }) => {
      const index = spawns.length
      spawns.push({ args, env })
      return spawnFakePi(options.scenarioForSpawn?.(index) ?? scenario).client
    }
  })
  return {
    service,
    storageRoot,
    spawns,
    surfaceCalls,
    cleanup: async () => {
      await service.close()
      rmSync(storageRoot, { recursive: true, force: true })
    }
  }
}

const okState = { get_state: { respond: { success: true, data: { ok: true } } } as const }

function harnessEnv(harness: Harness): { url: string; auth: string } {
  const env = harness.spawns[0]?.env ?? {}
  const url = env.SCIFORGE_PI_MCP_URL
  const auth = env.SCIFORGE_PI_MCP_AUTH
  if (!url || !auth) throw new Error('tool bridge environment was not passed to the child')
  return { url, auth }
}

async function callTool(
  harness: Harness,
  name: string,
  args: Record<string, unknown>,
  options: { auth?: string; method?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { url, auth } = harnessEnv(harness)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: options.auth ?? auth,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `t${Math.random()}`,
      method: options.method ?? 'tools/call',
      params: { name, arguments: args }
    })
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) } catch { /* 410/401 have no JSON body */ }
  return { status: response.status, body }
}

async function waitForTerminal(
  service: PiRuntimeService,
  threadId: string,
  turnId: string,
  timeoutMs = 5_000
): Promise<AgentRuntimeEvent[]> {
  const collected: AgentRuntimeEvent[] = []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for await (const event of service.subscribeEvents(threadId, 0, controller.signal)) {
      collected.push(event)
      if (
        event.kind === 'turn_lifecycle' &&
        event.turnId === turnId &&
        (event.state === 'completed' || event.state === 'failed' || event.state === 'aborted' || event.state === 'cancelled')
      ) {
        return collected
      }
    }
    return collected
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

/** Prompt spec that stays in-flight for `holdMs` before settling. */
function heldTurn(text: string, holdMs: number): NonNullable<FakePiScenario['prompts']>[number] {
  return {
    respond: { success: true, data: { disposition: 'started' } },
    events: [
      { record: { type: 'agent_start' } },
      { record: { type: 'turn_start' } },
      { record: { type: 'message_start' } },
      { record: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text, contentIndex: 0 } } },
      { record: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } } },
      { record: { type: 'turn_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } } },
      { record: { type: 'agent_end' } },
      { atMs: holdMs, record: { type: 'agent_settled', aborted: false } }
    ]
  }
}

describe('PiRuntimeService tool bridge', () => {
  let harness: Harness | undefined
  afterEach(async () => {
    await harness?.cleanup()
    harness = undefined
  })

  it('launches pi with the host extension, exact tool whitelist and bridge environment', async () => {
    harness = createHarness({ commands: { ...okState } })
    const thread = await harness.service.startThread({ title: 'tools' })
    const spawn = harness.spawns[0]
    expect(spawn).toBeDefined()
    const args = spawn.args
    expect(args).toContain('--no-extensions')
    expect(args).toContain('--no-approve')
    expect(args).not.toContain('--no-mcp')
    expect(args).not.toContain('--no-tools')
    const extensionIndex = args.indexOf('-e')
    expect(extensionIndex).toBeGreaterThan(-1)
    const extensionPath = args[extensionIndex + 1]
    expect(existsSync(extensionPath)).toBe(true)
    expect(extensionPath.startsWith(join(harness.storageRoot, 'host'))).toBe(true)
    const toolsIndex = args.indexOf('--tools')
    expect(toolsIndex).toBeGreaterThan(-1)
    // Pi 1.4.0 parses `--tools` as a single comma-separated allowlist value.
    expect(args[toolsIndex + 1]).toBe('echo_tool,other_tool')
    // The extension source is the host-generated bridge, not user code.
    const source = readFileSync(extensionPath, 'utf8')
    expect(source).toContain("registerCommand('mcp'")
    expect(source).toContain('SCIFORGE_PI_TOOL_MANIFEST')
    // Manifest snapshot matches the surface.
    const manifest = JSON.parse(readFileSync(spawn.env.SCIFORGE_PI_TOOL_MANIFEST!, 'utf8'))
    expect(manifest.tools.map((tool: { name: string }) => tool.name)).toEqual(['echo_tool', 'other_tool'])
    expect(manifest.tools[0].inputSchema.required).toEqual(['text'])
    await harness.service.deleteThread(thread.id)
  })

  it('serves tool calls only while the turn lease is bound, then fails closed (410)', async () => {
    harness = createHarness({
      commands: { ...okState },
      prompts: [heldTurn('working', 800)]
    })
    const thread = await harness.service.startThread({ title: 'tools' })
    // Between turns the endpoint is unbound: every call fails closed.
    const idle = await callTool(harness, 'echo_tool', { text: 'idle' })
    expect(idle.status).toBe(410)

    const turn = await harness.service.startTurn(thread.id, { text: 'q' })
    const during = await callTool(harness, 'echo_tool', { text: 'ping' })
    expect(during.status).toBe(200)
    expect(JSON.stringify(during.body)).toContain('ECHO:ping')
    // Host attribution: the surface saw the exact thread/turn identity.
    expect(harness.surfaceCalls).toHaveLength(1)
    expect(harness.surfaceCalls[0].context.threadId).toBe(thread.id)
    expect(harness.surfaceCalls[0].context.turnId).toBe(turn.turnId)
    expect(harness.surfaceCalls[0].context.runtimeId).toBe('pi')

    await waitForTerminal(harness.service, thread.id, turn.turnId)
    const after = await callTool(harness, 'echo_tool', { text: 'late' })
    expect(after.status).toBe(410)
    expect(harness.surfaceCalls).toHaveLength(1)
    await harness.service.deleteThread(thread.id)
  })

  it('keeps the endpoint closed until the Host durability ack resolves', async () => {
    harness = createHarness({
      commands: { ...okState },
      prompts: [heldTurn('working', 1_500)]
    })
    const thread = await harness.service.startThread({ title: 'tools' })
    let ack: () => void = () => undefined
    const acked = new Promise<void>((resolve) => { ack = resolve })
    const pending = harness.service.startTurn(thread.id, { text: 'q' }, async () => {
      await acked
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const early = await callTool(harness, 'echo_tool', { text: 'early' })
    expect(early.status).toBe(410)
    expect(harness.surfaceCalls).toHaveLength(0)
    ack()
    const turn = await pending
    const late = await callTool(harness, 'echo_tool', { text: 'late-ok' })
    expect(late.status).toBe(200)
    await waitForTerminal(harness.service, thread.id, turn.turnId)
    await harness.service.deleteThread(thread.id)
  })

  it('enforces the per-turn allowedTools allowlist at the lease', async () => {
    harness = createHarness({
      commands: { ...okState },
      prompts: [heldTurn('working', 800)]
    })
    const thread = await harness.service.startThread({ title: 'tools' })
    const turn = await harness.service.startTurn(thread.id, { text: 'q', allowedTools: ['other_tool'] })
    const denied = await callTool(harness, 'echo_tool', { text: 'nope' })
    expect(denied.status).toBe(200)
    expect(JSON.stringify(denied.body)).toContain('isError')
    expect(harness.surfaceCalls).toHaveLength(0)
    const allowed = await callTool(harness, 'other_tool', {})
    expect(allowed.status).toBe(200)
    expect(JSON.stringify(allowed.body)).not.toContain('isError')
    const listed = await callTool(harness, 'irrelevant', {}, { method: 'tools/list' })
    expect(JSON.stringify(listed.body)).toContain('other_tool')
    expect(JSON.stringify(listed.body)).not.toContain('echo_tool')
    await waitForTerminal(harness.service, thread.id, turn.turnId)
    await harness.service.deleteThread(thread.id)
  })

  it('revokes the lease on interrupt: in-flight call aborts, new calls 410', async () => {
    let abortObserved = false
    const hangingSurface: AgentRuntimeToolSurface = {
      tools: () => [ECHO_TOOL],
      assertPrincipalLease: () => undefined,
      call: (_request, options) =>
        new Promise<AgentRuntimeToolResult>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            abortObserved = true
            reject(new Error('aborted'))
          }, { once: true })
        }),
      abortTurn: () => 0
    }
    harness = createHarness(
      {
        commands: {
          ...okState,
          abort: { respond: { success: true }, events: [{ record: { type: 'agent_settled', aborted: true } }] }
        },
        prompts: [
          {
            respond: { success: true, data: { disposition: 'started' } },
            events: [{ record: { type: 'agent_start' } }, { record: { type: 'turn_start' } }]
          }
        ]
      },
      { surface: hangingSurface }
    )
    const thread = await harness.service.startThread({ title: 'tools' })
    const turn = await harness.service.startTurn(thread.id, { text: 'q' })
    const inFlight = callTool(harness, 'echo_tool', { text: 'hang' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await harness.service.interruptTurn(thread.id, turn.turnId)
    const result = await inFlight
    // The lease revocation either aborts the in-flight call (isError result
    // delivered before teardown) or tears down the exchange (fetch failure /
    // non-200); it must never complete successfully.
    expect(abortObserved || result.status !== 200 || JSON.stringify(result.body).includes('isError')).toBe(true)
    const events = await waitForTerminal(harness.service, thread.id, turn.turnId)
    expect(events.find((event) => event.kind === 'turn_lifecycle' && event.turnId === turn.turnId && event.state === 'aborted')).toBeTruthy()
    const after = await callTool(harness, 'echo_tool', { text: 'post-abort' })
    expect(after.status).toBe(410)
    await harness.service.deleteThread(thread.id)
  })

  it('runs two turns with distinct leases; the old lease cannot serve new calls', async () => {
    harness = createHarness({
      commands: { ...okState },
      prompts: [heldTurn('one', 400), heldTurn('two', 400)]
    })
    const thread = await harness.service.startThread({ title: 'tools' })
    const first = await harness.service.startTurn(thread.id, { text: 'q1' })
    await callTool(harness, 'echo_tool', { text: 'a' })
    await waitForTerminal(harness.service, thread.id, first.turnId)
    const between = await callTool(harness, 'echo_tool', { text: 'between' })
    expect(between.status).toBe(410)

    const second = await harness.service.startTurn(thread.id, { text: 'q2' })
    const duringSecond = await callTool(harness, 'echo_tool', { text: 'b' })
    expect(duringSecond.status).toBe(200)
    await waitForTerminal(harness.service, thread.id, second.turnId)
    // Each turn got its own exact attribution.
    expect(harness.surfaceCalls.map((call) => call.context.turnId)).toEqual([first.turnId, second.turnId])
    const callIds = harness.surfaceCalls.map((call) => call.context.callId)
    expect(callIds[0]?.startsWith(`${first.turnId}:`)).toBe(true)
    expect(callIds[1]?.startsWith(`${second.turnId}:`)).toBe(true)
    await harness.service.deleteThread(thread.id)
  })

  it('fails a prompt-dispatch timeout loudly, quiesces pi, then accepts the next turn', async () => {
    harness = createHarness(
      {
        commands: {
          ...okState,
          abort: { respond: { success: true }, events: [{ record: { type: 'agent_settled', aborted: true } }] }
        },
        prompts: [
          { noResponse: true }, // prompt response never arrives
          { echo: true }
        ]
      },
      { serviceOptions: { promptTimeoutMs: 2_000, quiesceTimeoutMs: 2_000 } }
    )
    const thread = await harness.service.startThread({ title: 'tools' })
    await expect(harness.service.startTurn(thread.id, { text: 'stuck' })).rejects.toThrow()
    const status = await harness.service.readThreadStatus(thread.id)
    expect(status.status).toBe('idle')
    expect(status.latestTurnStatus).toBe('failed')
    // The timed-out run was genuinely cancelled (settled observed), the
    // process survived, and the next turn runs on the same client.
    const next = await harness.service.startTurn(thread.id, { text: 'again' })
    const events = await waitForTerminal(harness.service, thread.id, next.turnId)
    expect(events.find((event) => event.kind === 'turn_lifecycle' && event.state === 'completed')).toBeTruthy()
    expect(harness.spawns).toHaveLength(1)
    await harness.service.deleteThread(thread.id)
  })

  it('kills the process when pi cannot prove quiescence after a dispatch failure', async () => {
    harness = createHarness(
      {},
      {
        serviceOptions: { promptTimeoutMs: 2_000, quiesceTimeoutMs: 400 },
        // A respawned fake re-reads its scenario: the first process hangs the
        // prompt and never settles after abort; the second behaves normally.
        scenarioForSpawn: (index) =>
          index === 0
            ? {
                commands: {
                  ...okState,
                  abort: { respond: { success: true } } // acknowledged, never settles
                },
                prompts: [{ noResponse: true }]
              }
            : { commands: { ...okState }, prompts: [{ echo: true }] }
      }
    )
    const thread = await harness.service.startThread({ title: 'tools' })
    await expect(harness.service.startTurn(thread.id, { text: 'stuck' })).rejects.toThrow()
    const status = await harness.service.readThreadStatus(thread.id)
    expect(status.status).toBe('idle')
    expect(status.latestTurnStatus).toBe('failed')
    // The unquiesced process was closed; the next turn respawns a fresh one.
    const next = await harness.service.startTurn(thread.id, { text: 'again' })
    const events = await waitForTerminal(harness.service, thread.id, next.turnId)
    expect(events.find((event) => event.kind === 'turn_lifecycle' && event.state === 'completed')).toBeTruthy()
    expect(harness.spawns.length).toBeGreaterThanOrEqual(2)
    await harness.service.deleteThread(thread.id)
  })

  it('translates tool execution records into receipted tool events, closing unresolved calls at settle', async () => {
    harness = createHarness({
      commands: { ...okState },
      prompts: [
        {
          respond: { success: true, data: { disposition: 'started' } },
          events: [
            { record: { type: 'agent_start' } },
            { record: { type: 'turn_start' } },
            { record: { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'echo_tool', args: { text: 'hi' } } },
            {
              record: {
                type: 'tool_execution_end',
                toolCallId: 'c1',
                toolName: 'echo_tool',
                result: { content: [{ type: 'text', text: 'ECHO:hi' }] },
                isError: false
              }
            },
            { record: { type: 'tool_execution_start', toolCallId: 'c2', toolName: 'echo_tool', args: { text: 'lost' } } },
            { record: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } } },
            { record: { type: 'turn_end', message: { role: 'assistant', content: [], stopReason: 'stop' } } },
            { record: { type: 'agent_end' } },
            { record: { type: 'agent_settled', aborted: false } }
          ]
        }
      ]
    })
    const thread = await harness.service.startThread({ title: 'tools' })
    const turn = await harness.service.startTurn(thread.id, { text: 'q' })
    const events = await waitForTerminal(harness.service, thread.id, turn.turnId)
    const toolEvents = events.filter((event) => event.kind === 'tool_event')
    const running1 = toolEvents.find((event) => event.callId === 'c1' && event.status === 'running')
    expect(running1).toMatchObject({ toolName: 'echo_tool', meta: { phase: 'requested', factSource: 'model_output' } })
    const success1 = toolEvents.find((event) => event.callId === 'c1' && event.status === 'success')
    expect(success1).toBeTruthy()
    expect(success1 && 'receipt' in success1 ? success1.receipt : undefined).toMatchObject({ status: 'success' })
    expect(success1?.detail).toContain('ECHO:hi')
    const lost2 = toolEvents.find((event) => event.callId === 'c2' && event.status === 'error')
    expect(lost2).toBeTruthy()
    expect(lost2?.meta?.error).toMatchObject({ code: 'pi_tool_result_missing' })
    expect(events.find((event) => event.kind === 'turn_lifecycle' && event.state === 'completed')).toBeTruthy()
    await harness.service.deleteThread(thread.id)
  })

  it('preserves blocking host approval inside the tool call path', async () => {
    // The real approval UI lives inside surface.call (broker requestApproval).
    // This gate stands in for it deterministically: the tool body only runs
    // after the test grants approval, exactly where the broker would block.
    let executions = 0
    let approve: (() => void) | undefined
    let deny: (() => void) | undefined
    const gatedSurface: AgentRuntimeToolSurface = {
      tools: () => [ECHO_TOOL],
      assertPrincipalLease: () => undefined,
      call: async (request) => {
        const decision = await new Promise<'approved' | 'denied'>((resolve) => {
          approve = () => resolve('approved')
          deny = () => resolve('denied')
        })
        if (decision === 'denied') {
          throw Object.assign(new Error('The user denied this tool call.'), { code: 'approval_denied' })
        }
        executions += 1
        const text = String((request.arguments as { text?: string } | undefined)?.text ?? '')
        return { tool: request.name, value: { echo: text }, modelContent: `ECHO:${text}` }
      },
      abortTurn: () => 0
    }
    harness = createHarness(
      {
        commands: { ...okState },
        prompts: [heldTurn('working', 3_000)]
      },
      { surface: gatedSurface }
    )
    const thread = await harness.service.startThread({ title: 'tools' })
    const turn = await harness.service.startTurn(thread.id, { text: 'q' })

    // Denial path: the call pends before approval, then fails closed.
    const deniedCall = callTool(harness, 'echo_tool', { text: 'deny-me' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(executions).toBe(0)
    deny!()
    const deniedResult = await deniedCall
    expect(executions).toBe(0)
    expect(JSON.stringify(deniedResult.body)).toContain('isError')

    // Approval path: same gate, granted; the tool body runs exactly once.
    const approvedCall = callTool(harness, 'echo_tool', { text: 'approve-me' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(executions).toBe(0)
    approve!()
    const approvedResult = await approvedCall
    expect(executions).toBe(1)
    expect(JSON.stringify(approvedResult.body)).toContain('ECHO:approve-me')

    await waitForTerminal(harness.service, thread.id, turn.turnId)
    await harness.service.deleteThread(thread.id)
  })

  it('closes the endpoint on deleteThread', async () => {
    harness = createHarness({ commands: { ...okState } })
    const thread = await harness.service.startThread({ title: 'tools' })
    const { url, auth } = harnessEnv(harness)
    await harness.service.deleteThread(thread.id)
    await expect(
      fetch(url, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: '{}'
      })
    ).rejects.toThrow()
  })

  it('revokes the lease when the process dies mid-turn; resume binds a fresh lease', async () => {
    let root = ''
    harness = createHarness(
      { commands: { ...okState } },
      {
        scenarioForSpawn: (index) => {
          const sessionFile = join(root, 'sessions', 'fake-session.jsonl')
          const getState = {
            get_state: { respond: { success: true, data: { sessionId: 'sess-restore', sessionFile } } }
          } as const
          if (index === 0) {
            return {
              commands: getState,
              prompts: [
                {
                  respond: { success: true, data: { disposition: 'started' } },
                  events: [{ record: { type: 'agent_start' } }],
                  exitCode: 1,
                  exitAfterMs: 100
                }
              ]
            }
          }
          return { commands: getState, prompts: [heldTurn('resumed', 800)] }
        }
      }
    )
    root = harness.storageRoot
    const thread = await harness.service.startThread({ title: 'tools' })
    const crashed = await harness.service.startTurn(thread.id, { text: 'q1' })
    const crashEvents = await waitForTerminal(harness.service, thread.id, crashed.turnId)
    expect(
      crashEvents.find((event) => event.kind === 'turn_lifecycle' && event.state === 'failed')
    ).toBeTruthy()
    // The crashed turn's lease is gone: the endpoint fails closed.
    const orphaned = await callTool(harness, 'echo_tool', { text: 'stale' })
    expect(orphaned.status).toBe(410)
    expect(harness.surfaceCalls).toHaveLength(0)

    // Resume the same thread (verified sessionId): a fresh lease is bound and
    // serves tools again; the endpoint never served the orphaned lease.
    mkdirSync(join(root, 'sessions'), { recursive: true })
    writeFileSync(join(root, 'sessions', 'fake-session.jsonl'), '{"type":"session"}\n')
    const restored = await harness.service.startTurn(thread.id, { text: 'q2' })
    expect(harness.spawns[1]?.args).toContain('--session')
    const revived = await callTool(harness, 'echo_tool', { text: 'back' })
    expect(revived.status).toBe(200)
    expect(JSON.stringify(revived.body)).not.toContain('isError')
    expect(harness.surfaceCalls).toHaveLength(1)
    await waitForTerminal(harness.service, thread.id, restored.turnId)
    await harness.service.deleteThread(thread.id)
  })
})
