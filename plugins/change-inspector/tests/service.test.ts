/**
 * Unit tests for the orchestration layer: resource identity, workspace
 * ownership policy and the openSession operation contract.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changeInspectorOpenSessionResultSchema } from '../src/contract.js'
import { openSession } from '../src/core/operations.js'
import {
  ChangeInspectorService,
  changeInspectorResourceId,
  normalizePath
} from '../src/core/service.js'
import type { ChangeInspectorSessionDetail } from '../src/ports/agent-threads.js'
import { corpusSessions, OTHER_WORKSPACE, WORKSPACE } from './cases.js'
import { fakeAgentThreads } from './runner.js'

function serviceWith(sessions: Record<string, ChangeInspectorSessionDetail>): ChangeInspectorService {
  return new ChangeInspectorService({ agentThreads: fakeAgentThreads(sessions) })
}

test('resource id is the sha256 of the canonical (runtimeId, sessionId) tuple', () => {
  const id = changeInspectorResourceId({ runtimeId: 'codex', sessionId: 'thread-1' })
  assert.match(id, /^session-changes:[a-f0-9]{64}$/u)
  // Delimiter collisions cannot alias: ["a:b", "c"] versus ["a", "b:c"].
  const left = changeInspectorResourceId({ runtimeId: 'codex:remote', sessionId: 'thread' })
  const right = changeInspectorResourceId({ runtimeId: 'codex', sessionId: 'remote:thread' })
  assert.notEqual(left, right)
  // Deterministic.
  assert.equal(id, changeInspectorResourceId({ runtimeId: 'codex', sessionId: 'thread-1' }))
})

test('normalizePath folds backslashes and trailing slashes', () => {
  assert.equal(normalizePath('C:\\repo\\pkg\\'), 'C:/repo/pkg')
  assert.equal(normalizePath('/repo/'), '/repo')
  assert.equal(normalizePath('/repo'), '/repo')
})

test('workspace ownership: equivalent paths pass, foreign paths throw the static message', async () => {
  const service = serviceWith({
    'thread-1': { workspaceRoot: `${WORKSPACE}/`, watermark: 'wm', artifacts: [] },
    'thread-win': { workspaceRoot: 'C:\\repo\\', watermark: 'wm', artifacts: [] },
    'thread-free': { watermark: 'wm', artifacts: [] }
  })
  const pass = await service.snapshot({ runtimeId: 'codex', sessionId: 'thread-1' }, WORKSPACE)
  assert.equal(pass.sessionId, 'thread-1')
  const windows = await service.snapshot({ runtimeId: 'codex', sessionId: 'thread-win' }, 'C:/repo')
  assert.equal(windows.sessionId, 'thread-win')
  // A session without a recorded workspace is readable from any workspace.
  const free = await service.snapshot({ runtimeId: 'codex', sessionId: 'thread-free' }, OTHER_WORKSPACE)
  assert.equal(free.sessionId, 'thread-free')
  await assert.rejects(
    service.snapshot({ runtimeId: 'codex', sessionId: 'thread-1' }, OTHER_WORKSPACE),
    (error: unknown) => {
      assert.equal((error as Error).message, 'The requested session belongs to another workspace.')
      return true
    }
  )
})

test('openSession returns the parsed result contract', async () => {
  const service = serviceWith(corpusSessions())
  const result = await openSession(
    service,
    { sessionId: 'thread-plain-diff', runtimeId: 'codex' },
    WORKSPACE
  )
  const parsed = changeInspectorOpenSessionResultSchema.parse(result.output)
  assert.equal(parsed.sessionId, 'thread-plain-diff')
  assert.match(parsed.resourceId, /^session-changes:[a-f0-9]{64}$/u)
  assert.equal(parsed.snapshot.changes.length, 1)
  assert.equal(parsed.snapshot.revision, 'wm-7')
})

test('openSession rejects a missing workspace with the static message', async () => {
  const service = serviceWith(corpusSessions())
  await assert.rejects(
    openSession(service, { sessionId: 'thread-plain-diff', runtimeId: 'codex' }, ''),
    (error: unknown) => {
      assert.equal((error as Error).message, 'Change Inspector requires an active workspace.')
      return true
    }
  )
  await assert.rejects(
    openSession(service, { sessionId: 'thread-plain-diff', runtimeId: 'codex' }, '   '),
    (error: unknown) => {
      assert.equal((error as Error).message, 'Change Inspector requires an active workspace.')
      return true
    }
  )
})

test('openSession validates the input with the strict contract schema', async () => {
  const service = serviceWith(corpusSessions())
  await assert.rejects(openSession(service, { runtimeId: 'codex' }, WORKSPACE))
  await assert.rejects(
    openSession(service, { sessionId: 'thread-plain-diff', runtimeId: 'codex', extra: 1 }, WORKSPACE),
    /unrecognized|extra/i
  )
})

test('port read failures propagate unchanged', async () => {
  const service = serviceWith({})
  await assert.rejects(
    openSession(service, { sessionId: 'missing', runtimeId: 'codex' }, WORKSPACE),
    (error: unknown) => {
      assert.equal((error as Error).message, 'Unknown session: missing')
      return true
    }
  )
})
