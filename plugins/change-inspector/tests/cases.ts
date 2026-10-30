import type { ChangeInspectorSessionDetail } from '../src/ports/agent-threads.js'

/**
 * Shared recorded-session corpus for the parity, baseline and unit tests.
 * Both the static capability handler and the plugin operation read the same
 * session details through the same fake port, so their observable outputs
 * (snapshot, resource id, rejections) can be compared byte for byte.
 *
 * The two giant sessions stay out of the golden baseline file (they would
 * bloat it); parity compares them in memory and the unit tests pin their
 * behaviour with literal expectations.
 */

export const WORKSPACE = '/workspace/repository'
export const OTHER_WORKSPACE = '/workspace/other'

const DIFF_A = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new'
const DIFF_B = '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-x\n+y'

export type ScenarioStep = Readonly<{
  input: unknown
  /** Defaults to WORKSPACE; pass '' to simulate a missing active workspace. */
  caller?: string
}>

/** Fresh copies on every call so scenario runs cannot mutate shared state. */
export function corpusSessions(): Record<string, ChangeInspectorSessionDetail> {
  return {
    'thread-plain-diff': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-7',
      artifacts: [{
        kind: 'tool',
        toolKind: 'file_change',
        id: 'art-1',
        status: 'success',
        createdAt: '2026-07-28T10:00:00+08:00',
        filePath: 'src/a.ts',
        detail: DIFF_A
      }]
    },
    'thread-json-keys': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-keys',
      artifacts: [
        { kind: 'tool', toolKind: 'file_change', id: 'k-diff', detail: JSON.stringify({ path: 'p1.ts', diff: DIFF_A }) },
        { kind: 'tool', toolKind: 'file_change', id: 'k-patch', detail: JSON.stringify({ filePath: 'p2.ts', patch: DIFF_B }) },
        { kind: 'tool', toolKind: 'file_change', id: 'k-ud', detail: JSON.stringify({ file_path: 'p3.ts', unified_diff: DIFF_A }) },
        { kind: 'tool', toolKind: 'file_change', id: 'k-uD', detail: JSON.stringify({ unifiedDiff: DIFF_B, filePath: 'p4.ts' }) }
      ]
    },
    'thread-nested-changes': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-nested',
      artifacts: [{
        kind: 'tool',
        toolKind: 'file_change',
        id: 'nest-1',
        filePath: 'fallback.ts',
        detail: JSON.stringify({
          changes: [
            { path: 'n1.ts', diff: DIFF_A },
            { changes: [{ file_path: 'n2.ts', unified_diff: DIFF_B }] },
            { patch: DIFF_A }
          ]
        })
      }]
    },
    'thread-ignored': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-ignored',
      artifacts: [
        { kind: 'tool', toolKind: 'read', id: 'ign-1', detail: DIFF_A },
        { kind: 'message', id: 'ign-2', detail: DIFF_A },
        'plain string artifact',
        null,
        42,
        { kind: 'tool', toolKind: 'file_change', id: 'ign-3', detail: { not: 'a string' } },
        { kind: 'tool', toolKind: 'file_change', id: 'ign-4', detail: '   ' },
        { kind: 'tool', toolKind: 'file_change', id: 'ign-5', detail: 'just some prose, not a diff' },
        { kind: 'tool', toolKind: 'file_change', id: 'ign-6', detail: '{"foo": "bar"}' }
      ]
    },
    'thread-status-dates': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-status',
      artifacts: [
        { kind: 'tool', toolKind: 'file_change', id: 'st-run', status: 'running', createdAt: '2026-07-28T10:00:00+08:00', detail: DIFF_A },
        { kind: 'tool', toolKind: 'file_change', id: 'st-err', status: 'error', createdAt: 'not-a-date', detail: DIFF_B },
        { kind: 'tool', toolKind: 'file_change', id: 'st-ok', status: 'success', createdAt: 123, detail: DIFF_A },
        { kind: 'tool', toolKind: 'file_change', id: 'st-weird', status: 'cancelled', detail: DIFF_B },
        { kind: 'tool', toolKind: 'file_change', id: 'st-none', detail: DIFF_A }
      ]
    },
    'thread-id-fallback': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-ids',
      artifacts: [
        { kind: 'tool', toolKind: 'file_change', detail: DIFF_A },
        {
          kind: 'tool',
          toolKind: 'file_change',
          id: 'multi',
          detail: JSON.stringify([
            { path: 'm1.ts', diff: DIFF_A },
            { filePath: 'm2.ts', patch: DIFF_B }
          ])
        }
      ]
    },
    'thread-turns': {
      workspaceRoot: WORKSPACE,
      watermark: 'wm-turns',
      artifacts: [],
      turns: [
        { id: 'turn-1', artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 't1-a', detail: DIFF_A }] },
        { id: 'turn-2', artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 't2-a', detail: DIFF_B }] }
      ]
    },
    'thread-foreign-workspace': {
      workspaceRoot: `${OTHER_WORKSPACE}/`,
      watermark: 'wm-foreign',
      artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 'fw-1', detail: DIFF_A }]
    },
    'thread-long-watermark': {
      workspaceRoot: WORKSPACE,
      watermark: 'w'.repeat(300),
      artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 'lw-1', detail: DIFF_A }]
    },
    'thread-empty-watermark': {
      workspaceRoot: WORKSPACE,
      watermark: '',
      artifacts: []
    },
    'thread-no-workspace': {
      watermark: 'wm-no-ws',
      artifacts: [{ kind: 'tool', toolKind: 'file_change', id: 'nw-1', detail: DIFF_A }]
    }
  }
}

