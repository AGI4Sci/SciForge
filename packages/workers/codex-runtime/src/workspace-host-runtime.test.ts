import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  WORKSPACE_HOST_EVENT_KINDS,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  WorkspaceHostOperationError,
  type WorkspaceHostPayload
} from '@sciforge/domain-sdk/workspace-host'

import type {
  CodexAppServerClientEvent,
  CodexAppServerJsonRpcClient,
  CodexAppServerJsonRpcClientOptions,
  CodexAppServerPendingRequest
} from './app-server/index.js'
import {
  createCodexWorkspaceHostRuntime,
  type CodexWorkspaceHostRuntime
} from './workspace-host-runtime.js'

const temporaryDirectories: string[] = []
const runtimes: CodexWorkspaceHostRuntime[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('CodexWorkspaceHostRuntime', () => {
  it('runs Codex beside the workspace and replays sequenced AgentRuntime events', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: (options) => {
        fake.captureOptions(options)
        return fake.client
      },
      now: () => new Date('2026-07-30T00:00:00.000Z')
    })
    runtimes.push(runtime)
    const published: Array<{ kind: string; payload: WorkspaceHostPayload }> = []
    const context = runtimeContext(root, {
      publishEvent(kind, payload) {
        published.push({ kind, payload })
      },
      environment: scopedProxyEnvironment(43100)
    })

    await invoke(runtime, context, 'connect')
    const capabilities = record(await invoke(runtime, context, 'capabilities'))
    assert.equal(capabilities.runtimeId, 'codex')
    assert.equal(record(capabilities.events).replayable, true)

    await invoke(runtime, context, 'subscribeEvents', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      sinceSeq: 0
    }, 'stream-1')
    const thread = record(await invoke(runtime, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      workspace: root,
      title: 'Remote work'
    }))
    assert.equal(thread.id, 'gui-thread-1')
    assert.equal(thread.backendThreadId, 'codex-thread-1')

    const turn = record(await invoke(runtime, context, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      workspace: root,
      text: 'inspect the cluster file'
    }))
    assert.equal(turn.turnId, 'turn-1')
    assert.equal(
      record(fake.options?.env).HTTPS_PROXY,
      scopedProxyEnvironment(43100).HTTPS_PROXY
    )
    assert.equal(
      record(fake.options?.env).SCIFORGE_RUNTIME_API_KEY,
      TEST_MODEL_ACCESS.authorization.token
    )
    assert.equal(record(fake.options?.env).OPENAI_API_KEY, undefined)
    assert.equal(record(fake.options?.env).CODEX_HOME, join(stateDirectory, 'codex-home'))
    const config = await readFile(join(stateDirectory, 'codex-home', 'config.toml'), 'utf8')
    assert.match(config, /model_provider = "sciforge-model-router"/)
    assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:43999\/v1"/)
    assert.doesNotMatch(config, new RegExp(TEST_MODEL_ACCESS.authorization.token))

    fake.events.push({
      type: 'event',
      channel: 'codex:event',
      payload: {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'assistant-1',
          delta: 'remote answer'
        }
      }
    })
    await waitFor(() => published.some(({ payload }) =>
      record(record(payload).event).kind === 'assistant_delta'
    ))

    const replay = record(await runtime.replayEvents({
      contractVersion: 1,
      runtimeId: 'codex',
      threadId: 'gui-thread-1',
      sinceSeq: 0,
      streamId: 'stream-1'
    }, context))
    const replayedEvents = array(replay.events).map(record)
    assert.deepEqual(
      replayedEvents.map((event) => event.seq),
      replayedEvents.map((_event, index) => index + 1)
    )
    assert.ok(replayedEvents.some((event) => event.kind === 'user_message'))
    assert.ok(replayedEvents.some((event) => event.kind === 'assistant_delta'))
    assert.ok(published.every(({ kind }) => kind === WORKSPACE_HOST_EVENT_KINDS.runtimeEvent))
  })

  it('publishes fail-closed approval and user-input requests and resolves them', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: (options) => {
        fake.captureOptions(options)
        return fake.client
      }
    })
    runtimes.push(runtime)
    const published: WorkspaceHostPayload[] = []
    const context = runtimeContext(root, {
      publishEvent(_kind, payload) {
        published.push(payload)
      }
    })

    await invoke(runtime, context, 'connect')
    await invoke(runtime, context, 'subscribeEvents', {
      runtimeId: 'codex',
      threadId: 'thread-1'
    }, 'stream-1')
    fake.pending?.({
      requestId: 41,
      method: 'item/commandExecution/requestApproval',
      kind: 'approval',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      summary: 'Command approval requested',
      params: {}
    })
    fake.pending?.({
      requestId: 42,
      method: 'item/tool/requestUserInput',
      kind: 'user_input',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'input-1',
      summary: 'User input requested',
      params: {
        questions: [{
          id: 'confirm',
          header: 'Confirm',
          question: 'Continue?',
          options: [{ label: 'Yes' }]
        }]
      }
    })

    assert.deepEqual(
      published.map((payload) => record(record(payload).event).kind),
      ['approval_requested', 'user_input_requested']
    )

    await invoke(runtime, context, 'resolveApproval', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: '41',
      decision: 'allowed'
    })
    await invoke(runtime, context, 'resolveUserInput', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: '42',
      answers: [{ id: 'confirm', value: 'Yes' }]
    })

    assert.deepEqual(fake.approvals, [{
      requestId: 41,
      decision: 'allowed'
    }])
    assert.deepEqual(fake.userInputs, [{
      requestId: 42,
      answers: [{ id: 'confirm', value: 'Yes' }],
      status: 'submitted'
    }])
  })

  it('interrupts the backend thread through the canonical app-server client', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const fake = fakeCodexClient()
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => fake.client
    })
    runtimes.push(runtime)
    const context = runtimeContext(root)

    await invoke(runtime, context, 'interruptTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    assert.deepEqual(fake.interruptions, [{
      threadId: 'thread-1',
      turnId: 'turn-1'
    }])
  })

  it('rotates scoped egress and model access without retaining stale credentials', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const clients = [
      fakeCodexClient(),
      fakeCodexClient(),
      fakeCodexClient(),
      fakeCodexClient()
    ]
    let clientIndex = 0
    const runtime = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      environment: {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'must-not-leak',
        HTTPS_PROXY: 'http://old-proxy.example:8080',
        SCIFORGE_RUNTIME_API_KEY: 'stale-runtime-token'
      },
      createClient: (options) => {
        const fake = clients[clientIndex++]!
        fake.captureOptions(options)
        return fake.client
      }
    })
    runtimes.push(runtime)
    const context1 = runtimeContext(root, {
      environment: scopedProxyEnvironment(43101),
      processGeneration: 1,
      modelAccess: TEST_MODEL_ACCESS,
      modelGeneration: 1
    })

    await invoke(runtime, context1, 'connect')
    await invoke(runtime, context1, 'startTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspace: root,
      text: 'with network'
    })
    assert.equal(record(clients[0]!.options?.env).OPENAI_API_KEY, undefined)
    assert.equal(clients[0]!.startTurns[0]?.sandboxPolicy.networkAccess, true)

    await runtime.operationHandlers[0]!.onProcessEnvironmentChanged?.(
      scopedProxyEnvironment(43102),
      2,
      true
    )
    assert.equal(clients[0]!.stopCount, 1)
    assert.equal(
      record(clients[1]!.options?.env).HTTPS_PROXY,
      scopedProxyEnvironment(43102).HTTPS_PROXY
    )

    await runtime.operationHandlers[0]!.onProcessEnvironmentChanged?.({}, 3, false)
    assert.equal(clients[1]!.stopCount, 1)
    await invoke(runtime, runtimeContext(root, {
      processGeneration: 3,
      modelAccess: TEST_MODEL_ACCESS,
      modelGeneration: 1
    }), 'startTurn', {
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspace: root,
      text: 'without network'
    })
    assert.equal(record(clients[2]!.options?.env).HTTPS_PROXY, undefined)
    assert.equal(clients[2]!.startTurns[0]?.sandboxPolicy.networkAccess, false)

    const nextModelAccess = {
      ...TEST_MODEL_ACCESS,
      authorization: {
        scheme: 'bearer' as const,
        token: 'scoped-model-token-rotated-123456789'
      }
    }
    await runtime.operationHandlers[0]!.onModelAccessChanged?.(
      nextModelAccess,
      2,
      true
    )
    assert.equal(clients[2]!.stopCount, 1)
    assert.equal(
      record(clients[3]!.options?.env).SCIFORGE_RUNTIME_API_KEY,
      nextModelAccess.authorization.token
    )
    assert.notEqual(
      record(clients[3]!.options?.env).SCIFORGE_RUNTIME_API_KEY,
      TEST_MODEL_ACCESS.authorization.token
    )

    await runtime.operationHandlers[0]!.onModelAccessChanged?.(
      undefined,
      3,
      false
    )
    assert.equal(clients[3]!.stopCount, 1)
    const unavailableContext = runtimeContext(root, {
      processGeneration: 3,
      modelGeneration: 3,
      modelAccess: undefined
    })
    const unavailableCapabilities = record(
      await invoke(runtime, unavailableContext, 'capabilities')
    )
    assert.equal(unavailableCapabilities.ready, false)
    assert.equal(
      record(record(unavailableCapabilities.matrix).nativeHistory).available,
      false
    )
    await assert.rejects(
      invoke(runtime, unavailableContext, 'connect'),
      (error: unknown) =>
        error instanceof WorkspaceHostOperationError &&
        error.code === 'model-access-unavailable' &&
        /scoped Model Router access/i.test(error.message)
    )
  })

  it('restores GUI-to-Codex thread bindings from private atomic state', async () => {
    const root = await temporaryWorkspace()
    const stateDirectory = await temporaryDirectory('sciforge-remote-codex-state-')
    const first = fakeCodexClient()
    const runtime1 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => first.client
    })
    const context = runtimeContext(root)
    await invoke(runtime1, context, 'startThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-persisted',
      workspace: root,
      title: 'Persisted'
    })
    await runtime1.dispose()

    const second = fakeCodexClient()
    const runtime2 = await createCodexWorkspaceHostRuntime({
      workspaceRoot: root,
      stateDirectory,
      createClient: () => second.client
    })
    runtimes.push(runtime2)
    const thread = record(await invoke(runtime2, context, 'readThread', {
      runtimeId: 'codex',
      threadId: 'gui-thread-persisted'
    }))

    assert.equal(second.reads[0]?.threadId, 'codex-thread-1')
    assert.equal(thread.id, 'gui-thread-persisted')
    const persisted = JSON.parse(
      await readFile(join(stateDirectory, 'thread-bindings.json'), 'utf8')
    ) as { workspaceRoot: string; threads: unknown[] }
    assert.equal(persisted.workspaceRoot, root)
    assert.equal(persisted.threads.length, 1)
  })
})

