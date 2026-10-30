import { test, expect } from 'vitest'
import { mkdtemp, writeFile, rm, link, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCommittedChain, committedStatus } from '@sciforge/domain-evidence-dag/host/committed-reader'
import { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } from '../src/core.js'

// Post-implementation controls, not the original R1 RED.
const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: '/controlled-workspace' }
const interpreter = process.env.EVIDENCE_BUILD_PYTHON!
function persisted() {
  const chain = new EvidenceDeltaChain('r:t')
  const delta = chain.append(evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'r:t', operationId: 'one', idempotencyKey: 'control-one', kind: 'manual', requestedWatermark: '1', trace: [] })).delta
  return { version: 1, chains: [{ threadId: 'r:t', records: [delta] }] }
}
async function fixture(action: (root: string, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'committed-control-'))
  try { await action(root, join(root, 'deltas.json')) } finally { await rm(root, { recursive: true, force: true }) }
}

test('descriptor committed chain rejects scope mismatch', () => fixture(async (root, file) => {
  const data = persisted(); data.chains[0].records[0].scope.workspaceRoot = '/foreign'
  await writeFile(file, JSON.stringify(data))
  await expect(readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL)).rejects.toThrow('persisted scope mismatch')
}))
test('descriptor committed chain rejects immutable payload tampering', () => fixture(async (root, file) => {
  const data = persisted(); (data.chains[0].records[0].payload as any).tampered = true
  await writeFile(file, JSON.stringify(data))
  await expect(readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL)).rejects.toThrow()
}))
test.each(['symlink', 'hardlink'])('descriptor committed chain rejects %s', (kind) => fixture(async (root, file) => {
  const target = join(root, 'target'); await writeFile(target, JSON.stringify(persisted()))
  await (kind === 'symlink' ? symlink(target, file) : link(target, file))
  await expect(readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL)).rejects.toThrow('descriptor reader failed')
}))
test('descriptor committed chain rejects duplicate identities', () => fixture(async (root, file) => {
  const data = persisted(); data.chains.push(data.chains[0]); await writeFile(file, JSON.stringify(data))
  await expect(readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL)).rejects.toThrow('Duplicate Evidence chain')
}))
test('empty committed chain never calls snapshot reader or exposes provisional content', () => fixture(async (root) => {
  const status = await committedStatus(await readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL), scope, async () => { throw Error('must not read snapshot') })
  expect(status.committed).toBeNull(); expect(status.provisional).toBeNull()
}))
test('committed interpreter must be explicitly absolute', () => fixture(async (root) => {
  await expect(readCommittedChain(root, 'python', scope)).rejects.toThrow('interpreter is required')
}))
