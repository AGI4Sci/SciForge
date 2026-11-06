import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteSafeStore, MAX_SAFE_STORE_READ_BYTES, readSafeStoreBytes, readSafeStoreText } from './safe-store'

const roots: string[] = []
async function workspace() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ac-safe-store-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const segments = ['anchored-comments', 'comments.json']

describe('plugin-owned safe store', () => {
  it('bounds reads before allocation and accepts files exactly at the byte limit', async () => {
    const root = await workspace()
    await atomicWriteSafeStore(root, segments, '1234')
    await expect(readSafeStoreText(root, segments, 4)).resolves.toBe('1234')
    await expect(readSafeStoreBytes(root, segments, 3)).rejects.toThrow(/exceeds 3 bytes/)
    await expect(readSafeStoreBytes(root, segments, -1)).rejects.toThrow(/byte limit/)
    await expect(readSafeStoreBytes(root, segments, MAX_SAFE_STORE_READ_BYTES + 1)).rejects.toThrow(/byte limit/)
    // Sparse oversized input must be refused using its opened file size.
    await truncate(join(root, ...segments), MAX_SAFE_STORE_READ_BYTES + 1)
    await expect(readSafeStoreBytes(root, segments)).rejects.toThrow(/exceeds/)
  })

  it('does not create a data root while reading missing data', async () => {
    const root = join(await workspace(), '.sciforge')
    await expect(readSafeStoreText(root, segments)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(existsSync(root)).toBe(false)
  })

  it('rejects a symlink data root for reads and writes without touching its destination', async () => {
    const caller = await workspace()
    const outside = await workspace()
    const root = join(caller, '.sciforge')
    await symlink(outside, root, 'dir')
    await expect(readSafeStoreText(root, segments)).rejects.toThrow(/symlink/)
    await expect(atomicWriteSafeStore(root, segments, 'bad')).rejects.toThrow(/symlink/)
    expect(existsSync(join(outside, 'anchored-comments'))).toBe(false)
  })

  it('rejects caller ancestors and store subdirectories that redirect outside the declared path', async () => {
    const caller = await workspace()
    const outside = await workspace()
    await symlink(outside, join(caller, 'alias'), 'dir')
    await expect(atomicWriteSafeStore(join(caller, 'alias', '.sciforge'), segments, 'bad')).rejects.toThrow(/symlink/)
    expect(existsSync(join(outside, '.sciforge'))).toBe(false)
    const root = join(caller, '.sciforge')
    await mkdir(root)
    await symlink(outside, join(root, 'anchored-comments'), 'dir')
    await expect(atomicWriteSafeStore(root, segments, 'bad')).rejects.toThrow(/symlink/)
  })

  it('rejects symlink files and traversal, preserving external bytes', async () => {
    const root = await workspace()
    const outside = join(await workspace(), 'outside.json')
    await writeFile(outside, 'untouched')
    await mkdir(join(root, 'anchored-comments'))
    await symlink(outside, join(root, ...segments))
    await expect(readSafeStoreText(root, segments)).rejects.toThrow(/regular files/)
    await expect(atomicWriteSafeStore(root, segments, 'bad')).rejects.toThrow(/regular files/)
    await expect(atomicWriteSafeStore(root, ['..', 'escape'], 'bad')).rejects.toThrow(/Invalid/)
    expect(await readFile(outside, 'utf8')).toBe('untouched')
  })
})
