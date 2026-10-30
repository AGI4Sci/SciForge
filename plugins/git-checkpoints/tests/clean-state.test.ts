/**
 * Clean-state evidence: the plugin core holds no global state, keeps no open
 * handles after calls, behaves deterministically across fresh instances and
 * under concurrency, and does not accumulate memory. This is why the adapter
 * needs no deactivate/dispose hook of its own.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { GitCheckpointService } from '../src/core/service.js'
import { createCheckpoint, listCheckpoints, previewCheckpoint } from '../src/core/operations.js'
import { scriptedClock, scriptedIds, scriptedVcs, WORKSPACE } from './cases.js'

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'clean-state-'))
  roots.push(path)
  return path
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
  const service = new GitCheckpointService({
    userDataDir: await tempRoot(),
    vcs: scriptedVcs().vcs,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  await service.list({})
  const before = activeHandles()
  for (let index = 0; index < 100; index++) {
    await createCheckpoint(service, {
      runtimeId: 'codex',
      threadId: `thread-${index}`,
      workspaceRoot: WORKSPACE
    }, WORKSPACE)
    await listCheckpoints(service, {}, WORKSPACE)
  }
  const after = activeHandles()
  assert.deepEqual(after, before)
})

test('fresh instances with identical inputs produce identical outputs', async () => {
  const run = async () => {
    const service = new GitCheckpointService({
      userDataDir: await tempRoot(),
      vcs: scriptedVcs().vcs,
      now: scriptedClock(),
      createId: scriptedIds()
    })
    const created = await createCheckpoint(service, {
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      workspaceRoot: WORKSPACE
    }, WORKSPACE)
    const listed = await listCheckpoints(service, {}, WORKSPACE)
    return { created: created.output, listed: listed.output }
  }
  assert.deepEqual(await run(), await run())
})

test('50 concurrent operations all settle with consistent results', async () => {
  const service = new GitCheckpointService({
    userDataDir: await tempRoot(),
    vcs: scriptedVcs().vcs,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      index % 2 === 0
        ? createCheckpoint(service, {
            runtimeId: 'codex',
            threadId: `thread-${index}`,
            workspaceRoot: WORKSPACE
          }, WORKSPACE)
        : listCheckpoints(service, {}, WORKSPACE)
    )
  )
  for (const result of results) {
    assert.equal(result.output.ok, true)
  }
  const listed = await listCheckpoints(service, {}, WORKSPACE)
  assert.equal(listed.output.ok, true)
  if (listed.output.ok) assert.equal(listed.output.value.length, 25)
})

test('memory stays bounded across thousands of operations', async () => {
  const service = new GitCheckpointService({
    userDataDir: await tempRoot(),
    vcs: scriptedVcs().vcs,
    now: scriptedClock(),
    createId: scriptedIds()
  })
  global.gc?.()
  const before = process.memoryUsage().heapUsed
  for (let index = 0; index < 2_000; index++) {
    await previewCheckpoint(service, { checkpointId: 'missing-checkpoint' }, WORKSPACE)
  }
  global.gc?.()
  const growth = process.memoryUsage().heapUsed - before
  assert.ok(growth < 60 * 1024 * 1024, `heap grew by ${growth} bytes`)
})
