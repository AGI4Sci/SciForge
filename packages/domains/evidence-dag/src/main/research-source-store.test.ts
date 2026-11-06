import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, writeFile, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResearchSourceStore } from './research-source-store.js'
import { researchSourceDigest } from './research-record-ingestion.js'
import { recordHash } from './research-record-state.js'
import { spawn } from 'node:child_process'
import { EvidenceFileStorage } from './secure-storage.js'

test('source retention has a byte bound, exact digest and scoped content address', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-source-')))
  const store = new ResearchSourceStore(directory)
  const raw = { id: 'source', text: 'observed original' }
  const ref = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: raw.id, digest: researchSourceDigest(raw) }
  assert.equal(store.retain(ref, raw), true)
  assert.deepEqual(new ResearchSourceStore(directory).read(ref).raw, raw)
  assert.equal(store.read({ ...ref, workspaceRoot: join(directory, 'foreign') }).status, 'not-retained')
  assert.throws(() => store.retain(ref, { ...raw, text: 'latest' }), /digest mismatch/)
  const large = { ...raw, text: 'x'.repeat(ResearchSourceStore.maxBytes) }
  const largeRef = { ...ref, digest: researchSourceDigest(large) }
  assert.equal(store.retain(largeRef, large), false)
  assert.equal(store.read(largeRef).status, 'not-retained')
  // Even an externally enlarged store file cannot be returned as an unbounded response.
  await writeFile(join(directory, `research-source-${recordHash(ref)}.json`), JSON.stringify(large))
  assert.equal(store.read(ref).status, 'corrupt')
})

test('aggregate capacity refusal is durable, preserves old data, and coverage never hides missing references', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-capacity-')))
  const raw = { text: 'first' }, other = { text: 'second' }
  const ref = (value: unknown) => ({ runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(value) })
  const limits = { maxBytes: Buffer.byteLength(JSON.stringify(raw)), maxEntries: 2 }
  const store = new ResearchSourceStore(directory, limits)
  assert.equal(store.retain(ref(raw), raw), true)
  assert.equal(store.retain(ref(other), other), false)
  const restarted = new ResearchSourceStore(directory, limits)
  assert.deepEqual(restarted.read(ref(raw)).raw, raw)
  const coverage = restarted.coverage([ref(raw), ref(other)])
  assert.equal(coverage.usedBytes, limits.maxBytes)
  assert.equal(coverage.retainedEntries, 1)
  assert.equal(coverage.missingEntries, 1)
  assert.equal(coverage.rejectedEntries, 1)
  assert.equal(coverage.complete, false)
  assert.equal(coverage.exportRequired, true)
  assert.equal(coverage.policy, 'retain-referenced-no-auto-delete')
})

test('entry capacity and cross-instance concurrent admissions stay bounded', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-entries-')))
  const limits = { maxBytes: 10000, maxEntries: 1 }
  const ref = (raw: unknown) => ({ runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(raw) })
  const values = [{ text: 'one' }, { text: 'two' }]
  const admitted = await Promise.all(values.map(async raw => new ResearchSourceStore(directory, limits).retain(ref(raw), raw)))
  assert.deepEqual(admitted, [true, false])
  assert.equal(new ResearchSourceStore(directory, limits).coverage(values.map(ref)).retainedEntries, 1)
  await writeFile(join(directory, '.research-source-manifest.json.lock'), 'another writer or interrupted writer')
  assert.throws(() => new ResearchSourceStore(directory, limits).retain(ref(values[0]), values[0]), /EEXIST/)
  assert.deepEqual(new ResearchSourceStore(directory, limits).read(ref(values[0])).raw, values[0])
})

test('manifest corruption and root link escape fail closed without overwriting sources', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-security-')))
  const raw = { text: 'original' }
  const ref = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(raw) }
  const store = new ResearchSourceStore(directory)
  assert.equal(store.retain(ref, raw), true)
  await writeFile(join(directory, 'research-source-manifest.json'), '{broken')
  assert.throws(() => store.retain(ref, raw))
  assert.equal(store.coverage([ref]).complete, false)
  assert.equal(store.read(ref).status, 'corrupt')
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'retained-link-')))
  const linked = join(parent, 'escape')
  await symlink(directory, linked, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(new ResearchSourceStore(linked).read(ref).status, 'corrupt')
  assert.throws(() => new ResearchSourceStore(linked).retain(ref, raw))
  const hardlinked = join(parent, `research-source-${recordHash(ref)}.json`)
  await link(join(directory, `research-source-${recordHash(ref)}.json`), hardlinked)
  assert.equal(new ResearchSourceStore(parent).read(ref).status, 'corrupt')
})

