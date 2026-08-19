#!/usr/bin/env node

import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, connect } from 'node:net'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(nodeExecFile)
const MANIFEST_VERSION = 1
const DEFAULT_READY_TIMEOUT_MS = 45_000
const DEFAULT_TASK_TIMEOUT_MS = 10 * 60_000
const DEFAULT_STOP_GRACE_MS = 8_000
const POLL_INTERVAL_MS = 100

export class ProductStackSupervisorError extends Error {
  constructor(code, message, detail = {}) {
    super(message)
    this.name = 'ProductStackSupervisorError'
    this.code = code
    this.detail = detail
  }
}

export function normalizeProductStackConfig(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', 'Product stack config must be an object.')
  }
  const cwd = resolve(options.cwd ?? process.cwd())
  const stateRoot = resolve(cwd, requiredString(input.stateRoot, 'stateRoot'))
  const roots = requiredArray(input.roots, 'roots').map((root, index) => normalizeCommand(root, `roots[${index}]`, cwd, {
    longRunning: true
  }))
  const roles = new Set()
  for (const root of roots) {
    if (roles.has(root.role)) throw new ProductStackSupervisorError('INVALID_CONFIG', `Duplicate root role: ${root.role}.`)
    roles.add(root.role)
  }
  const task = input.task ? normalizeCommand(input.task, 'task', cwd, { longRunning: false }) : null
  if (roots.length === 0 && !task) {
    throw new ProductStackSupervisorError(
      'INVALID_CONFIG',
      'Product stack config requires at least one root process or one bounded task.'
    )
  }
  const ports = [...new Set(requiredArray(input.ports ?? [], 'ports').map(normalizePort))].sort((a, b) => a - b)
  for (const root of roots) {
    if (root.readyPort !== null && !ports.includes(root.readyPort)) ports.push(root.readyPort)
  }
  ports.sort((a, b) => a - b)
  const profileDirectories = requiredArray(input.profileDirectories ?? [], 'profileDirectories').map((entry, index) => {
    const value = requiredString(entry, `profileDirectories[${index}]`)
    if (isAbsolute(value) || value.split(/[\\/]/u).includes('..')) {
      throw new ProductStackSupervisorError(
        'INVALID_CONFIG',
        `profileDirectories[${index}] must be a run-directory-relative path.`
      )
    }
    return value
  })
  return {
    stateRoot,
    roots,
    task,
    ports,
    profileDirectories,
    stopGraceMs: boundedInteger(input.stopGraceMs, DEFAULT_STOP_GRACE_MS, 100, 120_000, 'stopGraceMs')
  }
}

function normalizeCommand(input, label, cwd, { longRunning }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', `${label} must be an object.`)
  }
  const role = requiredString(input.role, `${label}.role`)
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(role)) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', `${label}.role is invalid.`)
  }
  const command = requiredString(input.command, `${label}.command`)
  const args = requiredArray(input.args ?? [], `${label}.args`).map((arg, index) =>
    requiredString(arg, `${label}.args[${index}]`, { allowEmpty: true }))
  const commandCwd = resolve(cwd, optionalString(input.cwd) ?? '.')
  const readyPort = input.readyPort === undefined ? null : normalizePort(input.readyPort)
  return {
    role,
    command,
    args,
    cwd: commandCwd,
    readyPort,
    timeoutMs: boundedInteger(
      input.timeoutMs,
      longRunning ? DEFAULT_READY_TIMEOUT_MS : DEFAULT_TASK_TIMEOUT_MS,
      100,
      24 * 60 * 60_000,
      `${label}.timeoutMs`
    ),
    commandHash: commandFingerprint(command, args, commandCwd)
  }
}

export function commandFingerprint(command, args, cwd) {
  return createHash('sha256')
    .update(JSON.stringify({ command: resolveCommandLabel(command), args, cwd: resolve(cwd) }))
    .digest('hex')
}

