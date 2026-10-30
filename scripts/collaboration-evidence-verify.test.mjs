import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseChecklist, validateRecord, verifyEvidence } from './collaboration-evidence-verify.mjs'

const SOURCE = 'a'.repeat(40)
const CONTRACT = 'b'.repeat(40)
const DIGEST = `sha256:${'c'.repeat(64)}`
const RECEIPT = `rcp_${'d'.repeat(24)}`
const COMMITTED_AT = new Date('2026-10-15T09:00:00.000Z')

function realCloudRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'EV-20261015-01',
    date: '2026-10-15',
    environment: 'real_cloud',
    kinds: ['cloud'],
    claim: 'Both OIDC users ensured an Agent through the desktop.',
    supports: ['prd: 真实 Cloud 门禁通过'],
    sourceCommit: SOURCE,
    server: { imageDigest: DIGEST, contractCommit: CONTRACT, database: 'cloud_v1' },
    desktop: { artifactPath: null, artifactSha256: null },
    receipts: [{ receiptId: RECEIPT, operation: 'agent.ensure', resourceId: 'agt_1', actorKey: 'oidc:oid_owner' }],
    visual: [],
    commands: [],
    recordedBy: 'claude-session:impl',
    acceptedBy: 'user:owner',
    acceptedAt: '2026-10-15T13:00:00Z',
    ...overrides
  }
}

function localRecord(overrides = {}) {
  return {
    ...realCloudRecord(),
    id: 'EV-20261015-02',
    environment: 'local',
    kinds: ['test'],
    server: undefined,
    receipts: [],
    commands: [{ command: 'npm test', result: '496 passed' }],
    ...overrides
  }
}

const git = {
  head: () => 'f'.repeat(40),
  commitExists: (sha) => sha === SOURCE || sha === CONTRACT,
  isAncestor: (sha) => sha === SOURCE,
  commitTime: () => COMMITTED_AT
}
const files = { sha256: () => null }

function cloudWith({ label = CONTRACT, rows } = {}) {
  return {
    imageContractCommit: async () => label,
    receipts: async () => rows ?? [{
      receiptId: RECEIPT, operation: 'agent.ensure', resourceId: 'agt_1', actorKey: 'oidc:oid_owner', createdAt: '2026-10-15T12:08:38.070Z'
    }]
  }
}

function workspace(checklist, records) {
  const root = mkdtempSync(join(tmpdir(), 'evidence-verify-'))
  writeFileSync(join(root, 'tasks.md'), checklist)
  mkdirSync(join(root, 'evidence'))
  for (const record of records) writeFileSync(join(root, 'evidence', `${record.id}.json`), JSON.stringify(record, null, 2))
  return root
}

async function run(checklist, records, cloud = cloudWith()) {
  const root = workspace(checklist, records)
  return verifyEvidence({ root, checklists: ['tasks.md'], evidenceDir: 'evidence', git, files, cloud })
}

test('parses checked lines and their evidence references', () => {
  const items = parseChecklist('tasks.md', '- [x] 1.1 done. Evidence: EV-20261015-01, EV-20261015-02\n- [ ] 1.2 open\n')
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].refs, ['EV-20261015-01', 'EV-20261015-02'])
})

test('a checked item without evidence fails', async () => {
  const result = await run('- [x] 1.1 Implement the parser.\n', [])
  assert.match(result.errors.join('\n'), /cites no evidence/u)
})

test('a checked item that says it is unfinished fails even with evidence', async () => {
  const result = await run('- [x] 1.1 Parser done; recovery remains open. Evidence: EV-20261015-02\n', [localRecord()])
  assert.match(result.errors.join('\n'), /says it is unfinished/u)
})

test('behaviour words such as partial upload or pending Offer are not read as unfinished', async () => {
  const result = await run('- [x] 1.1 Tests cover partial upload and an expired pending Offer. Evidence: EV-20261015-02\n', [localRecord()])
  assert.deepEqual(result.errors, [])
  const partial = await run('- [x] 1.1 Gates pass; real_cloud remains explicitly partial. Evidence: EV-20261015-02\n', [localRecord()])
  assert.match(partial.errors.join('\n'), /says it is unfinished/u)
})