test('independent processes cannot over-admit the aggregate quota', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-processes-')))
  const code = `import { ResearchSourceStore } from ${JSON.stringify(new URL('./research-source-store.ts', import.meta.url).href)};
    import { researchSourceDigest } from ${JSON.stringify(new URL('./research-record-ingestion.ts', import.meta.url).href)};
    const directory = process.argv[1], raw = { text: process.argv[2] };
    const ref = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(raw) };
    try { console.log(new ResearchSourceStore(directory, { maxBytes: 1000, maxEntries: 1 }).retain(ref, raw)); }
    catch(error) { if(error.code !== 'EEXIST') throw error; console.log('busy'); }`
  const results = await Promise.all(['one', 'two'].map(value => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, directory, value], { windowsHide: true })
    let output = '', error = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('close', code => { if (code !== 0) reject(new Error(`Child exit ${code}: ${error}`)); else resolve(output.trim()) })
  })))
  assert.equal(results.filter(value => value === 'true').length, 1)
  assert.ok(results.every(value => ['true', 'false', 'busy'].includes(value)))
  const coverage = new ResearchSourceStore(directory, { maxBytes: 1000, maxEntries: 1 }).coverage([])
  assert.equal(coverage.retainedEntries, 1)
  assert.ok(coverage.usedBytes <= 1000)
})

test('interrupted source write preserves reservations and old bytes; restart retry does not double-charge', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-interrupted-')))
  const ref = (raw: unknown) => ({ runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(raw) })
  const first = { text: 'first' }, second = { text: 'second' }
  const limits = { maxBytes: Buffer.byteLength(JSON.stringify(first)) + Buffer.byteLength(JSON.stringify(second)), maxEntries: 2 }
  const store = new ResearchSourceStore(directory, limits)
  assert.equal(store.retain(ref(first), first), true)
  const originalWrite = EvidenceFileStorage.prototype.writeText
  t.mock.method(EvidenceFileStorage.prototype, 'writeText', function (this: EvidenceFileStorage, text: string) {
    if (text === JSON.stringify(second)) throw new Error('simulated source interruption')
    return originalWrite.call(this, text)
  })
  assert.throws(() => store.retain(ref(second), second), /simulated source interruption/)
  t.mock.restoreAll()
  const restarted = new ResearchSourceStore(directory, limits)
  const coverage = restarted.coverage([ref(first), ref(second)])
  assert.equal(coverage.complete, false)
  assert.ok(coverage.reasons.includes('source-write-incomplete'))
  assert.equal(restarted.coverage([]).complete, false)
  assert.equal(restarted.coverage([]).reservedEntries, 1)
  assert.ok(restarted.coverage([]).reasons.includes('source-write-incomplete'))
  assert.equal(coverage.usedBytes, limits.maxBytes)
  assert.deepEqual(restarted.read(ref(first)).raw, first)
  assert.equal(restarted.retain(ref(second), second), true)
  assert.equal(restarted.coverage([ref(first), ref(second)]).complete, true)
})

test('manifest byte mismatches and corrupt ref metadata fail closed', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'retained-manifest-bytes-')))
  const raw = { text: 'original' }
  const ref = { runtimeId: 'codex', threadId: 'thread', workspaceRoot: directory, turnId: 'turn', itemId: 'item', digest: researchSourceDigest(raw) }
  const store = new ResearchSourceStore(directory)
  assert.equal(store.retain(ref, raw), true)
  await writeFile(join(directory, `research-source-${recordHash(ref)}.json`), JSON.stringify(raw) + ' ')
  assert.equal(store.read(ref).status, 'corrupt')
  assert.equal(store.coverage([ref]).usageKnown, false)
  assert.equal(store.coverage([ref]).complete, false)
  assert.equal(store.read({ ...ref, digest: 'invalid' }).status, 'corrupt')
})
