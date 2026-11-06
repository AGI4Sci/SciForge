import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve } from 'node:path'

export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue }
export type SnapshotFile = { path: string; content: string }
export type SnapshotInputFile = { path: string; bytes: Uint8Array }
export type SnapshotOutputFile = { path: string; bytes: Uint8Array }

export interface PythonSnapshotRequest {
  /** Executable name or absolute executable path, never a shell command with arguments. */
  pythonCommand: string
  workspaceRoot: string
  files: SnapshotFile[]
  entrypoint: string
  parameters: JSONValue
  inputFiles: SnapshotInputFile[]
  timeoutMs?: number
  signal?: AbortSignal
}

export interface PythonSnapshotResult {
  status: 'completed' | 'failed' | 'cancelled'
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  exitCode: number | null
  environment: {
    language: 'python'
    pythonVersion?: string
    matplotlibVersion?: string
    platform?: string
    machine?: string
    implementation?: string
    executable?: string
    packages?: Array<{ name: string; version: string }>
  }
  outputs: SnapshotOutputFile[]
  error?: { code: string; message: string }
}

/** Future language adapters implement this boundary; only Python is implemented. */
export interface SnapshotExecutionAdapter {
  readonly language: 'python'
  run(request: PythonSnapshotRequest): Promise<PythonSnapshotResult>
}

export const EXECUTION_LIMITS = Object.freeze({
  logBytes: 128 * 1024,
  snapshotFiles: 256,
  snapshotBytes: 64 * 1024 * 1024,
  parametersBytes: 128 * 1024,
  // PNG and analysis files use independent count and byte budgets.
  outputFiles: 16,
  outputFileBytes: 20 * 1024 * 1024,
  outputTotalBytes: 64 * 1024 * 1024,
  analysisFiles: 32,
  analysisFileBytes: 8 * 1024 * 1024,
  analysisTotalBytes: 32 * 1024 * 1024,
  environmentBytes: 2 * 1024 * 1024,
  environmentPackages: 5000,
  outputEntries: 256,
  outputDepth: 16,
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 10 * 60_000,
})

export const PYTHON_SNAPSHOT_WRAPPER = `import json, os, platform, runpy, sys, traceback
metadata_path, entrypoint = sys.argv[1:3]
import importlib.metadata
metadata = {"pythonVersion": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(), "implementation": platform.python_implementation(), "executable": os.path.basename(sys.executable), "packages": sorted([{"name": d.metadata.get("Name", "unknown"), "version": d.version} for d in importlib.metadata.distributions()], key=lambda d: (d["name"].lower(), d["version"]))}
try:
    import matplotlib
    metadata["matplotlibVersion"] = matplotlib.__version__
except ImportError:
    metadata["error"] = "missing-matplotlib"
    with open(metadata_path, "x", encoding="utf-8") as stream:
        json.dump(metadata, stream)
    print("Matplotlib is unavailable in the configured Python runtime; no packages were installed.", file=sys.stderr)
    traceback.print_exc()
    sys.exit(78)
with open(metadata_path, "x", encoding="utf-8") as stream:
    json.dump(metadata, stream)
sys.path.insert(0, os.getcwd())
sys.path.insert(0, os.path.dirname(os.path.realpath(entrypoint)))
sys.argv = [entrypoint]
runpy.run_path(entrypoint, run_name="__main__")
`

class ExecutionError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function relativePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || isAbsolute(value)
    // eslint-disable-next-line no-control-regex -- Filesystem paths must reject ASCII controls.
    || value.includes('\\') || /[\x00-\x1f\x7f:]/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..')
    || posix.normalize(value) !== value) {
    throw new ExecutionError('invalid-path', `Expected a safe relative path: ${String(value)}`)
  }
  return value
}

function parametersJSON(value: JSONValue): string {
  const seen = new Set<object>()
  function validate(item: unknown): void {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object' || !item || seen.has(item)) throw new ExecutionError('invalid-parameters', 'Parameters must contain finite JSON values without cycles.')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new ExecutionError('invalid-parameters', 'Parameters must be plain JSON objects.')
    seen.add(item)
    for (const child of Object.values(item)) validate(child)
    seen.delete(item)
  }
  validate(value)
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > EXECUTION_LIMITS.parametersBytes || text.includes('\u0000')) throw new ExecutionError('invalid-parameters', 'Parameters exceed the JSON size limit.')
  return text
}