test('local evidence accepted by another person closes a local item', async () => {
  const result = await run('- [x] 1.1 Implement the parser. Evidence: EV-20261015-02\n', [localRecord()])
  assert.deepEqual(result.errors, [])
})

test('unaccepted or self-accepted evidence cannot close an item', async () => {
  const pending = await run('- [x] 1.1 Implement the parser. Evidence: EV-20261015-02\n', [localRecord({ acceptedBy: null, acceptedAt: null })])
  assert.match(pending.errors.join('\n'), /not accepted yet/u)
  const self = await run('- [x] 1.1 Implement the parser. Evidence: EV-20261015-02\n', [localRecord({ acceptedBy: 'claude-session:impl' })])
  assert.match(self.errors.join('\n'), /acceptedBy must differ from recordedBy/u)
})

test('a real-cloud claim cannot be closed by local evidence', async () => {
  const result = await run('- [x] 6.7.2 Run the two-user real-cloud flow. Evidence: EV-20261015-02\n', [localRecord()])
  assert.match(result.errors.join('\n'), /real-cloud claim needs accepted real_cloud evidence/u)
})

test('verified real_cloud evidence closes a real-cloud claim', async () => {
  const result = await run('- [x] 6.7.2 Run the two-user real-cloud flow. Evidence: EV-20261015-01\n', [realCloudRecord()])
  assert.deepEqual(result.errors, [])
})

test('an offline run never closes a real-cloud claim', async () => {
  const result = await run('- [x] 6.7.2 Run the two-user real-cloud flow. Evidence: EV-20261015-01\n', [realCloudRecord()], null)
  assert.match(result.errors.join('\n'), /offline run cannot verify it/u)
})

test('missing, mismatched or stale receipts fail', async () => {
  const checklist = '- [x] 6.7.2 real-cloud flow. Evidence: EV-20261015-01\n'
  const missing = await run(checklist, [realCloudRecord()], cloudWith({ rows: [] }))
  assert.match(missing.errors.join('\n'), /does not exist/u)
  const wrongActor = await run(checklist, [realCloudRecord()], cloudWith({ rows: [{
    receiptId: RECEIPT, operation: 'agent.ensure', resourceId: 'agt_1', actorKey: 'oidc:oid_someone_else', createdAt: '2026-10-15T12:08:38.070Z'
  }] }))
  assert.match(wrongActor.errors.join('\n'), /actor is oidc:oid_someone_else/u)
  const stale = await run(checklist, [realCloudRecord()], cloudWith({ rows: [{
    receiptId: RECEIPT, operation: 'agent.ensure', resourceId: 'agt_1', actorKey: 'oidc:oid_owner', createdAt: '2026-10-14T00:00:00.000Z'
  }] }))
  assert.match(stale.errors.join('\n'), /predates sourceCommit/u)
})

test('an image whose contract-commit label differs fails', async () => {
  const result = await run('- [x] 6.7.2 real-cloud flow. Evidence: EV-20261015-01\n', [realCloudRecord()], cloudWith({ label: 'e'.repeat(40) }))
  assert.match(result.errors.join('\n'), /does not match/u)
})

test('a UI claim needs ui evidence with visuals', async () => {
  const result = await run('- [x] 6.4.1 Build the Dashboard shell. Evidence: EV-20261015-02\n', [localRecord()])
  assert.match(result.errors.join('\n'), /UI claim needs accepted evidence of kind ui/u)
  assert.match(validateRecord(localRecord({ kinds: ['ui'] }), 'EV-20261015-02.json').join('\n'), /ui records need at least one visual/u)
})

test('records that leak credentials or misname their file fail', () => {
  const leaking = { ...localRecord(), notes: 'see config', token: 'x' }
  assert.match(validateRecord(leaking, 'EV-20261015-02.json').join('\n'), /credential or token/u)
  assert.match(validateRecord(localRecord(), 'EV-20261015-99.json').join('\n'), /does not match id/u)
})

test('a source commit outside the verified history fails', async () => {
  const result = await run('- [x] 1.1 Implement the parser. Evidence: EV-20261015-02\n', [localRecord({ sourceCommit: '9'.repeat(40) })])
  assert.match(result.errors.join('\n'), /not in this repository/u)
})
