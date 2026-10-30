import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { requestManagedRuntimeQuit } from './managed-runtime-quit'
import { createAgentRuntimeHost } from './host'
import type { AgentRuntimeAdapter } from './adapter'
import type { AgentRuntimeEvent } from '../../../shared/agent-runtime-contract'
import { normalizeAppSettings, type AppSettingsV1 } from '../../../shared/app-settings'

/** Execute the unchanged production shutdown functions and listener, not a helper-only facsimile.
 * index.ts has unconditional Electron startup; AST selection excludes unrelated startup effects.
 */
function mainShutdownHarness(host: {
  close(stop?: () => Promise<void>): Promise<void>
  retryEventCaptures(): Promise<void>
}) {
  const source = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  const functions = ['stopManagedRuntimes', 'stopManagedRuntimesForQuit']
  const selected = file.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && functions.includes(node.name?.text ?? '')) ||
    (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(file) === 'app.on' &&
      node.expression.arguments[0]?.getText(file) === "'before-quit'")
  )
  expect(selected).toHaveLength(3)
  const order: string[] = []
  const app = Object.assign(new EventEmitter(), {
    quit: vi.fn(() => { app.emit('before-quit', { preventDefault: vi.fn() }) }),
    getPath: () => '/synthetic-profile'
  })
  const context = createContext({
    app, requestManagedRuntimeQuit, console: { warn: vi.fn() }, logWarn: vi.fn(),
    isQuitting: false, managedRuntimesStoppedForQuit: false, managedRuntimesStopPromise: null,
    managedRuntimesCaptureRecoveryPending: false, managedRuntimesQuitPending: false,
    cancelCodexRuntimePrewarm: vi.fn(), scheduleRuntime: null,
    claudeCodeRuntime: { stop: vi.fn(async () => { order.push('claude-stop') }) },
    codexRuntime: { stop: vi.fn(async () => { order.push('codex-stop') }) },
    agentRuntimeHostForShutdown: host,
    portablePrincipalSubscriptionForShutdown: null, portableResourceReferencesForShutdown: null,
    mainRuntimeContributions: null, hostFileTransfersForShutdown: null,
    hostExternalNavigationForShutdown: null, workspaceHostSessionManagerForShutdown: null,
    domainExecutionEventsForShutdown: null, turnArtifactHandoffForShutdown: null,
    workspaceEgressServiceForShutdown: null, codeNavigationService: null,
    domainModuleCatalog: null, runtimeMcpToolGateway: null,
    stopModelAccessGatewaySidecar: vi.fn(async () => undefined)
  })
  runInContext(ts.transpileModule(selected.map(node => node.getText(file)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, context)
  return { app, context, order, quit: () => {
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    return event
  } }
}

it('production before-quit retains failed capture ownership and retries before Session close on a later quit', async () => {
  const failure = new Error('accepted suffix is still obstructed')
  let obstructed = true
  let acceptedSuffix = 2
  const host = {
    close: vi.fn(async (stop?: () => Promise<void>) => {
      await stop?.()
      harness.order.push('capture-close')
      if (acceptedSuffix) throw failure
    }),
    retryEventCaptures: vi.fn(async () => {
      harness.order.push('capture-retry')
      if (obstructed) throw failure
      acceptedSuffix = 0
    })
  }
  const harness = mainShutdownHarness(host)
  expect(harness.quit().preventDefault).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(harness.context.isQuitting).toBe(false))
  expect(harness.context.agentRuntimeHostForShutdown).toBe(host)
  expect(harness.context.managedRuntimesStoppedForQuit).toBe(false)
  expect(harness.app.quit).not.toHaveBeenCalled()
  harness.quit()
  await vi.waitFor(() => expect(host.retryEventCaptures).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(harness.context.isQuitting).toBe(false))
  expect(acceptedSuffix).toBe(2)
  expect(harness.app.quit).not.toHaveBeenCalled()
  obstructed = false
  harness.quit()
  await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledOnce())
  expect(host.retryEventCaptures).toHaveBeenCalledTimes(2)
  expect(harness.context.agentRuntimeHostForShutdown).toBeNull()
  expect(harness.context.managedRuntimesStoppedForQuit).toBe(true)
  expect(harness.order).toEqual([
    'claude-stop', 'codex-stop', 'capture-close',
    'claude-stop', 'codex-stop', 'capture-retry',
    'claude-stop', 'codex-stop', 'capture-retry', 'capture-close'
  ])
  expect(harness.app.listenerCount('before-quit')).toBe(1)
})

