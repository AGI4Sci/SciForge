import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let sandbox = ''
let repoRoot = ''

beforeEach(async () => {
  vi.resetModules()
  vi.doUnmock('node:child_process')
  vi.doUnmock('./git-discovery')

  sandbox = await mkdtemp(join(tmpdir(), 'sciforge-git-service-'))
  repoRoot = await realpath(sandbox)
  await initRepo(repoRoot)
})

afterEach(async () => {
  vi.doUnmock('node:child_process')
  vi.doUnmock('./git-discovery')
  vi.resetModules()

  if (!sandbox) return
  await rm(sandbox, { recursive: true, force: true })
  sandbox = ''
  repoRoot = ''
})

async function loadGitService(): Promise<typeof import('./git-service')> {
  return import('./git-service')
}

async function initRepo(root: string): Promise<void> {
  execFileSync('git', ['init', root], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'checkout', '-B', 'main'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test User'], { stdio: 'pipe' })
  await writeFile(join(root, 'README.md'), 'test\n', 'utf8')
  execFileSync('git', ['-C', root, 'add', 'README.md'], { stdio: 'pipe' })
  execFileSync('git', ['-C', root, 'commit', '-m', 'init'], { stdio: 'pipe' })
}

describe('getGitBranches', () => {
  it('returns branches when called from the repository root', async () => {
    const { getGitBranches } = await loadGitService()

    const result = await getGitBranches(repoRoot)

    if (!result.ok) throw new Error(result.message)
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('main')
    expect(result.branches.map((branch) => branch.name)).toContain('main')
  })

  it('uses the nearest Git root when called from a workspace subdirectory', async () => {
    const { getGitBranches } = await loadGitService()
    const subdir = join(repoRoot, 'src', 'renderer', 'components', 'chat', 'picker')
    await mkdir(subdir, { recursive: true })

    const result = await getGitBranches(subdir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('main')
    expect(result.branches.map((branch) => branch.name)).toContain('main')
  })

  it('uses the nearest root for nested Git repositories', async () => {
    const { getGitBranches } = await loadGitService()
    const nestedRoot = join(repoRoot, 'packages', 'nested')
    await mkdir(nestedRoot, { recursive: true })
    await initRepo(nestedRoot)
    const nestedSubdir = join(nestedRoot, 'src')
    await mkdir(nestedSubdir, { recursive: true })

    const result = await getGitBranches(nestedSubdir)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.repositoryRoot).toBe(await realpath(nestedRoot))
    expect(result.currentBranch).toBe('main')
  })

  it('returns a clear not_git_repo failure for non-Git workspaces', async () => {
    const { getGitBranches } = await loadGitService()
    const outside = await mkdtemp(join(tmpdir(), 'sciforge-git-outside-'))

    try {
      const result = await getGitBranches(outside)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected a non-Git failure')
      expect(result.reason).toBe('not_git_repo')
      expect(result.message).toContain('not a Git repository')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('returns no_workspace for an empty workspace root', async () => {
    const { getGitBranches } = await loadGitService()

    const result = await getGitBranches('   ')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected no_workspace')
    expect(result.reason).toBe('no_workspace')
  })
})

describe('switchGitBranch', () => {
  it('switches to an existing branch from a workspace subdirectory', async () => {
    const { switchGitBranch } = await loadGitService()
    execFileSync('git', ['-C', repoRoot, 'checkout', '-B', 'feature/existing'], { stdio: 'pipe' })
    execFileSync('git', ['-C', repoRoot, 'checkout', 'main'], { stdio: 'pipe' })
    const subdir = join(repoRoot, 'src', 'main')
    await mkdir(subdir, { recursive: true })

    const result = await switchGitBranch(subdir, 'feature/existing')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('feature/existing')

    const actual = execFileSync('git', ['-C', repoRoot, 'branch', '--show-current'], {
      encoding: 'utf8'
    }).trim()
    expect(actual).toBe('feature/existing')
  })
})

describe('createAndSwitchGitBranch', () => {
  it('creates and switches to a branch from a workspace subdirectory', async () => {
    const { createAndSwitchGitBranch } = await loadGitService()
    const subdir = join(repoRoot, 'src', 'main')
    await mkdir(subdir, { recursive: true })

    const result = await createAndSwitchGitBranch(subdir, 'feature/created')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.repositoryRoot).toBe(repoRoot)
    expect(result.currentBranch).toBe('feature/created')

    const branches = execFileSync('git', ['-C', repoRoot, 'branch', '--format=%(refname:short)'], {
      encoding: 'utf8'
    })
      .split('\n')
      .map((branch) => branch.trim())
      .filter(Boolean)
    expect(branches).toContain('feature/created')
  })
})

describe('Git command diagnostics', () => {
  it('returns not_git_repo without running Git when discovery finds no root', async () => {
    vi.resetModules()
    const execFileMock = vi.fn()
    const findNearestGitRoot = vi.fn(async () => null)
    vi.doMock('node:child_process', () => ({ execFile: execFileMock }))
    vi.doMock('./git-discovery', () => ({ findNearestGitRoot }))
    const { createAndSwitchGitBranch, getGitBranches, switchGitBranch } = await loadGitService()

    const branches = await getGitBranches('/not-a-repo')
    const switched = await switchGitBranch('/not-a-repo', 'main')
    const created = await createAndSwitchGitBranch('/not-a-repo', 'feature/new')

    for (const result of [branches, switched, created]) {
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected not_git_repo')
      expect(result.reason).toBe('not_git_repo')
    }
    expect(findNearestGitRoot).toHaveBeenCalledTimes(3)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('runs Git commands with a stable C locale', async () => {
    vi.resetModules()
    const previousLcAll = process.env.LC_ALL
    const previousLang = process.env.LANG
    process.env.LC_ALL = 'zh_CN.UTF-8'
    process.env.LANG = 'zh_CN.UTF-8'
    const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = []
    const execFileMock = vi.fn()
    Object.defineProperty(execFileMock, Symbol.for('nodejs.util.promisify.custom'), {
      value: async (_file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ args, env: options.env })
        if (args[0] === 'rev-parse') return { stdout: '/repo\n', stderr: '' }
        if (args[0] === 'branch' && args.includes('--show-current')) {
          return { stdout: 'main\n', stderr: '' }
        }
        if (args[0] === 'branch') return { stdout: 'main\n', stderr: '' }
        return { stdout: '', stderr: '' }
      }
    })
    vi.doMock('node:child_process', () => ({ execFile: execFileMock }))
    vi.doMock('./git-discovery', () => ({ findNearestGitRoot: vi.fn(async () => '/repo') }))
    const { getGitBranches } = await loadGitService()

    try {
      const result = await getGitBranches('/repo/subdir')

      expect(result.ok).toBe(true)
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every((call) => call.env?.LC_ALL === 'C')).toBe(true)
      expect(calls.every((call) => call.env?.LANG === 'C')).toBe(true)
    } finally {
      if (previousLcAll === undefined) {
        delete process.env.LC_ALL
      } else {
        process.env.LC_ALL = previousLcAll
      }
      if (previousLang === undefined) {
        delete process.env.LANG
      } else {
        process.env.LANG = previousLang
      }
    }
  })
})
