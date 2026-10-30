/**
 * DSH tool wiring tested without the official runtime packages: a fake
 * `defineTool`/register pair verifies the tool names, grant mapping,
 * delegation to the core operations, the workspaceRoot argument split and
 * error behaviour. This is not evidence of compatibility with the official
 * runtime; host-loading.test.ts covers that.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RESEARCH_CHECKPOINT_CAPABILITY_IDS } from '../src/contract.js'
import type { ResearchCheckpointOperationRuntime } from '../src/core/operations.js'
import {
  EXPECTED_HOST_GRANTS,
  registerResearchCheckpointTools,
  researchCheckpointTools
} from '../src/dsh-adapter/tools.js'

const WORKSPACE = '/workspace/dsh-tools'

type CallRecord = Readonly<{ method: string; args: readonly unknown[] }>

function scriptedRuntime(sink: CallRecord[]): ResearchCheckpointOperationRuntime {
  const entry = (method: string, args: readonly unknown[]): unknown => {
    sink.push({ method, args })
    return { sentinel: `scripted-${method}` }
  }
  return {
    start: async (workspace: string, input: never) => entry('start', [workspace, input]) as never,
    stop: async (workspace: string, input: never) => entry('stop', [workspace, input]) as never,
    checkpointStatus: async (workspace: string, runtimeId: string, threadId: string) =>
      entry('checkpointStatus', [workspace, runtimeId, threadId]) as never,
    read: async (workspace: string, input: never) => entry('read', [workspace, input]) as never,
    list: async (workspace: string, input: never) => entry('list', [workspace, input]) as never,
    turnStatus: async (workspace: string, runtimeId: string, threadId: string, turnId: string) =>
      entry('turnStatus', [workspace, runtimeId, threadId, turnId]) as never,
    resolve: async (workspace: string, input: never) => entry('resolve', [workspace, input]) as never,
    restoreAsNew: async (workspace: string, input: never) =>
      entry('restoreAsNew', [workspace, input]) as never,
    previewLegacy: async (workspace: string, input: never) =>
      entry('previewLegacy', [workspace, input]) as never,
    importLegacy: async (workspace: string, input: never) =>
      entry('importLegacy', [workspace, input]) as never
  }
}

test('registers exactly the ten granted tools with matching capability ids', () => {
  const registered: unknown[] = []
  registerResearchCheckpointTools(
    (tool) => { registered.push(tool) },
    (definition) => definition,
    () => scriptedRuntime([])
  )
  assert.equal(registered.length, 10)

  const tools = researchCheckpointTools(() => scriptedRuntime([]))
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['start', 'stop', 'status', 'read', 'list', 'turn_status', 'resolve', 'restore_as_new', 'legacy_preview', 'legacy_import']
  )
  assert.deepEqual(
    Object.fromEntries(Object.entries(EXPECTED_HOST_GRANTS).map(([name, grant]) => [name, grant.id])),
    {
      start: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
      stop: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop,
      status: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
      read: RESEARCH_CHECKPOINT_CAPABILITY_IDS.read,
      list: RESEARCH_CHECKPOINT_CAPABILITY_IDS.list,
      turn_status: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus,
      resolve: RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve,
      restore_as_new: RESEARCH_CHECKPOINT_CAPABILITY_IDS.restoreAsNew,
      legacy_preview: RESEARCH_CHECKPOINT_CAPABILITY_IDS.previewLegacy,
      legacy_import: RESEARCH_CHECKPOINT_CAPABILITY_IDS.importLegacy
    }
  )
  for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
    assert.match(grant.id, /^[a-z][a-z0-9]*([._-][a-z0-9]+)+$/)
  }
  assert.equal(EXPECTED_HOST_GRANTS.status.effect, 'read')
  assert.equal(EXPECTED_HOST_GRANTS.start.effect, 'workspace-write')
})

test('every tool declares the workspaceRoot argument and a plain JSON Schema output', () => {
  const tools = researchCheckpointTools(() => scriptedRuntime([]))
  for (const tool of tools) {
    assert.deepEqual(tool.parameters.workspaceRoot, { type: 'string', required: true })
    assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true })
    const rendered = tool.output.render({}, { ok: true })
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0]?.type, 'text')
    assert.equal(typeof rendered[0]?.text, 'string')
  }
})

test('tool execution splits workspaceRoot out before strict contract parsing', async () => {
  const calls: CallRecord[] = []
  const tools = researchCheckpointTools(() => scriptedRuntime(calls))
  const status = tools.find((tool) => tool.name === 'status')
  assert.ok(status)
  const result = await status.execute({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: WORKSPACE
  }) as { ok: boolean }
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ method: 'checkpointStatus', args: [WORKSPACE, 'codex', 'thread-1'] }])
})

test('tool execution rejects a missing or blank workspaceRoot', async () => {
  const tools = researchCheckpointTools(() => scriptedRuntime([]))
  const status = tools.find((tool) => tool.name === 'status')
  assert.ok(status)
  await assert.rejects(
    status.execute({ runtimeId: 'codex', threadId: 'thread-1' }),
    /workspaceRoot|invalid|required/i
  )
  await assert.rejects(
    status.execute({ runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '  ' }),
    /workspaceRoot|invalid|required|too_small/i
  )
})

test('invalid capability input surfaces as an { ok: false, issue } result, not a throw', async () => {
  const calls: CallRecord[] = []
  const tools = researchCheckpointTools(() => scriptedRuntime(calls))
  const start = tools.find((tool) => tool.name === 'start')
  assert.ok(start)
  const result = await start.execute({
    runtimeId: 'codex',
    threadId: 'thread-1',
    idempotencyKey: 'too-short-key-but-missing-policy',
    workspaceRoot: WORKSPACE
  }) as { ok: boolean; issue: { message: string } }
  assert.equal(result.ok, false)
  assert.equal(typeof result.issue.message, 'string')
  assert.deepEqual(calls, [], 'runtime must not be called when contract parsing fails')
})
