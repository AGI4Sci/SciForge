import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  resolveTargetPathWithinWorkspace,
  writeSafeWorkspaceFile
} from './workspace-paths.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-domain-sdk-paths-'))
  temporaryRoots.push(root)
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  await writeFile(join(workspaceRoot, 'inside.txt'), 'inside', 'utf8')
  await writeFile(join(root, 'outside.txt'), 'outside', 'utf8')
  return { root, workspaceRoot }
}

test('resolves workspace-confined files and rejects lexical escapes', async () => {
  const { root, workspaceRoot } = await fixture()

  assert.equal(
    await resolveOpenTargetPath('inside.txt', workspaceRoot),
    await realpath(join(workspaceRoot, 'inside.txt'))
  )
  await assert.rejects(
    resolveTargetPathWithinWorkspace(join(root, 'outside.txt'), workspaceRoot),
    /stay within/
  )
})

test('rejects writes whose parent traverses a symlink outside the workspace', async () => {
  const { root, workspaceRoot } = await fixture()
  await symlink(root, join(workspaceRoot, 'escape'))

  await assert.rejects(
    resolveSafeWorkspaceWriteTarget('escape/created.txt', workspaceRoot),
    /stay within/
  )
})

test('writes through a verified workspace target', async () => {
  const { workspaceRoot } = await fixture()
  const target = await resolveSafeWorkspaceWriteTarget('nested/result.txt', workspaceRoot)

  await writeSafeWorkspaceFile(target, 'result')

  assert.equal(await readFile(join(workspaceRoot, 'nested/result.txt'), 'utf8'), 'result')
})
