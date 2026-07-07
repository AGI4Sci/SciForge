import {
  normalizeRuntimeGuardSettings,
  type RuntimeGuardSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeGovernanceProfile,
  AgentRuntimeId,
  AgentRuntimeToolKind,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'

type RuntimeGovernanceControls = {
  governanceProfile?: AgentRuntimeGovernanceProfile
  steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void>
  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void>
  publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent | null>
}

type ToolStormState = {
  events: ToolFingerprint[]
  steered: Set<string>
  interrupted: Set<string>
  observedRunningToolIds: Set<string>
}

type ToolFingerprint = {
  exact: string
  family: string
}

export class RuntimeGovernanceSupervisor {
  private readonly toolStormStates = new Map<string, ToolStormState>()

  observe(
    event: AgentRuntimeEvent,
    capabilities: AgentRuntimeCapabilities,
    settings: RuntimeGuardSettingsV1,
    controls: RuntimeGovernanceControls
  ): void {
    if (event.kind !== 'tool_event' || event.status !== 'running') return
    if (capabilities.guard.toolStorm !== 'observe') return
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return
    if (!settings.toolStorm.enabled) return
    const key = `${capabilities.runtimeId}:${threadId}:${turnId}`
    const state = this.toolStormStates.get(key) ?? {
      events: [],
      steered: new Set(),
      interrupted: new Set(),
      observedRunningToolIds: new Set()
    }
    const runningToolId = runningToolIdentity(event)
    if (runningToolId && state.observedRunningToolIds.has(runningToolId)) {
      this.toolStormStates.set(key, state)
      return
    }
    if (runningToolId) state.observedRunningToolIds.add(runningToolId)
    const fingerprint = toolFingerprint(event)
    state.events.push(fingerprint)
    state.events = state.events.slice(-settings.toolStorm.windowSize)
    this.toolStormStates.set(key, state)

    const softThreshold = settings.toolStorm.threshold
    const hardThreshold = softThreshold + 1
    const exactCount = countMatches(state.events, 'exact', fingerprint.exact)
    const exactSteerKey = `exact:${fingerprint.exact}`
    const exactInterruptKey = `exact:${fingerprint.exact}`
    if (exactCount >= hardThreshold && !state.interrupted.has(exactInterruptKey)) {
      state.interrupted.add(exactInterruptKey)
      void controls.interruptTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        discard: false
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'hard', fingerprint.family)
      return
    }
    if (exactCount >= softThreshold && !state.steered.has(exactSteerKey)) {
      state.steered.add(exactSteerKey)
      void controls.steerTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        text: `Stop repeating the same ${fingerprint.family} tool call. Use the results already available and answer the user directly.`
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'soft', fingerprint.family)
    }
  }
}

export async function adapterCapabilities(
  adapter: AgentRuntimeAdapter,
  context: AgentRuntimeAdapterContext
): Promise<AgentRuntimeCapabilities> {
  return adapter.capabilities(context)
}

export function runtimeGuardSettings(context: AgentRuntimeAdapterContext): RuntimeGuardSettingsV1 {
  return normalizeRuntimeGuardSettings(context.settings.runtimeGuards)
}

function toolFingerprint(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): ToolFingerprint {
  const meta = recordValue(event.meta)
  const toolName = stringValue(meta.toolName) || event.summary?.trim() || event.toolKind || 'tool'
  const args = meta.arguments ?? argumentLikeMeta(meta)
  const kind = event.toolKind ?? 'tool_call'
  const family = behaviorFamily(toolName, kind, meta, event.detail)
  const exactArgs = exactArgumentsForFingerprint(args, event, toolName, meta)
  return {
    exact: `${kind}:${toolName}:${canonicalJson(exactArgs)}`,
    family: `${kind}:${family}`
  }
}

function exactArgumentsForFingerprint(
  args: unknown,
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  toolName: string,
  meta: Record<string, unknown>
): unknown {
  if (!isComputerUseTool(toolName, meta)) return args
  return {
    args,
    invocation: runningToolIdentity(event) || event.itemId || stringValue(meta.callId)
  }
}

function isComputerUseTool(toolName: string, meta: Record<string, unknown>): boolean {
  const normalizedName = toolName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const server = stringValue(meta.server).toLowerCase()
  return normalizedName === 'computer_use' ||
    normalizedName.endsWith('_computer_use') ||
    server === 'gui_owl_computer_use'
}

function behaviorFamily(
  toolName: string,
  kind: AgentRuntimeToolKind,
  meta: Record<string, unknown>,
  detail?: string
): string {
  if (kind === 'file_change') return 'file-change'
  const command = commandExecutionText(meta, detail)
  if (kind === 'command_execution') return commandFamily(command)
  const normalized = toolName.toLowerCase()
  if (/(search|grep|find|rg|query)/.test(normalized)) return 'search-read'
  if (/(read|open|cat|fetch|get|list)/.test(normalized)) return 'read'
  if (/(write|create|update|delete|patch|edit)/.test(normalized)) return 'write'
  return normalized || 'tool'
}

