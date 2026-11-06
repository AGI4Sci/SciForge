import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { bindWorkspaceArgument } from './process-extension-host.js'

const descriptor = {
  id: 'example.write', scope: 'workspace', tags: ['dsh-tool'],
  inputSchema: { type: 'object', properties: { workspaceRoot: { type: 'string' } } }
}

test('binds absent or matching roots only from the authenticated Host caller', () => {
  const workspace = resolve('/workspace/one')
  assert.deepEqual(bindWorkspaceArgument(descriptor, { value: 1 }, workspace), { value: 1, workspaceRoot: workspace })
  assert.deepEqual(bindWorkspaceArgument(descriptor, { workspaceRoot: workspace }, workspace), { workspaceRoot: workspace })
  assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: resolve('/workspace/other') }, workspace), /rejects a workspaceRoot/)
  assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: workspace, __sciforgeHostWorkspace: 'host' }, undefined), /requires a workspace-scoped caller/)
  for (const root of ['', undefined, 'relative/path', 'bad\0path']) {
    assert.throws(() => bindWorkspaceArgument(descriptor, {}, root), /requires a workspace-scoped caller/)
  }
  for (const root of ['', null, undefined, 42, 'relative/path', '/bad\0path']) {
    assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: root }, workspace), /rejects a workspaceRoot/)
  }
  assert.throws(() => bindWorkspaceArgument(descriptor, null, workspace), /requires an object argument/)
})

test('workspace scope requires a caller even without DSH tags; unbound descriptors stay untouched', () => {
  assert.throws(() => bindWorkspaceArgument({ scope: 'workspace' }, {}, undefined), /requires a workspace-scoped caller/)
  const input = { workspaceRoot: '/model/supplied' }
  assert.equal(bindWorkspaceArgument({ scope: 'global' }, input, undefined), input)
  assert.throws(() => bindWorkspaceArgument({ ...descriptor, scope: 'resource', tags: ['dsh-workspace-read'] }, input, '/caller'), /rejects a workspaceRoot/)
})

test('canonical aliases and deepest existing ancestors compare equally, foreign symlinks reject', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'sdk-binding-'))
  try {
    const workspace = join(root, 'workspace')
    const foreign = join(root, 'foreign')
    const alias = join(root, 'alias')
    await mkdir(workspace)
    await mkdir(foreign)
    await symlink(workspace, alias, 'dir')
    assert.deepEqual(bindWorkspaceArgument(descriptor, { workspaceRoot: join(alias, '.', 'child', '..') }, workspace), { workspaceRoot: workspace })
    const future = join(workspace, 'not-created', 'deep')
    assert.deepEqual(bindWorkspaceArgument(descriptor, { workspaceRoot: join(alias, 'not-created', 'deep') }, future), { workspaceRoot: future })
    const escape = join(workspace, 'escape')
    await symlink(foreign, escape, 'dir')
    assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: escape, __sciforgeHostWorkspace: 'host' }, workspace), /rejects a workspaceRoot/)
    assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: join(escape, 'missing') }, join(workspace, 'missing')), /rejects a workspaceRoot/)
    if (process.platform === 'win32') {
      assert.deepEqual(bindWorkspaceArgument(descriptor, { workspaceRoot: workspace.toUpperCase() }, workspace), { workspaceRoot: workspace })
    } else {
      // Missing suffixes cannot be realpath-normalized; do not guess whether
      // the enclosing macOS volume folds case.
      assert.throws(() => bindWorkspaceArgument(descriptor, { workspaceRoot: join(workspace, 'CasePending') }, join(workspace, 'casepending')), /rejects a workspaceRoot/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
