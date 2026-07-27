import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ExecutionGovernorCore } from '@sciforge/execution-governance'
import { atomicWriteFile } from '../../atomic-write-file'
import type {
  AgentRuntimeTurnGovernanceSnapshot,
  AgentRuntimeTurnGovernanceSnapshotInput
} from '../agent-runtime/adapter'

const SNAPSHOT_SCHEMA = 'sciforge.codex-pre-tool-use-governance.v2'

export const CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT_ENV =
  'SCIFORGE_CODEX_PRE_TOOL_USE_GOVERNANCE_STORAGE_ROOT'

export type CodexPreToolUseHookInput = {
  hook_event_name: 'PreToolUse'
  session_id?: string
  turn_id: string
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
  cwd?: string
}

export type CodexPreToolUseHookOutput = {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'deny'
    permissionDecisionReason: string
  }
}

type StoredCodexTurnGovernanceSnapshot = {
  schema: typeof SNAPSHOT_SCHEMA
  kind: 'turn_snapshot'
  runtimeId: 'codex'
  threadId: string
  turnId: string
  snapshot: AgentRuntimeTurnGovernanceSnapshot
}

type StoredCodexTurnGovernanceBinding = {
  schema: typeof SNAPSHOT_SCHEMA
  kind: 'turn_binding'
  runtimeId: 'codex'
  threadId: string
  turnId: string
  governanceTurnId: string
}

type StoredCodexSessionGovernanceSnapshotSeed = {
  schema: typeof SNAPSHOT_SCHEMA
  kind: 'session_snapshot'
  runtimeId: 'codex'
  sessionId: string
  snapshot: AgentRuntimeTurnGovernanceSnapshot
}

type StoredCodexSessionGovernanceBindingSeed = {
  schema: typeof SNAPSHOT_SCHEMA
  kind: 'session_binding'
  runtimeId: 'codex'
  sessionId: string
  governanceTurnId: string
}

type StoredCodexTurnGovernanceState =
  | StoredCodexTurnGovernanceSnapshot
  | StoredCodexTurnGovernanceBinding

type StoredCodexSessionGovernanceSeed =
  | StoredCodexSessionGovernanceSnapshotSeed
  | StoredCodexSessionGovernanceBindingSeed

export class CodexPreToolUseGovernanceBridge {
  readonly rootDir: string

  constructor(options: { storageRoot: string }) {
    this.rootDir = join(options.storageRoot, 'pre-tool-use-governance')
  }

  async updateSnapshot(input: AgentRuntimeTurnGovernanceSnapshotInput): Promise<void> {
    if (input.runtimeId !== 'codex') {
      throw new Error(`Codex governance bridge cannot store runtime ${input.runtimeId}.`)
    }
    const threadId = requiredIdentity(input.threadId, 'threadId')
    const turnId = requiredIdentity(input.turnId, 'turnId')
    const stored: StoredCodexTurnGovernanceSnapshot = {
      schema: SNAPSHOT_SCHEMA,
      kind: 'turn_snapshot',
      runtimeId: 'codex',
      threadId,
      turnId,
      snapshot: {
        ownedVisualToolsAvailable: input.snapshot.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending: input.snapshot.nativeVisualProofChainPending === true
      }
    }
    await atomicWriteFile(
      turnStatePath(this.rootDir, turnId),
      `${JSON.stringify(stored)}\n`
    )
  }

  async bindTurn(input: {
    threadId: string
    turnId: string
    sessionId: string
    governanceTurnId?: string
  }): Promise<void> {
    const threadId = requiredIdentity(input.threadId, 'threadId')
    const turnId = requiredIdentity(input.turnId, 'turnId')
    const sessionId = requiredIdentity(input.sessionId, 'sessionId')
    const governanceTurnId = input.governanceTurnId?.trim()
    const seed = await readSessionSeed(this.rootDir, sessionId)
    let stored: StoredCodexTurnGovernanceState
    if (governanceTurnId) {
      if (governanceTurnId === turnId) {
        throw new Error('Codex child governance binding cannot target itself.')
      }
      if (
        !seed ||
        seed.kind !== 'session_binding' ||
        seed.governanceTurnId !== governanceTurnId
      ) {
        throw new Error('Codex child turn governance does not match its pre-dispatch binding.')
      }
      await requiredGovernanceSnapshot(this.rootDir, governanceTurnId)
      stored = {
        schema: SNAPSHOT_SCHEMA,
        kind: 'turn_binding',
        runtimeId: 'codex',
        threadId,
        turnId,
        governanceTurnId
      }
    } else {
      if (!seed || seed.kind !== 'session_snapshot') {
        throw new Error('Codex turn governance requires its typed pre-dispatch session seed.')
      }
      stored = {
        schema: SNAPSHOT_SCHEMA,
        kind: 'turn_snapshot',
        runtimeId: 'codex',
        threadId,
        turnId,
        snapshot: seed.snapshot
      }
    }
    await atomicWriteFile(
      turnStatePath(this.rootDir, turnId),
      `${JSON.stringify(stored)}\n`
    )
  }

