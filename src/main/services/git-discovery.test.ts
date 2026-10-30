import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findNearestGitRoot } from './git-discovery'

let sandbox = ''

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'sciforge-git-discovery-'))
})

afterEach(async () => {
  if (!sandbox) return
  await rm(sandbox, { recursive: true, force: true })
  sandbox = ''
})

async function makeRepo(root: string): Promise<void> {
  await mkdir(join(root, '.git'), { recursive: true })
}

describe('findNearestGitRoot', () => {
  it('returns the directory itself when it contains .git', async () => {
    await makeRepo(sandbox)

    await expect(findNearestGitRoot(sandbox)).resolves.toBe(sandbox)
  })

  it('walks up to find .git in an ancestor directory', async () => {
    await makeRepo(sandbox)
    const subdir = join(sandbox, 'src', 'components', 'chat')
    await mkdir(subdir, { recursive: true })

    await expect(findNearestGitRoot(subdir)).resolves.toBe(sandbox)
  })

  it('walks up from a deeply nested subdirectory', async () => {
    await makeRepo(sandbox)
    const subdir = join(sandbox, 'a', 'b', 'c', 'd', 'e', 'f', 'g')
    await mkdir(subdir, { recursive: true })

    await expect(findNearestGitRoot(subdir)).resolves.toBe(sandbox)
  })

  it('recognizes .git files used by worktrees and submodules', async () => {
    await writeFile(join(sandbox, '.git'), 'gitdir: /tmp/elsewhere\n', 'utf8')
    const subdir = join(sandbox, 'sub')
    await mkdir(subdir, { recursive: true })

    await expect(findNearestGitRoot(subdir)).resolves.toBe(sandbox)
  })

  it('returns the nearest root for nested Git repositories', async () => {
    await makeRepo(sandbox)
    const nestedRepo = join(sandbox, 'packages', 'nested')
    await makeRepo(nestedRepo)
    const nestedSubdir = join(nestedRepo, 'src')
    await mkdir(nestedSubdir, { recursive: true })

    await expect(findNearestGitRoot(nestedSubdir)).resolves.toBe(nestedRepo)

    const sibling = join(sandbox, 'sibling')
    await mkdir(sibling, { recursive: true })
    await expect(findNearestGitRoot(sibling)).resolves.toBe(sandbox)
  })

  it('walks from a non-existent child path to an ancestor Git root', async () => {
    await makeRepo(sandbox)
    const subdir = join(sandbox, 'src')
    await mkdir(subdir, { recursive: true })

    await expect(findNearestGitRoot(join(subdir, 'missing.txt'))).resolves.toBe(sandbox)
  })

  it('returns null when no ancestor contains .git', async () => {
    await expect(findNearestGitRoot(sandbox)).resolves.toBeNull()
  })

  it('returns null after walking to the filesystem root', async () => {
    await expect(findNearestGitRoot('/this/path/does/not/exist/for-sciforge')).resolves.toBeNull()
  })

  it('returns null for an empty workspace root', async () => {
    await expect(findNearestGitRoot('')).resolves.toBeNull()
    await expect(findNearestGitRoot('   ')).resolves.toBeNull()
  })
})
