import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { viteDependencyAssetRoots } from './vite-dependency-roots'

test('admits only declared dependency directories behind worktree links', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sciforge-vite-dependencies-'))
  try {
    const root = join(temporary, 'checkout')
    const cached = join(temporary, 'cache', 'node_modules', 'declared')
    const undeclared = join(temporary, 'cache', 'node_modules', 'undeclared')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(cached, { recursive: true })
    await mkdir(undeclared, { recursive: true })
    await writeFile(join(cached, 'package.json'), JSON.stringify({ name: 'declared' }))
    await writeFile(join(temporary, 'cache', 'package.json'), JSON.stringify({ name: 'cache-owner' }))
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { declared: '1.0.0', redirected: '1.0.0', missing: '1.0.0', '../cache': '1.0.0' }
    }))
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(cached, join(root, 'node_modules', 'declared'), linkType)
    await symlink(undeclared, join(root, 'node_modules', 'undeclared'), linkType)
    await symlink(join(temporary, 'cache'), join(root, 'node_modules', 'redirected'), linkType)
    const allowed = viteDependencyAssetRoots(root)
    expect(allowed).toEqual([root, await realpath(cached)])
    expect(allowed).not.toContain(join(temporary, 'cache'))
    expect(allowed).not.toContain(await realpath(undeclared))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
