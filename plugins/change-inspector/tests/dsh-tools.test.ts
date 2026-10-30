/**
 * DSH tool wiring tested without the official runtime packages: a fake
 * `defineTool`/register pair verifies the tool name, grant mapping,
 * delegation to the core, argument handling and error behaviour. This is not
 * evidence of compatibility with the official runtime; host-loading.test.ts
 * covers that.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { ChangeInspectorService } from '../src/core/service.js'
import {
  changeInspectorTools,
  EXPECTED_HOST_GRANTS,
  registerChangeInspectorTools
} from '../src/dsh-adapter/tools.js'
import { corpusSessions, WORKSPACE } from './cases.js'
import { fakeAgentThreads } from './runner.js'

function serviceFor(): ChangeInspectorService {
  return new ChangeInspectorService({ agentThreads: fakeAgentThreads(corpusSessions()) })
}

test('registers exactly the two granted tools with the matching capability id', () => {
  const service = serviceFor()
  const registered: unknown[] = []
  registerChangeInspectorTools(
    (tool) => { registered.push(tool) },
    (definition) => definition,
    () => service
  )
  assert.equal(registered.length, 2)

  const tools = changeInspectorTools(() => service)
  assert.deepEqual(tools.map((tool) => tool.name), ['open_session', 'list_changes'])
  assert.deepEqual(
    Object.fromEntries(Object.entries(EXPECTED_HOST_GRANTS).map(([name, grant]) => [name, grant.id])),
    { open_session: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, list_changes: CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges }
  )
  for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
    assert.match(grant.id, /^[a-z][a-z0-9]*([._-][a-z0-9]+)+$/)
  }
  assert.equal(EXPECTED_HOST_GRANTS.open_session.effect, 'read')
})

test('tool execution delegates to the core with the workspace argument split out', async () => {
  const service = serviceFor()
  const [tool] = changeInspectorTools(() => service)
  const result = await tool!.execute({
    sessionId: 'thread-plain-diff',
    runtimeId: 'codex',
    workspaceRoot: WORKSPACE
  }) as { sessionId: string; resourceId: string; snapshot: { changes: readonly unknown[] } }
  assert.equal(result.sessionId, 'thread-plain-diff')
  assert.match(result.resourceId, /^session-changes:[a-f0-9]{64}$/u)
  assert.equal(result.snapshot.changes.length, 1)
})

test('tool execution rejects invalid arguments exactly like the core', async () => {
  const service = serviceFor()
  const [tool] = changeInspectorTools(() => service)
  // Missing required workspaceRoot argument.
  await assert.rejects(
    tool!.execute({ sessionId: 'thread-plain-diff', runtimeId: 'codex' }),
    /workspaceRoot|invalid/i
  )
  // Extra keys survive the workspace split and fail the strict contract schema.
  await assert.rejects(
    tool!.execute({
      sessionId: 'thread-plain-diff',
      runtimeId: 'codex',
      workspaceRoot: WORKSPACE,
      extra: 1
    }),
    /unrecognized|extra/i
  )
  // Cross-workspace policy is enforced at the operation layer.
  await assert.rejects(
    tool!.execute({
      sessionId: 'thread-foreign-workspace',
      runtimeId: 'codex',
      workspaceRoot: WORKSPACE
    }),
    /belongs to another workspace/u
  )
})

test('the tool declares a plain JSON Schema output and a text render projection', () => {
  const service = serviceFor()
  for (const tool of changeInspectorTools(() => service)) {
    assert.deepEqual(tool.output.schema, { type: 'object', additionalProperties: true })
    const rendered = tool.output.render({}, { sessionId: 's' })
    assert.equal(rendered.length, 1)
    assert.equal(rendered[0]?.type, 'text')
    assert.equal(typeof rendered[0]?.text, 'string')
  }
})