function fakeCodexClient(): {
  client: CodexAppServerJsonRpcClient
  events: AsyncQueue<CodexAppServerClientEvent>
  approvals: unknown[]
  userInputs: unknown[]
  interruptions: unknown[]
  reads: Array<{ threadId: string }>
  startTurns: Array<{
    sandboxPolicy: { networkAccess: boolean }
  }>
  stopCount: number
  options?: CodexAppServerJsonRpcClientOptions
  pending?: (request: CodexAppServerPendingRequest) => void
  captureOptions(options: CodexAppServerJsonRpcClientOptions): void
} {
  const events = new AsyncQueue<CodexAppServerClientEvent>()
  const approvals: unknown[] = []
  const userInputs: unknown[] = []
  const interruptions: unknown[] = []
  const reads: Array<{ threadId: string }> = []
  const startTurns: Array<{
    sandboxPolicy: { networkAccess: boolean }
  }> = []
  const state: ReturnType<typeof fakeCodexClient> = {
    events,
    approvals,
    userInputs,
    interruptions,
    reads,
    startTurns,
    stopCount: 0,
    captureOptions(options) {
      state.options = options
      const pending = options.pendingServerRequests
      if (pending && !(typeof pending === 'object' && 'handle' in pending)) {
        state.pending = pending.onPendingRequest
      }
    },
    client: {
      connect: async () => ({
        userAgent: 'codex-test',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'linux'
      }),
      subscribe: () => events,
      listThreads: async () => ({
        data: [{ id: 'codex-thread-1', name: 'Remote work' }]
      }),
      startThread: async () => ({
        thread: {
          id: 'codex-thread-1',
          name: 'Remote work',
          cwd: '/unused'
        }
      }),
      readThread: async (input: { threadId: string }) => {
        reads.push(input)
        return {
          thread: { id: input.threadId, name: 'Remote work', turns: [] }
        }
      },
      startTurn: async (input: {
        sandboxPolicy: { networkAccess: boolean }
      }) => {
        startTurns.push(input)
        return {
          turn: { id: 'turn-1', userMessageItemId: 'user-1' }
        }
      },
      interruptTurn: async (input: unknown) => {
        interruptions.push(input)
      },
      steerTurn: async () => undefined,
      renameThread: async () => undefined,
      deleteThread: async () => undefined,
      resolveApproval: (input: unknown) => approvals.push(input),
      resolveUserInput: (input: unknown) => userInputs.push(input),
      stop: async () => {
        state.stopCount += 1
        events.end()
      }
    } as unknown as CodexAppServerJsonRpcClient
  }
  return state
}

