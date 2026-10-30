import type { GitCheckpointVcsPort } from '../src/ports/vcs.js'

/**
 * Shared deterministic inputs and a scripted VCS port for parity and baseline
 * tests. Both the static capability handlers and the plugin operations run the
 * same scenarios over identical scripted behaviour, fixed clocks and id
 * sequences, so their outputs can be compared byte for byte.
 */

export const WORKSPACE = '/workspace/repository'
export const OTHER_WORKSPACE = '/workspace/other'

export type ScriptedVcsOptions = Readonly<{
  /** Snapshot ids that make restore throw a dirty-worktree error. */
  dirtyOnRestore?: readonly string[]
  /** Capture call ordinal (1-based) that fails with `capture_failed`. */
  failCaptureOnCall?: number
}>

export function scriptedVcs(options: ScriptedVcsOptions = {}): Readonly<{
  vcs: GitCheckpointVcsPort
  calls: string[]
}> {
  const calls: string[] = []
  let snapshot = 0
  const vcs: GitCheckpointVcsPort = {
    capture: async ({ workspaceRoot, snapshotName }) => {
      calls.push(`capture:${workspaceRoot}:${snapshotName}`)
      snapshot += 1
      if (options.failCaptureOnCall === snapshot) {
        throw Object.assign(new Error('capture failed'), { code: 'capture_failed' })
      }
      return {
        snapshotId: `snapshot-${snapshot}`,
        provider: 'git',
        revision: `revision-${snapshot}`,
        changeSummary: snapshot === 1 ? 'Clean workspace' : '1 change (modified: 1)'
      }
    },
    preview: async ({ workspaceRoot, snapshotId }) => {
      calls.push(`preview:${workspaceRoot}:${snapshotId}`)
      return {
        patch: `patch for ${snapshotId}`,
        truncated: false
      }
    },
    restore: async ({ workspaceRoot, snapshotId }) => {
      calls.push(`restore:${workspaceRoot}:${snapshotId}`)
      if (options.dirtyOnRestore?.includes(snapshotId)) {
        throw Object.assign(new Error('Working tree has changes.'), { code: 'dirty_worktree' })
      }
    }
  }
  return Object.freeze({ vcs, calls })
}

/** Deterministic clock: base instant plus one second per call. */
export function scriptedClock(baseIso = '2026-07-28T00:00:00.000Z'): () => Date {
  const base = new Date(baseIso).getTime()
  let tick = 0
  return () => new Date(base + ++tick * 1_000)
}

/** Deterministic ids: id-1, id-2, ... */
export function scriptedIds(): () => string {
  let id = 0
  return () => `id-${++id}`
}

export type ScenarioStep =
  | Readonly<{ op: 'create'; input: unknown; caller?: string }>
  | Readonly<{ op: 'list'; input: unknown; caller?: string }>
  | Readonly<{ op: 'preview'; input: unknown; caller?: string }>
  | Readonly<{ op: 'restore'; input: unknown; caller?: string }>

export function happyPathSteps(createdId: string): readonly ScenarioStep[] {
  return [
    { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', turnId: 'turn-1', workspaceRoot: WORKSPACE, phase: 'manual' } },
    { op: 'list', input: {} },
    { op: 'list', input: { threadId: 'thread-1' } },
    { op: 'preview', input: { checkpointId: createdId } },
    { op: 'restore', input: { checkpointId: createdId } },
    { op: 'list', input: {} }
  ]
}

export function rejectionSteps(createdId: string): readonly ScenarioStep[] {
  return [
    { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: WORKSPACE, phase: 'before-turn' } },
    { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: OTHER_WORKSPACE } },
    { op: 'create', input: { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: WORKSPACE, extra: true } },
    { op: 'list', input: { workspaceRoot: OTHER_WORKSPACE } },
    { op: 'list', input: { runtimeId: 42 } },
    { op: 'preview', input: { checkpointId: 'missing-checkpoint' } },
    { op: 'preview', input: { checkpointId: createdId }, caller: OTHER_WORKSPACE },
    { op: 'restore', input: { checkpointId: 'missing-checkpoint' } }
  ]
}
