import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDelegateTaskInput, runDelegateTask } from './delegate-task.js'
import { MultiAgentRuntime } from './runtime.js'
import { InMemoryMultiAgentStore } from './store.js'

test('delegate_task input/output uses the generic public contract', async () => {
  assert.deepEqual(parseDelegateTaskInput({
    prompt: '  Investigate  ',
    label: '  Research  ',
    workspace: '  /tmp/work  ',
    model: '  router-model  '
  }), {
    prompt: 'Investigate',
    label: 'Research',
    workspace: '/tmp/work',
    model: 'router-model'
  })

  const runtime = new MultiAgentRuntime({
    store: new InMemoryMultiAgentStore(),
    idGenerator: () => 'child-1',
    executor: async () => ({
      summary: 'Investigation complete',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    })
  })

  const output = await runDelegateTask(runtime, {
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Investigate',
    model: 'router-model'
  })

  assert.deepEqual(output, {
    childId: 'child-1',
    status: 'completed',
    summary: 'Investigation complete',
    usage: {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3
    }
  })
})

test('delegate_task reports preflight errors without runtime-specific fields', async () => {
  const runtime = new MultiAgentRuntime({
    config: { enabled: false },
    store: new InMemoryMultiAgentStore(),
    executor: async () => ({ summary: 'unreachable' })
  })

  const output = await runDelegateTask(runtime, {
    parentThreadId: 'thread-1',
    parentTurnId: 'turn-1',
    prompt: 'Investigate'
  })

  assert.equal(output.status, 'failed')
  assert.equal(output.error?.code, 'config_disabled')
  assert.equal('warning' in output, false)
})

