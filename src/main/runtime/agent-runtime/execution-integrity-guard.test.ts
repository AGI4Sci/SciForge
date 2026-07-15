import { describe, expect, it } from 'vitest'

import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'
import {
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  RuntimeExecutionIntegrityGuard,
  withExecutionIntegrityRequirement
} from './execution-integrity-guard'
import {
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY,
  withVisualExecutionRequirement
} from './visual-execution-guard'

const RUNTIME_IDS: AgentRuntimeId[] = ['sciforge', 'codex', 'claude']
const ATTESTATION = `sha256:${'b'.repeat(64)}`

describe('RuntimeExecutionIntegrityGuard', () => {
  it.each(RUNTIME_IDS)('blocks a requested execution with no receipt for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.')
    const observation = guard.observe(runtimeId, completed(runtimeId))

    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(observation.violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      verdict: 'blocked',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it.each(RUNTIME_IDS)('blocks an open tool call for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Explain the result.')
    guard.observe(runtimeId, tool(runtimeId, 'requested'))

    expect(guard.observe(runtimeId, completed(runtimeId)).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: [`${runtimeId}-call`]
    })
  })

  it.each(RUNTIME_IDS)('accepts a correlated executor success receipt for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.')
    guard.observe(runtimeId, tool(runtimeId, 'requested'))
    guard.observe(runtimeId, tool(runtimeId, 'succeeded'))

    const observation = guard.observe(runtimeId, completed(runtimeId))
    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
    expect(observation.violation).toBeUndefined()
  })

  it('does not treat a failed executor receipt as successful execution', () => {
    const guard = rememberedGuard('codex', 'Run the unit tests.')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('does not use an unrelated read receipt to satisfy a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'read_file'
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('accepts a matching write receipt for a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'apply_patch',
      toolKind: 'file_change'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('marks an affirmative claim without a receipt as unverified', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.')
    guard.observe('claude', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'answer',
      text: 'I successfully ran the command and fixed the file.'
    })

    expect(guard.observe('claude', completed('claude')).violation).toMatchObject({
      code: 'runtime_execution_claim_unverified',
      verdict: 'unverified'
    })
  })

  it('does not use an unrelated read receipt to validate a claimed file edit', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.')
    guard.observe('claude', {
      ...tool('claude', 'succeeded'),
      toolName: 'read_file'
    })
    guard.observe('claude', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'answer',
      text: 'I successfully modified the file.'
    })

    expect(guard.observe('claude', completed('claude')).violation).toMatchObject({
      code: 'runtime_execution_claim_unverified',
      verdict: 'unverified'
    })
  })

  it('allows an ordinary text-only answer with no execution obligation', () => {
    const guard = rememberedGuard('codex', 'Explain what a receipt ledger is.')
    guard.observe('codex', {
      kind: 'assistant_delta',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'answer',
      text: 'A receipt ledger records authoritative lifecycle facts.'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('requires attested semantic evidence for a visual obligation', () => {
    const input = withVisualExecutionRequirement(baseInput('codex', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'gui_visual_capture',
      summary: 'gui_visual_capture',
      detail: JSON.stringify({ ok: true })
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_visual_execution_missing'
    })
  })

  it('accepts an attested semantic visual result', () => {
    const input = withVisualExecutionRequirement(baseInput('sciforge', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('sciforge', input, 'sciforge-thread', 'sciforge-turn')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      toolName: 'gui_visual_capture',
      summary: 'gui_visual_capture',
      detail: JSON.stringify({
        ok: true,
        inspection: { provider: 'model-router-vision', attestation: ATTESTATION }
      })
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('does not confuse child dispatch with child completion', () => {
    const guard = rememberedGuard('codex', 'Explain the task.')
    guard.observe('codex', childEvent('running'))
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['child:researcher']
    })
  })

  it('does not confuse an accepted asynchronous job with job completion', () => {
    const guard = rememberedGuard('sciforge', 'Submit the folding job.')
    guard.observe('sciforge', tool('sciforge', 'requested'))
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      meta: { output: { status: 'accepted', jobId: 'af3-job-1' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['sciforge-call']
    })
  })

  it('closes an asynchronous command launch when a later poll for the same session succeeds', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-1' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-poll',
      itemId: 'bash-poll',
      meta: { arguments: { action: 'poll', session_id: 'bash-session-1' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-poll',
      itemId: 'bash-poll-result',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'bash-session-1' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('closes an asynchronous command launch when its terminal poll reports failure', () => {
    const guard = rememberedGuard('sciforge', 'Explain the command result.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-2' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-poll',
      itemId: 'bash-poll',
      meta: { arguments: { action: 'poll', session_id: 'bash-session-2' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'failed'),
      callId: 'bash-poll',
      itemId: 'bash-poll-result',
      meta: { output: { status: 'completed', exit_code: 1, session_id: 'bash-session-2' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('keeps an asynchronous launch open when a session action returns a non-terminal receipt', () => {
    const guard = rememberedGuard('sciforge', 'Explain the command state.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-run',
      itemId: 'bash-run'
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-run',
      itemId: 'bash-run-result',
      meta: { output: { status: 'running', session_id: 'bash-session-3' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'requested'),
      callId: 'bash-write',
      itemId: 'bash-write',
      meta: { arguments: { action: 'write', session_id: 'bash-session-3' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'bash-write',
      itemId: 'bash-write-result',
      meta: { output: { status: 'running', exit_code: null, session_id: 'bash-session-3' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: expect.arrayContaining(['bash-run', 'bash-write'])
    })
  })

  it('reconstructs only marked policy turns during replay', () => {
    const guarded = withExecutionIntegrityRequirement(baseInput('claude', 'Run the checks.'))
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.observe('claude', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'user',
      text: guarded.text
    })
    expect(guard.observe('claude', completed('claude')).violation).toBeDefined()

    const oldHistory = new RuntimeExecutionIntegrityGuard()
    oldHistory.observe('claude', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-old-turn',
      itemId: 'old-user',
      text: 'Run the checks.'
    })
    expect(oldHistory.observe('claude', {
      ...completed('claude'),
      turnId: 'claude-old-turn'
    }).violation).toBeUndefined()
  })

  it('emits a replayed violation only once while keeping completion failed', () => {
    const guarded = withExecutionIntegrityRequirement(baseInput('codex', 'Run the checks.'))
    const guard = new RuntimeExecutionIntegrityGuard()
    const userEvent: AgentRuntimeEvent = {
      kind: 'user_message',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'user',
      text: guarded.text
    }
    guard.observe('codex', userEvent)
    expect(guard.observe('codex', completed('codex')).violation).toBeDefined()
    guard.observe('codex', userEvent)
    const replayed = guard.observe('codex', completed('codex'))
    expect(replayed.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(replayed.violation).toBeUndefined()
  })

  it('fails closed on conflicting terminal receipts for the same call', () => {
    const guard = rememberedGuard('codex', 'Run the checks.')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'succeeded'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('handles a bounded batch of concurrent receipts deterministically', () => {
    const guard = rememberedGuard('codex', 'Run the checks.')
    for (let index = 0; index < 100; index += 1) {
      const callId = `call-${index}`
      guard.observe('codex', { ...tool('codex', 'requested'), callId, itemId: callId })
    }
    for (let index = 99; index >= 0; index -= 1) {
      const callId = `call-${index}`
      guard.observe('codex', { ...tool('codex', 'succeeded'), callId, itemId: `${callId}-result` })
    }
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })
})

describe('execution integrity input policy', () => {
  it('detects direct Chinese execution requests without relying on ASCII word boundaries', () => {
    const input = baseInput('codex', '支持，帮我修改这个文件。')
    const guarded = withExecutionIntegrityRequirement(input)
    expect(guarded.text).toContain('"effectClass":"local_write"')
  })

  it('injects a replay marker for explicit execution while preserving display text', () => {
    const input = baseInput('codex', 'Run the unit tests.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('Runtime-enforced execution integrity gate:')
    expect(guarded.displayText).toBe(input.displayText)
    expect(guarded.metadata?.[EXECUTION_INTEGRITY_POLICY_METADATA_KEY]).toBe('execution-integrity.v1')
  })

  it('adds no prompt or metadata overhead to a text-only turn', () => {
    const input = baseInput('claude', 'Explain this algorithm.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toBe(input.text)
    expect(guarded).toEqual(input)
  })

  it('preserves the visual obligation in the unified policy', () => {
    const input = baseInput('sciforge', 'Inspect the layout.')
    input.metadata = { [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true }
    expect(withExecutionIntegrityRequirement(input).text).toContain('visual_inspection')
  })
})

function rememberedGuard(runtimeId: AgentRuntimeId, text: string): RuntimeExecutionIntegrityGuard {
  const guard = new RuntimeExecutionIntegrityGuard()
  guard.rememberTurn(runtimeId, withExecutionIntegrityRequirement(baseInput(runtimeId, text)), `${runtimeId}-thread`, `${runtimeId}-turn`)
  return guard
}

function baseInput(runtimeId: AgentRuntimeId, text: string): AgentRuntimeTurnStartInput {
  return {
    runtimeId,
    threadId: `${runtimeId}-thread`,
    text,
    displayText: text
  }
}

function completed(runtimeId: AgentRuntimeId): AgentRuntimeEvent {
  return {
    kind: 'turn_lifecycle',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    state: 'completed'
  }
}

function tool(
  runtimeId: AgentRuntimeId,
  phase: 'requested' | 'succeeded' | 'failed'
): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  return {
    kind: 'tool_event',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    itemId: `${runtimeId}-call`,
    callId: `${runtimeId}-call`,
    toolName: 'local_shell',
    status: phase === 'requested' ? 'running' : phase === 'succeeded' ? 'success' : 'error',
    phase,
    factSource: phase === 'requested' ? 'model_output' : 'executor_result',
    evidenceStrength: phase === 'requested' ? 'intent' : 'executor_receipt'
  }
}

function childEvent(status: 'running' | 'completed'): AgentRuntimeEvent {
  return {
    kind: 'child_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'codex-turn',
    child: {
      runtimeId: 'codex',
      parentThreadId: 'codex-thread',
      parentTurnId: 'codex-turn',
      id: 'researcher',
      kind: 'agent',
      status
    }
  }
}
