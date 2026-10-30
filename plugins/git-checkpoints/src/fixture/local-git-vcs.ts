import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  GitCheckpointCaptureInput,
  GitCheckpointCaptureResult,
  GitCheckpointPreviewInput,
  GitCheckpointPreviewResult,
  GitCheckpointRestorePortInput,
  GitCheckpointVcsPort
} from '../ports/vcs.js'

const execFileAsync = promisify(execFile)
const PATCH_LIMIT = 1_000_000

/**
 * Local Git CLI implementation of the version-control port.
 *
 * This is a fixture, not the production wiring: it exists so the plugin can
 * run and be tested without the host. In SciForge the port is satisfied by the
 * governed `version-control.*` capabilities (see the static adapter in
 * packages/domains/git-checkpoints/src/main.ts); the host capability bridge
 * for plugins is tracked in plugins/GAPS.md (G1).
 *
 * Behavioural approximations versus the host provider, by design:
 * - snapshots are commit-tree objects under refs/sciforge/git-checkpoints/,
 *   captured from a temporary index so the working tree is never disturbed;
 * - preview diffs the working tree against the snapshot commit;
 * - restore applies the snapshot over the worktree and index without
 *   removing untracked files.
 */
export function createLocalGitVcs(): GitCheckpointVcsPort {
  return Object.freeze({
    capture: async (input: GitCheckpointCaptureInput): Promise<GitCheckpointCaptureResult> => {
      await git(input.workspaceRoot, ['rev-parse', '--is-inside-work-tree'])
      const revision = await git(input.workspaceRoot, ['rev-parse', 'HEAD'])
      const statusPorcelain = await git(input.workspaceRoot, ['status', '--porcelain'])
      const changeSummary = summarizePorcelain(statusPorcelain)
      const snapshotId = await commitTreeSnapshot(input.workspaceRoot, input.snapshotName)
      return {
        snapshotId,
        provider: 'git',
        revision,
        changeSummary
      }
    },
    preview: async (input: GitCheckpointPreviewInput): Promise<GitCheckpointPreviewResult> => {
      const patch = await git(input.workspaceRoot, ['diff', input.snapshotId])
      if (patch.length <= PATCH_LIMIT) return { patch, truncated: false }
      return { patch: patch.slice(0, PATCH_LIMIT), truncated: true }
    },
    restore: async (input: GitCheckpointRestorePortInput): Promise<void> => {
      await git(input.workspaceRoot, [
        'restore',
        '--source',
        input.snapshotId,
        '--staged',
        '--worktree',
        ':/'
      ])
    }
  })
}

async function commitTreeSnapshot(workspaceRoot: string, snapshotName: string): Promise<string> {
  const tempIndexDir = await mkdtemp(join(tmpdir(), 'sciforge-git-index-'))
  const tempIndex = join(tempIndexDir, 'index')
  const env = {
    GIT_INDEX_FILE: tempIndex,
    GIT_AUTHOR_NAME: 'SciForge',
    GIT_AUTHOR_EMAIL: 'sciforge@localhost',
    GIT_COMMITTER_NAME: 'SciForge',
    GIT_COMMITTER_EMAIL: 'sciforge@localhost'
  }
  try {
    await git(workspaceRoot, ['read-tree', 'HEAD'], env)
    await git(workspaceRoot, ['add', '-A'], env)
    const tree = await git(workspaceRoot, ['write-tree'], env)
    const head = await git(workspaceRoot, ['rev-parse', 'HEAD'])
    const commit = await git(workspaceRoot, [
      'commit-tree',
      tree,
      '-p',
      head,
      '-m',
      snapshotName
    ], env)
    await git(workspaceRoot, [
      'update-ref',
      `refs/sciforge/git-checkpoints/${snapshotName}`,
      commit
    ])
    return commit
  } finally {
    await rm(tempIndexDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function summarizePorcelain(porcelain: string): string {
  const lines = porcelain.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return 'Clean workspace'
  const counts = new Map<string, number>()
  for (const line of lines) {
    const code = line.slice(0, 2)
    const name = code.includes('A') ? 'added'
      : code.includes('D') ? 'deleted'
      : code.includes('R') ? 'renamed'
      : code.includes('?') ? 'untracked'
      : 'modified'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const detail = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ')
  const total = lines.length
  return `${total} change${total === 1 ? '' : 's'}${detail ? ` (${detail})` : ''}`
}

async function git(
  cwd: string,
  args: readonly string[],
  environment: Record<string, string> = {}
): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    env: { ...process.env, ...environment },
    maxBuffer: 16 * 1024 * 1024
  })
  return String(result.stdout).trim()
}
