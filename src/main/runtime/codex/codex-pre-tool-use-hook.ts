import { randomUUID } from 'node:crypto'
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { join } from 'node:path'
import {
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  type ManagedGuiMcpLaunchConfig
} from '../../managed-gui-mcp-config'
import {
  CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV,
  codexPreToolUseFailureClosedOutput,
  type CodexPreToolUseHookInput,
  type CodexPreToolUseHookOutput
} from './codex-pre-tool-use-governance'

const CODEX_PRE_TOOL_USE_NODE_ENTRY =
  'out/main/codex-pre-tool-use-governance-node-entry.js'
const MAX_HOOK_PROCESS_OUTPUT_BYTES = 1024 * 1024
const CODEX_PRE_TOOL_USE_WORKER_TIMEOUT_MS = 4_000
const CODEX_PRE_TOOL_USE_PROBE_TIMEOUT_MS = 8_000
const CODEX_PRE_TOOL_USE_CHALLENGE_TOOL = 'sciforge_pre_tool_use_deny_challenge'
const CODEX_PRE_TOOL_USE_CHALLENGE_REASON = 'sciforge_hook_deny_challenge'

export const CODEX_PRE_TOOL_USE_WORKER_ARG = '--sciforge-governance-worker'

export type CodexPreToolUseHookDefinition = {
  sourcePath: string
  command: string
  commandWindows: string
}

export type CodexPreToolUseHookProbeResult = {
  denied: true
  reason: string
}

export function createCodexPreToolUseHookDefinition(options: {
  codexHome: string
  launch: ManagedGuiMcpLaunchConfig
}): CodexPreToolUseHookDefinition {
  const executable = resolveManagedGuiMcpCommand(options.launch)
  const entry = resolveManagedGuiMcpNodeEntryPath(
    options.launch,
    CODEX_PRE_TOOL_USE_NODE_ENTRY
  )
  const emergencyDenyJson = JSON.stringify(codexPreToolUseFailureClosedOutput(
    'SciForge hook launcher could not start.'
  ))
  return {
    sourcePath: join(options.codexHome, 'hooks.json'),
    command: [
      [
        'env',
        'ELECTRON_RUN_AS_NODE=1',
        shellQuote(executable),
        shellQuote(entry)
      ].join(' '),
      '||',
      `printf '%s\\n' ${shellQuote(emergencyDenyJson)}`
    ].join(' '),
    commandWindows: [
      `(set "ELECTRON_RUN_AS_NODE=1"&& ${windowsQuote(executable)} ${windowsQuote(entry)})`,
      '||',
      `echo ${emergencyDenyJson}`
    ].join(' ')
  }
}

export function codexPreToolUseHooksJson(
  definition: CodexPreToolUseHookDefinition
): string {
  return `${JSON.stringify({
    hooks: {
      PreToolUse: [{
        hooks: [{
          type: 'command',
          command: definition.command,
          commandWindows: definition.commandWindows,
          timeout: 10,
          async: false,
          statusMessage: 'Checking SciForge visual execution policy'
        }]
      }]
    }
  }, null, 2)}\n`
}

