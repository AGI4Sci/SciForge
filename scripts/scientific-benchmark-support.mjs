import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, copyFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
export const isolation = Object.freeze({ mode: 'development-workspace', osEnforced: false })

export function isMain(url) {
  return Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url))
}

export function helpRequested(usage, acceptsIds = false) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage)
    return true
  }
  if (!acceptsIds && args.length) throw new Error('This command takes no arguments. Use --help for environment settings.')
  return false
}

export function required(env, key) {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

export function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`${name} must be a positive safe integer.`)
  }
  return Number(value)
}

export function safeId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value))) throw new Error('Invalid task ID type.')
  const id = String(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error(`Invalid task ID: ${id}`)
  return id
}

export function inside(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Expected a workspace-relative path: ${name}`)
  }
  const path = resolve(root, name)
  if (!relative(root, path) || (relative(root, path) === '..' || relative(root, path).startsWith(`..${sep}`))) throw new Error(`Path escapes workspace: ${name}`)
  return path
}

export async function separateRoots(left, right) {
  // Resolve existing ancestors too, so aliases through symlinked parents cannot bypass this check.
  async function canonical(path) {
    try { return await realpath(path) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      return join(await canonical(dirname(path)), relative(dirname(path), path))
    }
  }
  const [a, b] = await Promise.all([canonical(resolve(left)), canonical(resolve(right))])
  const nested = (root, candidate) => {
    const path = relative(root, candidate)
    return path === '' || (!(path === '..' || path.startsWith(`..${sep}`)) && !isAbsolute(path))
  }
  if (nested(a, b) || nested(b, a)) throw new Error('Benchmark, output, and Agent workspace roots must be separate.')
}

export async function exists(path) {
  try { await lstat(path); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function plainPath(root, name) {
  const path = inside(root, name)
  let current = root
  for (const part of ['', ...name.split('/')]) {
    if (part) current = join(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${current}`)
  }
  return path
}

export function validateRecord(record, manifest, outputRoot, id) {
  if (record.schemaVersion !== 1 || record.instance_id !== id || record.datasetDigest !== manifest.datasetDigest ||
    record.model !== manifest.model || record.runtimeId !== manifest.runtimeId) throw new Error(`Result ${id} does not match this run manifest.`)
  if (typeof record.workspace !== 'string' || !isAbsolute(record.workspace)) throw new Error('Invalid record workspace.')
  inside(join(outputRoot, 'workspaces'), relative(join(outputRoot, 'workspaces'), record.workspace))
  inside(record.workspace, record.output_fname)
  inside(record.workspace, record.eval_script_name)
}