  async deleteTurnState(turnId: string): Promise<void> {
    const normalizedTurnId = turnId.trim()
    if (!normalizedTurnId) return
    await rm(turnStatePath(this.rootDir, normalizedTurnId), { force: true })
  }

  async seedSession(
    sessionId: string,
    snapshot: AgentRuntimeTurnGovernanceSnapshot
  ): Promise<void> {
    const normalizedSessionId = requiredIdentity(sessionId, 'sessionId')
    const stored: StoredCodexSessionGovernanceSnapshotSeed = {
      schema: SNAPSHOT_SCHEMA,
      kind: 'session_snapshot',
      runtimeId: 'codex',
      sessionId: normalizedSessionId,
      snapshot: {
        ownedVisualToolsAvailable: snapshot.ownedVisualToolsAvailable === true,
        nativeVisualProofChainPending: snapshot.nativeVisualProofChainPending === true
      }
    }
    await atomicWriteFile(
      sessionSeedPath(this.rootDir, normalizedSessionId),
      `${JSON.stringify(stored)}\n`
    )
  }

  async seedSessionForGovernanceTurn(
    sessionId: string,
    governanceTurnId: string
  ): Promise<void> {
    const normalizedSessionId = requiredIdentity(sessionId, 'sessionId')
    const normalizedGovernanceTurnId = requiredIdentity(
      governanceTurnId,
      'governanceTurnId'
    )
    await requiredGovernanceSnapshot(this.rootDir, normalizedGovernanceTurnId)
    const stored: StoredCodexSessionGovernanceBindingSeed = {
      schema: SNAPSHOT_SCHEMA,
      kind: 'session_binding',
      runtimeId: 'codex',
      sessionId: normalizedSessionId,
      governanceTurnId: normalizedGovernanceTurnId
    }
    await atomicWriteFile(
      sessionSeedPath(this.rootDir, normalizedSessionId),
      `${JSON.stringify(stored)}\n`
    )
  }

  async deleteSessionSeed(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) return
    await rm(sessionSeedPath(this.rootDir, normalizedSessionId), { force: true })
  }

  async evaluate(input: CodexPreToolUseHookInput): Promise<CodexPreToolUseHookOutput> {
    const stored = await readTurnState(this.rootDir, input.turn_id)
      ?? (input.session_id
        ? await readSessionSeed(this.rootDir, input.session_id)
        : null)
    if (!stored) {
      return codexPreToolUseFailureClosedOutput(
        'SciForge could not resolve the typed governance state for this Codex tool call.'
      )
    }
    const snapshot = stored.kind === 'turn_snapshot' || stored.kind === 'session_snapshot'
      ? stored.snapshot
      : (await requiredGovernanceSnapshot(
          this.rootDir,
          stored.governanceTurnId
        )).snapshot
    const workspace = input.cwd?.trim() || undefined
    const decision = new ExecutionGovernorCore({ workspace }).inspectAttempt({
      callId: input.tool_use_id,
      toolName: input.tool_name,
      arguments: input.tool_input
    }, {
      workspace,
      ownedVisualToolsAvailable: snapshot.ownedVisualToolsAvailable,
      nativeVisualProofChainPending: snapshot.nativeVisualProofChainPending
    })
    if (decision.action !== 'deny') return {}
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: [
          decision.code ? `${decision.code}:` : '',
          decision.reason,
          decision.guidance
        ].filter(Boolean).join(' ')
      }
    }
  }
}

export function codexPreToolUseFailureClosedOutput(
  reason: string
): CodexPreToolUseHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `native_visual_governance_unavailable: ${reason.trim() || 'Governance state is unavailable.'}`
    }
  }
}

export function parseCodexPreToolUseHookInput(value: unknown): CodexPreToolUseHookInput | null {
  const record = asRecord(value)
  if (!record || record.hook_event_name !== 'PreToolUse') return null
  const sessionId = nonEmptyString(record.session_id)
  const turnId = nonEmptyString(record.turn_id)
  const toolName = nonEmptyString(record.tool_name)
  const toolUseId = nonEmptyString(record.tool_use_id)
  const toolInput = asRecord(record.tool_input)
  const cwd = nonEmptyString(record.cwd)
  if (!turnId || !toolName || !toolUseId || !toolInput) return null
  return {
    hook_event_name: 'PreToolUse',
    ...(sessionId ? { session_id: sessionId } : {}),
    turn_id: turnId,
    tool_name: toolName,
    tool_use_id: toolUseId,
    tool_input: toolInput,
    ...(cwd ? { cwd } : {})
  }
}

