import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteFile } from './atomic-write-file'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })))
})

describe('atomicWriteFile', () => {
  it('creates parent directories and atomically replaces existing contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-atomic-write-'))
    temporaryDirectories.push(root)
    const path = join(root, 'nested', 'settings.json')

    await atomicWriteFile(path, 'first')
    await atomicWriteFile(path, 'second')

    expect(await readFile(path, 'utf8')).toBe('second')
    expect(await readdir(join(root, 'nested'))).toEqual(['settings.json'])
  })
})