async function directory(parent: string, name: string): Promise<string> {
  const path = join(parent, name)
  try { await mkdir(path, { mode: 0o700 }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new ExecutionError('unsafe-directory', `Staging directory is not a real directory: ${name}`)
  return path
}

async function writeSnapshot(root: string, path: string, bytes: Uint8Array | string): Promise<void> {
  const parts = relativePath(path).split('/')
  let parent = root
  for (const part of parts.slice(0, -1)) parent = await directory(parent, part)
  const handle = await open(join(parent, parts.at(-1)!), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(bytes) } finally { await handle.close() }
}

async function readRegular(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new ExecutionError('unsafe-output', 'Output must be a bounded regular file without links.')
    const data = Buffer.alloc(stat.size + 1)
    let count = 0
    while (count < data.length) {
      const result = await handle.read(data, count, data.length - count, count)
      if (!result.bytesRead) break
      count += result.bytesRead
    }
    if (count !== stat.size) throw new ExecutionError('unsafe-output', 'Output changed while being collected.')
    return data.subarray(0, count)
  } finally { await handle.close() }
}

function strictUTF8(bytes: Uint8Array, label: string): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch {
    throw new ExecutionError('invalid-output', `${label} is not valid UTF-8.`)
  }
}

function comparePaths(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

async function collectOutputs(root: string): Promise<SnapshotOutputFile[]> {
  const outputs: SnapshotOutputFile[] = []
  let entries = 0
  let pngCount = 0
  let pngTotal = 0
  let analysisCount = 0
  let analysisTotal = 0
  async function visit(path: string, prefix: string, depth: number): Promise<void> {
    if (depth > EXECUTION_LIMITS.outputDepth) throw new ExecutionError('output-limit', 'Output directory nesting exceeds the limit.')
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new ExecutionError('unsafe-output', 'Output directory contains a symbolic link.')
    const dir = await opendir(path)
    for await (const item of dir) {
      entries += 1
      if (entries > EXECUTION_LIMITS.outputEntries) throw new ExecutionError('output-limit', 'Too many output directory entries.')
      const name = relativePath(prefix ? `${prefix}/${item.name}` : item.name)
      const target = join(path, item.name)
      if (name.split('/')[0].toLowerCase() === '_environment') throw new ExecutionError('reserved-output', 'The _environment output path is reserved for captured runtime artifacts.')
      if (item.isSymbolicLink()) throw new ExecutionError('unsafe-output', 'Symbolic link outputs are not permitted.')
      if (item.isDirectory()) { await visit(target, name, depth + 1); continue }
      if (!item.isFile()) continue
      const extension = posix.extname(name).toLowerCase()
      const png = extension === '.png'
      if (!png && !['.csv', '.tsv', '.json', '.txt'].includes(extension)) continue
      if (png ? pngCount >= EXECUTION_LIMITS.outputFiles : analysisCount >= EXECUTION_LIMITS.analysisFiles) throw new ExecutionError('output-limit', png ? 'Too many PNG output files.' : 'Too many analysis output files.')
      const bytes = await readRegular(target, png
        ? Math.min(EXECUTION_LIMITS.outputFileBytes, EXECUTION_LIMITS.outputTotalBytes - pngTotal)
        : Math.min(EXECUTION_LIMITS.analysisFileBytes, EXECUTION_LIMITS.analysisTotalBytes - analysisTotal))
      if (png) {
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ExecutionError('invalid-output', `Output is not a PNG: ${name}`)
        pngCount += 1
        pngTotal += bytes.byteLength
      } else {
        const text = strictUTF8(bytes, `Analysis output ${name}`)
        if (text.includes('\u0000')) throw new ExecutionError('invalid-output', `Analysis output contains NUL: ${name}`)
        if (extension === '.json') {
          try { JSON.parse(text) } catch { throw new ExecutionError('invalid-output', `Output is not valid JSON: ${name}`) }
        }
        analysisCount += 1
        analysisTotal += bytes.byteLength
      }
      outputs.push({ path: name, bytes: new Uint8Array(bytes) })
    }
  }
  await visit(root, '', 0)
  return outputs.sort(comparePaths)
}

// Reject requirements options, URLs, markers, newlines, wildcards and ambiguous duplicate names.
const PACKAGE_NAME = /^[A-Z0-9](?:[A-Z0-9._-]*[A-Z0-9])?$/i
const EXACT_VERSION = /^v?(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?[0-9]*)?(?:(?:-[0-9]+)|(?:[-_.]?(?:post|rev|r)[-_.]?[0-9]*))?(?:[-_.]?dev[-_.]?[0-9]*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$/i

function environmentOutputs(environment: PythonSnapshotResult['environment']): SnapshotOutputFile[] {
  const inventory = environment.packages
  if (!inventory || !environment.pythonVersion || !environment.platform || !environment.implementation || !environment.machine) throw new ExecutionError('invalid-environment', 'Python runtime did not report a complete environment inventory.')
  const pins = new Map<string, { name: string; version: string }>()
  for (const item of inventory) {
    // eslint-disable-next-line no-control-regex -- Requirements lines must reject embedded controls.
    if (/[\s\x00-\x1f\x7f]/.test(item.name + item.version) || !PACKAGE_NAME.test(item.name) || !EXACT_VERSION.test(item.version)) throw new ExecutionError('invalid-environment', 'Installed package inventory contains an invalid package name or exact version.')
    const name = item.name.toLowerCase().replace(/[-_.]+/g, '-')
    const previous = pins.get(name)
    if (previous && previous.version !== item.version) throw new ExecutionError('invalid-environment', `Installed package inventory contains conflicting versions: ${name}`)
    pins.set(name, { name, version: item.version })
  }
  const packages = [...pins.values()].sort((a, b) => comparePaths({ path: a.name }, { path: b.name }))
  const requirements = '# Captured installed inventory; exact versions, not a hash lock.\n' + packages.map(item => `${item.name}==${item.version}\n`).join('')
  const rebuild = `# Rebuild the captured Python environment\n\nUse the Python version, implementation, platform and machine recorded in environment.json as the reconstruction target.\n\nChoose a matching Python interpreter (replace python3.X below with its executable). From this directory create a fresh virtual environment:\n\n\`\`\`sh\npython3.X -m venv .venv\n\`\`\`\n\nActivate it with \`source .venv/bin/activate\` on POSIX, or \`.venv\\Scripts\\Activate.ps1\` in Windows PowerShell. Then install the captured inventory:\n\n\`\`\`sh\npython -m pip install -r requirements.txt\n\`\`\`\n\nThese commands are guidance only; SciForge did not run it or install any packages. Installation may require network access and explicit authorization.\n\nrequirements.txt is the captured installed distribution inventory with exact version pins. It is not a hash lock, does not bundle package binaries, does not preserve index URLs or editable/direct source locations, and does not guarantee identical results on another Python version or platform. Packages may be unavailable for the target platform. Input data, native libraries, drivers and external services must be supplied separately.\n`
  const outputs = [
    { path: '_environment/requirements.txt', bytes: new TextEncoder().encode(requirements) },
    { path: '_environment/environment.json', bytes: new TextEncoder().encode(JSON.stringify(environment, null, 2) + '\n') },
    { path: '_environment/REBUILD.md', bytes: new TextEncoder().encode(rebuild) },
  ]
  if (outputs.reduce((total, file) => total + file.bytes.byteLength, 0) > EXECUTION_LIMITS.environmentBytes) throw new ExecutionError('invalid-environment', 'Environment reconstruction artifacts exceed the size limit.')
  return outputs
}

function logBuffer() {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    append(value: Buffer | string) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const remaining = EXECUTION_LIMITS.logBytes - size
      if (bytes.length > remaining) truncated = true
      if (remaining > 0) { const chunk = bytes.subarray(0, remaining); chunks.push(chunk); size += chunk.length }
    },
    text: () => {
      // Invalid/truncated UTF-8 expands to replacement characters; bound returned UTF-8 too.
      const text = Buffer.concat(chunks).toString('utf8')
      if (Buffer.byteLength(text) <= EXECUTION_LIMITS.logBytes) return text
      let low = 0
      let high = text.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (Buffer.byteLength(text.slice(0, middle)) <= EXECUTION_LIMITS.logBytes) low = middle
        else high = middle - 1
      }
      truncated = true
      return text.slice(0, low)
    },
    truncated: () => truncated,
  }
}

