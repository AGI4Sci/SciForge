import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  AsyncEventQueue,
  CODEX_MAIN_IPC_CHANNELS,
  createCodexAppServerClient,
  type CodexAppServerJsonRpcClientOptions,
  type CodexAppServerProcess,
  type SpawnCodexAppServerProcess
} from '@sciforge/codex-runtime/app-server'

class FakeCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly writes: string[] = []
  killed = false
  killSignal: NodeJS.Signals | number | undefined

  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.writes.push(chunk.toString())
      callback()
    }
  })

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true
    this.killSignal = signal
    queueMicrotask(() => {
      this.emit('close', null, typeof signal === 'string' ? signal : null)
    })
    return true
  }

  emitStdout(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  emitRawStdout(line: string): void {
    this.stdout.write(`${line}\n`)
  }

  writtenMessages(): Record<string, unknown>[] {
    return this.writes
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

function createHarness(options: Partial<CodexAppServerJsonRpcClientOptions> = {}) {
  const fake = new FakeCodexProcess()
  const spawnCalls: Array<{
    command: string
    args: string[]
    options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] }
  }> = []
  const spawnProcess: SpawnCodexAppServerProcess = (command, args, spawnOptions) => {
    spawnCalls.push({
      command,
      args: [...args],
      options: spawnOptions
    })
    return fake as unknown as CodexAppServerProcess
  }
  const client = createCodexAppServerClient({
    cwd: '/tmp/workspace',
    env: { PATH: '/bin' },
    spawnProcess,
    ...options
  })
  return { client, fake, spawnCalls }
}

describe('AsyncEventQueue', () => {
  it('yields queued values and ends pending iterators', async () => {
    const queue = new AsyncEventQueue<string>()
    const iterator = queue[Symbol.asyncIterator]()

    queue.push('one')
    await expect(iterator.next()).resolves.toEqual({ value: 'one', done: false })

    const pending = iterator.next()
    queue.end()

    await expect(pending).resolves.toEqual({ value: undefined, done: true })
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })
})

