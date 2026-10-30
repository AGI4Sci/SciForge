import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentTeamsWorkflowFixture, WorkflowFixtureError } from './agent-teams-workflow-fixture.js'

test('workflow fixture observes and advances a dependency DAG', () => {
  const fixture = new AgentTeamsWorkflowFixture()
  const started = fixture.start('success')
  assert.deepEqual(started.snapshot.tasks.map((task) => task.status), ['running', 'blocked'])
  const prepared = fixture.advance(started.handle, 0)
  assert.deepEqual(prepared.tasks.map((task) => task.status), ['completed', 'running'])
  const completed = fixture.advance(started.handle, prepared.revision)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.events.at(-1)?.kind, 'team.completed')
})

test('cancel and failure close the graph without dispatching dependent work', () => {
  const fixture = new AgentTeamsWorkflowFixture()
  const cancelled = fixture.start('cancel')
  const closed = fixture.cancel(cancelled.handle, 0)
  assert.equal(closed.status, 'cancelled')
  assert.deepEqual(closed.tasks.map((task) => task.status), ['cancelled', 'cancelled'])

  const failing = fixture.start('failure', 'fixture.prepare')
  const failed = fixture.advance(failing.handle, 0)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.tasks[1]?.status, 'blocked')
  assert.throws(() => fixture.advance(failing.handle, failed.revision), (error: unknown) =>
    error instanceof WorkflowFixtureError && error.code === 'terminal')
})

test('replacing a run rejects its old generation and dispose stops scheduling', () => {
  const fixture = new AgentTeamsWorkflowFixture()
  const oldRun = fixture.start('replace')
  const newRun = fixture.start('replace')
  assert.equal(newRun.handle.generation, oldRun.handle.generation + 1)
  assert.throws(() => fixture.status(oldRun.handle), (error: unknown) =>
    error instanceof WorkflowFixtureError && error.code === 'stale_generation')
  fixture.dispose()
  assert.throws(() => fixture.status(newRun.handle), (error: unknown) =>
    error instanceof WorkflowFixtureError && error.code === 'disposed')
  assert.throws(() => fixture.start('after-dispose'), /disposed/)
})