export interface PreparedPythonSnapshot {
  stageRoot: string
  stagingRoot: string
  identity: { dev: number; ino: number }
  cwd: string
  argv: string[]
  env: Record<string, string>
  timeoutMs: number
}

export interface PythonProcessOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutTruncated?: boolean
  stderrTruncated?: boolean
  status?: 'completed' | 'failed' | 'cancelled'
  error?: string | { code: string; message: string }
}

/** Prepare in the authorized outer worker; host then uses its managed subprocess API. */
export async function preparePythonSnapshot(request: PythonSnapshotRequest): Promise<PreparedPythonSnapshot> {
  let runRoot: string | undefined
  let runIdentity: { dev: number; ino: number } | undefined
  let stagingRoot: string | undefined
  try {
    if (request.signal?.aborted) throw new ExecutionError('cancelled', 'Python execution was cancelled.')
    // eslint-disable-next-line no-control-regex -- Executable names must reject ASCII controls.
    if (typeof request.pythonCommand !== 'string' || !request.pythonCommand.trim() || /[\x00-\x1f\x7f]/.test(request.pythonCommand)) throw new ExecutionError('invalid-runtime', 'Configure a Python executable, without shell arguments.')
    const timeout = request.timeoutMs ?? EXECUTION_LIMITS.defaultTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > EXECUTION_LIMITS.maxTimeoutMs) throw new ExecutionError('invalid-timeout', 'Timeout must be between 1 and 600000 milliseconds.')
    const entrypoint = relativePath(request.entrypoint)
    const parameters = parametersJSON(request.parameters)
    if (!Array.isArray(request.files) || !Array.isArray(request.inputFiles) || request.files.length + request.inputFiles.length > EXECUTION_LIMITS.snapshotFiles) throw new ExecutionError('snapshot-limit', 'Too many snapshot or input files.')
    const seen = new Set<string>()
    let snapshotBytes = 0
    // Copy synchronously before the first await: caller mutations cannot change this run's snapshot.
    const files = request.files.map(file => {
      const path = relativePath(file.path)
      if (typeof file.content !== 'string' || seen.has(`snapshot/${path}`)) throw new ExecutionError('invalid-snapshot', 'Snapshot files must have unique paths and string content.')
      seen.add(`snapshot/${path}`)
      snapshotBytes += Buffer.byteLength(file.content)
      return { path, content: file.content }
    })
    const inputs = request.inputFiles.map(file => {
      const path = relativePath(file.path)
      if (!(file.bytes instanceof Uint8Array) || seen.has(`inputs/${path}`)) throw new ExecutionError('invalid-snapshot', 'Input files must have unique paths and byte content.')
      seen.add(`inputs/${path}`)
      snapshotBytes += file.bytes.byteLength
      if (snapshotBytes > EXECUTION_LIMITS.snapshotBytes) throw new ExecutionError('snapshot-limit', 'Snapshot and input bytes exceed the limit.')
      return { path, bytes: new Uint8Array(file.bytes) }
    })
    if (snapshotBytes > EXECUTION_LIMITS.snapshotBytes) throw new ExecutionError('snapshot-limit', 'Snapshot and input bytes exceed the limit.')
    if (!files.some(file => file.path === entrypoint) || !entrypoint.endsWith('.py')) throw new ExecutionError('invalid-entrypoint', 'Entrypoint must be a .py file included in the snapshot.')
    const workspace = await realpath(resolve(request.workspaceRoot))
    if (!(await lstat(workspace)).isDirectory()) throw new ExecutionError('invalid-workspace', 'Workspace root must be a directory.')
    stagingRoot = await directory(await directory(workspace, '.scientific-figures'), '.runs-temp')
    runRoot = await mkdtemp(join(stagingRoot, 'python-'))
    const stat = await lstat(runRoot)
    runIdentity = { dev: stat.dev, ino: stat.ino }
    const snapshot = await directory(runRoot, 'snapshot')
    const inputDir = await directory(runRoot, 'inputs')
    const outputDir = await directory(runRoot, 'outputs')
    const cacheDir = await directory(runRoot, 'cache')
    const tempDir = await directory(runRoot, 'tmp')
    for (const file of files) await writeSnapshot(snapshot, file.path, file.content)
    for (const file of inputs) await writeSnapshot(inputDir, file.path, file.bytes)
    const metadataPath = join(runRoot, 'environment.json')
    return { stageRoot: runRoot, stagingRoot, identity: runIdentity, cwd: snapshot,
      argv: [request.pythonCommand, '-I', '-u', '-c', PYTHON_SNAPSHOT_WRAPPER, metadataPath, join(snapshot, entrypoint)],
      env: { MPLBACKEND: 'Agg', MPLCONFIGDIR: cacheDir, XDG_CACHE_HOME: cacheDir, TMPDIR: tempDir, PYTHONDONTWRITEBYTECODE: '1', SCIENTIFIC_FIGURES_OUTPUT_DIR: outputDir, SCIENTIFIC_FIGURES_INPUT_DIR: inputDir, SCIENTIFIC_FIGURES_PARAMETERS_JSON: parameters },
      timeoutMs: timeout,
    }
  } catch (error) {
    if (runRoot && runIdentity && stagingRoot) await cleanupPythonSnapshot({ stageRoot: runRoot, stagingRoot, identity: runIdentity })
    throw error
  }
}

