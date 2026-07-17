#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = await realpath(join(dirname(fileURLToPath(import.meta.url)), '..'))
const workspaceId = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)
const lockDir = join(tmpdir(), 'sciforge-dev-instances')
const lockPath = join(lockDir, `${workspaceId}.json`)
const instanceId = randomUUID()
let lockOwned = false
let child = null

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
      stdio: 'inherit'
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

function forwardSignal(signal) {
  if (child && !child.killed) child.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => forwardSignal(signal))
}

try {
  await acquireLock()
  const env = {
    ...process.env,
    SCIFORGE_DEV_INSTANCE_ID: instanceId,
    SCIFORGE_DEV_WORKSPACE_ID: workspaceId
  }
  const npmCli = process.env.npm_execpath
  if (npmCli) await run(process.execPath, [npmCli, 'run', 'build:local-runtime'], env)
  else await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:local-runtime'], env)
  await run(process.execPath, [join(projectRoot, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev'], env)
} catch (error) {
  console.error(`[sciforge dev] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await releaseLock()
}