export class ProductStackSupervisor {
  constructor(config, options = {}) {
    this.config = normalizeProductStackConfig(config, { cwd: options.cwd })
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? randomUUID
    this.spawn = options.spawn ?? nodeSpawn
    this.inspectProcess = options.inspectProcess ?? ((pid) => inspectProcessIdentity(pid, this.platform))
    this.listDescendants = options.listDescendants ?? ((pid) => listDescendantProcessIdentities(pid, this.platform))
    this.listProcessGroup = options.listProcessGroup ?? ((processGroupId) =>
      listProcessGroupIdentities(processGroupId, this.platform))
    this.forceStop = options.forceStop ?? ((identity) => forceStopProcessTree(identity, this.platform))
    this.isPortFree = options.isPortFree ?? isLoopbackPortFree
    this.waitForPort = options.waitForPort ?? waitForLoopbackPort
    this.createDeadline = options.createDeadline ?? createDeadline
    this.roots = []
    this.taskProcess = null
    this.interruptedBy = null
    this.teardownPromise = null
    this.signalHandlers = new Map()
    this.manifest = null
    this.interruptOutcome = null
    this.interruptPromise = new Promise((resolveInterrupt) => {
      this.resolveInterrupt = resolveInterrupt
    })
  }

  async run() {
    await this.preflight()
    await this.initializeManifest()
    this.installSignalHandlers()
    let result
    let failure
    try {
      await this.updateManifest({ phase: 'launching' })
      for (const spec of this.config.roots) {
        await this.launchRoot(spec)
        if (this.interruptedBy) {
          throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${this.interruptedBy}.`)
        }
      }
      await this.updateManifest({ phase: 'running' })
      if (this.interruptedBy) {
        throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${this.interruptedBy}.`)
      }
      result = this.config.task ? await this.runTask(this.config.task) : { code: 0, signal: null }
      if (result.code !== 0 || result.signal) {
        throw new ProductStackSupervisorError(
          'TASK_FAILED',
          `E2E task exited with code ${result.code ?? 'null'} and signal ${result.signal ?? 'none'}.`,
          result
        )
      }
      if (this.interruptedBy) {
        throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${this.interruptedBy}.`)
      }
      await this.updateManifest({ phase: 'task-complete', taskResult: result })
    } catch (error) {
      failure = normalizeError(error)
      await this.updateManifest({ phase: 'failed', failure }).catch(() => undefined)
    } finally {
      await this.teardown(failure ? 'failure' : 'success').catch((error) => {
        const teardownFailure = normalizeError(error)
        failure ??= teardownFailure
      })
      this.removeSignalHandlers()
    }
    if (failure) {
      throw new ProductStackSupervisorError(failure.code, failure.message, failure.detail)
    }
    return { runId: this.manifest.runId, runDirectory: this.manifest.runDirectory, manifest: this.manifest }
  }

  async preflight() {
    await mkdir(this.config.stateRoot, { recursive: true })
    const entries = await readdir(this.config.stateRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(this.config.stateRoot, entry.name, 'manifest.json')
      const manifest = await readPreviousManifest(path)
      if (!manifest || manifest.teardown?.completedAt) continue
      for (const owner of [manifest.task, ...(manifest.roots ?? [])].filter(Boolean)) {
        for (const owned of [owner, ...(owner.descendants ?? [])]) {
          const current = await this.inspectProcess(owned.pid)
          if (current && sameProcessIdentity(current, owned.identity)) {
            throw new ProductStackSupervisorError(
              'LIVE_PREVIOUS_RUN',
              `Previous E2E run ${manifest.runId ?? entry.name} still owns ${owner.role} PID ${owned.pid}.`,
              { manifestPath: path, pid: owned.pid, role: owner.role }
            )
          }
        }
        if (owner.processGroupId) {
          const groupMembers = await this.listProcessGroup(owner.processGroupId)
          if (groupMembers.length > 0) {
            throw new ProductStackSupervisorError(
              'LIVE_PREVIOUS_RUN',
              `Previous E2E run ${manifest.runId ?? entry.name} still owns process group ${owner.processGroupId}.`,
              { manifestPath: path, processGroupId: owner.processGroupId, role: owner.role }
            )
          }
        }
      }
    }
    const occupied = []
    for (const port of this.config.ports) {
      if (!(await this.isPortFree(port))) occupied.push(port)
    }
    if (occupied.length > 0) {
      throw new ProductStackSupervisorError(
        'PORT_CONFLICT',
        `E2E preflight found occupied loopback ports: ${occupied.join(', ')}.`,
        { ports: occupied }
      )
    }
  }

  async initializeManifest() {
    const createdAt = this.now().toISOString()
    const runId = `${createdAt.replace(/[-:.TZ]/gu, '').slice(0, 14)}-${this.randomId()}`
    const runDirectory = join(this.config.stateRoot, runId)
    await mkdir(runDirectory, { recursive: false })
    for (const profile of this.config.profileDirectories) {
      await mkdir(runOwnedPath(runDirectory, profile), { recursive: true })
    }
    this.manifestPath = join(runDirectory, 'manifest.json')
    this.manifest = {
      version: MANIFEST_VERSION,
      runId,
      runDirectory,
      createdAt,
      phase: 'created',
      platform: this.platform,
      ports: this.config.ports,
      profileDirectories: this.config.profileDirectories,
      roots: [],
      task: this.config.task ? safeCommandSummary(this.config.task) : null,
      teardown: { startedAt: null, completedAt: null, reason: null, verification: null }
    }
    await this.writeManifest()
  }

  async launchRoot(spec) {
    const child = this.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        SCIFORGE_E2E_RUN_ID: this.manifest.runId,
        SCIFORGE_E2E_ROLE: spec.role,
        SCIFORGE_E2E_RUN_DIRECTORY: this.manifest.runDirectory
      },
      detached: this.platform !== 'win32',
      stdio: 'inherit',
      windowsHide: true
    })
    const earlyExit = childExit(child)
    await childSpawned(child)
    const identity = await this.inspectProcess(child.pid)
    if (!identity) {
      child.kill('SIGTERM')
      throw new ProductStackSupervisorError('IDENTITY_UNAVAILABLE', `Could not verify ${spec.role} PID ${child.pid}.`)
    }
    const processGroupId = this.platform === 'win32' ? null : child.pid
    const root = { spec, child, pid: child.pid, identity, exit: earlyExit, processGroupId }
    this.roots.push(root)
    this.manifest.roots.push({
      role: spec.role,
      pid: child.pid,
      identity,
      processGroupId,
      command: safeCommandSummary(spec),
      startedAt: this.now().toISOString(),
      stoppedAt: null,
      exit: null,
      descendants: []
    })
    await this.writeManifest()
    if (spec.readyPort !== null) {
      const ready = await Promise.race([
        this.waitForPort(spec.readyPort, spec.timeoutMs).then(() => ({ kind: 'ready' })),
        earlyExit.then((exit) => ({ kind: 'exit', exit })),
        this.interruptPromise
      ])
      if (ready.kind === 'interrupt') {
        throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${ready.signal}.`)
      }
      if (ready.kind === 'exit') {
        throw new ProductStackSupervisorError(
          'ROOT_EXITED',
          `${spec.role} exited before port ${spec.readyPort} became ready.`,
          ready.exit
        )
      }
    }
  }

  async runTask(spec) {
    const child = this.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        SCIFORGE_E2E_RUN_ID: this.manifest.runId,
        SCIFORGE_E2E_ROLE: spec.role,
        SCIFORGE_E2E_RUN_DIRECTORY: this.manifest.runDirectory
      },
      detached: this.platform !== 'win32',
      stdio: 'inherit',
      windowsHide: true
    })
    const taskExit = childExit(child)
    await childSpawned(child)
    const identity = await this.inspectProcess(child.pid)
    if (!identity) {
      child.kill('SIGTERM')
      throw new ProductStackSupervisorError('IDENTITY_UNAVAILABLE', `Could not verify ${spec.role} PID ${child.pid}.`)
    }
    const processGroupId = this.platform === 'win32' ? null : child.pid
    this.taskProcess = { spec, child, pid: child.pid, identity, exit: taskExit, processGroupId }
    this.manifest.task = {
      ...safeCommandSummary(spec),
      pid: child.pid,
      identity,
      processGroupId,
      startedAt: this.now().toISOString(),
      exit: null,
      descendants: []
    }
    await this.writeManifest()
    const timeout = this.createDeadline(spec.timeoutMs)
    const rootExit = Promise.race(this.roots.map((root) =>
      root.exit.then((exit) => ({ rootExited: true, role: root.spec.role, exit }))))
    let outcome
    try {
      outcome = await Promise.race([
        taskExit,
        timeout.promise.then(() => ({ timedOut: true })),
        rootExit,
        this.interruptPromise
      ])
    } finally {
      timeout.cancel()
    }
    if (outcome?.kind === 'interrupt') {
      throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${outcome.signal}.`)
    }
    if (outcome?.rootExited) {
      if (this.interruptedBy) {
        throw new ProductStackSupervisorError('INTERRUPTED', `E2E run was interrupted by ${this.interruptedBy}.`)
      }
      throw new ProductStackSupervisorError(
        'ROOT_EXITED',
        `${outcome.role} exited while the E2E task was running.`,
        outcome.exit
      )
    }
    if (outcome?.timedOut) {
      throw new ProductStackSupervisorError('TASK_TIMEOUT', `${spec.role} timed out after ${spec.timeoutMs} ms.`)
    }
    this.manifest.task.exit = outcome
    await this.writeManifest()
    return outcome
  }

  interrupt(signal) {
    this.interruptedBy ??= signal
    if (!this.interruptOutcome) {
      this.interruptOutcome = { kind: 'interrupt', signal: this.interruptedBy }
      this.resolveInterrupt(this.interruptOutcome)
    }
  }

  async teardown(reason) {
    if (this.teardownPromise) return this.teardownPromise
    this.teardownPromise = this.performTeardown(reason)
    return this.teardownPromise
  }

  async performTeardown(reason) {
    if (!this.manifest) return
    this.manifest.phase = 'teardown'
    this.manifest.teardown.startedAt ??= this.now().toISOString()
    this.manifest.teardown.reason ??= reason
    await this.writeManifest()
    const failures = []
    if (this.taskProcess) {
      try {
        await this.stopManagedProcess(this.taskProcess, this.manifest.task)
      } catch (error) {
        failures.push(normalizeError(error))
      }
    }
    for (const root of [...this.roots].reverse()) {
      try {
        await this.stopRoot(root)
      } catch (error) {
        failures.push(normalizeError(error))
      }
    }
    const occupiedPorts = []
    for (const port of this.config.ports) {
      if (!(await this.isPortFree(port))) occupiedPorts.push(port)
    }
    if (occupiedPorts.length === 0) {
      for (const profile of this.config.profileDirectories) {
        await rm(runOwnedPath(this.manifest.runDirectory, profile), { recursive: true, force: true })
      }
    }
    const liveProcesses = []
    const liveProcessIds = new Set()
    const noteLiveProcess = (entry) => {
      if (liveProcessIds.has(entry.pid)) return
      liveProcessIds.add(entry.pid)
      liveProcesses.push(entry)
    }
    if (this.taskProcess) {
      const current = await this.inspectProcess(this.taskProcess.pid)
      if (current && sameProcessIdentity(current, this.taskProcess.identity)) {
        noteLiveProcess({ role: this.taskProcess.spec.role, pid: this.taskProcess.pid })
      }
    }
    for (const root of this.manifest.roots) {
      const current = await this.inspectProcess(root.pid)
      if (current && sameProcessIdentity(current, root.identity)) {
        noteLiveProcess({ role: root.role, pid: root.pid })
      }
      for (const descendant of root.descendants ?? []) {
        const owned = await this.inspectProcess(descendant.pid)
        if (owned && sameProcessIdentity(owned, descendant.identity)) {
          noteLiveProcess({ role: root.role, pid: descendant.pid, descendant: true })
        }
      }
    }
    for (const descendant of this.manifest.task?.descendants ?? []) {
      const owned = await this.inspectProcess(descendant.pid)
      if (owned && sameProcessIdentity(owned, descendant.identity)) {
        noteLiveProcess({ role: this.manifest.task.role, pid: descendant.pid, descendant: true })
      }
    }
    for (const owner of [this.manifest.task, ...this.manifest.roots].filter(Boolean)) {
      if (!owner.processGroupId) continue
      for (const member of await this.listProcessGroup(owner.processGroupId)) {
        noteLiveProcess({ role: owner.role, pid: member.pid, processGroup: true })
      }
    }
    const verification = { liveProcesses, occupiedPorts, profilesReleased: occupiedPorts.length === 0 }
    if (failures.length > 0 || liveProcesses.length > 0 || occupiedPorts.length > 0) {
      this.manifest.phase = 'teardown-failed'
      this.manifest.teardown.verification = verification
      this.manifest.teardown.failures = failures
      await this.writeManifest()
      throw new ProductStackSupervisorError('TEARDOWN_INCOMPLETE', 'E2E teardown did not reach resource zero.', {
        ...verification,
        failures
      })
    }
    this.manifest.phase = 'teardown-complete'
    this.manifest.teardown.completedAt = this.now().toISOString()
    this.manifest.teardown.verification = verification
    await this.writeManifest()
  }

  async stopRoot(root) {
    const manifestRoot = this.manifest.roots.find((candidate) => candidate.pid === root.pid && candidate.role === root.spec.role)
    await this.stopManagedProcess(root, manifestRoot)
  }

  async stopManagedProcess(processRecord, manifestRecord) {
    const { pid, identity, child, exit: exitPromise, spec, processGroupId } = processRecord
    const descendants = await this.captureOwnedDescendants(pid, processGroupId, manifestRecord)
    const current = await this.inspectProcess(pid)
    if (!current) {
      await this.stopOwnedDescendants(descendants, spec.role)
      await this.stopOwnedDescendants(
        await this.captureOwnedDescendants(pid, processGroupId, manifestRecord),
        spec.role
      )
      if (manifestRecord) {
        manifestRecord.stoppedAt = this.now().toISOString()
        manifestRecord.exit = await settledExit(exitPromise)
        await this.writeManifest()
      }
      return
    }
    if (!sameProcessIdentity(current, identity)) {
      throw new ProductStackSupervisorError(
        'PROCESS_IDENTITY_MISMATCH',
        `Refusing to stop reused PID ${pid} for role ${spec.role}.`,
        { expected: identity, actual: current }
      )
    }
    child.kill('SIGTERM')
    const grace = this.createDeadline(this.config.stopGraceMs)
    let exit
    try {
      exit = await Promise.race([
        exitPromise.then((value) => ({ kind: 'exit', value })),
        grace.promise.then(() => ({ kind: 'timeout' }))
      ])
    } finally {
      grace.cancel()
    }
    if (exit.kind === 'timeout') {
      const beforeForce = await this.inspectProcess(pid)
      if (beforeForce && !sameProcessIdentity(beforeForce, identity)) {
        throw new ProductStackSupervisorError(
          'PROCESS_IDENTITY_MISMATCH',
          `Refusing force-stop of reused PID ${pid} for role ${spec.role}.`
        )
      }
      if (beforeForce) await this.forceStop(identity)
    }
    await this.stopOwnedDescendants(descendants, spec.role)
    await this.stopOwnedDescendants(
      await this.captureOwnedDescendants(pid, processGroupId, manifestRecord),
      spec.role
    )
    const survivor = await this.inspectProcess(pid)
    if (survivor && sameProcessIdentity(survivor, identity)) {
      throw new ProductStackSupervisorError(
        'PROCESS_STILL_RUNNING',
        `Owned root PID ${pid} for role ${spec.role} survived teardown.`
      )
    }
    if (manifestRecord) {
      manifestRecord.stoppedAt = this.now().toISOString()
      manifestRecord.exit = exit.kind === 'exit' ? exit.value : await settledExit(exitPromise)
      await this.writeManifest()
    }
  }

  async captureOwnedDescendants(pid, processGroupId, manifestRecord) {
    const [treeDescendants, groupMembers] = await Promise.all([
      this.listDescendants(pid),
      processGroupId ? this.listProcessGroup(processGroupId) : Promise.resolve([])
    ])
    const byPid = new Map()
    for (const identity of [...treeDescendants, ...groupMembers]) {
      if (identity.pid !== pid) byPid.set(identity.pid, identity)
    }
    const descendants = [...byPid.values()]
    const capturedAt = this.now().toISOString()
    const recordsByPid = new Map((manifestRecord?.descendants ?? []).map((record) => [record.pid, record]))
    for (const identity of descendants) {
      if (!recordsByPid.has(identity.pid)) {
        recordsByPid.set(identity.pid, { pid: identity.pid, identity, capturedAt, stoppedAt: null })
      }
    }
    const records = [...recordsByPid.values()]
    if (manifestRecord) {
      manifestRecord.descendants = records
      await this.writeManifest()
    }
    return records
  }

  async stopOwnedDescendants(descendants, role) {
    for (const descendant of [...descendants].reverse()) {
      const current = await this.inspectProcess(descendant.pid)
      if (!current) {
        descendant.stoppedAt = this.now().toISOString()
        continue
      }
      if (!sameProcessIdentity(current, descendant.identity)) {
        throw new ProductStackSupervisorError(
          'PROCESS_IDENTITY_MISMATCH',
          `Refusing to stop reused descendant PID ${descendant.pid} for role ${role}.`,
          { expected: descendant.identity, actual: current }
        )
      }
      await this.forceStop(descendant.identity)
      const survivor = await this.inspectProcess(descendant.pid)
      if (survivor && sameProcessIdentity(survivor, descendant.identity)) {
        throw new ProductStackSupervisorError(
          'PROCESS_STILL_RUNNING',
          `Owned descendant PID ${descendant.pid} for role ${role} survived teardown.`
        )
      }
      descendant.stoppedAt = this.now().toISOString()
    }
  }

  installSignalHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => this.interrupt(signal)
      this.signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  }

  removeSignalHandlers() {
    for (const [signal, handler] of this.signalHandlers) process.removeListener(signal, handler)
    this.signalHandlers.clear()
  }

  async updateManifest(patch) {
    Object.assign(this.manifest, patch)
    await this.writeManifest()
  }

  async writeManifest() {
    const temporary = `${this.manifestPath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.manifestPath)
  }
}