type StageIdentity = Pick<PreparedPythonSnapshot, 'stageRoot' | 'stagingRoot' | 'identity'>

async function validateStage(prepared: StageIdentity): Promise<void> {
  const { stageRoot, stagingRoot, identity } = prepared
  if (!isAbsolute(stageRoot) || resolve(stageRoot) !== stageRoot || !isAbsolute(stagingRoot)
    || resolve(stagingRoot) !== stagingRoot || !/^python-[A-Za-z0-9]+$/.test(posix.basename(stageRoot))
    || join(stagingRoot, posix.basename(stageRoot)) !== stageRoot
    || posix.basename(stagingRoot) !== '.runs-temp' || posix.basename(posix.dirname(stagingRoot)) !== '.scientific-figures') {
    throw new ExecutionError('unsafe-stage', 'Invalid run staging location.')
  }
  const stat = await lstat(stageRoot)
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== identity.dev || stat.ino !== identity.ino
    || await realpath(stagingRoot) !== stagingRoot || await realpath(stageRoot) !== stageRoot) {
    throw new ExecutionError('unsafe-stage', 'Run staging directory identity changed.')
  }
}

/** Checks exact generated directory identity before removing only that run directory. */
export async function cleanupPythonSnapshot(prepared: StageIdentity): Promise<void> {
  await validateStage(prepared)
  await rm(prepared.stageRoot, { recursive: true, force: true })
}

