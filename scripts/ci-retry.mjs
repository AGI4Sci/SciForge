#!/usr/bin/env node
/**
 * Retries a CI command a few times with a short backoff.
 *
 * Implemented as a plain Node script rather than a shell loop so the same
 * retry logic works unchanged whether the calling workflow step runs under
 * bash (Linux/macOS runners) or PowerShell (Windows runners' default shell),
 * instead of maintaining two shell-specific retry loops that can drift.
 *
 * See COLLAB-20260908-003: `smoke:domain-packages:tarball` occasionally hits
 * transient npm registry flakiness (e.g. a `notarget` resolution error for a
 * version that does exist), and passes on a bare re-run.
 *
 * Usage: node scripts/ci-retry.mjs [--attempts=N] [--delay-seconds=N] -- <command...>
 *
 * The command is re-joined with spaces and handed to the shell as one
 * string (needed so `npm`/`npm.cmd` resolve the same way under both bash
 * and PowerShell) — it is not shell-escaped, so this is only meant for
 * simple space-separated commands (e.g. `npm run <script>`), not commands
 * containing quotes or other shell metacharacters.
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--')
  if (separatorIndex === -1 || separatorIndex === argv.length - 1) {
    throw new Error(
      'Usage: node scripts/ci-retry.mjs [--attempts=N] [--delay-seconds=N] -- <command...>'
    )
  }
  const flags = argv.slice(0, separatorIndex)
  const command = argv.slice(separatorIndex + 1)
  const attempts = Number(flags.find((f) => f.startsWith('--attempts='))?.split('=')[1] ?? 3)
  const delaySeconds = Number(
    flags.find((f) => f.startsWith('--delay-seconds='))?.split('=')[1] ?? 5
  )
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`--attempts must be a positive integer, got: ${attempts}`)
  }
  if (!Number.isInteger(delaySeconds) || delaySeconds < 0) {
    throw new Error(`--delay-seconds must be a non-negative integer, got: ${delaySeconds}`)
  }
  return { command, attempts, delaySeconds }
}

const { command, attempts, delaySeconds } = parseArgs(process.argv.slice(2))
const label = command.join(' ')

let lastStatus = 1
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = spawnSync(label, { stdio: 'inherit', shell: true })
  lastStatus = result.status ?? 1
  if (lastStatus === 0) process.exit(0)
  if (attempt < attempts) {
    console.error(
      `ci-retry: "${label}" failed (attempt ${attempt}/${attempts}); retrying in ${delaySeconds}s...`
    )
    await sleep(delaySeconds * 1000)
  }
}
console.error(`ci-retry: "${label}" failed after ${attempts} attempts`)
process.exit(lastStatus)
