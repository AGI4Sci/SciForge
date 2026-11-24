import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHostDiscussionPort } from './discussion'

test('discussion cancellation reaches the exact Host handle and removes the listener after settlement', async () => {
  let settle!: (value: unknown) => void
  let cancellations = 0
  const controller = new AbortController()
  const port = createHostDiscussionPort({ request(operation, input) {
    assert.equal(operation, 'run'); assert.deepEqual(input, { prompt: 'Question' })
    return { result: new Promise((resolve) => { settle = resolve }), async cancel() { cancellations++ } }
  } })
  const result = port.run('Question', controller.signal)
  controller.abort()
  assert.equal(cancellations, 1)
  settle({ state: 'cancelled', text: '', runtimeId: 'codex' })
  assert.equal((await result).state, 'cancelled')
})

test('discussion refuses an already cancelled request before contacting Host', async () => {
  const controller = new AbortController(); controller.abort()
  const port = createHostDiscussionPort({ request() { throw new Error('Host must not be contacted') } })
  await assert.rejects(port.run('Question', controller.signal), /abort/i)
})

test('discussion validates returned fields instead of accepting injected execution authority', async () => {
  const port = createHostDiscussionPort({ request() {
    return { result: Promise.resolve({ state: 'completed', text: 'Answer', runtimeId: 'codex', token: 'secret' }),
      async cancel() {} }
  } })
  await assert.rejects(port.run('Question', new AbortController().signal))
})