export async function inspectProcessIdentity(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  if (platform === 'win32') return inspectWindowsProcessIdentity(pid)
  if (platform === 'linux') return inspectLinuxProcessIdentity(pid)
  return inspectPosixProcessIdentity(pid)
}

export async function listDescendantProcessIdentities(rootPid, platform = process.platform) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return []
  if (platform === 'win32') return listWindowsDescendantProcessIdentities(rootPid)
  return listPosixDescendantProcessIdentities(rootPid, platform)
}

export async function listProcessGroupIdentities(processGroupId, platform = process.platform) {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0 || platform === 'win32') return []
  try {
    const { stdout } = await execFile('ps', ['-axo', 'pid=,pgid='], { timeout: 10_000 })
    const pids = stdout.split(/\r?\n/u).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u)
      return match && Number(match[2]) === processGroupId && Number(match[1]) !== processGroupId
        ? [Number(match[1])]
        : []
    })
    return inspectProcessIds(pids, platform)
  } catch (error) {
    throw new ProductStackSupervisorError(
      'PROCESS_GROUP_INSPECTION_FAILED',
      `Could not inspect POSIX process group ${processGroupId}.`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
}

async function listWindowsDescendantProcessIdentities(rootPid) {
  const script = [
    '$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)',
    '@($all|ForEach-Object{[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdAt=[string]$_.CreationDate;executablePath=[string]$_.ExecutablePath;commandLine=[string]$_.CommandLine}})|ConvertTo-Json -Compress'
  ].join(';')
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024
    })
    const parsed = JSON.parse(stdout.trim() || '[]')
    const processes = (Array.isArray(parsed) ? parsed : [parsed]).map((raw) => ({
      pid: raw.pid,
      parentPid: raw.parentPid,
      createdAt: raw.createdAt,
      executablePath: resolveExecutable(raw.executablePath),
      commandLineHash: hashText(raw.commandLine ?? '')
    }))
    return collectDescendantProcessIdentities(processes, rootPid)
  } catch (error) {
    throw new ProductStackSupervisorError(
      'PROCESS_TREE_INSPECTION_FAILED',
      `Could not inspect descendants of Windows PID ${rootPid}.`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
}

async function listPosixDescendantProcessIdentities(rootPid, platform) {
  try {
    const { stdout } = await execFile('ps', ['-axo', 'pid=,ppid='], { timeout: 10_000 })
    const processes = stdout.split(/\r?\n/u).flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u)
      if (!match) return []
      return [{
        pid: Number(match[1]),
        parentPid: Number(match[2])
      }]
    })
    const descendantPids = collectDescendantProcessIdentities(processes, rootPid).map(({ pid }) => pid)
    return inspectProcessIds(descendantPids, platform)
  } catch (error) {
    throw new ProductStackSupervisorError(
      'PROCESS_TREE_INSPECTION_FAILED',
      `Could not inspect descendants of POSIX PID ${rootPid}.`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
}

async function inspectProcessIds(pids, platform) {
  const identities = await Promise.all(pids.map((pid) => inspectProcessIdentity(pid, platform)))
  return identities.filter(Boolean)
}

export function collectDescendantProcessIdentities(processes, rootPid) {
  const childrenByParent = new Map()
  for (const process of processes) {
    const children = childrenByParent.get(process.parentPid) ?? []
    children.push(process)
    childrenByParent.set(process.parentPid, children)
  }
  const descendants = []
  const pending = [rootPid]
  const seen = new Set([rootPid])
  while (pending.length > 0) {
    const parentPid = pending.shift()
    for (const candidate of childrenByParent.get(parentPid) ?? []) {
      if (seen.has(candidate.pid)) continue
      seen.add(candidate.pid)
      pending.push(candidate.pid)
      const { parentPid: _parentPid, ...identity } = candidate
      descendants.push(identity)
    }
  }
  return descendants
}

async function inspectWindowsProcessIdentity(pid) {
  const script = [
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop`,
    'if (-not $p) { exit 3 }',
    '[pscustomobject]@{pid=[int]$p.ProcessId;createdAt=[string]$p.CreationDate;executablePath=[string]$p.ExecutablePath;commandLine=[string]$p.CommandLine}|ConvertTo-Json -Compress'
  ].join(';')
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 5_000
    })
    const raw = JSON.parse(stdout.trim())
    return {
      pid: raw.pid,
      createdAt: raw.createdAt,
      executablePath: resolveExecutable(raw.executablePath),
      commandLineHash: hashText(raw.commandLine ?? '')
    }
  } catch (error) {
    if (error?.code === 3 || error?.code === '3') return null
    if (await processExists(pid)) {
      throw new ProductStackSupervisorError('PROCESS_INSPECTION_FAILED', `Could not inspect Windows PID ${pid}.`)
    }
    return null
  }
}

async function inspectLinuxProcessIdentity(pid) {
  try {
    const [stat, commandLine, executablePath] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/cmdline`, 'utf8'),
      import('node:fs/promises').then(({ readlink }) => readlink(`/proc/${pid}/exe`))
    ])
    const close = stat.lastIndexOf(')')
    const fields = stat.slice(close + 2).split(' ')
    return {
      pid,
      createdAt: `proc-start-ticks:${fields[19] ?? 'unknown'}`,
      executablePath: resolveExecutable(executablePath),
      commandLineHash: hashText(commandLine)
    }
  } catch {
    return (await processExists(pid)) ? inspectPosixProcessIdentity(pid) : null
  }
}

