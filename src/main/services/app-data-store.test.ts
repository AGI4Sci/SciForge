import { lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AppDataJsonlStore,
  appendAppDataStoreText,
  appDataStorePath,
  atomicWriteAppDataJson,
  renameAppDataFileAtomically,
  readAppDataStoreText
} from './app-data-store'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-app-data-store-'))
}

describe('app-data-store', () => {
  it('retries transient Windows rename failures without changing other platforms', async () => {
    const windowsRename = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporarily locked'), { code: 'EPERM' }))
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined)
    const wait = vi.fn(async () => undefined)

    await expect(renameAppDataFileAtomically('source.tmp', 'target.json', {
      platform: 'win32',
      renameFile: windowsRename,
      wait
    })).resolves.toBeUndefined()

    expect(windowsRename).toHaveBeenCalledTimes(3)
    expect(wait).toHaveBeenNthCalledWith(1, 10)
    expect(wait).toHaveBeenNthCalledWith(2, 25)

    const macRename = vi.fn()
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }))
    await expect(renameAppDataFileAtomically('source.tmp', 'target.json', {
      platform: 'darwin',
      renameFile: macRename,
      wait
    })).rejects.toThrow('denied')
    expect(macRename).toHaveBeenCalledTimes(1)
  })

  it('writes JSON through a temp file and resolves the final path inside app data', async () => {
    const root = await tempRoot()

    await atomicWriteAppDataJson(root, ['runtime-goals', 'goals.json'], { goals: [{ threadId: 't1' }] })

    const target = await appDataStorePath(root, ['runtime-goals', 'goals.json'])
    expect(target.path).toBe(join(await realpath(root), 'runtime-goals', 'goals.json'))
    expect(JSON.parse(await readAppDataStoreText(root, ['runtime-goals', 'goals.json']))).toEqual({
      goals: [{ threadId: 't1' }]
    })
    expect((await lstat(target.path)).isSymbolicLink()).toBe(false)
  })

  it('rejects unsafe path segments', async () => {
    const root = await tempRoot()

    await expect(atomicWriteAppDataJson(root, ['runtime-goals', '..', 'goals.json'], {}))
      .rejects.toThrow(/segment is invalid/)
    await expect(atomicWriteAppDataJson(root, ['runtime-goals/extra', 'goals.json'], {}))
      .rejects.toThrow(/segment is invalid/)
  })

  it('rejects symlinked parents under app data', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await symlink(outside, join(root, 'runtime-goals'))

    await expect(atomicWriteAppDataJson(root, ['runtime-goals', 'goals.json'], { goals: [] }))
      .rejects.toThrow(/must not cross a symlink/)
  })

  it('rejects existing symlink targets instead of replacing or following them', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const outsideFile = join(outside, 'goals.json')
    await writeFile(outsideFile, 'outside', 'utf8')
    await atomicWriteAppDataJson(root, ['runtime-goals', 'seed.json'], {})
    await symlink(outsideFile, join(root, 'runtime-goals', 'goals.json'))

    await expect(atomicWriteAppDataJson(root, ['runtime-goals', 'goals.json'], { goals: [] }))
      .rejects.toThrow(/not a symlink/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })

  it('appends JSONL through no-follow path validation and replays multiple rows', async () => {
    const root = await tempRoot()
    const store = new AppDataJsonlStore({ rootDir: root, segments: ['events', 'thread.jsonl'] })

    await store.appendJson([{ seq: 1, text: 'hello' }, { seq: 2, text: 'world' }])

    const rows = (await store.readText()).trim().split('\n').map((line) => JSON.parse(line) as { seq: number })
    expect(rows.map((row) => row.seq)).toEqual([1, 2])
  })

  it('serializes concurrent JSONL appends on one store instance', async () => {
    const root = await tempRoot()
    const store = new AppDataJsonlStore({ rootDir: root, segments: ['usage', 'records.jsonl'] })

    await Promise.all(Array.from({ length: 40 }, (_, index) => store.appendJson([{ index }])))

    const rows = (await store.readText()).trim().split('\n').map((line) => JSON.parse(line) as { index: number })
    expect(rows).toHaveLength(40)
    expect(rows.map((row) => row.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index)
    )
  })

  it('rejects JSONL append through a symlinked parent directory', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    await symlink(outside, join(root, 'events'))

    await expect(appendAppDataStoreText(root, ['events', 'thread.jsonl'], '{}\n'))
      .rejects.toThrow(/must not cross a symlink/)
  })

  it('rejects JSONL append to an existing symlink target', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const outsideFile = join(outside, 'thread.jsonl')
    await mkdir(join(root, 'events'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(root, 'events', 'thread.jsonl'))

    await expect(appendAppDataStoreText(root, ['events', 'thread.jsonl'], '{}\n'))
      .rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
