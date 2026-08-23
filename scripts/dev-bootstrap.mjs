#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const scriptPath = await realpath(fileURLToPath(import.meta.url))
const projectRoot = await realpath(join(dirname(scriptPath), '..'))
const workspaceId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)
const lockDir = join(tmpdir(), 'sciforge-dev-instances')
const lockPath = join(lockDir, `${workspaceId}.json`)
const instanceId = randomUUID()
let lockOwned = false
let child = null
const require = createRequire(import.meta.url)

const requiredDevDependencies = [
  'node_modules/typescript/package.json',
  'node_modules/electron-vite/package.json'
]

export const DEV_FORWARD_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP'])

export function devChildSpawnOptions(platform = process.platform) {
  return {
    // On POSIX, detached children lead a new process group. Keeping inherited
    // stdio preserves the interactive dev experience while allowing shutdown
    // signals to reach electron-vite and every Electron descendant together.
    detached: platform !== 'win32'
  }
}

export function forwardSignalToDevChild(
  target,
  signal,
  { platform = process.platform, killProcess = process.kill } = {}
) {
  const pid = target?.pid
  if (!target || target.killed || !Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    if (platform === 'win32') target.kill(signal)
    else killProcess(-pid, signal)
    return true
  } catch (error) {
    // The process group may have completed between the signal and this call.
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function assertDevDependenciesInstalled() {
  const missing = []
  for (const relativePath of requiredDevDependencies) {
    try {
      await access(join(projectRoot, relativePath))
    } catch {
      missing.push(relativePath)
    }
  }
  if (missing.length === 0) return
  throw new Error(
    'SciForge development dependencies are not installed. Run `npm install` in the project root, then run `npm run dev` again.'
  )
}

function ensureElectronBinaryInstalled() {
  // Electron 42+ downloads its binary on first require. electron-vite 3 reads
  // path.txt directly, so trigger Electron's verified installer first.
  require('electron')
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readLockOwner() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return JSON.parse(await readFile(lockPath, 'utf8'))
    } catch {
      if (attempt === 4) return null
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  return null
}

async function acquireLock() {
  await mkdir(lockDir, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        instanceId,
        workspaceId,
        projectRoot,
        rendererUrl: 'http://127.0.0.1:5173/',
        startedAt: new Date().toISOString()
      }, null, 2))
      await handle.close()
      lockOwned = true
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      // The winning process may still be writing the small owner record after
      // its exclusive create. Retry briefly before classifying it as stale.
      const owner = await readLockOwner()
      if (owner && isProcessAlive(owner.pid)) {
        throw new Error(
          `SciForge dev is already running for this workspace (PID ${owner.pid}, instance ${owner.instanceId ?? 'unknown'}, endpoint ${owner.rendererUrl ?? 'unknown'}). Stop that process before starting another.`
        )
      }
      await unlink(lockPath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError
      })
    }
  }
  throw new Error(`Could not acquire the SciForge dev lock at ${lockPath}.`)
}

async function releaseLock() {
  if (!lockOwned) return
  lockOwned = false
  try {
    const owner = JSON.parse(await readFile(lockPath, 'utf8'))
    if (owner.instanceId !== instanceId) return
  } catch {
    return
  }
  await unlink(lockPath).catch(() => undefined)
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      ...devChildSpawnOptions()
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      child = null
      if (signal) reject(new Error(`${command} exited after signal ${signal}.`))
      else if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

let interruptedBy = null

function forwardSignal(signal) {
  interruptedBy ??= signal
  try {
    forwardSignalToDevChild(child, signal)
  } catch (error) {
    console.error(
      `[sciforge dev] Could not forward ${signal} to the development process tree: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  }
}

function installSignalHandlers() {
  const handlers = new Map()
  for (const signal of DEV_FORWARD_SIGNALS) {
    const handler = () => forwardSignal(signal)
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
  }
}

function throwIfInterrupted() {
  if (interruptedBy) throw new Error(`Interrupted by ${interruptedBy}.`)
}

async function main() {
  const removeSignalHandlers = installSignalHandlers()
  try {
    await assertDevDependenciesInstalled()
    await acquireLock()
    ensureElectronBinaryInstalled()
    const env = {
      ...process.env,
      SCIFORGE_DEV_INSTANCE_ID: instanceId,
      SCIFORGE_DEV_WORKSPACE_ID: workspaceId
    }
    throwIfInterrupted()
    const npmCli = process.env.npm_execpath
    if (npmCli) await run(process.execPath, [npmCli, 'run', 'build:agent-support'], env)
    else await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:agent-support'], env)
    throwIfInterrupted()
    await run(process.execPath, [join(projectRoot, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev'], env)
  } catch (error) {
    console.error(`[sciforge dev] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    removeSignalHandlers()
    await releaseLock()
  }
}

async function isDirectExecution() {
  const entryPath = process.argv[1]
  if (!entryPath) return false
  const resolvedEntry = resolve(entryPath)
  const canonicalEntry = await realpath(resolvedEntry).catch(() => resolvedEntry)
  return canonicalEntry === scriptPath
}

if (await isDirectExecution()) await main()