async function inspectPosixProcessIdentity(pid) {
  try {
    const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm=', '-o', 'command='], {
      timeout: 5_000
    })
    const line = stdout.trim()
    if (!line) return null
    const match = line.match(/^(.{24})\s+(\S+)\s+([\s\S]+)$/u)
    if (!match) throw new Error('unexpected ps output')
    return {
      pid,
      createdAt: match[1].trim(),
      executablePath: resolveExecutable(match[2]),
      commandLineHash: hashText(match[3])
    }
  } catch {
    if (await processExists(pid)) {
      throw new ProductStackSupervisorError('PROCESS_INSPECTION_FAILED', `Could not inspect POSIX PID ${pid}.`)
    }
    return null
  }
}

export function sameProcessIdentity(actual, expected) {
  return Boolean(
    actual && expected &&
    actual.pid === expected.pid &&
    actual.createdAt === expected.createdAt &&
    actual.executablePath === expected.executablePath &&
    actual.commandLineHash === expected.commandLineHash
  )
}

export async function forceStopProcessTree(identity, platform = process.platform) {
  const current = await inspectProcessIdentity(identity.pid, platform)
  if (!current) return
  if (!sameProcessIdentity(current, identity)) {
    throw new ProductStackSupervisorError('PROCESS_IDENTITY_MISMATCH', `Refusing to stop reused PID ${identity.pid}.`)
  }
  if (platform === 'win32') {
    await execFile('taskkill.exe', ['/PID', String(identity.pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 })
    return
  }
  try {
    process.kill(-identity.pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
    const fallback = await inspectProcessIdentity(identity.pid, platform)
    if (!fallback) return
    if (!sameProcessIdentity(fallback, identity)) {
      throw new ProductStackSupervisorError('PROCESS_IDENTITY_MISMATCH', `Refusing to stop reused PID ${identity.pid}.`)
    }
    process.kill(identity.pid, 'SIGKILL')
  }
}

export async function isLoopbackPortFree(port) {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') resolvePort(false)
      else reject(error)
    })
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolvePort(true))
    })
  })
}

