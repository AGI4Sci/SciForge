import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  GitCheckpointService,
  type GitCheckpointVcsPort
} from './service.js'

const roots: string[] = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

test('service owns metadata, preview, rescue-before-restore, and durable list policy', async () => {
  const userDataDir = await tempRoot()
  const calls: string[] = []
  let snapshot = 0
  const vcs: GitCheckpointVcsPort = {
    capture: async ({ snapshotName }) => {
      calls.push(`capture:${snapshotName}`)
      snapshot += 1
      return {
        snapshotId: `snapshot-${snapshot}`,
        provider: 'git',
        revision: `revision-${snapshot}`,
        changeSummary: '1 modified'
      }
    },
    preview: async ({ snapshotId }) => {
      calls.push(`preview:${snapshotId}`)
      return {
        patch: 'workspace patch',
        truncated: false
      }
    },
    restore: async ({ snapshotId }) => {
      calls.push(`restore:${snapshotId}`)
    }
  }
  let id = 0
  const service = new GitCheckpointService({
    userDataDir,
    vcs,
    now: () => new Date('2026-07-28T00:00:00.000Z'),
    createId: () => `id-${++id}`
  })
  const created = await service.create({
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspaceRoot: '/workspace/repository',
    phase: 'before-turn'
  })
  assert.equal(created.ok, true)
  if (!created.ok) return
  assert.equal(created.value.phase, 'before-turn')

  const hidden = await service.preview(
    created.value.checkpointId,
    '/another-workspace'
  )
  assert.deepEqual(hidden, {
    ok: false,
    reason: 'not_found',
    message: `Git checkpoint not found: ${created.value.checkpointId}`
  })
  assert.equal(calls.filter((entry) => entry.startsWith('preview:')).length, 0)

  const preview = await service.preview(created.value.checkpointId)
  assert.equal(preview.ok, true)
  if (preview.ok) {
    assert.equal(preview.value.patch, 'workspace patch')
    assert.equal(preview.value.truncated, false)
  }

  const restored = await service.restore({
    checkpointId: created.value.checkpointId
  })
  assert.equal(restored.ok, true)
  if (!restored.ok) return
  assert.match(restored.value.rescueCheckpointId, /^rescue_/u)
  assert.deepEqual(calls.slice(-2).map((entry) => entry.split(':')[0]), [
    'capture',
    'restore'
  ])

  const reopened = new GitCheckpointService({ userDataDir, vcs })
  const listed = await reopened.list({ runtimeId: 'codex', threadId: 'thread-1' })
  assert.equal(listed.ok, true)
  if (listed.ok) {
    assert.equal(listed.value.length, 1)
    assert.equal(listed.value[0]?.status, 'restored')
    assert.equal(listed.value[0]?.rescueCheckpointId, restored.value.rescueCheckpointId)
  }
  const rescueList = await reopened.list({
    runtimeId: 'codex',
    threadId: 'thread-1:restore-rescue'
  })
  assert.equal(rescueList.ok, true)
  if (rescueList.ok) assert.equal(rescueList.value.length, 1)
})

test('restore aborts before destructive VCS action if rescue capture fails', async () => {
  const userDataDir = await tempRoot()
  let captures = 0
  let restoreCalls = 0
  const vcs: GitCheckpointVcsPort = {
    capture: async () => {
      captures += 1
      if (captures > 1) throw Object.assign(new Error('capture failed'), { code: 'capture_failed' })
      return {
        snapshotId: 'snapshot-1',
        provider: 'git',
        revision: 'revision-1',
        changeSummary: ''
      }
    },
    preview: async () => ({ patch: '', truncated: false }),
    restore: async () => {
      restoreCalls += 1
    }
  }
  const service = new GitCheckpointService({ userDataDir, vcs })
  const created = await service.create({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/repository',
    phase: 'manual'
  })
  assert.equal(created.ok, true)
  if (!created.ok) return

  const restored = await service.restore({ checkpointId: created.value.checkpointId })
  assert.equal(restored.ok, false)
  if (!restored.ok) assert.equal(restored.reason, 'rescue_failed')
  assert.equal(restoreCalls, 0)
})

test('blocked restore still retains the rescue checkpoint ID', async () => {
  const userDataDir = await tempRoot()
  let snapshot = 0
  const vcs: GitCheckpointVcsPort = {
    capture: async () => ({
      snapshotId: `snapshot-${++snapshot}`,
      provider: 'git',
      revision: `revision-${snapshot}`,
      changeSummary: ''
    }),
    preview: async () => ({ patch: '', truncated: false }),
    restore: async () => {
      throw Object.assign(new Error('Working tree has changes.'), { code: 'dirty_worktree' })
    }
  }
  const service = new GitCheckpointService({ userDataDir, vcs })
  const created = await service.create({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/repository'
  })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const restored = await service.restore({ checkpointId: created.value.checkpointId })
  assert.equal(restored.ok, false)
  if (!restored.ok) {
    assert.equal(restored.reason, 'dirty_worktree')
    assert.match(
      String((restored.details as { rescueCheckpointId?: string }).rescueCheckpointId),
      /^rescue_/u
    )
  }
  const listed = await service.list({ threadId: 'thread-1' })
  assert.equal(listed.ok, true)
  if (listed.ok) assert.equal(listed.value[0]?.status, 'blocked')
})

test('metadata root rejects symlink substitution', async () => {
  const userDataDir = await tempRoot()
  const outside = await tempRoot()
  const domainData = join(userDataDir, 'domain-data')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(domainData)
  await symlink(
    outside,
    join(domainData, 'git-checkpoints'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  const vcs: GitCheckpointVcsPort = {
    capture: async () => ({
      snapshotId: 'snapshot-1',
      provider: 'git',
      revision: 'revision-1',
      changeSummary: ''
    }),
    preview: async () => ({ patch: '', truncated: false }),
    restore: async () => undefined
  }
  const service = new GitCheckpointService({ userDataDir, vcs })
  const created = await service.create({
    runtimeId: 'codex',
    threadId: 'thread-1',
    workspaceRoot: '/workspace/repository'
  })
  assert.equal(created.ok, false)
  if (!created.ok) assert.match(created.message, /real directory/u)
})

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'sciforge-git-checkpoints-'))
  roots.push(path)
  return path
}
