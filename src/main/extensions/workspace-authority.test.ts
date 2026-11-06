import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, test } from 'vitest'
import { canonicalWorkspacePath, createWorkspaceAuthority, isWithinWorkspaceRoot } from './workspace-authority.js'

describe('canonicalWorkspacePath', () => {
  test('rejects relative, empty and whitespace-only declarations', () => {
    assert.equal(canonicalWorkspacePath(''), undefined)
    assert.equal(canonicalWorkspacePath('   '), undefined)
    assert.equal(canonicalWorkspacePath('relative/path'), undefined)
    assert.equal(canonicalWorkspacePath('./also-relative'), undefined)
  })

  test('resolves dot segments before comparing', () => {
    assert.equal(canonicalWorkspacePath('/tmp/a/../b'), canonicalWorkspacePath('/tmp/b'))
  })

  test('preserves native realpath spelling and missing suffix case on non-Windows volumes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'Workspace-Case-'))
    try {
      const file = join(root, 'Review-Document.md')
      await writeFile(file, 'case-sensitive resource identity')
      const native = await realpath(file)
      assert.equal(canonicalWorkspacePath(file), process.platform === 'win32' ? native.toLowerCase() : native)
      if (process.platform !== 'win32') {
        const parent = await realpath(root)
        assert.equal(canonicalWorkspacePath(join(root, 'Pending-View')), join(parent, 'Pending-View'))
        assert.notEqual(canonicalWorkspacePath(join(root, 'Pending-View')), canonicalWorkspacePath(join(root, 'pending-view')))
        const allow = createWorkspaceAuthority({ readTrustedRoots: () => [join(root, 'Pending-View')] })
        assert.equal(await allow({ caller: {}, workspaceId: join(root, 'pending-view') }), false)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('isWithinWorkspaceRoot', () => {
  test('accepts the root and its descendants, rejects siblings and traversal', () => {
    assert.equal(isWithinWorkspaceRoot('/ws', '/ws'), true)
    assert.equal(isWithinWorkspaceRoot('/ws/sub/dir', '/ws'), true)
    assert.equal(isWithinWorkspaceRoot('/ws-evil', '/ws'), false)
    assert.equal(isWithinWorkspaceRoot('/etc', '/ws'), false)
  })
})

describe('createWorkspaceAuthority', () => {
  let root = ''
  let sibling = ''
  let link = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'sciforge-workspace-authority-'))
    sibling = `${root}-sibling`
    await mkdir(join(root, 'nested'), { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(root, 'note.txt'), 'x')
    link = `${root}-link`
    await symlink(root, link, 'dir')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(sibling, { recursive: true, force: true })
    await rm(link, { force: true })
  })

  const authority = (roots: readonly string[] | (() => Promise<readonly string[]>)) =>
    createWorkspaceAuthority({ readTrustedRoots: typeof roots === 'function' ? roots : () => roots })

  test('authorizes a configured root and a directory inside it', async () => {
    const allow = authority([root])
    assert.equal(await allow({ caller: {}, workspaceId: root }), true)
    assert.equal(await allow({ caller: {}, workspaceId: join(root, 'nested') }), true)
  })

  test('rejects a sibling that shares a name prefix', async () => {
    const allow = authority([root])
    assert.equal(await allow({ caller: {}, workspaceId: sibling }), false)
    assert.equal(await allow({ caller: {}, workspaceId: join(sibling, 'x') }), false)
  })

  test('rejects traversal out of the root', async () => {
    const allow = authority([root])
    assert.equal(await allow({ caller: {}, workspaceId: join(root, '..', 'etc') }), false)
  })

  test('treats a symlink to a trusted root as that root', async () => {
    const allow = authority([root])
    assert.equal(await allow({ caller: {}, workspaceId: link }), true)
  })

  test('authorizes a remote workspace-host root the Host reports', async () => {
    const allow = authority([root, '/remote/workspace'])
    assert.equal(await allow({ caller: {}, workspaceId: '/remote/workspace/project' }), true)
  })

  test('reads the roots on every call, so a new workspace is authorized without a restart', async () => {
    let roots: readonly string[] = []
    const allow = authority(async () => roots)
    assert.equal(await allow({ caller: {}, workspaceId: root }), false)
    roots = [root]
    assert.equal(await allow({ caller: {}, workspaceId: root }), true)
  })

  test('an empty trust list denies everything', async () => {
    const allow = authority([])
    assert.equal(await allow({ caller: {}, workspaceId: '/' }), false)
    assert.equal(await allow({ caller: {}, workspaceId: root }), false)
  })
})