export async function waitForLoopbackPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canConnect(port)) return
    await delay(POLL_INTERVAL_MS)
  }
  throw new ProductStackSupervisorError('READY_TIMEOUT', `Port ${port} did not become ready within ${timeoutMs} ms.`)
}

async function canConnect(port) {
  return new Promise((resolveConnection) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(250)
    socket.once('connect', () => {
      socket.destroy()
      resolveConnection(true)
    })
    const failed = () => {
      socket.destroy()
      resolveConnection(false)
    }
    socket.once('error', failed)
    socket.once('timeout', failed)
  })
}

function childSpawned(child) {
  if (child.pid) return Promise.resolve()
  return new Promise((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn)
    child.once('error', reject)
  })
}

function childExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

async function settledExit(exitPromise) {
  return Promise.race([exitPromise, delay(1_000).then(() => ({ code: null, signal: 'unknown' }))])
}

async function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function runOwnedPath(runDirectory, childPath) {
  const target = resolve(runDirectory, childPath)
  const relation = relative(resolve(runDirectory), target)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new ProductStackSupervisorError('UNSAFE_PROFILE_PATH', `Profile path escapes run directory: ${childPath}.`)
  }
  return target
}

function safeCommandSummary(spec) {
  return {
    role: spec.role,
    executable: basename(spec.command),
    commandHash: spec.commandHash,
    cwd: spec.cwd,
    readyPort: spec.readyPort,
    timeoutMs: spec.timeoutMs
  }
}