/** >5000 changes: projection must truncate to the LAST 5000. */
export function manyChangesSession(count = 5_001): ChangeInspectorSessionDetail {
  return {
    workspaceRoot: WORKSPACE,
    watermark: 'wm-many',
    artifacts: Array.from({ length: count }, (_, index) => ({
      kind: 'tool',
      toolKind: 'file_change',
      id: `bulk-${index}`,
      detail: DIFF_A
    }))
  }
}

/** >2MB patch: projection must truncate to exactly 2,000,000 characters. */
export function hugePatchSession(): ChangeInspectorSessionDetail {
  return {
    workspaceRoot: WORKSPACE,
    watermark: 'wm-huge',
    artifacts: [{
      kind: 'tool',
      toolKind: 'file_change',
      id: 'huge-1',
      filePath: 'huge.ts',
      detail: `${DIFF_A}\n${'x'.repeat(2_000_001)}`
    }]
  }
}

export function corpusSteps(): readonly ScenarioStep[] {
  return [
    { input: { sessionId: 'thread-plain-diff', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-json-keys', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-nested-changes', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-ignored', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-status-dates', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-id-fallback', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-turns', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-long-watermark', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-empty-watermark', runtimeId: 'codex' } },
    { input: { sessionId: 'thread-no-workspace', runtimeId: 'codex' } }
  ]
}

export function rejectionSteps(): readonly ScenarioStep[] {
  return [
    // The session itself belongs to another workspace.
    { input: { sessionId: 'thread-foreign-workspace', runtimeId: 'codex' } },
    // The caller workspace does not match the session's workspace.
    { input: { sessionId: 'thread-plain-diff', runtimeId: 'codex' }, caller: OTHER_WORKSPACE },
    // No active workspace.
    { input: { sessionId: 'thread-plain-diff', runtimeId: 'codex' }, caller: '' },
    // Unknown session: the port read fails.
    { input: { sessionId: 'missing-thread', runtimeId: 'codex' } },
    // Contract violations.
    { input: { runtimeId: 'codex' } },
    { input: { sessionId: 42, runtimeId: 'codex' } },
    { input: { sessionId: 'thread-plain-diff', runtimeId: 'codex', extra: true } },
    { input: { sessionId: '', runtimeId: 'codex' } },
    { input: { sessionId: 'x'.repeat(257), runtimeId: 'codex' } }
  ]
}
