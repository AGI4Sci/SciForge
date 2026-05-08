import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const children: ChildProcess[] = [];
let shuttingDown = false;
const repoRoot = process.cwd();
const parent = dirname(repoRoot);
const worktreeA = resolve(process.env.SCIFORGE_WORKTREE_A || join(parent, 'SciForge-A'));
const worktreeB = resolve(process.env.SCIFORGE_WORKTREE_B || join(parent, 'SciForge-B'));

if (!existsSync(join(worktreeA, 'package.json')) || !existsSync(join(worktreeB, 'package.json'))) {
  console.error([
    'SciForge dual-instance dev is worktree-first.',
    `Missing worktree package.json at ${worktreeA} or ${worktreeB}.`,
    'Run: npm run worktree:dual -- create',
  ].join('\n'));
  process.exit(2);
}

children.push(start('SciForge-A', ['run', 'dev', '--', '--instance', 'A'], worktreeA));
children.push(start('SciForge-B', ['run', 'dev', '--', '--instance', 'B'], worktreeB));

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function start(label: string, args: string[], cwd: string) {
  const child = spawn('npm', args, {
    cwd,
    env: { ...process.env },
    stdio: 'inherit',
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`${label} instance exited with ${signal || `code ${code}`}`);
    shutdown();
  });
  return child;
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}
