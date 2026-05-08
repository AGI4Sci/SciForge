import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const command = (process.argv[2] || 'status').trim();
const repoRoot = detectRepoRoot();
const parent = dirname(repoRoot);
const baseRef = process.env.SCIFORGE_WORKTREE_BASE_REF || 'HEAD';
const worktrees = [
  {
    label: 'A',
    name: 'SciForge-A',
    path: resolve(process.env.SCIFORGE_WORKTREE_A || join(parent, 'SciForge-A')),
    branch: process.env.SCIFORGE_WORKTREE_A_BRANCH || 'codex/t092-worktree-a',
  },
  {
    label: 'B',
    name: 'SciForge-B',
    path: resolve(process.env.SCIFORGE_WORKTREE_B || join(parent, 'SciForge-B')),
    branch: process.env.SCIFORGE_WORKTREE_B_BRANCH || 'codex/t092-worktree-b',
  },
];

if (!['status', 'create', 'clean'].includes(command)) {
  console.error(`Usage: npm run worktree:dual -- [status|create|clean]`);
  process.exit(2);
}

if (command === 'status') {
  printStatus();
} else if (command === 'create') {
  createWorktrees();
  printStatus();
} else {
  cleanWorktrees();
  printStatus();
}

function printStatus() {
  const listed = listWorktrees();
  for (const tree of worktrees) {
    const match = listed.find((item) => item.path === tree.path);
    const exists = existsSync(tree.path);
    const detected = match ? `detected branch ${match.branch || '(detached)'}` : exists ? 'path exists but is not a registered worktree' : 'missing';
    console.log(`${tree.name}: ${tree.path} - ${detected}`);
  }
}

function createWorktrees() {
  for (const tree of worktrees) {
    const listed = listWorktrees();
    const existing = listed.find((item) => item.path === tree.path);
    if (existing) {
      console.log(`${tree.name} already registered at ${tree.path}`);
      continue;
    }
    if (existsSync(tree.path)) {
      throw new Error(`${tree.name} path already exists but is not a git worktree: ${tree.path}`);
    }
    if (git(['show-ref', '--verify', '--quiet', `refs/heads/${tree.branch}`], { allowFailure: true }) === '__ok__') {
      throw new Error(`Branch already exists for ${tree.name}: ${tree.branch}`);
    }
    runGit(['worktree', 'add', '-b', tree.branch, tree.path, baseRef]);
  }
}

function cleanWorktrees() {
  for (const tree of worktrees) {
    const listed = listWorktrees();
    const existing = listed.find((item) => item.path === tree.path);
    if (!existing) continue;
    if (existing.branch && existing.branch !== tree.branch) {
      throw new Error(`${tree.name} uses branch ${existing.branch}, expected ${tree.branch}; refusing to clean.`);
    }
    const status = git(['status', '--porcelain'], { cwd: tree.path });
    if (status.trim()) {
      throw new Error(`${tree.name} has uncommitted changes; clean it manually or move your work first: ${tree.path}`);
    }
    runGit(['worktree', 'remove', tree.path]);
    if (existing.branch) runGit(['branch', '-D', existing.branch]);
  }
}

function listWorktrees() {
  const output = git(['worktree', 'list', '--porcelain']);
  const entries: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | undefined;
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: resolve(line.slice('worktree '.length)) };
      entries.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return entries;
}

function runGit(args: string[]) {
  const result = spawnSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

function detectRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) return process.cwd();
  return result.stdout.trim() || process.cwd();
}

function git(args: string[], options: { cwd?: string; allowFailure?: boolean } = {}): string {
  const result = spawnSync('git', args, { cwd: options.cwd || repoRoot, encoding: 'utf8' });
  if (options.allowFailure) return result.status === 0 ? '__ok__' : '';
  if (result.status !== 0) {
    const cwd = options.cwd ? ` in ${basename(options.cwd)}` : '';
    throw new Error(`git ${args.join(' ')}${cwd} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}
