import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { GitBranchesResult } from '../../shared/git-branches'
import { findNearestGitRoot } from './git-discovery'

const execFileAsync = promisify(execFile)

function noWorkspaceResult(): GitBranchesResult {
  return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
}

function notGitRepoResult(): GitBranchesResult {
  return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
}

export async function resolveGitCwd(workspaceRoot: string): Promise<string | null> {
  return findNearestGitRoot(workspaceRoot)
}

export async function runGit(
  cwd: string,
  args: string[],
  timeout = 10_000
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function gitErrorText(error: unknown): string {
  const details: string[] = []
  if (error instanceof Error) details.push(error.message)

  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === 'string') details.push(stderr)
  if (Buffer.isBuffer(stderr)) details.push(stderr.toString('utf8'))

  if (details.length > 0) return details.join('\n')
  return String(error)
}

function gitFailure(error: unknown): GitBranchesResult {
  const message = gitErrorText(error)
  if (/not a git repository/i.test(message)) {
    return { ok: false, reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return { ok: false, reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { ok: false, reason: 'error', message }
}

export async function getGitBranches(workspaceRoot: string): Promise<GitBranchesResult> {
  const workspace = workspaceRoot.trim()
  if (!workspace) return noWorkspaceResult()

  const cwd = await resolveGitCwd(workspace)
  if (!cwd) return notGitRepoResult()

  try {
    const repositoryRoot = resolve((await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim())
    const currentRaw = (await runGit(cwd, ['branch', '--show-current'])).stdout.trim()
    const currentBranch = currentRaw || null
    const branchLines = (await runGit(cwd, ['branch', '--format=%(refname:short)'])).stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const branchSet = new Set(branchLines)
    if (currentBranch && !branchSet.has(currentBranch)) branchSet.add(currentBranch)
    const branches = [...branchSet].map((name) => ({
      name,
      current: currentBranch === name
    }))
    const dirtyCount = (await runGit(cwd, ['status', '--porcelain=v1'])).stdout
      .split('\n')
      .filter((line) => line.trim().length > 0).length
    return { ok: true, repositoryRoot, currentBranch, branches, dirtyCount }
  } catch (error) {
    return gitFailure(error)
  }
}

export async function switchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const workspace = workspaceRoot.trim()
  const branch = branchName.trim()
  if (!workspace) return noWorkspaceResult()
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }

  const cwd = await resolveGitCwd(workspace)
  if (!cwd) return notGitRepoResult()

  try {
    try {
      await runGit(cwd, ['switch', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}

export async function createAndSwitchGitBranch(
  workspaceRoot: string,
  branchName: string
): Promise<GitBranchesResult> {
  const workspace = workspaceRoot.trim()
  const branch = branchName.trim()
  if (!workspace) return noWorkspaceResult()
  if (!branch) return { ok: false, reason: 'error', message: 'Branch name is required.' }

  const cwd = await resolveGitCwd(workspace)
  if (!cwd) return notGitRepoResult()

  try {
    await runGit(cwd, ['check-ref-format', '--branch', branch])
    try {
      await runGit(cwd, ['switch', '-c', branch], 20_000)
    } catch {
      await runGit(cwd, ['checkout', '-b', branch], 20_000)
    }
    return getGitBranches(cwd)
  } catch (error) {
    return gitFailure(error)
  }
}
