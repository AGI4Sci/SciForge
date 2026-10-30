import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  await git(root, ['config', 'core.autocrlf', 'false'])
  await git(root, ['config', 'user.name', 'SciForge Test'])
  await git(root, ['config', 'user.email', 'sciforge-test@localhost'])
  await writeFile(join(workspace, 'paper.md'), 'baseline\n')
  await writeFile(join(root, 'outside.txt'), 'outside baseline\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-m', 'baseline'])
  return { root, workspace }
}

async function createWorkspace() {
  const repository = await createRepository()
  const service = new VersionControlWorkspaceService()
  const session = await service.open('window-1', 'ui', repository.workspace)
  return { ...repository, service, session }
}

describe('VersionControlWorkspaceService', () => {
  let fixture: Awaited<ReturnType<typeof createWorkspace>>

  beforeEach(async () => {
    fixture = await createWorkspace()
  })

  describe('with dirty tracked and untracked files', () => {
    let before: Awaited<ReturnType<VersionControlWorkspaceService['status']>>

    beforeEach(async () => {
      const { workspace, service, session } = fixture
      await writeFile(join(workspace, 'paper.md'), 'snapshot version\n')
      await writeFile(join(workspace, 'notes.txt'), 'untracked snapshot\n')

      before = await service.status(session)
    })

    it('captures dirty tracked and untracked files without changing the real index', async () => {
      const { root, workspace, service, session } = fixture
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
  })

  describe('with a snapshot and subsequent workspace changes', () => {
    let snapshot: Awaited<ReturnType<VersionControlWorkspaceService['createSnapshot']>>
    let current: Awaited<ReturnType<VersionControlWorkspaceService['status']>>

    // Build the real Git state as a fixture; each case below checks one
    // operation rather than timing repository setup plus several workflows.
    beforeEach(async () => {
      const { root, workspace, service, session } = fixture
      await writeFile(join(workspace, 'paper.md'), 'captured staged\n')
      await git(root, ['add', 'workspace/paper.md'])
      await writeFile(join(workspace, 'paper.md'), 'captured unstaged\n')
      await writeFile(join(workspace, 'captured.txt'), 'captured untracked\n')
      const capturedStatus = await service.status(session)
      snapshot = await service.createSnapshot(
        session,
        { label: 'target' },
        capturedStatus.revision
      )

      await writeFile(join(workspace, 'paper.md'), 'later\n')
      await writeFile(join(workspace, 'later.txt'), 'remove me\n')
      await writeFile(join(root, 'outside.txt'), 'outside must survive\n')
      current = await service.status(session)
    })

    it('restores only the bound workspace and reproduces the captured revision', async () => {
      const { root, workspace, service, session } = fixture
      expect(current.revision).not.toBe(snapshot.revision)
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

    it('rejects empty restore paths without deleting untracked files', async () => {
      const { workspace, service, session } = fixture
      await expect(service.restore(
        session,
        { target: snapshot.id, paths: [] },
        current.revision
      )).rejects.toThrow(/paths cannot be empty/u)
      await expect(readFile(join(workspace, 'later.txt'), 'utf8')).resolves.toBe('remove me\n')

      // A rejected mutation must leave the queue usable and the revision intact.
      const followingSnapshot = await service.createSnapshot(
        session,
        { label: 'After rejected restore' },
        current.revision
      )
      expect(followingSnapshot.revision).toBe(current.revision)
    })

    it('previews changes relative to the captured snapshot', async () => {
      const { service, session } = fixture
      const preview = await service.diff(session, {
        from: snapshot.id,
        maxCharacters: 100_000
      })
      expect(preview.text).toContain('later')
    })
  })

  it('rejects cross-owner sessions, escaping paths, and stale revisions', async () => {
    const { workspace, service, session } = fixture
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

  describe('with the current snapshot', () => {
    let current: Awaited<ReturnType<VersionControlWorkspaceService['status']>>
    let snapshot: Awaited<ReturnType<VersionControlWorkspaceService['createSnapshot']>>

    beforeEach(async () => {
      const { root, workspace, service, session } = fixture
      await writeFile(join(workspace, 'paper.md'), 'captured\n')
      await git(root, ['add', 'workspace/paper.md'])
      await writeFile(join(workspace, 'paper.md'), 'captured unstaged\n')
      current = await service.status(session)
      snapshot = await service.createSnapshot(session, { label: 'same' }, current.revision)
    })

    it('treats restoring the current snapshot as an exact no-op', async () => {
      const { root, workspace, service, session } = fixture
      await expect(service.restore(session, { target: snapshot.id }, current.revision))
        .resolves.toEqual({ ok: true, revision: current.revision })
      await expect(readFile(join(workspace, 'paper.md'), 'utf8'))
        .resolves.toBe('captured unstaged\n')
      await expect(git(root, ['show', ':workspace/paper.md']))
        .resolves.toBe('captured\n')
    })
  })
})
