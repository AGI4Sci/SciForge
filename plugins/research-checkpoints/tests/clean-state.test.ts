/**
 * Clean-state evidence: the plugin runtime keeps no global state, leaves no
 * open handles behind once deactivated, tears down idempotently and behaves
 * deterministically across fresh instances and under concurrency. This is why
 * the adapter's disposer only needs to deactivate the runtime and abort the
 * fixture controller.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listCheckpoints, readStatus } from '../src/core/operations.js'
import { ResearchCheckpointRuntime } from '../src/core/runtime.js'
import { createFixtureRuntimeContext } from '../src/fixture/config-runtime-context.js'

const WORKSPACE = '/workspace/clean-state'

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function activateRuntime(): Promise<Readonly<{
  runtime: ResearchCheckpointRuntime
  deactivate: () => void | Promise<void>
}>> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'rc-clean-state-'))
  roots.push(userDataDir)
  const controller = new AbortController()
  const runtime = new ResearchCheckpointRuntime({ userDataDir })
  const deactivate = await runtime.activate(
    createFixtureRuntimeContext({ sessions: {}, signal: controller.signal })
  )
  return { runtime, deactivate }
}

function activeHandles(): readonly string[] {
  // FS request wrappers (FSReqPromise/CloseReq/FSReqCallback) are transient:
  // every store read/write resolves them, so whether one is in flight at
  // sampling time is pure timing. They cannot leak, so they are excluded.
  // Persistent handles (Timer, PipeWrap, sockets, watchers) are what a leak
  // would look like.
  return process.getActiveResourcesInfo()
    .filter((name) => name !== 'MessagePort')
    .map((name) => (name === 'FSReqPromise' || name === 'CloseReq' || name === 'FSReqCallback' ? 'FSRequest' : name))
    .filter((name) => name !== 'FSRequest')
    .sort()
}

test('200 operations on an active runtime leave no new active handles', async () => {
  const { runtime, deactivate } = await activateRuntime()
  await readStatus(runtime, { runtimeId: 'codex', threadId: 'thread-1' }, WORKSPACE)
  const before = activeHandles()
  for (let index = 0; index < 200; index += 1) {
    await readStatus(runtime, { runtimeId: 'codex', threadId: 'thread-1' }, WORKSPACE)
  }
  assert.deepEqual(activeHandles(), before)
  await deactivate()
})

test('50 concurrent reads all settle with identical results', async () => {
  const { runtime, deactivate } = await activateRuntime()
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      listCheckpoints(runtime, { runtimeId: 'codex', threadId: 'thread-1' }, WORKSPACE))
  )
  for (const result of results) {
    assert.deepEqual(result.output, { ok: true, value: { records: [] } })
  }
  await deactivate()
})

test('teardown is idempotent and releases its handles', async () => {
  const baseline = activeHandles()
  const { runtime, deactivate } = await activateRuntime()
  await readStatus(runtime, { runtimeId: 'codex', threadId: 'thread-1' }, WORKSPACE)
  await deactivate()
  await deactivate()
  assert.deepEqual(activeHandles(), baseline)
})

test('fresh instances with identical inputs produce identical outputs', async () => {
  const run = async (): Promise<unknown> => {
    const { runtime, deactivate } = await activateRuntime()
    try {
      const result = await readStatus(
        runtime, { runtimeId: 'codex', threadId: 'thread-1' }, WORKSPACE
      )
      return result.output
    } finally {
      await deactivate()
    }
  }
  assert.deepEqual(await run(), await run())
})
