/**
 * Clean-state evidence: the plugin holds no global state beyond the lazy
 * per-workspace service cache, leaves no persistent handles behind and
 * behaves deterministically across fresh factories and under concurrency.
 * This is why the adapter needs no deactivate/dispose hook of its own.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mapData, plottingStatus } from '../src/core/operations.js'
import { createScientificPlottingServiceFactory } from '../src/core/service-factory.js'

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function tempWorkspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'plotting-clean-state-'))
  roots.push(path)
  return path
}

function activeHandles(): readonly string[] {
  // FS request wrappers are transient (they always settle); persistent
  // handles (Timer, PipeWrap, sockets, watchers) are what a leak looks like.
  return process.getActiveResourcesInfo()
    .filter((name) => name !== 'MessagePort')
    .map((name) => (name === 'FSReqPromise' || name === 'CloseReq' || name === 'FSReqCallback' ? 'FSRequest' : name))
    .filter((name) => name !== 'FSRequest')
    .sort()
}

const PLAN = {
  planId: 'plan-clean-1',
  route: 'code',
  routeLocked: true,
  rationale: 'clean-state',
  sourceArtifacts: [],
  reproducibleInputs: ['inline-data'],
  lockedElements: ['all'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'draft_ready',
  fallbackPolicy: 'fail_closed'
} as const

test('200 status reads leave no new persistent handles', async () => {
  const factory = createScientificPlottingServiceFactory()
  await plottingStatus(factory, {})
  const before = activeHandles()
  for (let index = 0; index < 200; index += 1) {
    await plottingStatus(factory, {})
  }
  assert.deepEqual(activeHandles(), before)
})

test('fresh factories with identical inputs produce identical outputs', async () => {
  const workspaceRoot = await tempWorkspace()
  const run = async () => {
    const factory = createScientificPlottingServiceFactory()
    const result = await mapData(factory, {
      operationId: 'clean-state-map-0001',
      task: 'Clean-state mapping',
      visualPlan: PLAN,
      data: { series: [{ name: 'S1', x: [1, 2], y: [3, 4] }] },
      templateHint: 'scatter'
    }, workspaceRoot)
    return result.output
  }
  assert.deepEqual(await run(), await run())
})

test('50 concurrent operations all settle with consistent results', async () => {
  const workspaceRoot = await tempWorkspace()
  const factory = createScientificPlottingServiceFactory()
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      mapData(factory, {
        operationId: `clean-state-map-${String(index).padStart(4, '0')}`,
        task: 'Clean-state mapping',
        visualPlan: PLAN,
        data: { series: [{ name: 'S1', x: [1, 2], y: [3, 4] }] },
        templateHint: 'scatter'
      }, workspaceRoot))
  )
  for (const result of results) {
    assert.equal((result.output as { ok: boolean }).ok, true)
  }
})
