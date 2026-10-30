/**
 * Clean-state evidence: the plugin core holds no global state, keeps no open
 * handles after calls and behaves deterministically across fresh instances
 * and under concurrency. This is why the adapter needs no deactivate/dispose
 * hook of its own.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openSession } from '../src/core/operations.js'
import { ChangeInspectorService } from '../src/core/service.js'
import type { ChangeInspectorSessionDetail } from '../src/ports/agent-threads.js'
import { corpusSessions, WORKSPACE } from './cases.js'
import { fakeAgentThreads } from './runner.js'

function serviceWith(sessions: Record<string, ChangeInspectorSessionDetail>): ChangeInspectorService {
  return new ChangeInspectorService({ agentThreads: fakeAgentThreads(sessions) })
}

function activeHandles(): readonly string[] {
  // FSReqPromise/CloseReq are transient fs request wrappers; which one is in
  // flight at sampling time is timing-dependent, so normalize both.
  return process.getActiveResourcesInfo()
    .filter((name) => name !== 'MessagePort')
    .map((name) => (name === 'FSReqPromise' || name === 'CloseReq' ? 'FSRequest' : name))
    .sort()
}

test('200 operations leave no new active handles', async () => {
  const service = serviceWith(corpusSessions())
  await openSession(service, { sessionId: 'thread-plain-diff', runtimeId: 'codex' }, WORKSPACE)
  const before = activeHandles()
  for (let index = 0; index < 200; index += 1) {
    await openSession(service, { sessionId: 'thread-json-keys', runtimeId: 'codex' }, WORKSPACE)
  }
  const after = activeHandles()
  assert.deepEqual(after, before)
})

test('fresh instances with identical inputs produce identical outputs', async () => {
  const run = async () => {
    const service = serviceWith(corpusSessions())
    const result = await openSession(
      service,
      { sessionId: 'thread-nested-changes', runtimeId: 'codex' },
      WORKSPACE
    )
    return result.output
  }
  assert.deepEqual(await run(), await run())
})

test('50 concurrent operations all settle with consistent results', async () => {
  const service = serviceWith(corpusSessions())
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      openSession(
        service,
        { sessionId: index % 2 === 0 ? 'thread-plain-diff' : 'thread-id-fallback', runtimeId: 'codex' },
        WORKSPACE
      ))
  )
  for (const [index, result] of results.entries()) {
    assert.equal(
      result.output.snapshot.changes.length,
      index % 2 === 0 ? 1 : 3,
      `concurrent call ${index} diverged`
    )
  }
})