async function invoke(
  runtime: CodexWorkspaceHostRuntime,
  context: {
    workspaceRoot: string
    sessionId: string
    publishEvent(kind: string, payload: WorkspaceHostPayload): unknown
    getProcessEnvironment?(): NodeJS.ProcessEnv
    getProcessEnvironmentGeneration?(): number
    isProcessNetworkEgressReady?(): boolean
    getModelAccess?(): typeof TEST_MODEL_ACCESS | undefined
    getModelAccessGeneration?(): number
    isModelAccessReady?(): boolean
  },
  method: string,
  input?: WorkspaceHostPayload,
  streamId?: string
): Promise<WorkspaceHostPayload> {
  const response = record(await runtime.invoke({
    contractVersion: WORKSPACE_HOST_PROTOCOL_VERSION,
    runtimeId: 'codex',
    method,
    ...(input === undefined ? {} : { input }),
    ...(streamId ? { streamId } : {})
  }, context))
  assert.equal(response.runtimeId, 'codex')
  assert.equal(response.method, method)
  return response.result as WorkspaceHostPayload
}

async function temporaryWorkspace(): Promise<string> {
  return temporaryDirectory('sciforge-remote-codex-')
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  temporaryDirectories.push(path)
  return path
}

const TEST_MODEL_ACCESS = {
  baseUrl: 'http://127.0.0.1:43999/v1',
  authorization: {
    scheme: 'bearer' as const,
    token: 'scoped-model-token-1234567890123456789'
  },
  expiresAt: '2099-01-01T00:00:00.000Z'
}