/** Managed callers defer cleanup until durable commit; standalone callers clean immediately. */
export async function collectPythonSnapshot(prepared: PreparedPythonSnapshot, outcome: PythonProcessOutcome, options: { cleanup?: boolean } = {}): Promise<PythonSnapshotResult> {
  const stdout = logBuffer()
  const stderr = logBuffer()
  stdout.append(outcome.stdout)
  stderr.append(outcome.stderr)
  const result: PythonSnapshotResult = {
    status: 'failed', stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    exitCode: outcome.exitCode, environment: { language: 'python' }, outputs: [],
  }
  try {
    await validateStage(prepared)
    let metadata: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(strictUTF8(await readRegular(join(prepared.stageRoot, 'environment.json'), 512 * 1024), 'Environment metadata'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid environment metadata')
      metadata = parsed as Record<string, unknown>
      if (typeof metadata.pythonVersion === 'string') result.environment.pythonVersion = metadata.pythonVersion.slice(0, 128)
      if (typeof metadata.matplotlibVersion === 'string') result.environment.matplotlibVersion = metadata.matplotlibVersion.slice(0, 128)
      for (const key of ['platform', 'machine', 'implementation', 'executable'] as const) if (typeof metadata[key] === 'string') result.environment[key] = metadata[key].slice(0, 2048)
      if (Array.isArray(metadata.packages)) {
        if (metadata.packages.length > EXECUTION_LIMITS.environmentPackages || metadata.packages.some(item => !item || typeof item.name !== 'string' || typeof item.version !== 'string' || item.name.length > 256 || item.version.length > 256)) throw new Error('Invalid environment package inventory')
        result.environment.packages = metadata.packages.map(item => ({ name: item.name, version: item.version }))
      }
    } catch (error) {
      if (outcome.exitCode === 0 && !outcome.error && outcome.status !== 'cancelled') throw new ExecutionError('invalid-environment', `Python runtime did not report its environment: ${String(error)}`)
    }
    if (outcome.status === 'cancelled') { result.status = 'cancelled'; throw new ExecutionError('cancelled', 'Python execution was cancelled.') }
    if (outcome.error) throw typeof outcome.error === 'string' ? new ExecutionError('execution-failed', outcome.error) : new ExecutionError(outcome.error.code, outcome.error.message)
    if (metadata.error === 'missing-matplotlib') throw new ExecutionError('missing-matplotlib', 'Matplotlib is unavailable in the configured Python runtime. No packages were installed.')
    if (outcome.exitCode !== 0 || outcome.status === 'failed') throw new ExecutionError('python-failed', `Python exited with ${outcome.exitCode ?? 'an unknown error'}.`)
    const outputs = await collectOutputs(join(prepared.stageRoot, 'outputs'))
    result.outputs = [...outputs, ...environmentOutputs(result.environment)].sort(comparePaths)
    result.status = 'completed'
  } catch (error) {
    result.error = { code: error instanceof ExecutionError ? error.code : 'execution-failed', message: error instanceof Error ? error.message : String(error) }
    stderr.append(`
[scientific-figures] ${result.error.message}
`)
  } finally {
    try { if (options.cleanup !== false) await cleanupPythonSnapshot(prepared) } catch (error) {
      result.status = 'failed'
      result.outputs = []
      result.error = { code: 'cleanup-failed', message: `Unable to clean up run staging: ${String(error)}` }
      stderr.append(`
[scientific-figures] ${result.error.message}
`)
    }
    result.stdout = stdout.text()
    result.stderr = stderr.text()
    result.stdoutTruncated = !!outcome.stdoutTruncated || stdout.truncated()
    result.stderrTruncated = !!outcome.stderrTruncated || stderr.truncated()
  }
  return result
}

/** Isolated test/worker convenience. Production host uses prepare/managed subprocess/collect. */
export async function runPythonSnapshot(request: PythonSnapshotRequest): Promise<PythonSnapshotResult> {
  let prepared: PreparedPythonSnapshot
  try { prepared = await preparePythonSnapshot(request) } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stderr = logBuffer()
    stderr.append(`[scientific-figures] ${message}
`)
    return { status: error instanceof ExecutionError && error.code === 'cancelled' ? 'cancelled' : 'failed',
      stdout: '', stderr: stderr.text(), stdoutTruncated: false, stderrTruncated: stderr.truncated(), exitCode: null,
      environment: { language: 'python' }, outputs: [], error: { code: error instanceof ExecutionError ? error.code : 'execution-failed', message } }
  }
  const stdout = logBuffer()
  const stderr = logBuffer()
  let timedOut = false
  let cancelled = false
  let spawnError: Error | undefined
  let outcome: PythonProcessOutcome
  try {
    outcome = await new Promise<PythonProcessOutcome>(resolveProcess => {
      const child = spawn(prepared.argv[0], prepared.argv.slice(1), {
        cwd: prepared.cwd, env: { ...process.env, ...prepared.env }, shell: false,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      })
      const kill = () => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
          else child.kill('SIGKILL')
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') stderr.append(`
Unable to terminate Python process: ${String(error)}
`) }
      }
      const abort = () => { cancelled = true; kill() }
      const timer = setTimeout(() => { timedOut = true; kill() }, prepared.timeoutMs)
      request.signal?.addEventListener('abort', abort, { once: true })
      if (request.signal?.aborted) abort()
      child.stdout.on('data', chunk => stdout.append(chunk))
      child.stderr.on('data', chunk => stderr.append(chunk))
      child.on('error', error => { spawnError = error })
      child.on('exit', kill)
      child.on('close', code => {
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        resolveProcess({ exitCode: spawnError ? null : code, stdout: stdout.text(), stderr: stderr.text(),
          stdoutTruncated: stdout.truncated(), stderrTruncated: stderr.truncated(),
          status: cancelled ? 'cancelled' : 'completed',
          ...(spawnError ? { error: { code: 'runtime-unavailable', message: `Unable to start configured Python runtime: ${spawnError.message}` } }
            : timedOut ? { error: { code: 'timeout', message: `Python execution exceeded ${prepared.timeoutMs} milliseconds.` } } : {}),
        })
      })
    })
  } catch (error) {
    outcome = { exitCode: null, stdout: stdout.text(), stderr: stderr.text(), error: String(error) }
  }
  return collectPythonSnapshot(prepared, outcome)
}

export const pythonSnapshotAdapter: SnapshotExecutionAdapter = { language: 'python', run: runPythonSnapshot }
