import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveOpenTargetPath,
  resolveTargetPathWithinWorkspace
} from './workspace-paths'

let fixtureRoot = ''
let workspaceRoot = ''
let outsideRoot = ''

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'plot-workspace-paths-'))
  workspaceRoot = join(fixtureRoot, 'workspace')
  outsideRoot = join(fixtureRoot, 'outside')
  mkdirSync(workspaceRoot)
  mkdirSync(outsideRoot)
})

afterEach(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = ''
  workspaceRoot = ''
  outsideRoot = ''
})

describe('workspace path boundaries', () => {
  it('resolves normal relative and absolute read/write paths inside the canonical workspace', async () => {
    const dataDir = join(workspaceRoot, 'data')
    const sourcePath = join(dataDir, 'source.csv')
    mkdirSync(dataDir)
    writeFileSync(sourcePath, 'x,y\n1,2\n')

    await expect(resolveOpenTargetPath('data/source.csv', workspaceRoot)).resolves.toBe(realpathSync(sourcePath))
    await expect(resolveOpenTargetPath(sourcePath, workspaceRoot)).resolves.toBe(realpathSync(sourcePath))
    await expect(resolveTargetPathWithinWorkspace('output/figure.png', workspaceRoot)).resolves.toBe(
      join(realpathSync(workspaceRoot), 'output', 'figure.png')
    )
    await expect(resolveTargetPathWithinWorkspace(join(workspaceRoot, 'output', 'figure.png'), workspaceRoot)).resolves.toBe(
      join(realpathSync(workspaceRoot), 'output', 'figure.png')
    )
  })

  it('rejects parent traversal for both read paths and write targets', async () => {
    const outsideFile = join(outsideRoot, 'source.csv')
    writeFileSync(outsideFile, 'x,y\n1,2\n')

    await expect(
      resolveOpenTargetPath('../outside/source.csv', workspaceRoot, { allowBasenameFallback: false })
    ).rejects.toThrow('Path must stay within the selected workspace.')
    await expect(resolveTargetPathWithinWorkspace('../outside/figure.png', workspaceRoot)).rejects.toThrow(
      'Path must stay within the selected workspace.'
    )
  })

  it('rejects existing and non-existing targets reached through a workspace symlink to outside', async () => {
    const outsideFile = join(outsideRoot, 'source.csv')
    writeFileSync(outsideFile, 'x,y\n1,2\n')
    symlinkSync(outsideRoot, join(workspaceRoot, 'external'), 'dir')

    await expect(
      resolveOpenTargetPath('external/source.csv', workspaceRoot, { allowBasenameFallback: false })
    ).rejects.toThrow('Path must stay within the selected workspace.')
    await expect(resolveTargetPathWithinWorkspace('external/source.csv', workspaceRoot)).rejects.toThrow(
      'Path must stay within the selected workspace.'
    )
    await expect(resolveTargetPathWithinWorkspace('external/new/deep/figure.png', workspaceRoot)).rejects.toThrow(
      'Path must stay within the selected workspace.'
    )
    await expect(
      resolveOpenTargetPath('external/new/deep/source.csv', workspaceRoot, { allowBasenameFallback: false })
    ).rejects.toThrow('File not found:')
  })

  it('rejects a non-existing target below a dangling symlink', async () => {
    symlinkSync(join(outsideRoot, 'not-created'), join(workspaceRoot, 'dangling'), 'dir')

    await expect(resolveTargetPathWithinWorkspace('dangling/new/figure.png', workspaceRoot)).rejects.toThrow(
      'unavailable symbolic link'
    )
  })

  it('accepts workspace-internal symlinks and returns their canonical target paths', async () => {
    const realDataDir = join(workspaceRoot, 'real-data')
    const sourcePath = join(realDataDir, 'source.csv')
    mkdirSync(realDataDir)
    writeFileSync(sourcePath, 'x,y\n1,2\n')
    symlinkSync(realDataDir, join(workspaceRoot, 'data-alias'), 'dir')

    await expect(resolveOpenTargetPath('data-alias/source.csv', workspaceRoot)).resolves.toBe(realpathSync(sourcePath))
    await expect(resolveTargetPathWithinWorkspace('data-alias/new/figure.png', workspaceRoot)).resolves.toBe(
      join(realpathSync(realDataDir), 'new', 'figure.png')
    )
  })

  it('supports a canonical workspace reached through a symlink and keeps unique basename fallback', async () => {
    const nestedDir = join(workspaceRoot, 'nested')
    const sourcePath = join(nestedDir, 'unique-source.csv')
    const workspaceAlias = join(fixtureRoot, 'workspace-alias')
    mkdirSync(nestedDir)
    writeFileSync(sourcePath, 'x,y\n1,2\n')
    symlinkSync(workspaceRoot, workspaceAlias, 'dir')

    await expect(resolveOpenTargetPath('unique-source.csv', workspaceAlias)).resolves.toBe(realpathSync(sourcePath))
    await expect(resolveTargetPathWithinWorkspace('output/figure.png', workspaceAlias)).resolves.toBe(
      resolve(realpathSync(workspaceRoot), 'output/figure.png')
    )
  })
})