it('production before-quit preserves a real Host capture after producer failure and writes late seq2 before Session disposal', async () => {
  const barrier = () => {
    let resolve!: () => void
    const promise = new Promise<void>(done => { resolve = done })
    return { promise, resolve }
  }
  const entered = barrier(), late = barrier(), ended = barrier()
  const accepted: number[] = []
  let signal: AbortSignal | undefined
  let running = true
  const unused = async (): Promise<never> => { throw new Error('Unexpected synthetic adapter operation.') }
  const adapter: AgentRuntimeAdapter = {
    id: 'codex', transport: 'jsonrpc_stdio',
    probe: unused, connect: unused, capabilities: unused, listThreads: unused, startThread: unused,
    readThreadStatus: unused, readThreadPage: unused, readToolArtifact: unused,
    interruptTurn: unused, steerTurn: unused, renameThread: unused, deleteThread: unused, usage: unused,
    startTurn: vi.fn(async () => ({ threadId: 'quit-thread', turnId: 'quit-turn' })),
    subscribeEvents: vi.fn(async function* (_context, input) {
      signal = input.signal
      const aborted = new Promise<void>(resolve => input.signal?.addEventListener('abort', () => resolve(), { once: true }))
      yield { kind: 'turn_lifecycle', runtimeId: 'codex', threadId: 'quit-thread', turnId: 'quit-turn', state: 'running', seq: 1 } satisfies AgentRuntimeEvent
      entered.resolve()
      await Promise.race([late.promise, aborted])
      if (input.signal?.aborted) return
      yield { kind: 'turn_lifecycle', runtimeId: 'codex', threadId: 'quit-thread', turnId: 'quit-turn', state: 'running', seq: 2 } satisfies AgentRuntimeEvent
      await Promise.race([ended.promise, aborted])
    })
  }
  const host = createAgentRuntimeHost({
    settings: () => normalizeAppSettings({ activeAgentRuntime: 'codex' } as AppSettingsV1),
    adapters: [adapter], services: { sessions: { observeEvent: async event => { accepted.push(event.seq!) } } }
  })
  const dispose = vi.spyOn(host, 'dispose')
  const retry = vi.spyOn(host, 'retryEventCaptures')
  const harness = mainShutdownHarness(host)
  const sessionClose = vi.fn(async () => {
    expect(running).toBe(false)
    expect(accepted).toEqual([1, 2])
    expect(dispose).toHaveBeenCalledOnce()
    harness.order.push('session-close')
  })
  harness.context.domainExecutionEventsForShutdown = { close: sessionClose }
  const stop = vi.fn(async () => {
    if (running) throw new Error('Producer still running.')
    ended.resolve()
  })
  harness.context.codexRuntime = { stop }
  try {
    await host.startTurn({ runtimeId: 'codex', threadId: 'quit-thread', text: 'Synthetic shutdown tail.' })
    await entered.promise
    harness.quit()
    await vi.waitFor(() => expect(harness.context.isQuitting).toBe(false))
    expect(harness.context.agentRuntimeHostForShutdown).toBe(host)
    expect(harness.context.domainExecutionEventsForShutdown).toEqual({ close: sessionClose })
    expect(signal?.aborted).toBe(false)
    expect(dispose).not.toHaveBeenCalled()
    expect(sessionClose).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
    late.resolve()
    await vi.waitFor(() => expect(accepted).toEqual([1, 2]))
    // A second failed quit must retain the same live owner rather than restore admission.
    harness.quit()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(harness.context.isQuitting).toBe(false))
    expect(retry).not.toHaveBeenCalled()
    expect(signal?.aborted).toBe(false)
    expect(harness.context.agentRuntimeHostForShutdown).toBe(host)
    await expect(host.startTurn({ runtimeId: 'codex', threadId: 'quit-thread', text: 'Still fenced.' })).rejects.toThrow(/closing/)
    running = false
    harness.quit()
    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledOnce())
    expect(stop).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledOnce()
    expect(sessionClose).toHaveBeenCalledOnce()
    expect(adapter.subscribeEvents).toHaveBeenCalledOnce()
    expect(accepted).toEqual([1, 2])
    expect(harness.context.agentRuntimeHostForShutdown).toBeNull()
    expect(harness.context.domainExecutionEventsForShutdown).toBeNull()
    expect(harness.context.managedRuntimesStoppedForQuit).toBe(true)
  } finally { late.resolve(); ended.resolve(); host.dispose() }
})

it('production before-quit coalesces repeated requests while drain is pending without recursive quit', async () => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const host = {
    close: vi.fn(async (stop?: () => Promise<void>) => { await stop?.(); await barrier }),
    retryEventCaptures: vi.fn(async () => undefined)
  }
  const harness = mainShutdownHarness(host)
  const first = harness.quit()
  const second = harness.quit()
  expect(first.preventDefault).toHaveBeenCalledOnce()
  expect(second.preventDefault).toHaveBeenCalledOnce()
  expect(host.close).toHaveBeenCalledOnce()
  expect(harness.app.quit).not.toHaveBeenCalled()
  release()
  // app.quit itself emits before-quit; completed shutdown must not start another drain.
  await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledOnce())
  expect(host.close).toHaveBeenCalledOnce()
  expect(harness.app.listenerCount('before-quit')).toBe(1)
})

it('failed managed runtime drain reports failure without marking shutdown complete or quitting', async () => {
  const path = './managed-runtime-quit'
  const module = await import(path).catch(() => undefined) as { requestManagedRuntimeQuit: (options: { stop(): Promise<void>; quit(): void; onFailure(error: unknown): void }) => Promise<boolean> } | undefined
  expect(typeof module?.requestManagedRuntimeQuit).toBe('function')
  let stopped = false
  let quits = 0
  const failure = new Error('accepted Session writes remain pending')
  const errors: unknown[] = []
  const result = await module!.requestManagedRuntimeQuit({
    stop: async () => { throw failure },
    quit: () => { stopped = true; quits++ },
    onFailure: error => { errors.push(error) }
  })
  expect(result).toBe(false)
  expect(errors).toEqual([failure])
  expect(stopped).toBe(false)
  expect(quits).toBe(0)
  expect(await module!.requestManagedRuntimeQuit({
    stop: async () => { stopped = true }, quit: () => { quits++ }, onFailure: error => { errors.push(error) }
  })).toBe(true)
  expect(stopped).toBe(true)
  expect(quits).toBe(1)
  expect(errors).toEqual([failure])
})
