import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const fixtureRoot = new URL('../test-fixtures/collaboration/run0-meeting/', import.meta.url)

async function readFixture(path) {
  return readFile(new URL(path, fixtureRoot), 'utf8')
}

test('Run-0 meeting fixture describes the complete synthetic five-user review loop', async () => {
  const manifest = JSON.parse(await readFixture('fixture-manifest.json'))

  assert.deepEqual(Object.keys(manifest).sort(), [
    'inputs',
    'outputs',
    'projectDisplayName',
    'scenarios',
    'users',
    'version'
  ])
  assert.equal(manifest.version, 'sciforge.run0-meeting-fixture/1')
  assert.equal(manifest.projectDisplayName, '多用户协作设计评审会')
  assert.deepEqual(
    manifest.users.map(({ fixtureLabel, behavior }) => ({ fixtureLabel, behavior })),
    [
      { fixtureLabel: 'U0', behavior: 'owner_coordinator' },
      { fixtureLabel: 'U1', behavior: 'manual_worker' },
      { fixtureLabel: 'U2', behavior: 'automatic_worker_human_needed' },
      { fixtureLabel: 'U3', behavior: 'reject_worker' },
      { fixtureLabel: 'U4', behavior: 'replacement_worker' }
    ]
  )
  assert.deepEqual(manifest.outputs, [
    'architecture-review.md',
    'meeting-minutes.md',
    'risk-register.md'
  ])
  assert.deepEqual(manifest.scenarios, [
    'plan_confirm_or_edit',
    'manual_accept',
    'automatic_accept_after_preflight',
    'human_needed_owner_answer',
    'reject_and_exact_agent_reassign',
    'review_accept',
    'review_request_revision',
    'project_complete'
  ])
})

test('Run-0 meeting inputs are synthetic, complete, and contain no credential material', async () => {
  const manifest = JSON.parse(await readFixture('fixture-manifest.json'))
  assert.deepEqual(manifest.inputs, ['agenda.md', 'requirements.md', 'risk-constraints.md'])

  const inputs = await Promise.all(manifest.inputs.map(readFixture))
  const combined = inputs.join('\n')

  for (const marker of [
    '纯合成数据',
    '单一 Coordinator',
    '精确 Agent',
    'HumanNeeded',
    '拒绝后改派',
    '真实 Content Space',
    '复审',
    '恢复'
  ]) {
    assert.match(combined, new RegExp(marker))
  }

  for (const secretPattern of [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bBearer\s+[A-Za-z0-9._~-]+/u,
    /\b(?:access|refresh)[_-]?token\s*[:=]/iu,
    /\bapi[_-]?key\s*[:=]\s*\S+/iu,
    /\bpassword\s*[:=]\s*\S+/iu
  ]) {
    assert.doesNotMatch(combined, secretPattern)
  }
})
