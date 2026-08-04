import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { VersionControlWorkspaceService } from './version-control-workspace-service'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return String(stdout)
}

async function createRepository(): Promise<{
  root: string
  workspace: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-vcs-test-'))
  temporaryRoots.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await git(root, ['init'])
  await git(root, ['config', 'user.name', 'SciForge Test'])
  await git(root, ['config', 'user.email', 'sciforge-test@localhost'])
  await writeFile(join(workspace, 'paper.md'), 'baseline\n')
  await writeFile(join(root, 'outside.txt'), 'outside baseline\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'baseline'])
  return { root, workspace }
}

describe('VersionControlWorkspaceService', () => {
  it('captures dirty tracked and untracked files without changing the real index', async () => {
    const { root, workspace } = await createRepository()
    const service = new VersionControlWorkspaceService()
    const session = await service.open('window-1', 'ui', workspace)
    await writeFile(join(workspace, 'paper.md'), 'snapshot version\n')
    await writeFile(join(workspace, 'notes.txt'), 'untracked snapshot\n')

    const before = await service.status(session)
    expect(before.changes).toEqual(expect.arrayContaining([
      { path: 'paper.md', status: 'modified' },
      { path: 'notes.txt', status: 'untracked' }
    ]))
    const snapshot = await service.createSnapshot(session, {
      label: 'Before rewrite',
      metadata: { source: 'test' }
    }, before.revision)

    expect(snapshot.revision).toBe(before.revision)
    expect(await git(root, ['diff', '--cached', '--name-only'])).toBe('')
    await expect(readFile(join(workspace, 'paper.md'), 'utf8'))
      .resolves.toBe('snapshot version\n')
    const listed = await service.listSnapshots(session, { limit: 10 })
    expect(listed.snapshots).toEqual([expect.objectContaining({
      id: snapshot.id,
      revision: snapshot.revision,
      label: 'Before rewrite',
      metadata: { source: 'test' }
    })])
    await expect(service.readFile(session, {
      revision: snapshot.id,
      path: 'notes.txt'
    })).resolves.toEqual({
      content: 'untracked snapshot\n',
      truncated: false
    })
  })

  it('restores only the bound workspace and reproduces the captured revision', async () => {
    const { root, workspace } = await createRepository()
    const service = new VersionControlWorkspaceService()
    const session = await service.open('window-1', 'ui', workspace)
    await writeFile(join(workspace, 'paper.md'), 'captured staged\n')
    await git(root, ['add', 'workspace/paper.md'])
    await writeFile(join(workspace, 'paper.md'), 'captured unstaged\n')
    await writeFile(join(workspace, 'captured.txt'), 'captured untracked\n')
    const capturedStatus = await service.status(session)
    const snapshot = await service.createSnapshot(
      session,
      { label: 'target' },
      capturedStatus.revision
    )

    await writeFile(join(workspace, 'paper.md'), 'later\n')
    await writeFile(join(workspace, 'later.txt'), 'remove me\n')
    await writeFile(join(root, 'outside.txt'), 'outside must survive\n')
    const current = await service.status(session)
    expect(current.revision).not.toBe(snapshot.revision)
    await expect(service.restore(
      session,
      { target: snapshot.id, paths: [] },
      current.revision
    )).rejects.toThrow(/paths cannot be empty/u)
    await expect(readFile(join(workspace, 'later.txt'), 'utf8')).resolves.toBe('remove me\n')

    const preview = await service.diff(session, {
      from: snapshot.id,
      maxCharacters: 100_000
    })
    expect(preview.text).toContain('later')
    const restored = await service.restore(session, { target: snapshot.id }, current.revision)

    expect(restored.revision).toBe(snapshot.revision)
    await expect(readFile(join(workspace, 'paper.md'), 'utf8'))
      .resolves.toBe('captured unstaged\n')
    await expect(git(root, ['show', ':workspace/paper.md']))
      .resolves.toBe('captured staged\n')
    expect(await git(root, ['status', '--porcelain=v1', '--', 'workspace']))
      .toContain('MM workspace/paper.md')
    await expect(readFile(join(workspace, 'captured.txt'), 'utf8'))
      .resolves.toBe('captured untracked\n')
    await expect(readFile(join(workspace, 'later.txt'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(root, 'outside.txt'), 'utf8'))
      .resolves.toBe('outside must survive\n')
  })

  it('rejects cross-owner sessions, escaping paths, and stale revisions', async () => {
    const { workspace } = await createRepository()
    const service = new VersionControlWorkspaceService()
    const session = await service.open('window-1', 'ui', workspace)
    const initial = await service.revision(session)

    expect(() => service.requireSession('window-2', 'ui', session.resourceId, workspace))
      .toThrow(/unavailable to this caller/u)
    expect(() => service.requireSession('window-1', 'agent', session.resourceId, workspace))
      .toThrow(/unavailable to this caller/u)
    await expect(service.open('window-1', 'ui', workspace))
      .resolves.toBe(session)
    await expect(service.readFile(session, {
      revision: initial,
      path: '../outside.txt'
    })).rejects.toThrow(/stay inside the workspace/u)
    await writeFile(join(workspace, 'paper.md'), 'changed\n')
    await expect(service.assertRevision(session, initial))
      .rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('treats restoring the current snapshot as an exact no-op', async () => {
    const { root, workspace } = await createRepository()
    const service = new VersionControlWorkspaceService()
    const session = await service.open('window-1', 'ui', workspace)
    await writeFile(join(workspace, 'paper.md'), 'captured\n')
    await git(root, ['add', 'workspace/paper.md'])
    await writeFile(join(workspace, 'paper.md'), 'captured unstaged\n')
    const current = await service.status(session)
    const snapshot = await service.createSnapshot(session, { label: 'same' }, current.revision)

    await expect(service.restore(session, { target: snapshot.id }, current.revision))
      .resolves.toEqual({ ok: true, revision: current.revision })
    await expect(readFile(join(workspace, 'paper.md'), 'utf8'))
      .resolves.toBe('captured unstaged\n')
    await expect(git(root, ['show', ':workspace/paper.md']))
      .resolves.toBe('captured\n')
  })
})
