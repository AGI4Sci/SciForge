import { describe, expect, it } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { ContextCompactor } from '../src/loop/context-compactor.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitForValue<T>(
  read: () => T | undefined,
  label: string,
  timeoutMs = 1_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function settleWithin<T>(promise: Promise<T>, label: string, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function historyText(request: ModelRequest): string {
  return request.history
    .map((item) => {
      if (item.kind === 'user_message' || item.kind === 'assistant_text') return item.text
      if (item.kind === 'compaction') return item.summary
      return ''
    })
    .join('\n')
}

describe('AgentLoop multi-turn stress invariants', () => {
  it('interrupts a turn waiting for structured user input', async () => {
    const h = makeHarness({
      provider: 'input-interrupt-stress',
      model: 'input-interrupt-stress',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield {
          kind: 'tool_call_complete',
          callId: 'call_user_input',
          toolName: 'request_user_input',
          arguments: {
            prompt: 'Choose a migration strategy.',
            questions: [{
              header: 'Strategy',
              id: 'strategy',
              question: 'Which strategy?',
              options: [
                { label: 'Incremental', description: 'Migrate in slices.' },
                { label: 'Atomic', description: 'Migrate at once.' }
              ]
            }]
          }
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    })
    await bootstrapThread(h, { request: { prompt: 'Ask before choosing.' } })

    const run = h.loop.runTurn(h.threadId, h.turnId)
    await waitForValue(
      () => h.userInputGate.pending(h.threadId)[0],
      'pending structured input'
    )
    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })

    await expect(settleWithin(run, 'input-interrupted turn')).resolves.toBe('aborted')
    expect(h.userInputGate.pending(h.threadId)).toEqual([])
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.filter((item) => item.status === 'pending' || item.status === 'running')).toEqual([])
  })

  it('resumes after an explicit approval denial without executing the guarded tool', async () => {
    let sideEffects = 0
    let modelCalls = 0
    const guardedMutation = LocalToolHost.defineTool({
      name: 'denied_mutation',
      description: 'Perform one observable mutation.',
      toolKind: 'file_change',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async () => {
        sideEffects += 1
        return { output: { sideEffects } }
      }
    })
    const h = makeHarness({
      provider: 'approval-denial-stress',
      model: 'approval-denial-stress',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelCalls += 1
        if (modelCalls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_denied_mutation',
            toolName: 'denied_mutation',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'The user denied the mutation.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { tools: [guardedMutation] })
    await bootstrapThread(h, {
      request: { prompt: 'Attempt the guarded operation.', approvalPolicy: 'untrusted' }
    })

    let approvalId = ''
    let registeredWhenPublished = false
    const unsubscribe = h.bus.subscribe(h.threadId, (event) => {
      if (event.kind !== 'approval_requested') return
      approvalId = event.approvalId
      registeredWhenPublished = h.approvalGate.get(event.approvalId) !== undefined
      h.approvalGate.decide(event.approvalId, 'deny', 'not authorized')
    })
    const run = h.loop.runTurn(h.threadId, h.turnId)

    await expect(settleWithin(run, 'denied agent turn')).resolves.toBe('completed')
    unsubscribe()
    expect(registeredWhenPublished).toBe(true)
    expect(approvalId).not.toBe('')
    expect(sideEffects).toBe(0)
    expect(modelCalls).toBe(2)
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'approval',
        approvalId,
        status: 'denied'
      }),
      expect.objectContaining({
        kind: 'tool_call',
        callId: 'call_denied_mutation',
        status: 'failed'
      })
    ]))
  })

  it('interrupts a turn waiting on approval without executing the guarded tool', async () => {
    let sideEffects = 0
    let modelCalls = 0
    const guardedMutation = LocalToolHost.defineTool({
      name: 'guarded_mutation',
      description: 'Perform one observable mutation.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value']
      },
      policy: 'auto',
      execute: async () => {
        sideEffects += 1
        return { output: { sideEffects } }
      }
    })
    const model: ModelClient = {
      provider: 'approval-stress',
      model: 'approval-stress',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelCalls += 1
        if (modelCalls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_guarded_mutation',
            toolName: 'guarded_mutation',
            arguments: { value: 'must-not-run' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'No mutation was performed.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { tools: [guardedMutation] })
    await bootstrapThread(h, {
      request: {
        prompt: 'Attempt the guarded operation.',
        approvalPolicy: 'untrusted'
      }
    })

    const run = h.loop.runTurn(h.threadId, h.turnId)
    const approval = await waitForValue(
      () => h.approvalGate.pending(h.threadId)[0],
      'pending approval'
    )

    expect(sideEffects).toBe(0)
    await h.turns.interruptTurn({ threadId: h.threadId, turnId: h.turnId })
    const status = await settleWithin(run, 'interrupted agent turn')

    expect(status).toBe('aborted')
    expect(sideEffects).toBe(0)
    expect(modelCalls).toBe(1)
    expect(h.approvalGate.pending(h.threadId)).toEqual([])
    expect(h.approvalGate.get(approval.id)?.status).toBe('denied')
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items.filter((item) => item.status === 'pending' || item.status === 'running')).toEqual([])
    expect(items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'approval', approvalId: approval.id })
    ]))

    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'approval_resolved',
        approvalId: approval.id,
        status: 'denied'
      })
    ]))
  })

  it('injects live steering into the very next model request', async () => {
    const toolEntered = deferred<void>()
    const releaseTool = deferred<void>()
    const requests: ModelRequest[] = []
    let modelCalls = 0
    const checkpoint = LocalToolHost.defineTool({
      name: 'checkpoint',
      description: 'Pause at a safe tool boundary.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      policy: 'auto',
      execute: async () => {
        toolEntered.resolve()
        await releaseTool.promise
        return { output: { reached: true } }
      }
    })
    const model: ModelClient = {
      provider: 'steering-stress',
      model: 'steering-stress',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        modelCalls += 1
        if (modelCalls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_checkpoint',
            toolName: 'checkpoint',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Steering acknowledged.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { tools: [checkpoint] })
    await bootstrapThread(h, { request: { prompt: 'Begin the investigation.' } })

    const run = h.loop.runTurn(h.threadId, h.turnId)
    await settleWithin(toolEntered.promise, 'checkpoint tool entry')
    const steeringText = 'Change course: preserve module A and use adapter B.'
    await h.turns.steerTurn({ threadId: h.threadId, turnId: h.turnId, text: steeringText })
    releaseTool.resolve()

    const status = await settleWithin(run, 'steered agent turn')

    expect(status).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(historyText(requests[0]!)).not.toContain(steeringText)
    expect(historyText(requests[1]!)).toContain(steeringText)
    expect(requests[1]!.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user_message', text: steeringText })
    ]))
  })

  it('recovers from a pre-output 502 without duplicating a later mutation', async () => {
    let modelCalls = 0
    let mutations = 0
    const applyOnce = LocalToolHost.defineTool({
      name: 'apply_once',
      description: 'Apply one idempotency-sensitive mutation.',
      toolKind: 'file_change',
      inputSchema: {
        type: 'object',
        properties: { operationId: { type: 'string' } },
        required: ['operationId']
      },
      policy: 'auto',
      execute: async () => {
        mutations += 1
        return { output: { mutations } }
      }
    })
    const model: ModelClient = {
      provider: 'recovery-stress',
      model: 'recovery-stress',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        modelCalls += 1
        if (modelCalls === 1) {
          yield {
            kind: 'error',
            message: 'Provider returned HTTP 502 before producing output',
            code: 'response_stream_error'
          }
          return
        }
        if (modelCalls === 2) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_apply_once',
            toolName: 'apply_once',
            arguments: { operationId: 'operation-17' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Mutation completed exactly once.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, { tools: [applyOnce] })
    await bootstrapThread(h, { request: { prompt: 'Apply the requested change once.' } })

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

    expect(status).toBe('completed')
    expect(modelCalls).toBe(3)
    expect(mutations).toBe(1)
    expect(items.filter((item) =>
      item.kind === 'tool_call' && item.callId === 'call_apply_once'
    )).toHaveLength(1)
    expect(items.filter((item) =>
      item.kind === 'tool_result' && item.callId === 'call_apply_once'
    )).toHaveLength(1)
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'model_stream_retry'
    )).toBe(true)
  })

  it('preserves foundational and latest requirements through evolving turns and compaction', async () => {
    const requests: ModelRequest[] = []
    let responseNumber = 0
    const model: ModelClient = {
      provider: 'compaction-stress',
      model: 'compaction-stress',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        requests.push(request)
        responseNumber += 1
        yield { kind: 'assistant_text_delta', text: `Acknowledged revision ${responseNumber}.` }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const h = makeHarness(model, {
      tools: [],
      compactor: new ContextCompactor({ softThreshold: 180, hardThreshold: 360 })
    })
    const rootRequirement = 'ROOT_INVARIANT_17: retain an append-only audit record.'
    await bootstrapThread(h, {
      request: {
        prompt: `${rootRequirement} ${'Initial architectural context. '.repeat(10)}`
      }
    })
    expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')

    for (let revision = 2; revision <= 8; revision += 1) {
      const latestRequirement = revision === 8
        ? 'ACTIVE_SCHEMA_REVISION_8: the public response field is result_v8.'
        : `SCHEMA_REVISION_${revision}: evolve the response contract for stage ${revision}.`
      const started = await h.turns.startTurn({
        threadId: h.threadId,
        request: {
          prompt: `${latestRequirement} ${`Revision ${revision} context. `.repeat(10)}`
        }
      })
      h.turnId = started.turnId
      expect(await h.loop.runTurn(h.threadId, h.turnId)).toBe('completed')
    }

    const finalRequest = requests.at(-1)
    if (!finalRequest) throw new Error('expected a final model request')
    const finalContext = historyText(finalRequest)

    expect(finalRequest.history.some((item) => item.kind === 'compaction')).toBe(true)
    expect(finalContext).toContain(rootRequirement)
    expect(finalContext).toContain('ACTIVE_SCHEMA_REVISION_8')

    const persisted = await h.sessionStore.loadItems(h.threadId)
    expect(persisted.filter((item) => item.kind === 'compaction').length).toBeGreaterThan(0)
  })
})