function resolveCommandLabel(command) {
  return command.includes('/') || command.includes('\\') ? resolve(command) : command
}

function resolveExecutable(value) {
  return value ? resolve(value).toLocaleLowerCase() : 'unavailable'
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function normalizePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', `Invalid TCP port: ${value}.`)
  }
  return port
}

function requiredArray(value, label) {
  if (!Array.isArray(value)) throw new ProductStackSupervisorError('INVALID_CONFIG', `${label} must be an array.`)
  return value
}

function requiredString(value, label, options = {}) {
  if (typeof value !== 'string' || (!options.allowEmpty && !value.trim())) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', `${label} must be a non-empty string.`)
  }
  return options.allowEmpty ? value : value.trim()
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ProductStackSupervisorError('INVALID_CONFIG', `${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

function normalizeError(error) {
  if (error instanceof ProductStackSupervisorError) {
    return { code: error.code, message: error.message, detail: error.detail }
  }
  return { code: 'SUPERVISOR_FAILED', message: error instanceof Error ? error.message : String(error), detail: {} }
}

async function readPreviousManifest(path) {
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    if (manifest?.version !== MANIFEST_VERSION) {
      throw new ProductStackSupervisorError('INVALID_PREVIOUS_MANIFEST', `Unsupported E2E manifest at ${path}.`)
    }
    return manifest
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error instanceof ProductStackSupervisorError) throw error
    throw new ProductStackSupervisorError('INVALID_PREVIOUS_MANIFEST', `Could not parse E2E manifest at ${path}.`)
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function createDeadline(milliseconds) {
  let timer
  return {
    promise: new Promise((resolveDeadline) => {
      timer = setTimeout(resolveDeadline, milliseconds)
    }),
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

export async function runProductStackSupervisorCli(argv = process.argv.slice(2)) {
  const configIndex = argv.indexOf('--config')
  if (configIndex < 0 || !argv[configIndex + 1]) {
    throw new ProductStackSupervisorError('INVALID_CLI', 'Usage: product-stack-supervisor.mjs --config <config.json>.')
  }
  const configPath = resolve(argv[configIndex + 1])
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const supervisor = new ProductStackSupervisor(config, { cwd: dirname(configPath) })
  return supervisor.run()
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  runProductStackSupervisorCli()
    .then(({ runId, runDirectory }) => {
      console.log(JSON.stringify({ ok: true, runId, runDirectory }))
    })
    .catch((error) => {
      const failure = normalizeError(error)
      console.error(JSON.stringify({ ok: false, ...failure }))
      process.exitCode = 1
    })
}
