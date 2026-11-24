import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceFile } from './workspace-file.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))) })

async function workspace() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'kn-ws-')))
  dirs.push(base)
  const root = join(base, 'ws')
  await mkdir(join(root, 'refs'), { recursive: true })
  await writeFile(join(root, 'refs', 'lib.bib'), '@a{k, title={T}}')
  await writeFile(join(base, 'secret.txt'), 'outside')
  return { base, root }
}

describe('readWorkspaceFile', () => {
  it('reads a file inside the workspace', async () => {
    const { root } = await workspace()
    expect((await readWorkspaceFile(root, 'refs/lib.bib', 1024)).toString()).toBe('@a{k, title={T}}')
  })

  it('refuses absolute paths, parent escapes and symlinks that leave the workspace', async () => {
    const { base, root } = await workspace()
    const linkPath = process.platform === 'win32' ? 'refs/external/secret.txt' : 'refs/link.bib'
    if (process.platform === 'win32') await symlink(base, join(root, 'refs', 'external'), 'junction')
    else await symlink(join(base, 'secret.txt'), join(root, 'refs', 'link.bib'))
    await expect(readWorkspaceFile(root, join(base, 'secret.txt'), 1024)).rejects.toThrow('relative')
    await expect(readWorkspaceFile(root, '../secret.txt', 1024)).rejects.toThrow('outside the workspace')
    await expect(readWorkspaceFile(root, linkPath, 1024)).rejects.toThrow('outside the workspace')
  })

  it('refuses a missing file, a directory and an oversized file', async () => {
    const { root } = await workspace()
    await expect(readWorkspaceFile(root, 'refs/none.bib', 1024)).rejects.toThrow('not found')
    await expect(readWorkspaceFile(root, 'refs', 1024)).rejects.toThrow('not a regular file')
    await expect(readWorkspaceFile(root, 'refs/lib.bib', 4)).rejects.toThrow('larger than')
  })
})


describe('portable workspace paths', () => {
  it('rejects Windows drives, alternate streams and UNC paths on all platforms', async () => {
    const { root } = await workspace()
    for (const path of ['C:secret.bib', 'C:/secret.bib', String.raw`\\server\share\secret.bib`, 'refs/lib.bib:secret']) {
      await expect(readWorkspaceFile(root, path, 1024)).rejects.toThrow('relative')
    }
  })

  it('allows dot-prefixed ordinary files, Unicode and an internal symlink', async () => {
    const { root } = await workspace()
    await writeFile(join(root, '..ordinary.bib'), 'ok')
    await writeFile(join(root, '文献 含空格.bib'), '中文')
    await symlink(join(root, 'refs'), join(root, 'internal'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await readWorkspaceFile(root, '..ordinary.bib', 2)).toString()).toBe('ok')
    expect((await readWorkspaceFile(root, '文献 含空格.bib', 6)).toString()).toBe('中文')
    expect((await readWorkspaceFile(root, 'internal/lib.bib', 1024)).toString()).toContain('@a')
    await expect(readWorkspaceFile(root, 'refs/lib.bib', 0)).rejects.toThrow('Invalid file size limit')
  })
})
