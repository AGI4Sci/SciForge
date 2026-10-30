/**
 * DSH tool wiring tested without the official runtime packages: a fake
 * `defineTool`/register pair verifies names, grant mapping, delegation to the
 * core, argument handling and error behaviour. This is not evidence of
 * compatibility with the official runtime; host-loading.test.ts covers that.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { GIT_CHECKPOINTS_CAPABILITY_IDS } from '../src/contract.js'
import { GitCheckpointService } from '../src/core/service.js'
import {
  EXPECTED_HOST_GRANTS,
  gitCheckpointTools,
  registerGitCheckpointTools,
  type DshToolDefinition
} from '../src/dsh-adapter/tools.js'
import { scriptedClock, scriptedIds, scriptedVcs, WORKSPACE } from './cases.js'

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function serviceFor() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'dsh-tools-'))
  roots.push(userDataDir)
  return new GitCheckpointService({
    userDataDir,
    vcs: scriptedVcs().vcs,
    now: scriptedClock(),
    createId: scriptedIds()
  })
}

test('registers exactly the four granted tools with matching capability ids', async () => {
  const service = await serviceFor()
  const registered: unknown[] = []
  registerGitCheckpointTools(
    (tool) => { registered.push(tool) },
    (definition) => definition,
    () => service
  )
  assert.equal(registered.length, 4)

  const tools = gitCheckpointTools(() => service)
  assert.deepEqual(tools.map((tool) => tool.name), ['list', 'create', 'preview', 'restore'])
  assert.deepEqual(
    Object.fromEntries(Object.entries(EXPECTED_HOST_GRANTS).map(([name, grant]) => [name, grant.id])),
    {
      list: GIT_CHECKPOINTS_CAPABILITY_IDS.list,
      create: GIT_CHECKPOINTS_CAPABILITY_IDS.create,
      preview: GIT_CHECKPOINTS_CAPABILITY_IDS.preview,
      restore: GIT_CHECKPOINTS_CAPABILITY_IDS.restore
    }
  )
  for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
    assert.match(grant.id, /^[a-z][a-z0-9]*([._-][a-z0-9]+)+$/)
  }
  assert.equal(EXPECTED_HOST_GRANTS.list.effect, 'read')
  assert.equal(EXPECTED_HOST_GRANTS.create.effect, 'workspace-write')
  assert.equal(EXPECTED_HOST_GRANTS.preview.effect, 'read')
  assert.equal(EXPECTED_HOST_GRANTS.restore.effect, 'destructive')
})

test('tool execution delegates to the core with the workspace argument split out', async () => {
  const service = await serviceFor()
  const tools = gitCheckpointTools(() => service)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  const created = await byName.get('create')!.execute({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: WORKSPACE
  }) as { ok: true; value: { checkpointId: string } }
  assert.equal(created.ok, true)
  const checkpointId = created.value.checkpointId

  const listed = await byName.get('list')!.execute({ workspaceRoot: WORKSPACE }) as {
    ok: true
    value: readonly { checkpointId: string }[]
  }
  assert.equal(listed.value.length, 1)
  assert.equal(listed.value[0]?.checkpointId, checkpointId)

  const previewed = await byName.get('preview')!.execute({
    checkpointId,
    workspaceRoot: WORKSPACE
  }) as { ok: true; value: { patch: string } }
  assert.equal(previewed.value.patch, 'patch for snapshot-1')

  const restored = await byName.get('restore')!.execute({
    checkpointId,
    workspaceRoot: WORKSPACE
  }) as { ok: true; value: { status: string } }
  assert.equal(restored.value.status, 'restored')
})

test('tool execution rejects invalid arguments exactly like the core', async () => {
  const service = await serviceFor()
  const tools = gitCheckpointTools(() => service)
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  // Missing required workspaceRoot argument.
  await assert.rejects(byName.get('list')!.execute({}), /workspaceRoot|invalid/i)
  // Extra keys survive the workspace split and fail the strict contract schema.
  await assert.rejects(
    byName.get('preview')!.execute({ checkpointId: 'x', workspaceRoot: WORKSPACE, extra: 1 }),
    /unrecognized|extra/i
  )
  // Cross-workspace policy is enforced at the operation layer (parity tests
  // cover it); at the tool layer the workspaceRoot argument IS the caller
  // workspace, so a conflicting input workspace cannot be expressed.
  await assert.rejects(
    byName.get('create')!.execute({
      runtimeId: 'codex',
      threadId: 'thread-1',
      workspaceRoot: WORKSPACE,
      phase: 'before-turn'
    }),
    /only creates manual checkpoints/u
  )
})

test('every tool declares a plain JSON Schema output and a text render projection', async () => {
  const service = await serviceFor()
  for (const tool of gitCheckpointTools(() => service)) {
    assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true })
    const rendered = tool.output.render({}, { ok: true })
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0]?.type, 'text')
    assert.equal(typeof rendered[0]?.text, 'string')
  }
})