function commandExecutionText(meta: Record<string, unknown>, detail?: string): string {
  const command = stringValue(meta.command)
  const args = recordValue(meta.arguments)
  const argumentCommand = stringValue(args.cmd) || stringValue(args.command)
  const argumentArgs = firstStringArray(args.args, args.argv)
  const wrappedCommand = shellScriptFromCommandAndArgs(command || argumentCommand, argumentArgs)
  if (wrappedCommand) return wrappedCommand
  const wrappedArgumentCommand = shellScriptFromCommand(argumentCommand)
  if (wrappedArgumentCommand) return wrappedArgumentCommand
  const wrappedDetail = shellScriptFromCommand(detail?.trim() || '')
  if (wrappedDetail) return wrappedDetail
  return command || argumentCommand || detail?.trim() || ''
}

function commandFamily(command: string): string {
  const effectiveCommand = shellScriptFromCommand(command) || command
  const head = commandName(shellTokens(effectiveCommand)[0] || 'shell')
  if (head === 'date' || head === 'time') return 'shell/date'
  if (['cat', 'sed', 'head', 'tail', 'nl', 'less'].includes(head)) return 'shell/read-file'
  if (['rg', 'grep', 'find', 'fd'].includes(head)) return 'shell/search'
  if (['ls', 'pwd', 'stat'].includes(head)) return 'shell/list'
  if (['curl', 'wget'].includes(head)) return 'shell/fetch'
  return `shell/${head}`
}

function shellScriptFromCommandAndArgs(command: string, args: string[]): string {
  const tokens = shellTokens(command)
  if (!args.length) return shellScriptFromTokens(tokens)
  if (!tokens.length) return shellScriptFromTokens(args)
  return shellScriptFromTokens([...tokens, ...args])
}

function shellScriptFromCommand(command: string): string {
  return shellScriptFromTokens(shellTokens(command))
}

function shellScriptFromTokens(tokens: string[]): string {
  if (tokens.length < 2) return ''
  const shellIndex = shellExecutableIndex(tokens)
  if (shellIndex < 0) return ''
  for (let index = shellIndex + 1; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    if (token === '--') continue
    if (!token.startsWith('-')) break
    if (token === '-c' || /^-[^-]*c/.test(token)) return tokens[index + 1]?.trim() || ''
  }
  return ''
}

function shellExecutableIndex(tokens: string[]): number {
  if (isShellExecutable(tokens[0])) return 0
  if (commandName(tokens[0]) !== 'env') return -1
  return tokens.findIndex((token, index) =>
    index > 0 &&
    !token.startsWith('-') &&
    !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) &&
    isShellExecutable(token)
  )
}

function isShellExecutable(token: string | undefined): boolean {
  return ['sh', 'bash', 'zsh', 'dash', 'fish'].includes(commandName(token || ''))
}

function commandName(token: string): string {
  return token.trim().split(/[\\/]/).pop()?.toLowerCase() || 'shell'
}

function shellTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (escaped) current += '\\'
  if (current) tokens.push(current)
  return tokens
}

async function publishToolStormEvent(
  controls: RuntimeGovernanceControls,
  source: AgentRuntimeEvent,
  runtimeId: AgentRuntimeId,
  level: 'soft' | 'hard',
  family: string
): Promise<void> {
  await controls.publishSyntheticEvent({
    kind: 'runtime_status',
    threadId: source.threadId,
    runtimeId,
    turnId: source.turnId,
    phase: 'tool_running',
    message: level === 'hard'
      ? `Runtime guard interrupted repeated ${family} tool activity.`
      : `Runtime guard steered repeated ${family} tool activity.`,
    metadata: {
      synthetic: true,
      guard: 'toolStorm',
      level,
      family
    }
  })
  if (level === 'hard') {
    await controls.publishSyntheticEvent({
      kind: 'error',
      threadId: source.threadId,
      runtimeId,
      turnId: source.turnId,
      itemId: `runtime-guard-tool-storm-${source.turnId || source.threadId}`,
      recoverable: true,
      severity: 'error',
      code: 'runtime_tool_storm_interrupted',
      message: `Runtime guard stopped this turn after repeated ${family} tool activity.`,
      detail: `The runtime interrupted the turn to prevent a repeated tool-call loop. Tool family: ${family}.`
    })
  }
}

function countMatches<T extends keyof ToolFingerprint>(
  events: ToolFingerprint[],
  key: T,
  value: ToolFingerprint[T]
): number {
  return events.filter((event) => event[key] === value).length
}

function runningToolIdentity(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): string {
  const meta = recordValue(event.meta)
  const callId = stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    stringValue(meta.call_id) ||
    stringValue(meta.tool_call_id)
  if (callId) return `call:${callId}`
  const itemId = event.itemId.trim()
  if (!itemId || itemId === 'codex-local-shell-call' || itemId === 'codex-tool-output') return ''
  return `item:${itemId}`
}

function argumentLikeMeta(meta: Record<string, unknown>): unknown {
  return {
    command: meta.command,
    cwd: meta.cwd,
    filePath: meta.filePath,
    path: meta.path,
    query: meta.query
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter(Boolean)
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const strings = stringArrayValue(value)
    if (strings.length) return strings
  }
  return []
}
