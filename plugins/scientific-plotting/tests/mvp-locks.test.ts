import assert from 'node:assert/strict'
import { renameSync, symlinkSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ConfinedFigureFiles } from '../src/figure-store/node-files.js'

async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'scientific-lock-test-'))
  t.after(async () => {
    assert.equal(await realpath(root), resolve(root))
    assert.ok(root.startsWith(join(parent, 'scientific-lock-test-')))
    await rm(root, { recursive: true, force: true })
  })
  const directory = join(root, '.scientific-figures')
  await mkdir(directory)
  return { root, directory, lock: join(directory, '.index.lock') }
}

test('independent filesystem instances wait and serialize the same index critical section', async t => {
  const { root, lock } = await fixture(t)
  const first = new ConfinedFigureFiles()
  const second = new ConfinedFigureFiles()
  let markEntered!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { markEntered = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  const events: string[] = []
  const holding = first.withLock(root, '@index', async () => {
    events.push('first entered')
    markEntered()
    await released
    events.push('first exited')
    return 'first result'
  })
  await entered
  const waiting = second.withLock(root, '@index', async () => {
    events.push('second entered')
    return 'second result'
  })
  // Attach a rejection handler while deliberately keeping the owner active.
  const results = Promise.all([holding, waiting])
  try {
    await delay(100)
    assert.deepEqual(events, ['first entered'])
    assert.ok((await lstat(lock)).isDirectory())
  } finally {
    release()
  }
  assert.deepEqual(await results, ['first result', 'second result'])
  assert.deepEqual(events, ['first entered', 'first exited', 'second entered'])
  await assert.rejects(lstat(lock), { code: 'ENOENT' })
})

test('surviving lock times out without entering, deleting, or replacing the lock inode', async t => {
  const { root, lock } = await fixture(t)
  await mkdir(lock)
  const marker = join(lock, 'owner')
  await writeFile(marker, 'surviving owner')
  const before = await lstat(lock)
  let entered = false
  const started = performance.now()
  await assert.rejects(new ConfinedFigureFiles().withLock(root, '@index', async () => {
    entered = true
  }), { message: 'Document is busy (@index); retry after the active operation completes. A surviving lock requires manual inspection.' })
  const elapsed = performance.now() - started
  assert.ok(elapsed >= 1900, `contention should wait before failing: ${elapsed}ms`)
  assert.ok(elapsed < 5000, `contention must have a bounded deadline: ${elapsed}ms`)
  assert.equal(entered, false)
  const after = await lstat(lock)
  assert.equal(after.dev, before.dev)
  assert.equal(after.ino, before.ino)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(await readFile(marker, 'utf8'), 'surviving owner')
})

test('contended acquisition rechecks and rejects a lock replaced by a symlink', async t => {
  const { root, directory, lock } = await fixture(t)
  await mkdir(lock)
  const destination = join(root, 'destination')
  await mkdir(destination)
  let entered = false
  const waiting = assert.rejects(new ConfinedFigureFiles().withLock(root, '@index', async () => {
    entered = true
  }), /Symlink is forbidden/)
  await delay(75)
  // Keep the replacement within one event-loop turn so a retry cannot acquire the gap.
  renameSync(lock, join(directory, '.original.lock'))
  symlinkSync(destination, lock)
  await waiting
  assert.equal(entered, false)
  assert.ok((await lstat(lock)).isSymbolicLink())
  assert.ok((await lstat(destination)).isDirectory())
})
