#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseCapabilityEvalArgs } from './capability-eval-cli-utils.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseCapabilityEvalArgs(process.argv.slice(2), { booleanFlags: ['--allow-failures', '--allow-dirty'] })
if (args.help) {
  printHelp()
} else {
  await assertCleanWorktree(args.allowDirty)
  const cliArgs = [
    '--import', 'tsx', path.join(root, 'scripts/capability-eval.mjs'),
    '--live',
    '--isolate-global-state',
    '--cases', args.cases ?? 'eval-cases/capability/workflow-golden.jsonl',
    '--output', args.output ?? 'eval-results/live-smoke',
    '--trace-output-dir', args.traceOutputDir ?? `${args.output ?? 'eval-results/live-smoke'}/traces`
  ]
  for (const key of ['model', 'mode', 'reasoningEffort', 'modelAccessBootstrap', 'approvalDecision', 'faultPolicy', 'finalStateDir', 'runtimeId', 'timeoutMs', 'pollIntervalMs']) {
    if (args[key] !== undefined) cliArgs.push(`--${key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`, args[key])
  }
  if (args.allowFailures) cliArgs.push('--allow-failures')
  const result = await execFileAsync(process.execPath, cliArgs, { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
}

function printHelp() {
  console.log('Run the canonical isolated live Agent smoke batch and persist raw traces.')
  console.log('The command requires a clean worktree unless --allow-dirty is supplied for diagnostics.')
  console.log('Usage: npm run capability:eval:live-smoke -- [--cases <path>] [--output <dir>] [--model-access-bootstrap coding-plan:codex] [--allow-dirty]')
}

async function assertCleanWorktree(allowDirty) {
  if (allowDirty) return
  const status = (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: root })).stdout
  if (status.trim()) {
    throw new Error('Formal live capability evaluation requires a clean worktree. Commit changes first or pass --allow-dirty only for a diagnostic run.')
  }
}