export async function superviseCodexPreToolUseWorker(options: {
  executablePath: string
  entryPath: string
  inputJson: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  spawnProcess?: typeof spawn
}): Promise<CodexPreToolUseHookOutput> {
  const result = await runBoundedProcess({
    command: options.executablePath,
    args: [options.entryPath, CODEX_PRE_TOOL_USE_WORKER_ARG],
    input: options.inputJson,
    env: {
      ...process.env,
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    timeoutMs: options.timeoutMs ?? CODEX_PRE_TOOL_USE_WORKER_TIMEOUT_MS,
    spawnProcess: options.spawnProcess
  })
  if (!result.ok) {
    return codexPreToolUseFailureClosedOutput(
      `SciForge governance worker failed: ${result.reason}`
    )
  }
  if (result.status !== 0) {
    return codexPreToolUseFailureClosedOutput(
      `SciForge governance worker exited with status ${result.status}.`
    )
  }
  const output = parseCodexPreToolUseHookOutput(result.stdout)
  if (!output) {
    return codexPreToolUseFailureClosedOutput(
      'SciForge governance worker returned invalid JSON.'
    )
  }
  return output
}

export async function probeCodexPreToolUseHook(options: {
  definition: CodexPreToolUseHookDefinition
  cwd: string
  storageRoot: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  timeoutMs?: number
  spawnProcess?: typeof spawn
}): Promise<CodexPreToolUseHookProbeResult> {
  const nonce = randomUUID()
  const input: CodexPreToolUseHookInput = {
    hook_event_name: 'PreToolUse',
    session_id: `sciforge-hook-probe-${nonce}`,
    turn_id: `sciforge-hook-probe-${nonce}`,
    tool_name: CODEX_PRE_TOOL_USE_CHALLENGE_TOOL,
    tool_use_id: `sciforge-hook-probe-${nonce}`,
    tool_input: { nonce },
    cwd: options.cwd
  }
  const platform = options.platform ?? process.platform
  const result = await runBoundedProcess({
    command: platform === 'win32'
      ? options.definition.commandWindows
      : options.definition.command,
    args: [],
    input: JSON.stringify(input),
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      [CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV]: options.storageRoot
    },
    shell: true,
    timeoutMs: options.timeoutMs ?? CODEX_PRE_TOOL_USE_PROBE_TIMEOUT_MS,
    spawnProcess: options.spawnProcess
  })
  if (!result.ok) {
    throw new Error(`SciForge Codex PreToolUse hook probe failed: ${result.reason}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `SciForge Codex PreToolUse hook probe exited with status ${result.status}.`
    )
  }
  const output = parseCodexPreToolUseHookOutput(result.stdout)
  const reason = output?.hookSpecificOutput?.permissionDecisionReason ?? ''
  const expectedReason = challengeReason(nonce)
  if (
    output?.hookSpecificOutput?.permissionDecision !== 'deny' ||
    reason !== expectedReason
  ) {
    throw new Error(
      'SciForge Codex PreToolUse hook probe did not return the exact deny challenge.'
    )
  }
  return { denied: true, reason }
}

export function codexPreToolUseChallengeOutput(
  input: CodexPreToolUseHookInput
): CodexPreToolUseHookOutput | null {
  if (
    input.tool_name !== CODEX_PRE_TOOL_USE_CHALLENGE_TOOL ||
    typeof input.tool_input.nonce !== 'string' ||
    !input.tool_input.nonce.trim()
  ) {
    return null
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: challengeReason(input.tool_input.nonce.trim())
    }
  }
}

export function parseCodexPreToolUseHookOutput(
  raw: string
): CodexPreToolUseHookOutput | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (Object.keys(parsed).length === 0) return {}
  const hookSpecificOutput = isRecord(parsed.hookSpecificOutput)
    ? parsed.hookSpecificOutput
    : null
  if (
    !hookSpecificOutput ||
    hookSpecificOutput.hookEventName !== 'PreToolUse' ||
    hookSpecificOutput.permissionDecision !== 'deny' ||
    typeof hookSpecificOutput.permissionDecisionReason !== 'string' ||
    !hookSpecificOutput.permissionDecisionReason.trim()
  ) {
    return null
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        hookSpecificOutput.permissionDecisionReason.trim()
    }
  }
}

type BoundedProcessResult =
  | {
      ok: true
      status: number | null
      stdout: string
      stderr: string
    }
  | {
      ok: false
      reason: string
    }

async function runBoundedProcess(options: {
  command: string
  args: string[]
  input: string
  cwd?: string
  env: NodeJS.ProcessEnv
  shell?: boolean
  timeoutMs: number
  spawnProcess?: typeof spawn
}): Promise<BoundedProcessResult> {
  const spawnProcess = options.spawnProcess ?? spawn
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawnProcess(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell === true,
      stdio: 'pipe',
      windowsHide: true
    } satisfies SpawnOptionsWithoutStdio)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
  return new Promise((resolve) => {
    let completed = false
    let failureReason = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const finish = (result: BoundedProcessResult): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      resolve(result)
    }
    const append = (
      chunk: Buffer | string,
      chunks: Buffer[],
      byteCount: number,
      label: string
    ): number => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const nextByteCount = byteCount + buffer.byteLength
      if (nextByteCount > MAX_HOOK_PROCESS_OUTPUT_BYTES && !failureReason) {
        failureReason = `${label} exceeded ${MAX_HOOK_PROCESS_OUTPUT_BYTES} bytes.`
        child.kill('SIGKILL')
        return nextByteCount
      }
      if (nextByteCount <= MAX_HOOK_PROCESS_OUTPUT_BYTES) chunks.push(buffer)
      return nextByteCount
    }
    const timer = setTimeout(() => {
      failureReason = `timed out after ${options.timeoutMs} ms.`
      child.kill('SIGKILL')
    }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBytes = append(chunk, stdout, stdoutBytes, 'stdout')
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBytes = append(chunk, stderr, stderrBytes, 'stderr')
    })
    child.once('error', (error) => {
      finish({ ok: false, reason: error.message })
    })
    child.once('close', (status) => {
      if (failureReason) {
        finish({ ok: false, reason: failureReason })
        return
      }
      finish({
        ok: true,
        status,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim()
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input)
  })
}

function challengeReason(nonce: string): string {
  return `${CODEX_PRE_TOOL_USE_CHALLENGE_REASON}:${nonce}`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

function windowsQuote(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
