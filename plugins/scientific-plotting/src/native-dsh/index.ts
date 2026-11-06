/**
 * Native DSH entrypoint. Workspace and authority come from the live caller,
 * never from model arguments or the SciForge iframe/runner protocol.
 * Service signatures verified against installed DSH 0.2.1-rc.4 public packages.
 */
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ToolRunContext, type ToolRuntime } from '@deepseek-ai/dsh-tools'

type Agent = NonNullable<ToolRunContext['agent']>
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Policy = Readonly<{ mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string; sessionId?: string }>
type ConfigInput = Readonly<{ pythonCommand?: string }>
type ReadResult = Readonly<{ text: string; lossy?: boolean }>
type ProcessHandle = Readonly<{
  done: Promise<{ exitCode: number | null; signal: string | null }>
  collected: { stdout?: { readFrom(offset: number): ReadResult }; stderr?: { readFrom(offset: number): ReadResult } }
  waitForExit(): Promise<void>
  terminate(): Promise<void>
}>
type NativeContext = Context & {
  tools: ToolRuntime
  commands: { register(definition: { name: string; description: string; input: { hint: string }; recordInput: boolean; handler(invocation: { agent: Agent; rawInput: string; signal: AbortSignal }): Promise<{ kind: 'success' | 'error'; text: string }> }): () => void }
  workingDirectory: { ensure(agent: Agent, signal: AbortSignal): Promise<string> }
  sandboxPolicy: { resolve(request: { session: Agent['session'] }): Policy }
  sandbox: { confine(argv: string[], policy: Policy, signal: AbortSignal): Promise<{ argv: string[]; enforcement: string }> }
  approval: { request(request: { agent: Agent; toolName: string; callId: ToolRunContext['callId']; reason: string; signal: AbortSignal }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> }
  subprocess: { spawn(request: {
    argv: string[]; cwd: string; stdio: { stdin: { data: string }; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number; signal: AbortSignal; env: Record<string, string>
  }): ProcessHandle }
}

export { getRendererContributions } from '../sciforge/contributions.js'

export const inject = ['tools', 'commands', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'approval', 'subprocess']
export const Config = z.object({ pythonCommand: z.string().default(process.env.SCIFORGE_PYTHON?.trim() || 'python3') })

const ACTIONS = ['status', 'list', 'read', 'importOriginal', 'importBaseline', 'addCandidate', 'saveAnnotations', 'rejectCandidate', 'image', 'render', 'acceptCandidate', 'saveCode', 'listCodes', 'readCode', 'listRuns', 'listPendingRuns', 'readRun', 'executePython', 'publishRun'] as const
type Action = typeof ACTIONS[number]
const TOOL_NAME = 'scientific_figures'

function objectInput(value: Json): Record<string, Json> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('Scientific Figures input must be a JSON object.')
  // Authority fields belong exclusively to the Host-to-worker envelope.
  const visit = (item: Json): void => {
    if (item === null || typeof item !== 'object') return
    if (Array.isArray(item)) { for (const child of item) visit(child); return }
    for (const [key, child] of Object.entries(item)) {
      if (key === 'workspaceRoot' || key === 'approvalGranted') throw new Error(`Caller-supplied authority field is forbidden: ${key}`)
      visit(child)
    }
  }
  visit(value)
  return value
}

function presentRunResponse(value: Json, workspaceRoot: string): Json {
  // Stored run references stay relative and immutable. Only response run records
  // receive the explicit base generic chat previews need to resolve outputs.
  const outputRoot = resolve(workspaceRoot, '.scientific-figures')
  const presentRun = (run: Json): Json => {
    if (!run || Array.isArray(run) || typeof run !== 'object' || typeof run.runId !== 'string' || !Array.isArray(run.outputs)) return run
    return { ...run, outputs: run.outputs.map(output => output && !Array.isArray(output) && typeof output === 'object' ? { ...output, workspaceRoot: outputRoot } : output) }
  }
  if (value && !Array.isArray(value) && typeof value === 'object' && Array.isArray(value.items)) return { ...value, items: value.items.map(presentRun) }
  if (value && typeof value === 'object' && 'completed' in value) {
    const completed = presentRun(value.completed)
    if (completed !== value.completed) return { ...value, completed }
  }
  return presentRun(value)
}

export function apply(ctx: NativeContext, config: ConfigInput = {}): void {
  const pythonCommand = config.pythonCommand?.trim() || process.env.SCIFORGE_PYTHON?.trim() || 'python3'
  // The bundled host entry lives beside the bundled worker, in dist/.
  const workerPath = fileURLToPath(new URL('./figure-worker.cjs', import.meta.url))

  async function worker(action: string, input: Record<string, Json>, workspaceRoot: string, agent: Agent, signal: AbortSignal, authority?: { approvalGranted?: true; confirmationId?: string; preflight?: Json; execution?: Json }): Promise<Json> {
    signal.throwIfAborted()
    const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
    const argv = [process.execPath, workerPath, '--stdio']
    const confined = await ctx.sandbox.confine(argv, policy.mode === 'danger-full-access' ? { ...policy, mode: 'workspace-write' } : policy, signal)
    signal.throwIfAborted()
    const handle = ctx.subprocess.spawn({
      argv: confined.argv, cwd: workspaceRoot, graceMs: 5000, signal,
      stdio: { stdin: { data: JSON.stringify({ action, input, workspaceRoot, pythonCommand, ...authority }) }, stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      env: { ELECTRON_RUN_AS_NODE: '1', PYTHONDONTWRITEBYTECODE: '1' },
    })
    try {
      const outcome = await handle.done
      await handle.terminate()
      await handle.waitForExit()
      signal.throwIfAborted()
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (outcome.exitCode !== 0) throw new Error(`Scientific Figures worker failed (${outcome.exitCode ?? outcome.signal ?? 'unknown'}): ${stderr?.text ?? ''}`)
      if (!stdout || stdout.lossy) throw new Error('Scientific Figures worker output is missing or exceeds its output bound.')
      const result: Json = JSON.parse(stdout.text)
      if (result !== null && !Array.isArray(result) && typeof result === 'object' && result.ok === false) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result))
      return presentRunResponse(result, workspaceRoot)
    } finally {
      await handle.terminate()
      await handle.waitForExit()
    }
  }

  async function executePython(input: Record<string, Json>, workspaceRoot: string, agent: Agent, signal: AbortSignal): Promise<Json> {
    const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
    if (policy.mode === 'read-only') throw new Error('Python runs require workspace-write permission.')
    const within = (child: string, parent: string) => { const p = relative(resolve(parent), resolve(child)); return p === '' || (!p.startsWith(`..${sep}`) && p !== '..' && !isAbsolute(p)) }
    if (within(workspaceRoot, tmpdir()) || within(workspaceRoot, '/tmp') || within(workspaceRoot, '/private/tmp') || within(workspaceRoot, '/private/var/folders')) throw new Error('Python execution requires a workspace outside platform temporary writable roots to protect stored revisions.')
    const preparation = await worker('preparePython', input, workspaceRoot, agent, signal) as any
    if (preparation.completed) return preparation.completed
    const prepared = preparation.prepared
    if (!prepared || !within(prepared.stageRoot, resolve(workspaceRoot, '.scientific-figures/.runs-temp')) || prepared.stageRoot === resolve(workspaceRoot, '.scientific-figures/.runs-temp')) throw new Error('Invalid Python staging root')
    if (preparation.recovery === true) {
      if (!preparation.outcome || preparation.outcome.quiescent === false) throw new Error('Interrupted run has no safely recoverable process outcome; inspect retained staging manually.')
      return worker('finalizePython', input, workspaceRoot, agent, signal, { execution: { prepared, outcome: preparation.outcome } })
    }
    const controller = new AbortController()
    const cancel = () => controller.abort(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
    let expired = false
    const timer = setTimeout(() => { expired = true; controller.abort(new Error('Python execution deadline exceeded')) }, Math.min(prepared.timeoutMs, 600_000))
    let handle: ProcessHandle | undefined
    async function stopRange(process: ProcessHandle): Promise<void> {
      let deadline: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([(async () => { await process.terminate(); await process.waitForExit() })(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Process range teardown timed out')), 5000) })]) }
      finally { if (deadline) clearTimeout(deadline) }
    }
    let outcome: Record<string, Json> = { exitCode: null, stdout: '', stderr: '', status: 'failed' }
    try {
      signal.throwIfAborted()
      const confined = await ctx.sandbox.confine(prepared.argv, { mode: 'workspace-write', workspaceRoot: prepared.stageRoot, sessionId: policy.sessionId }, controller.signal)
      if (confined.enforcement !== 'full') throw new Error('Python requires complete file-write confinement')
      handle = ctx.subprocess.spawn({ argv: confined.argv, cwd: prepared.cwd, stdio: { stdin: { data: '' }, stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 128 * 1024 } }, graceMs: 1000, signal: controller.signal, env: { ...prepared.env, PYTHONDONTWRITEBYTECODE: '1' } })
      const done = await handle.done
      outcome = { ...outcome, exitCode: done.exitCode }
      await stopRange(handle)
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      outcome = { exitCode: done.exitCode, stdout: stdout?.text ?? '', stderr: stderr?.text ?? '', stdoutTruncated: stdout?.lossy ?? false, stderrTruncated: stderr?.lossy ?? false,
        ...(controller.signal.aborted ? { status: signal.aborted ? 'cancelled' : 'failed', error: expired ? 'Python execution timed out' : 'Python execution cancelled' } : {}) }
    } catch (error) {
      outcome = { ...outcome, status: signal.aborted ? 'cancelled' : 'failed', error: expired ? 'Python execution timed out' : error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel)
      if (handle) {
        try { await stopRange(handle) }
        catch (error) { outcome = { ...outcome, status: 'failed', quiescent: false, error: `Python process range did not stop: ${String(error)}` } }
        try { const out = handle.collected.stdout?.readFrom(0), err = handle.collected.stderr?.readFrom(0); outcome = { ...outcome, stdout: out?.text ?? '', stderr: err?.text ?? '', stdoutTruncated: out?.lossy ?? false, stderrTruncated: err?.lossy ?? false } } catch { /* Preserve earlier outcome when provider collection itself fails. */ }
      }
    }
    // Persist cancellation/failure and cleanup using a fresh bounded signal; never publish on it.
    const finalizer = new AbortController()
    const finalTimer = setTimeout(() => finalizer.abort(), 60_000)
    try { return await worker('finalizePython', input, workspaceRoot, agent, finalizer.signal, { execution: { prepared, outcome } }) }
    finally { clearTimeout(finalTimer) }
  }

  async function renderTemplate(input: Record<string, Json>, workspaceRoot: string, agent: Agent, signal: AbortSignal): Promise<Json> {
    const key = createHash('sha256').update(String(input.documentId) + ':' + String(input.operationId)).digest('hex').slice(0, 32)
    const codeRevisionId = `template-${key}`, runId = `run-${key}`
    await worker('prepareTemplate', { ...input, codeRevisionId }, workspaceRoot, agent, signal)
    const run = await executePython({ runId, codeRevisionId }, workspaceRoot, agent, signal) as any
    if (run.status !== 'completed') throw new Error(`Template execution ${run.status}; inspect run ${runId}: ${run.error ?? run.stderr}`)
    const figures = run.outputs.filter((output: { path: string }) => output.path.toLowerCase().endsWith('.png'))
    if (figures.length !== 1) throw new Error('Template must produce exactly one PNG figure')
    return worker('publishRun', { ...input, runId, outputPath: figures[0].path }, workspaceRoot, agent, signal)
  }

  const dispose = ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: 'Manage Python code snapshots, immutable execution records, figures and reviews in the current workspace. saveCode takes codeRevisionId, parentCodeRevisionId, entrypoint, files:[{path,content}], parameters and inputPaths. executePython takes runId and codeRevisionId; scripts save PNG figures and bounded UTF-8 CSV/TSV/JSON/TXT analysis files under SCIENTIFIC_FIGURES_OUTPUT_DIR and read parameters/input directory from SCIENTIFIC_FIGURES_PARAMETERS_JSON/SCIENTIFIC_FIGURES_INPUT_DIR. Successful runs also include _environment requirements.txt, environment.json and REBUILD.md; package versions are exact pins rather than wheel hashes. Reuse an output as inputPaths with the workspace-relative .scientific-figures/<output.path>. publishRun takes runId, outputPath, documentId, operationId, expectedDocumentRevision and candidate baseline when updating. listCodes/listRuns accept {limit:1..50,cursor?} and return compact {items,nextCursor,errors} pages in descending ID order; readCode/readRun fully verify individual snapshots. listPendingRuns reports recoverable interrupted finalizations; executePython with the same IDs retries finalization only when an immutable process outcome exists; otherwise inspect retained staging manually without deleting locks or inferring a process result. Acceptance requires a separate one-shot DSH human approval; originals stay immutable. Never supply workspaceRoot or approvalGranted. Scripts execute with the calling session sandbox permissions.',
    parameters: { action: { type: 'string', enum: ACTIONS, required: true }, input: { type: 'json', required: true }, workspaceRoot: { type: 'string', description: 'Host-bound workspace; the host overrides any supplied value.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new Error('Scientific Figures requires a live calling DSH agent.')
      const input = objectInput(args.input)
      const workspaceRoot = await ctx.workingDirectory.ensure(agent, exec.signal)
      const action: Action = args.action as Action
      if (action === 'render') return renderTemplate(input, workspaceRoot, agent, exec.signal)
      if (action === 'executePython') return executePython(input, workspaceRoot, agent, exec.signal)
      if (action !== 'acceptCandidate') return worker(action, input, workspaceRoot, agent, exec.signal)

      const preflight = await worker('preflightAccept', input, workspaceRoot, agent, exec.signal)
      if (preflight !== null && !Array.isArray(preflight) && typeof preflight === 'object' && preflight.alreadyCompleted !== undefined) return preflight.alreadyCompleted
      const decision = await ctx.approval.request({ agent, toolName: TOOL_NAME, callId: exec.callId, reason: `Accept the reviewed scientific figure candidate in ${workspaceRoot}. Preflight: ${JSON.stringify(preflight)}`, signal: exec.signal })
      if (decision !== 'allowed-once') return { ok: false, status: 'cancelled', approval: decision, changed: false }
      exec.signal.throwIfAborted()
      if (await ctx.workingDirectory.ensure(agent, exec.signal) !== workspaceRoot) throw new Error('The current workspace changed during approval; candidate was not accepted.')
      // Worker must recheck the caller-supplied expected revision, baseline, and
      // candidate hash under its transaction lock immediately before publishing.
      return worker('acceptCandidate', input, workspaceRoot, agent, exec.signal, { approvalGranted: true, confirmationId: String(exec.callId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120), preflight })
    },
  }))
  const disposeCommand = ctx.commands.register({
    name: 'scientific-figures',
    description: 'Open and update scientific figures in the current session workspace.',
    input: { hint: 'JSON object with action and input' },
    recordInput: false,
    async handler(invocation) {
      try {
        const request: unknown = JSON.parse(invocation.rawInput)
        if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Scientific Figures command requires {action,input}.')
        const { action, input } = request as { action?: unknown; input?: unknown }
        if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) throw new Error('Unknown Scientific Figures action.')
        if (action === 'acceptCandidate') throw new Error('DSH human confirmation requires an active agent tool call. Ask in the conversation to run scientific_figures with action acceptCandidate for this candidate. An approval policy of never rejects acceptance without changing the document.')
        const parsed = objectInput(input as Json)
        const workspaceRoot = await ctx.workingDirectory.ensure(invocation.agent, invocation.signal)
        const result = action === 'executePython'
          ? await executePython(parsed, workspaceRoot, invocation.agent, invocation.signal)
          : action === 'render' ? await renderTemplate(parsed, workspaceRoot, invocation.agent, invocation.signal)
          : await worker(action, parsed, workspaceRoot, invocation.agent, invocation.signal)
        return { kind: 'success', text: JSON.stringify(result) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  ctx.effect(() => () => { disposeCommand(); dispose() })
}
