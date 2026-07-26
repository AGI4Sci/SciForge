import { describe, expect, it } from 'vitest'
import { createExecutionReceipt } from '@sciforge/execution-governance'

import type {
  AgentRuntimeCompletionReceipt,
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'
import {
  EXECUTION_INTENT_METADATA_KEY,
  EXECUTION_INTEGRITY_POLICY_METADATA_KEY,
  EXECUTION_OBLIGATIONS_METADATA_KEY,
  RuntimeExecutionIntegrityGuard,
  type ExecutionEffectClass,
  type ExecutionObligation,
  withExecutionIntegrityRequirement
} from './execution-integrity-guard'
import {
  VISUAL_EXECUTION_PLAN_METADATA_KEY,
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY,
  withVisualExecutionRequirement
} from './visual-execution-guard'

const RUNTIME_IDS: AgentRuntimeId[] = ['sciforge', 'codex', 'claude']
const ATTESTATION = `sha256:${'b'.repeat(64)}`

describe('RuntimeExecutionIntegrityGuard', () => {
  it.each(RUNTIME_IDS)('blocks a requested execution with no receipt for %s', (runtimeId) => {
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.', 'command_execution')
    const observation = guard.observe(runtimeId, completed(runtimeId))

    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(observation.violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      verdict: 'blocked',
      unsatisfiedObligationIds: ['requested-execution'],
      message: 'Completion rejected: unsatisfied requirements: requested-execution.'
    })
  })

  it('accepts a structured mutation obligation for a continuation turn', () => {
    const guard = new RuntimeExecutionIntegrityGuard()
    const input = intentInput('codex', 'Continue.', 'local_write')
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('adds only structured obligations when a user steers an active turn', () => {
    const guard = rememberedGuard('codex', 'Explain the current state.')
    guard.rememberSteer('codex', 'codex-thread', 'codex-turn', [obligation('local_write')])

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
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
    const guard = rememberedGuard(runtimeId, 'Run the unit tests.', 'command_execution')
    guard.observe(runtimeId, tool(runtimeId, 'requested'))
    guard.observe(runtimeId, tool(runtimeId, 'succeeded'))

    const observation = guard.observe(runtimeId, completed(runtimeId))
    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
    expect(observation.violation).toBeUndefined()
  })

  it('does not treat a failed executor receipt as successful execution', () => {
    const guard = rememberedGuard('codex', 'Run the unit tests.', 'command_execution')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('does not use an unrelated read receipt to satisfy a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.', 'local_write')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'read_file',
      meta: { effectClasses: ['read'] }
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('accepts a matching write receipt for a requested file modification', () => {
    const guard = rememberedGuard('codex', 'Modify the file and fix the bug.', 'local_write')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'apply_patch',
      toolKind: 'file_change'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it.each([
    ['Run the auto-fix command.', 'command_execution' as const, ['command_execution']],
    ['Run rm -f temp.txt.', 'local_write' as const, ['command_execution', 'local_write']],
    ['Delete temp.txt.', 'local_write' as const, ['command_execution', 'local_write']]
  ])('accepts declared effects proved by one command receipt: %s', (request, expectedEffect, effectClasses) => {
    const guard = rememberedGuard('codex', request, expectedEffect)
    const receipt = {
      ...tool('codex', 'succeeded'),
      toolKind: 'command_execution' as const,
      meta: { effectClasses }
    }
    guard.observe('codex', receipt)

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('does not infer obligations from affirmative assistant prose', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.')
    guard.observe('claude', {
      kind: 'assistant_delta',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'answer',
      text: 'I successfully ran the command and fixed the file.'
    })

    expect(guard.observe('claude', completed('claude')).violation).toBeUndefined()
  })

  it('uses structured obligations rather than assistant wording when validating effects', () => {
    const guard = rememberedGuard('claude', 'Summarize what happened.', 'local_write')
    guard.observe('claude', {
      ...tool('claude', 'succeeded'),
      toolName: 'read_file',
      meta: { effectClasses: ['read'] }
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
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
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

  it('does not promote visual claims from detail or structured output into completion receipts', () => {
    const input = withVisualExecutionRequirement(baseInput('codex', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'local_shell',
      detail: JSON.stringify({ completionReceipts: [semanticReceipt('visual.look', 'look-fake', 'codex-call')] }),
      meta: {
        output: {
          completionReceipts: [semanticReceipt('visual.look', 'look-fake', 'codex-call')]
        }
      }
    })

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_visual_execution_missing'
    })
  })

  it('accepts an out-of-band typed receipt from the exact native look tool', () => {
    const input = withVisualExecutionRequirement(baseInput('sciforge', 'Inspect the rendered image.'), true)
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('sciforge', input, 'sciforge-thread', 'sciforge-turn')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      toolName: 'sciforge_look',
      completionReceipts: [semanticReceipt('visual.look', 'look-native', 'sciforge-call')]
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('requires a linked look, capture, and final-look receipt chain', () => {
    const input = withVisualExecutionRequirement(
      baseInput('codex', '准确裁剪论文中的方法总览图'),
      true
    )
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', semanticTool(
      'codex',
      'look-locate-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-locate', 'look-locate-call')
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'capture-call',
      'sciforge_capture',
      semanticReceipt('visual.capture', 'capture', 'capture-call', ['look-locate'], [REGION_REF])
    ))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['visual-look-final']
    })

    const completedGuard = new RuntimeExecutionIntegrityGuard()
    completedGuard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    completedGuard.observe('codex', semanticTool(
      'codex',
      'look-locate-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-locate', 'look-locate-call')
    ))
    completedGuard.observe('codex', semanticTool(
      'codex',
      'capture-call',
      'sciforge_capture',
      semanticReceipt('visual.capture', 'capture', 'capture-call', ['look-locate'], [REGION_REF])
    ))
    completedGuard.observe('codex', semanticTool(
      'codex',
      'look-final-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-final', 'look-final-call', ['capture'])
    ))

    expect(completedGuard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('rejects a full-snapshot capture when an accurate region was requested', () => {
    const input = withVisualExecutionRequirement(
      baseInput('codex', '截取论文中的方法总览图'),
      true
    )
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', semanticTool(
      'codex',
      'look-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-region', 'look-call')
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'capture-call',
      'sciforge_capture',
      semanticReceipt('visual.capture', 'capture-full-page', 'capture-call', ['look-region'])
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'final-look-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-final-page', 'final-look-call', ['capture-full-page'])
    ))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['visual-capture', 'visual-look-final']
    })
  })

  it('allows a full-snapshot capture for an ordinary screenshot request', () => {
    const input = withVisualExecutionRequirement(
      baseInput('codex', 'Capture a screenshot of this page.'),
      true
    )
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', semanticTool(
      'codex',
      'look-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-page', 'look-call')
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'capture-call',
      'sciforge_capture',
      semanticReceipt('visual.capture', 'capture-page', 'capture-call', ['look-page'])
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'final-look-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-final-page', 'final-look-call', ['capture-page'])
    ))

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('rejects a native visual receipt whose parent chain is missing', () => {
    const input = withVisualExecutionRequirement(
      baseInput('codex', '把方法总览图裁剪出来'),
      true
    )
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', semanticTool(
      'codex',
      'look-call',
      'sciforge_look',
      semanticReceipt('visual.look', 'look-root', 'look-call')
    ))
    guard.observe('codex', semanticTool(
      'codex',
      'capture-call',
      'sciforge_capture',
      semanticReceipt('visual.capture', 'capture-unlinked', 'capture-call', [], [REGION_REF])
    ))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['visual-capture', 'visual-look-final']
    })
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
    const guard = rememberedGuard('sciforge', 'Submit the folding job.', 'external_mutation')
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
    const guard = rememberedGuard('sciforge', 'Run the checks.', 'command_execution')
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

  it('correlates a terminal poll across tool names by the shared async handle', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.', 'command_execution')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'launch',
      itemId: 'launch',
      toolName: 'exec_command',
      meta: { output: { status: 'running', session_id: 'session-a' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'poll',
      itemId: 'poll',
      toolName: 'write_stdin',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'session-a' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toBeUndefined()
  })

  it('does not correlate same-tool terminal receipts from different async handles', () => {
    const guard = rememberedGuard('sciforge', 'Run the checks.')
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'launch-a',
      itemId: 'launch-a',
      meta: { output: { status: 'running', session_id: 'session-a' } }
    })
    guard.observe('sciforge', {
      ...tool('sciforge', 'succeeded'),
      callId: 'terminal-b',
      itemId: 'terminal-b',
      meta: { output: { status: 'completed', exit_code: 0, session_id: 'session-b' } }
    })

    expect(guard.observe('sciforge', completed('sciforge')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      openCallIds: ['launch-a']
    })
  })

  it('reconstructs only marked policy turns during replay', () => {
    const guarded = intentInput('claude', 'Run the checks.', 'command_execution')
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
    const guarded = intentInput('codex', 'Run the checks.', 'command_execution')
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
    const guard = rememberedGuard('codex', 'Run the checks.', 'command_execution')
    guard.observe('codex', tool('codex', 'requested'))
    guard.observe('codex', tool('codex', 'succeeded'))
    guard.observe('codex', tool('codex', 'failed'))

    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      code: 'runtime_execution_incomplete',
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('handles a bounded batch of concurrent receipts deterministically', () => {
    const guard = rememberedGuard('codex', 'Run the checks.', 'command_execution')
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
  it.each([
    '支持，帮我修改这个文件。',
    'Run the unit tests.',
    '实现个性化肺癌 mRNA 疫苗从 0 到 1 的精准工程化突破。',
    '设计 mRNA 疫苗序列和器官芯片的关系是什么？',
    'Do not edit, but explain how the command works.'
  ])('never infers an execution obligation from natural-language text: %s', (text) => {
    const input = baseInput('codex', text)
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it('ignores historical prose stored under unrelated metadata', () => {
    const input = {
      ...baseInput('codex', '继续解释。'),
      metadata: {
        sciforgeDirectiveContinuityText: '实现系统。修改文件。运行测试。'
      }
    }
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it('does not create an obligation for a structured answer intent', () => {
    const input = {
      ...baseInput('codex', 'Explain the algorithm.'),
      executionIntent: { mode: 'answer' as const }
    }
    expect(withExecutionIntegrityRequirement(input)).toEqual(input)
  })

  it('creates an effect obligation from a structured execution intent', () => {
    const guarded = intentInput('codex', 'Please patch the module.', 'local_write')
    expect(guarded.text).toContain('"effectClass":"local_write"')
    expect(guarded.text).toContain('Runtime-enforced execution integrity gate:')
    expect(guarded.displayText).toBe('Please patch the module.')
    expect(guarded.metadata?.[EXECUTION_INTEGRITY_POLICY_METADATA_KEY]).toBe('execution-integrity.v3')
  })

  it('creates a generic success obligation from an inspect intent without requirements', () => {
    const input = baseInput('codex', 'Inspect the current file.')
    input.executionIntent = { mode: 'inspect' }
    const guarded = withExecutionIntegrityRequirement(input)
    expect(guarded.text).toContain('"kind":"any_success"')
    expect(guarded.text).not.toContain('"effectClass"')
  })

  it('accepts a trusted inspection success when no specific receipt type was requested', () => {
    const input = baseInput('codex', 'Inspect the current file.')
    input.executionIntent = { mode: 'inspect' }
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn('codex', input, 'codex-thread', 'codex-turn')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'semantic_observer',
      toolKind: 'tool_call'
    })

    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('supports typed tool and completion requirements', () => {
    const input = baseInput('codex', 'Run the checks.')
    input.executionIntent = {
      mode: 'execute',
      requirements: [{ toolNames: ['exec_command'], completion: 'terminal' }]
    }
    const guarded = withExecutionIntegrityRequirement(input)
    expect(guarded.text).toContain('"toolNames":["exec_command"]')
    expect(guarded.text).toContain('"completion":"terminal"')
  })

  it('accepts reference validation only as an explicit typed execution intent', () => {
    const input = baseInput('codex', 'Insert the prepared artifact.')
    input.executionIntent = {
      mode: 'execute',
      requirements: [{
        id: 'consumer-reference',
        receiptKind: 'artifact.reference-validation',
        completion: 'success'
      }]
    }

    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toContain('"receiptKind":"artifact.reference-validation"')
    expect(guarded.text).toContain('"id":"consumer-reference"')
  })

  it('keeps explicit obligation metadata backward compatible', () => {
    const input = baseInput('codex', 'Apply the prepared operation.')
    input.metadata = {
      [EXECUTION_OBLIGATIONS_METADATA_KEY]: [obligation('external_mutation')]
    }
    expect(withExecutionIntegrityRequirement(input).text).toContain('"effectClass":"external_mutation"')
  })

  it('applies the same generic success rule to structured intent metadata', () => {
    const input = baseInput('codex', 'Inspect the current file.')
    input.metadata = { [EXECUTION_INTENT_METADATA_KEY]: { mode: 'inspect' } }
    expect(withExecutionIntegrityRequirement(input).text).toContain('"kind":"any_success"')
  })

  it('requires declared receipt effects instead of guessing from tool names', () => {
    const guard = rememberedGuard('codex', 'Publish the release.', 'external_mutation')
    guard.observe('codex', { ...tool('codex', 'succeeded'), toolName: 'publish_release' })
    expect(guard.observe('codex', completed('codex')).violation).toMatchObject({
      unsatisfiedObligationIds: ['requested-execution']
    })
  })

  it('accepts an explicitly declared external mutation receipt', () => {
    const guard = rememberedGuard('codex', 'Publish the release.', 'external_mutation')
    guard.observe('codex', {
      ...tool('codex', 'succeeded'),
      toolName: 'provider_action',
      effects: ['external_mutation']
    })
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('accepts a trusted failed receipt for a terminal-only requirement', () => {
    const guard = new RuntimeExecutionIntegrityGuard()
    guard.rememberTurn(
      'codex',
      intentInput('codex', 'Run the tests and report the result.', 'command_execution', 'terminal'),
      'codex-thread',
      'codex-turn'
    )
    guard.observe('codex', tool('codex', 'failed'))
    expect(guard.observe('codex', completed('codex')).violation).toBeUndefined()
  })

  it('adds no prompt or metadata overhead to a text-only turn', () => {
    const input = baseInput('claude', 'Explain this algorithm.')
    const guarded = withExecutionIntegrityRequirement(input)

    expect(guarded.text).toBe(input.text)
    expect(guarded).toEqual(input)
  })

  it('preserves the visual obligation in the unified policy', () => {
    const input = baseInput('sciforge', 'Inspect the layout.')
    input.metadata = {
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true,
      [VISUAL_EXECUTION_PLAN_METADATA_KEY]: 'inspect'
    }
    expect(withExecutionIntegrityRequirement(input).text).toContain('"receiptKind":"visual.look"')
  })
})

function rememberedGuard(
  runtimeId: AgentRuntimeId,
  text: string,
  effectClass?: ExecutionEffectClass
): RuntimeExecutionIntegrityGuard {
  const guard = new RuntimeExecutionIntegrityGuard()
  const input = effectClass ? intentInput(runtimeId, text, effectClass) : baseInput(runtimeId, text)
  guard.rememberTurn(runtimeId, input, `${runtimeId}-thread`, `${runtimeId}-turn`)
  return guard
}

function intentInput(
  runtimeId: AgentRuntimeId,
  text: string,
  effectClass: ExecutionEffectClass,
  completion: 'terminal' | 'success' = 'success'
): AgentRuntimeTurnStartInput {
  const input = baseInput(runtimeId, text)
  input.executionIntent = {
    mode: 'execute',
    requirements: [{ effectClass, completion }]
  }
  return withExecutionIntegrityRequirement(input)
}

function obligation(effectClass: ExecutionEffectClass): ExecutionObligation {
  return {
    id: 'requested-execution',
    kind: 'effect',
    effectClass,
    completion: 'success',
    source: 'metadata'
  }
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
  const common = {
    kind: 'tool_event' as const,
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    itemId: `${runtimeId}-call`,
    callId: `${runtimeId}-call`,
    toolName: 'local_shell',
    toolKind: 'command_execution' as const
  }
  if (phase === 'requested') {
    return {
      ...common,
      status: 'running',
      phase,
      factSource: 'model_output',
      evidenceStrength: 'intent'
    }
  }
  if (phase === 'succeeded') {
    return {
      ...common,
      status: 'success',
      receipt: createExecutionReceipt({ status: 'success' }),
      phase,
      factSource: 'executor_result',
      evidenceStrength: 'executor_receipt'
    }
  }
  return {
    ...common,
    status: 'error',
    receipt: createExecutionReceipt({ status: 'error' }),
    phase,
    factSource: 'executor_result',
    evidenceStrength: 'executor_receipt'
  }
}

function semanticReceipt(
  kind: AgentRuntimeCompletionReceipt['kind'],
  id: string,
  callId: string,
  parents: string[] = [],
  relatedRefs: string[] = []
): AgentRuntimeCompletionReceipt {
  return {
    contractVersion: 'completion-receipt.v1',
    receiptId: `proof_${id}`,
    kind,
    status: 'satisfied',
    issuer: 'sciforge.agent-visual',
    callId,
    subjectRef: kind === 'visual.look' && id.includes('locate')
      ? 'res_source_abcdefghijklmnopqrstuvwxyz'
      : 'artifact_output_abcdefghijklmnopqrstuvwxyz',
    ...(relatedRefs.length ? { relatedRefs } : {}),
    ...(parents.length ? { parentReceiptIds: parents.map((parent) => `proof_${parent}`) } : {}),
    ...(kind === 'visual.look' ? { attestation: ATTESTATION } : {}),
    ...(kind === 'visual.capture' ? { sha256: 'c'.repeat(64) } : {}),
    createdAt: '2026-07-26T00:00:00.000Z'
  }
}

const REGION_REF = `region_${'r'.repeat(24)}`

function semanticTool(
  runtimeId: AgentRuntimeId,
  callId: string,
  toolName: 'sciforge_look' | 'sciforge_capture',
  completionReceipt: AgentRuntimeCompletionReceipt
): Extract<AgentRuntimeEvent, { kind: 'tool_event' }> {
  return {
    ...tool(runtimeId, 'succeeded'),
    itemId: callId,
    callId,
    toolName,
    toolKind: 'tool_call',
    effects: toolName === 'sciforge_capture' ? ['local_write'] : ['read'],
    completionReceipts: [completionReceipt]
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