async function readTurnState(
  rootDir: string,
  turnId: string
): Promise<StoredCodexTurnGovernanceState | null> {
  const normalizedTurnId = turnId.trim()
  if (!normalizedTurnId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(turnStatePath(rootDir, normalizedTurnId), 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
  const record = asRecord(parsed)
  const threadId = nonEmptyString(record?.threadId)
  if (
    record?.schema !== SNAPSHOT_SCHEMA ||
    record.runtimeId !== 'codex' ||
    record.turnId !== normalizedTurnId ||
    !threadId
  ) {
    throw new Error('Codex governance turn state is invalid.')
  }
  if (record.kind === 'turn_binding') {
    const governanceTurnId = nonEmptyString(record.governanceTurnId)
    if (!governanceTurnId || governanceTurnId === normalizedTurnId) {
      throw new Error('Codex governance turn binding is invalid.')
    }
    return {
      schema: SNAPSHOT_SCHEMA,
      kind: 'turn_binding',
      runtimeId: 'codex',
      threadId,
      turnId: normalizedTurnId,
      governanceTurnId
    }
  }
  const snapshot = asRecord(record.snapshot)
  if (
    record.kind !== 'turn_snapshot' ||
    typeof snapshot?.ownedVisualToolsAvailable !== 'boolean' ||
    typeof snapshot.nativeVisualProofChainPending !== 'boolean'
  ) {
    throw new Error('Codex governance turn snapshot is invalid.')
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    kind: 'turn_snapshot',
    runtimeId: 'codex',
    threadId,
    turnId: normalizedTurnId,
    snapshot: {
      ownedVisualToolsAvailable: snapshot.ownedVisualToolsAvailable,
      nativeVisualProofChainPending: snapshot.nativeVisualProofChainPending
    }
  }
}

async function readSessionSeed(
  rootDir: string,
  sessionId: string
): Promise<StoredCodexSessionGovernanceSeed | null> {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(
      await readFile(sessionSeedPath(rootDir, normalizedSessionId), 'utf8')
    )
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
  const record = asRecord(parsed)
  if (
    record?.schema !== SNAPSHOT_SCHEMA ||
    record.runtimeId !== 'codex' ||
    record.sessionId !== normalizedSessionId
  ) {
    throw new Error('Codex governance session seed is invalid.')
  }
  if (record.kind === 'session_binding') {
    const governanceTurnId = nonEmptyString(record.governanceTurnId)
    if (!governanceTurnId) {
      throw new Error('Codex governance session binding is invalid.')
    }
    return {
      schema: SNAPSHOT_SCHEMA,
      kind: 'session_binding',
      runtimeId: 'codex',
      sessionId: normalizedSessionId,
      governanceTurnId
    }
  }
  const snapshot = asRecord(record.snapshot)
  if (
    record.kind !== 'session_snapshot' ||
    typeof snapshot?.ownedVisualToolsAvailable !== 'boolean' ||
    typeof snapshot.nativeVisualProofChainPending !== 'boolean'
  ) {
    throw new Error('Codex governance session snapshot is invalid.')
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    kind: 'session_snapshot',
    runtimeId: 'codex',
    sessionId: normalizedSessionId,
    snapshot: {
      ownedVisualToolsAvailable: snapshot.ownedVisualToolsAvailable,
      nativeVisualProofChainPending: snapshot.nativeVisualProofChainPending
    }
  }
}

async function requiredGovernanceSnapshot(
  rootDir: string,
  turnId: string
): Promise<StoredCodexTurnGovernanceSnapshot> {
  const stored = await readTurnState(rootDir, turnId)
  if (!stored || stored.kind !== 'turn_snapshot') {
    throw new Error('Codex parent governance snapshot is unavailable.')
  }
  return stored
}

function turnStatePath(rootDir: string, turnId: string): string {
  return join(
    rootDir,
    `turn-${createHash('sha256').update(turnId, 'utf8').digest('hex')}.json`
  )
}

function sessionSeedPath(rootDir: string, sessionId: string): string {
  return join(
    rootDir,
    `session-${createHash('sha256').update(sessionId, 'utf8').digest('hex')}.json`
  )
}

function requiredIdentity(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Codex governance snapshot requires ${field}.`)
  return normalized
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isMissingFile(error: unknown): boolean {
  return String((error as { code?: unknown })?.code ?? '') === 'ENOENT'
}