describe('createCodexAppServerClient', () => {
  it('exports channel names expected by Codex main IPC wrappers', () => {
    expect(CODEX_MAIN_IPC_CHANNELS).toEqual({
      connect: 'codex:connect',
      threadList: 'codex:thread:list',
      threadStart: 'codex:thread:start',
      threadRead: 'codex:thread:read',
      threadRename: 'codex:thread:rename',
      threadDelete: 'codex:thread:delete',
      turnStart: 'codex:turn:start',
      turnInterrupt: 'codex:turn:interrupt',
      turnSteer: 'codex:turn:steer',
      event: 'codex:event',
      error: 'codex:error',
      closed: 'codex:closed'
    })
  })

  it('starts codex app-server on stdio and completes initialize handshake', async () => {
    const { client, fake, spawnCalls } = createHarness()

    const initialize = client.connect()

    expect(spawnCalls).toEqual([{
      command: 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      options: {
        cwd: '/tmp/workspace',
        env: { PATH: '/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true
      }
    }])
    expect(fake.writtenMessages()).toEqual([{
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'sciforge',
          title: 'SciForge',
          version: '0.1.0'
        },
        capabilities: {
          experimentalApi: true
        }
      }
    }])

    fake.emitStdout({
      id: 1,
      result: {
        userAgent: 'Codex Desktop/0.141.0 (Mac OS 15.7.4; arm64) dumb (sciforge; 0.1.0)',
        codexHome: '/tmp/codex-home',
        platformFamily: 'unix',
        platformOs: 'linux'
      }
    })

    await expect(initialize).resolves.toEqual({
      userAgent: 'Codex Desktop/0.141.0 (Mac OS 15.7.4; arm64) dumb (sciforge; 0.1.0)',
      codexHome: '/tmp/codex-home',
      platformFamily: 'unix',
      platformOs: 'linux'
    })
    expect(fake.writtenMessages()[1]).toEqual({ method: 'initialized' })
  })

  it('reuses the initialize handshake across repeated connect calls', async () => {
    const { client, fake } = createHarness()

    const first = client.connect()
    const response = {
      userAgent: 'Codex Desktop/0.141.0 (test)',
      codexHome: '/tmp/codex-home',
      platformFamily: 'unix',
      platformOs: 'linux'
    }
    fake.emitStdout({ id: 1, result: response })

    await expect(first).resolves.toEqual(response)
    await expect(client.connect()).resolves.toEqual(response)

    expect(fake.writtenMessages().filter((message) => message.method === 'initialize')).toHaveLength(1)
  })

  it('sends thread and turn JSON-RPC requests over newline-delimited JSON', async () => {
    const { client, fake } = createHarness()

    const initialize = client.initialize()
    fake.emitStdout({ id: 1, result: { ok: true } })
    await initialize

    const started = client.startThread({
      cwd: '/tmp/workspace',
      model: 'gpt-5',
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      ephemeral: true,
      serviceName: 'SciForge'
    })
    fake.emitStdout({ id: 2, result: { thread: { id: 'thread-1' } } })
    await expect(started).resolves.toEqual({ thread: { id: 'thread-1' } })

    const resumed = client.resumeThread({
      threadId: 'thread-1',
      cwd: '/tmp/workspace',
      model: 'gpt-5',
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access'
    })
    fake.emitStdout({ id: 3, result: { thread: { id: 'thread-1' } } })
    await expect(resumed).resolves.toEqual({ thread: { id: 'thread-1' } })

    const turn = client.startTurn({
      threadId: 'thread-1',
      cwd: '/tmp/workspace',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/tmp/workspace'], networkAccess: true }
    })
    fake.emitStdout({ id: 4, result: { turn: { id: 'turn-1' } } })
    await expect(turn).resolves.toEqual({ turn: { id: 'turn-1' } })

    const interrupted = client.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1' })
    fake.emitStdout({ id: 5, result: { ok: true } })
    await expect(interrupted).resolves.toEqual({ ok: true })

    const steered = client.steerTurn({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'continue', text_elements: [] }]
    })
    fake.emitStdout({ id: 6, result: { ok: true } })
    await expect(steered).resolves.toEqual({ ok: true })

    expect(fake.writes.join('').endsWith('\n')).toBe(true)
    expect(fake.writtenMessages().map((message) => message.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'thread/resume',
      'turn/start',
      'turn/interrupt',
      'turn/steer'
    ])
  })

  it('times out a stalled turn/start request and ignores its late response', async () => {
    const { client, fake } = createHarness({ turnStartTimeoutMs: 20 })

    const stalledTurn = client.startTurn({
      threadId: 'thread-stalled',
      cwd: '/tmp/workspace',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/tmp/workspace'] }
    })

    expect(fake.writtenMessages()).toEqual([expect.objectContaining({
      id: 1,
      method: 'turn/start'
    })])
    await expect(stalledTurn).rejects.toThrow(
      'Codex app-server did not acknowledge turn/start within 20 ms.'
    )

    // A response that arrives after the timeout must not settle a later
    // request or leave the client unusable.
    fake.emitStdout({ id: 1, result: { turn: { id: 'turn-too-late' } } })
    const read = client.readThread({ threadId: 'thread-stalled' })
    fake.emitStdout({ id: 2, result: { thread: { id: 'thread-stalled' }, turns: [] } })
    await expect(read).resolves.toEqual({
      thread: { id: 'thread-stalled' },
      turns: []
    })

    await client.stop()
  })

  it('repairs lone surrogates in nested JSON-RPC keys and values without poisoning later requests', async () => {
    const { client, fake } = createHarness()
    const loneHigh = '\ud800'
    const loneLow = '\udc00'

    const unicodeRequest = client.request('test/nested-unicode', {
      [`high-${loneHigh}`]: {
        [`low-${loneLow}`]: [
          `value-${loneHigh}`,
          { nested: `value-${loneLow}` }
        ]
      }
    })

    expect(fake.writtenMessages()).toEqual([{
      id: 1,
      method: 'test/nested-unicode',
      params: {
        'high-�': {
          'low-�': [
            'value-�',
            { nested: 'value-�' }
          ]
        }
      }
    }])
    expect(fake.writes[0]).not.toMatch(/\\u(?:d800|dc00)/iu)
    fake.emitStdout({ id: 1, result: { ok: true } })
    await expect(unicodeRequest).resolves.toEqual({ ok: true })

    const read = client.readThread({ threadId: 'thread-after-unicode' })
    fake.emitStdout({ id: 2, result: { thread: { id: 'thread-after-unicode' }, turns: [] } })
    await expect(read).resolves.toEqual({
      thread: { id: 'thread-after-unicode' },
      turns: []
    })

    await client.stop()
  })

  it('provides thread list/read/rename/delete methods for IPC wrappers', async () => {
    const { client, fake } = createHarness()

    client.start()

    const list = client.listThreads({ limit: 25 })
    fake.emitStdout({ id: 1, result: { threads: [] } })
    await expect(list).resolves.toEqual({ threads: [] })

    const read = client.readThread({ threadId: 'thread-1' })
    fake.emitStdout({ id: 2, result: { thread: { id: 'thread-1' }, turns: [] } })
    await expect(read).resolves.toEqual({ thread: { id: 'thread-1' }, turns: [] })

    const rename = client.renameThread({ threadId: 'thread-1', title: 'Next title' })
    fake.emitStdout({ id: 3, result: { thread: { id: 'thread-1', title: 'Next title' } } })
    await expect(rename).resolves.toEqual({ thread: { id: 'thread-1', title: 'Next title' } })

    const deletion = client.deleteThread({ threadId: 'thread-1' })
    fake.emitStdout({ id: 4, result: { ok: true } })
    await expect(deletion).resolves.toEqual({ ok: true })

    expect(fake.writtenMessages()).toEqual([
      { id: 1, method: 'thread/list', params: { limit: 25 } },
      { id: 2, method: 'thread/read', params: { threadId: 'thread-1' } },
      { id: 3, method: 'thread/name/set', params: { threadId: 'thread-1', name: 'Next title' } },
      { id: 4, method: 'thread/delete', params: { threadId: 'thread-1' } }
    ])
  })

  it('uses the typed app-server hook discovery and config write endpoints', async () => {
    const { client, fake } = createHarness()

    client.start()
    const hooks = client.listHooks(['/tmp/workspace'])
    fake.emitStdout({
      id: 1,
      result: {
        data: [{
          cwd: '/tmp/workspace',
          hooks: [],
          warnings: [],
          errors: []
        }]
      }
    })
    await expect(hooks).resolves.toMatchObject({
      data: [{ cwd: '/tmp/workspace', hooks: [] }]
    })

    const write = client.writeConfigBatch({
      edits: [{
        keyPath: 'hooks.state',
        value: {
          'owned-hook-key': {
            enabled: true,
            trusted_hash: `sha256:${'a'.repeat(64)}`
          }
        },
        mergeStrategy: 'upsert'
      }],
      filePath: '/tmp/codex-home/config.toml',
      reloadUserConfig: true
    })
    fake.emitStdout({
      id: 2,
      result: {
        status: 'ok',
        version: '2',
        filePath: '/tmp/codex-home/config.toml',
        overriddenMetadata: null
      }
    })
    await expect(write).resolves.toMatchObject({ status: 'ok', version: '2' })

    expect(fake.writtenMessages()).toEqual([
      {
        id: 1,
        method: 'hooks/list',
        params: { cwds: ['/tmp/workspace'] }
      },
      {
        id: 2,
        method: 'config/batchWrite',
        params: {
          edits: [{
            keyPath: 'hooks.state',
            value: {
              'owned-hook-key': {
                enabled: true,
                trusted_hash: `sha256:${'a'.repeat(64)}`
              }
            },
            mergeStrategy: 'upsert'
          }],
          filePath: '/tmp/codex-home/config.toml',
          reloadUserConfig: true
        }
      }
    ])
  })

  it('exposes the Codex-managed ChatGPT account lifecycle without handling tokens', async () => {
    const { client, fake } = createHarness()

    client.start()

    const account = client.readAccount({ refreshToken: true })
    fake.emitStdout({
      id: 1,
      result: {
        account: { type: 'chatgpt', email: 'user@example.com', planType: 'plus' },
        requiresOpenaiAuth: true
      }
    })
    await expect(account).resolves.toMatchObject({
      account: { type: 'chatgpt', planType: 'plus' },
      requiresOpenaiAuth: true
    })

    const browserLogin = client.startAccountLogin({ type: 'chatgpt' })
    fake.emitStdout({
      id: 2,
      result: { type: 'chatgpt', loginId: 'login-browser', authUrl: 'https://auth.example/login' }
    })
    await expect(browserLogin).resolves.toMatchObject({ loginId: 'login-browser' })

    const deviceLogin = client.startAccountLogin({ type: 'chatgptDeviceCode' })
    fake.emitStdout({
      id: 3,
      result: {
        type: 'chatgptDeviceCode',
        loginId: 'login-device',
        verificationUrl: 'https://auth.example/device',
        userCode: 'ABCD-EFGH'
      }
    })
    await expect(deviceLogin).resolves.toMatchObject({ loginId: 'login-device' })

    const rateLimits = client.readAccountRateLimits()
    fake.emitStdout({
      id: 4,
      result: {
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: null,
          credits: null,
          individualLimit: null,
          planType: 'plus',
          rateLimitReachedType: null
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: null
      }
    })
    await expect(rateLimits).resolves.toMatchObject({
      rateLimits: { limitId: 'codex', planType: 'plus' }
    })

    const logout = client.logoutAccount()
    fake.emitStdout({ id: 5, result: {} })
    await expect(logout).resolves.toEqual({})

    expect(fake.writtenMessages()).toEqual([
      { id: 1, method: 'account/read', params: { refreshToken: true } },
      { id: 2, method: 'account/login/start', params: { type: 'chatgpt' } },
      { id: 3, method: 'account/login/start', params: { type: 'chatgptDeviceCode' } },
      { id: 4, method: 'account/rateLimits/read' },
      { id: 5, method: 'account/logout' }
    ])
  })

  it('publishes stdout notifications and invalid JSON warnings to subscribers', async () => {
    const { client, fake } = createHarness()
    const iterator = client.subscribe()[Symbol.asyncIterator]()

    client.start()
    fake.emitStdout({ method: 'turn/event', params: { threadId: 'thread-1', turnId: 'turn-1' } })
    fake.emitRawStdout('{not-json')

    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:event',
        type: 'event',
        payload: { method: 'turn/event', params: { threadId: 'thread-1', turnId: 'turn-1' } }
      },
      done: false
    })
    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:event',
        type: 'event',
        payload: {
          method: 'warning',
          params: {
            message: 'Codex app-server emitted invalid JSON.',
            text: '{not-json'
          }
        }
      },
      done: false
    })

    await client.stop()
    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:closed',
        type: 'closed',
        reason: 'stopped'
      },
      done: false
    })
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('publishes new top-level app-server session events to subscribers', async () => {
    const { client, fake } = createHarness()
    const iterator = client.subscribe()[Symbol.asyncIterator]()

    client.start()
    const responseItem = {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello' }]
      }
    }
    const eventMessage = {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: 'turn-1'
      }
    }
    fake.emitStdout(responseItem)
    fake.emitStdout(eventMessage)

    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:event',
        type: 'event',
        payload: responseItem
      },
      done: false
    })
    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:event',
        type: 'event',
        payload: eventMessage
      },
      done: false
    })

    await client.stop()
  })

  it('answers server-originated JSON-RPC requests with conservative defaults', async () => {
    const { client, fake } = createHarness()

    client.start()
    fake.emitStdout({ id: 'server-1', method: 'item/permissions/requestApproval', params: {} })
    fake.emitStdout({ id: 'server-2', method: 'mcpServer/elicitation/request', params: {} })
    fake.emitStdout({ id: 'server-3', method: 'item/tool/requestUserInput', params: {} })
    fake.emitStdout({ id: 'server-4', method: 'execCommandApproval', params: {} })
    fake.emitStdout({ id: 'server-5', method: 'applyPatchApproval', params: {} })

    await vi.waitFor(() => {
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-1',
        result: { permissions: {}, scope: 'turn' }
      })
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-2',
        result: { action: 'cancel', content: null }
      })
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-3',
        result: { answers: {} }
      })
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-4',
        result: { decision: 'decline' }
      })
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-5',
        result: { decision: 'decline' }
      })
    })
  })

  it('fails legacy user-input server requests closed', async () => {
    const { client, fake } = createHarness()
    const iterator = client.subscribe()[Symbol.asyncIterator]()

    client.start()
    fake.emitStdout({ id: 'server-legacy-input', method: 'request_user_input', params: {} })

    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:error',
        type: 'error',
        error: {
          message: 'Codex requested an unsupported operation and it was declined.'
        }
      },
      done: false
    })
    await vi.waitFor(() => {
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-legacy-input',
        error: {
          code: -32000,
          message: 'Unsupported Codex app-server request: request_user_input'
        }
      })
    })
  })

  it('keeps known server-originated approval requests pending until resolved by request id', async () => {
    const pendingRequests: unknown[] = []
    const { client, fake } = createHarness({
      pendingServerRequests: {
        onPendingRequest: (request) => pendingRequests.push(request)
      }
    })

    client.start()
    fake.emitStdout({
      id: 'server-approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        command: 'npm test'
      }
    })

    await vi.waitFor(() => {
      expect(pendingRequests).toEqual([
        expect.objectContaining({
          requestId: 'server-approval-1',
          kind: 'approval',
          threadId: 'thread-1',
          turnId: 'turn-1'
        })
      ])
    })
    expect(fake.writtenMessages()).toEqual([])

    client.resolveServerRequest('server-approval-1', { decision: 'decline' })

    await vi.waitFor(() => {
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-approval-1',
        result: { decision: 'decline' }
      })
    })
  })

  it('answers server-originated dynamic tool calls through the configured request handler', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'dynamic-ok' }],
      success: true
    }))
    const { client, fake } = createHarness({
      pendingServerRequests: { onToolCallRequest }
    })

    client.start()
    fake.emitStdout({
      id: 'server-tool-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-1',
        namespace: 'mcp_server',
        tool: 'lookup',
        arguments: { id: 'ABC-123' }
      }
    })

    await vi.waitFor(() => {
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-tool-1',
        result: {
          contentItems: [{ type: 'inputText', text: 'dynamic-ok' }],
          success: true
        }
      })
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'server-tool-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: 'mcp_server',
      tool: 'lookup',
      arguments: { id: 'ABC-123' }
    })
  })

  it('publishes a safe error and fails closed for unsupported server-originated requests', async () => {
    const { client, fake } = createHarness()
    const iterator = client.subscribe()[Symbol.asyncIterator]()

    client.start()
    fake.emitStdout({
      id: 'server-unknown-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        rawJson: { apiKey: 'secret' }
      }
    })

    await expect(iterator.next()).resolves.toEqual({
      value: {
        channel: 'codex:error',
        type: 'error',
        error: {
          message: 'Codex requested an unsupported operation and it was declined.'
        }
      },
      done: false
    })
    await vi.waitFor(() => {
      expect(fake.writtenMessages()).toContainEqual({
        id: 'server-unknown-1',
        error: {
          code: -32000,
          message: 'Unsupported Codex app-server request: item/tool/call'
        }
      })
    })
  })

  it('rejects pending requests and terminates the process on stop', async () => {
    const { client, fake } = createHarness()
    const pending = client.request('turn/start', { threadId: 'thread-1' })
    const expectation = expect(pending).rejects.toThrow('Codex app-server client stopped.')

    await client.stop()

    expect(fake.killed).toBe(true)
    expect(fake.killSignal).toBe('SIGTERM')
    await expectation
  })
})