export async function copyPlainTree(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not allowed in benchmark inputs or outputs: ${source}`)
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true })
    for (const name of await readdir(source)) await copyPlainTree(join(source, name), join(destination, name))
  } else if (info.isFile()) {
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  } else throw new Error(`Unsupported benchmark file: ${source}`)
}

export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

export function runtimeConfig(env) {
  const runtimeId = env.SCIFORGE_RUNTIME_ID?.trim() || 'codex'
  if (!['codex', 'claude'].includes(runtimeId)) throw new Error('SCIFORGE_RUNTIME_ID must be codex or claude.')
  return { runtimeId, bridgeUrl: env.SCIFORGE_DEV_BRIDGE_URL?.trim() || 'http://127.0.0.1:5174',
    instanceId: env.SCIFORGE_DEV_INSTANCE_ID?.trim() || undefined, projectRoot: repositoryRoot }
}

export async function createBenchmarkRuntime(config) {
  const { createDevBrowserBridgeRuntime } = await import('../src/main/capability-eval/dev-bridge-runtime.ts')
  return createDevBrowserBridgeRuntime(config)
}

export async function executeBenchmarkTask({ runtime, runtimeId, model, timeoutMs, id, query, workspace, tracePath }) {
  const { createLiveWorkflowExecutor } = await import('../src/main/capability-eval/live-executor.ts')
  const executor = createLiveWorkflowExecutor({
    runtime, runtimeId, model, timeoutMs, cleanupThread: true,
    onTrace: async (_evalCase, events, trace) => writeJson(tracePath, { events, trace })
  })
  const result = await executor.run({ id, query, expected: { requiredActions: [] } }, {
    caseId: id, runId: randomUUID(), directory: workspace, state: {}
  })
  return result.trace
}

export async function loadScienceAgentBenchRows(path, env) {
  const document = await readJson(path)
  if (!Array.isArray(document.rows)) throw new Error('SAB_ROWS must contain a rows array of { row } entries.')
  const all = document.rows.map(entry => {
    const row = entry?.row
    if (!row || typeof row.task_inst !== 'string' || !row.task_inst.trim()) throw new Error('Invalid benchmark task.')
    safeId(row.instance_id)
    inside(repositoryRoot, row.output_fname)
    inside(repositoryRoot, row.eval_script_name)
    if (row.output_fname === 'benchmark' || row.output_fname.startsWith('benchmark/')) throw new Error('Task output cannot overwrite benchmark inputs.')
    return row
  })
  const ids = all.map(row => String(row.instance_id))
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate task IDs in SAB_ROWS.')
  const selected = new Set((env.SAB_INSTANCE_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean).map(safeId))
  for (const id of selected) if (!ids.includes(id)) throw new Error(`Unknown requested task ID: ${id}`)
  const rows = all.filter(row => !selected.size || selected.has(String(row.instance_id)))
    .slice(0, positiveInteger(env.SAB_LIMIT, 'SAB_LIMIT', all.length))
  if (!rows.length) throw new Error('No benchmark tasks selected.')
  return { rows, datasetDigest: createHash('sha256').update(JSON.stringify(all)).digest('hex') }
}

export async function ensureManifest(outputRoot, identity) {
  const path = join(outputRoot, 'manifest.json')
  const manifest = { schemaVersion: 1, ...identity, isolation }
  if (await exists(path)) {
    const previous = await readJson(path)
    if (JSON.stringify(previous) !== JSON.stringify(manifest)) throw new Error('Run configuration changed; choose a new SAB_OUTPUT directory.')
    return previous
  }
  if (await exists(outputRoot) && (await readdir(outputRoot)).length) throw new Error('SAB_OUTPUT is not empty and has no manifest. Choose a new directory.')
  await writeJson(path, manifest)
  return manifest
}

export async function readManifest(outputRoot) {
  const value = await readJson(join(outputRoot, 'manifest.json'))
  if (value.schemaVersion !== 1 || !Array.isArray(value.expectedIds) || !value.expectedIds.length ||
    new Set(value.expectedIds).size !== value.expectedIds.length || !value.model || !value.benchmarkRoot) {
    throw new Error('Invalid benchmark run manifest.')
  }
  if (value.expectedIds.some(id => typeof id !== 'string') || !['codex', 'claude'].includes(value.runtimeId)) throw new Error('Invalid manifest task IDs or runtime.')
  if (typeof value.benchmarkRoot !== 'string' || !isAbsolute(value.benchmarkRoot) || typeof value.datasetDigest !== 'string') throw new Error('Invalid manifest input identity.')
  value.expectedIds.forEach(safeId)
  return value
}

export async function prepareScienceAgentBenchWorkspace(row, benchmarkRoot, workspacesRoot) {
  await mkdir(workspacesRoot, { recursive: true })
  const workspace = await mkdtemp(join(workspacesRoot, `${safeId(row.instance_id)}-`))
  await mkdir(join(workspace, 'pred_results'))
  await mkdir(join(workspace, 'benchmark/datasets'), { recursive: true })
  const names = [...String(row.dataset_folder_tree ?? '').matchAll(/^\|--\s+(.+?)\/?\s*$/gm)].map(match => match[1].trim())
  for (const name of new Set(names)) {
    await copyPlainTree(await plainPath(join(benchmarkRoot, 'datasets'), name), inside(join(workspace, 'benchmark/datasets'), name))
  }
  return workspace
}

// Execute the upstream __main__ path unchanged. Decode its final Python (0|1, reason)
// tuple with literal_eval, never eval; a zero exit alone does not establish correctness.
const scorerWrapper = `import ast, contextlib, io, json, os, runpy, sys
script, result_path = sys.argv[1:]
sys.argv = [script]
sys.path.insert(0, os.path.dirname(script))
class Capture(io.StringIO):
    def write(self, text):
        sys.__stdout__.write(text)
        sys.__stdout__.flush()
        return super().write(text)
output = Capture()
with contextlib.redirect_stdout(output):
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit as error:
        if error.code not in (None, 0):
            raise
lines = output.getvalue().strip().splitlines()
result = {"status": "unparsed", "score": None, "reason": None}
try:
    value = ast.literal_eval(lines[-1])
    if isinstance(value, tuple) and len(value) == 2 and type(value[0]) in (int, bool) and value[0] in (0, 1) and isinstance(value[1], str):
        result = {"status": "reported", "score": int(value[0]), "reason": value[1]}
except (ValueError, SyntaxError, IndexError, RecursionError):
    pass
with open(result_path, "w") as handle:
    json.dump({"metric": result, "pythonVersion": sys.version}, handle)
`

export async function scoreScienceAgentBenchWorkspace({ row, workspace, benchmarkRoot, outputRoot, python, visualJudge, timeoutMs, env = process.env }) {
  const id = safeId(row.instance_id)
  await plainPath(outputRoot, relative(outputRoot, workspace))
  const logs = join(outputRoot, 'scorer-logs')
  await mkdir(logs, { recursive: true })
  await separateRoots(benchmarkRoot, workspace)
  const stage = await mkdtemp(join(tmpdir(), 'sciforge-sab-score-'))
  const attempt = `${id}-${randomUUID()}`
  const stdoutLog = join(logs, `${attempt}.stdout.log`)
  const stderrLog = join(logs, `${attempt}.stderr.log`)
  let pythonVersion = null
  let stdout = '', stderr = '', executionStatus = 'completed', metric = { status: 'unparsed', score: null, reason: null }
  try {
    // Only copy data/artifacts, never Agent-generated Python into the evaluator directory.
    await copyPlainTree(await plainPath(workspace, 'benchmark/datasets'), join(stage, 'benchmark/datasets'))
    if (await exists(join(workspace, 'pred_results'))) await copyPlainTree(join(workspace, 'pred_results'), join(stage, 'pred_results'))
    if (!row.output_fname.startsWith('pred_results/')) await copyPlainTree(await plainPath(workspace, row.output_fname), inside(stage, row.output_fname))
    const evaluatorDirectory = join(stage, 'benchmark/eval_programs')
    await copyPlainTree(join(benchmarkRoot, 'eval_programs'), evaluatorDirectory)
    if (visualJudge) await copyPlainTree(visualJudge, join(evaluatorDirectory, 'gpt4_visual_judge.py'))
    const result = await execFileAsync(python, ['-c', scorerWrapper, inside(evaluatorDirectory, row.eval_script_name), join(stage, 'metric.json')], {
      cwd: stage, env: { ...env, PYTHONPATH: evaluatorDirectory }, timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024
    })
    stdout = result.stdout
    stderr = result.stderr
    const decoded = await readJson(join(stage, 'metric.json'))
    metric = decoded.metric
    pythonVersion = decoded.pythonVersion
  } catch (error) {
    executionStatus = error.killed ? 'timed-out' : 'failed'
    stdout = error.stdout ?? ''
    stderr = error.stderr || String(error)
  } finally {
    try {
      await Promise.all([
        writeFile(stdoutLog, stdout, { mode: 0o600 }),
        writeFile(stderrLog, stderr, { mode: 0o600 })
      ])
    } finally {
      // Reference material is not retained next to the Agent workspace or in run output.
      await rm(stage, { recursive: true, force: true })
    }
  }
  return { executionStatus, metric, pythonVersion, configuration: { python, visualJudge: visualJudge ?? null, timeoutMs }, stdoutLog, stderrLog }
}

export async function validateScorerConfiguration(config, env) {
  const result = await execFileAsync(config.python, ['--version'], { env, timeout: 5_000, maxBuffer: 4096 })
  if (!/^Python 3\./.test(result.stdout.trim() || result.stderr.trim())) throw new Error('SAB_PYTHON must be a Python 3 interpreter.')
  if (config.visualJudge && !(await lstat(config.visualJudge)).isFile()) throw new Error('SAB_VISUAL_JUDGE must be a regular file.')
}

export function scorerConfig(env) {
  return { python: env.SAB_PYTHON?.trim() || 'python3', visualJudge: env.SAB_VISUAL_JUDGE?.trim() || undefined,
    timeoutMs: positiveInteger(env.SAB_SCORER_TIMEOUT_MS, 'SAB_SCORER_TIMEOUT_MS', 120_000) }
}