function scopedProxyEnvironment(port: number): NodeJS.ProcessEnv {
  const proxy = `http://sciforge-lease:scoped-egress-token@127.0.0.1:${port}`
  return {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy
  }
}

function runtimeContext(
  workspaceRoot: string,
  options: {
    publishEvent?(kind: string, payload: WorkspaceHostPayload): unknown
    environment?: NodeJS.ProcessEnv
    processGeneration?: number
    modelAccess?: typeof TEST_MODEL_ACCESS
    modelGeneration?: number
  } = {}
) {
  const environment = options.environment ?? {}
  const modelAccess = Object.hasOwn(options, 'modelAccess')
    ? options.modelAccess
    : TEST_MODEL_ACCESS
  return {
    workspaceRoot,
    sessionId: 'session-1',
    publishEvent: options.publishEvent ?? (() => undefined),
    getProcessEnvironment: () => environment,
    getProcessEnvironmentGeneration: () => options.processGeneration ?? 1,
    isProcessNetworkEgressReady: () =>
      Boolean(environment.HTTPS_PROXY),
    getModelAccess: () => modelAccess,
    getModelAccessGeneration: () => options.modelGeneration ?? 1,
    isModelAccessReady: () => modelAccess !== undefined
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  assert.fail('Timed out waiting for remote Codex event.')
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = []
  #ended = false

  push(value: T): void {
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.#values.push(value)
  }

  end(): void {
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ done: true, value: undefined })
    }
  }

  async next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift()
    if (value !== undefined) return { done: false, value }
    if (this.#ended) return { done: true, value: undefined }
    return new Promise((resolve) => this.#waiters.push(resolve))
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}
