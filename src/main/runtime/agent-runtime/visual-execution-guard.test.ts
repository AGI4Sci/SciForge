import { describe, expect, it } from 'vitest'
import { createExecutionReceipt } from '@sciforge/execution-governance'

import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'
import {
  requiresVerifiedVisualInspection,
  RuntimeVisualExecutionGuard,
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY,
  withVisualExecutionRequirement
} from './visual-execution-guard'

const RUNTIME_IDS: AgentRuntimeId[] = ['sciforge', 'codex', 'claude']
const ATTESTATION = `sha256:${'a'.repeat(64)}`

describe('RuntimeVisualExecutionGuard', () => {
  it.each(RUNTIME_IDS)('rejects unverified visual completion for %s', (runtimeId) => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.rememberTurn(runtimeId, requiredInput(runtimeId), `${runtimeId}-thread`, `${runtimeId}-turn`)

    const observation = guard.observe(runtimeId, completedEvent(runtimeId))

    expect(observation.event).toMatchObject({
      kind: 'turn_lifecycle',
      state: 'failed',
      message: expect.stringContaining('verified visual inspection did not execute')
    })
    expect(observation.violation).toMatchObject({ code: 'runtime_visual_execution_missing' })
  })

  it.each(RUNTIME_IDS)('accepts an attested semantic sciforge_invoke for %s', (runtimeId) => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.rememberTurn(runtimeId, requiredInput(runtimeId), `${runtimeId}-thread`, `${runtimeId}-turn`)
    guard.observe(runtimeId, attestedCaptureEvent(runtimeId))

    const observation = guard.observe(runtimeId, completedEvent(runtimeId))

    expect(observation.event).toMatchObject({ kind: 'turn_lifecycle', state: 'completed' })
    expect(observation.violation).toBeUndefined()
  })

  it('recognizes SciForge tool item snapshots as real execution evidence', () => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.rememberTurn('sciforge', requiredInput('sciforge'), 'sciforge-thread', 'sciforge-turn')
    guard.observe('sciforge', {
      kind: 'item_snapshot',
      runtimeId: 'sciforge',
      threadId: 'sciforge-thread',
      turnId: 'sciforge-turn',
      item: {
        id: 'capture-result',
        kind: 'tool',
        status: 'success',
        summary: 'sciforge_invoke',
        detail: JSON.stringify({
          ok: true,
          evidence: { provider: 'model-router', attestation: ATTESTATION }
        }),
        meta: { toolName: 'sciforge_invoke' }
      }
    })

    expect(guard.observe('sciforge', completedEvent('sciforge')).event).toMatchObject({
      kind: 'turn_lifecycle',
      state: 'completed'
    })
  })

  it('does not accept capture-only results or a hallucinated tool mention', () => {
    for (const evidence of [captureOnlyEvent(), reasoningOnlyEvent()]) {
      const guard = new RuntimeVisualExecutionGuard()
      guard.rememberTurn('codex', requiredInput('codex'), 'codex-thread', 'codex-turn')
      guard.observe('codex', evidence)

      expect(guard.observe('codex', completedEvent('codex')).event).toMatchObject({
        kind: 'turn_lifecycle',
        state: 'failed'
      })
    }
  })

  it('rejects native view_image as an unattested inspection side path', () => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.rememberTurn('codex', requiredInput('codex'), 'codex-thread', 'codex-turn')
    guard.observe('codex', {
      kind: 'tool_event',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'view-image-result',
      status: 'success',
      receipt: createExecutionReceipt({ status: 'success' }),
      meta: { toolName: 'view_image' }
    })

    expect(guard.observe('codex', completedEvent('codex')).event).toMatchObject({
      kind: 'turn_lifecycle',
      state: 'failed'
    })
  })

  it('requires a passing artifact review after a visual production route starts', () => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.rememberTurn('codex', requiredInput('codex'), 'codex-thread', 'codex-turn')
    guard.observe('codex', toolEvent('visual_generate', {
      ok: true,
      routeLocked: true,
      execution: { nextCall: { tool: 'image_generation_prepare' } }
    }))
    guard.observe('codex', toolEvent('view_image', { ok: true }))
    expect(guard.observe('codex', completedEvent('codex')).event).toMatchObject({ state: 'failed' })

    const reviewed = new RuntimeVisualExecutionGuard()
    reviewed.rememberTurn('codex', requiredInput('codex'), 'codex-thread', 'codex-turn')
    reviewed.observe('codex', toolEvent('scientific_plotting_render', { ok: true }))
    reviewed.observe('codex', toolEvent('visual_artifact_review', {
      ok: true,
      status: 'publication_ready',
      semantic: { pass: true }
    }))
    expect(reviewed.observe('codex', completedEvent('codex')).event).toMatchObject({ state: 'completed' })
  })

  it('does not accept a failed or needs-context artifact review', () => {
    for (const result of [
      { ok: false, status: 'review_failed' },
      { ok: true, status: 'needs_context' },
      { ok: true, status: 'repair_required', semantic: { pass: false } }
    ]) {
      const guard = new RuntimeVisualExecutionGuard()
      guard.rememberTurn('codex', requiredInput('codex'), 'codex-thread', 'codex-turn')
      guard.observe('codex', toolEvent('image_generation_render', { ok: true }))
      guard.observe('codex', toolEvent('visual_artifact_review', result))
      expect(guard.observe('codex', completedEvent('codex')).event).toMatchObject({ state: 'failed' })
    }
  })

  it('reconstructs the gate from replayed runtime events after a host restart', () => {
    const guard = new RuntimeVisualExecutionGuard()
    guard.observe('claude', {
      kind: 'user_message',
      runtimeId: 'claude',
      threadId: 'claude-thread',
      turnId: 'claude-turn',
      itemId: 'user-message',
      text: 'Runtime-enforced visual completion gate:\nCall sciforge_invoke.'
    })
    guard.observe('claude', attestedCaptureEvent('claude'))

    expect(guard.observe('claude', completedEvent('claude')).event).toMatchObject({
      kind: 'turn_lifecycle',
      state: 'completed'
    })
  })

  it('does not emit duplicate violations when a rejected turn is replayed again', () => {
    const guard = new RuntimeVisualExecutionGuard()
    const userMessage: AgentRuntimeEvent = {
      kind: 'user_message',
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'codex-turn',
      itemId: 'user-message',
      text: 'Runtime-enforced visual completion gate:\nCall sciforge_invoke.'
    }
    guard.observe('codex', userMessage)
    expect(guard.observe('codex', completedEvent('codex')).violation).toBeDefined()

    guard.observe('codex', userMessage)
    const replayed = guard.observe('codex', completedEvent('codex'))

    expect(replayed.event).toMatchObject({ kind: 'turn_lifecycle', state: 'failed' })
    expect(replayed.violation).toBeUndefined()
  })
})

describe('visual inspection request classification', () => {
  it('detects explicit Chinese and English visual QA requirements', () => {
    expect(requiresVerifiedVisualInspection('需要用视觉能力看一下排版后的表格图像，优化排版')).toBe(true)
    expect(requiresVerifiedVisualInspection('Visually inspect the rendered table and improve its layout.')).toBe(true)
  })

  it('does not turn visual-chain diagnostics into a new visual QA obligation', () => {
    expect(requiresVerifiedVisualInspection('只需要帮我排查视觉链路为什么失败')).toBe(false)
  })

  it('injects runtime-neutral instructions without changing display text', () => {
    const input: AgentRuntimeTurnStartInput = {
      runtimeId: 'claude',
      threadId: 'claude-thread',
      text: 'Inspect the final layout.',
      displayText: 'Inspect the final layout.'
    }

    const guarded = withVisualExecutionRequirement(input, true)

    expect(guarded.text).toContain('Runtime-enforced visual completion gate')
    expect(guarded.text).toContain('sciforge_invoke')
    expect(guarded.displayText).toBe(input.displayText)
    expect(guarded.metadata?.[VISUAL_EXECUTION_REQUIRED_METADATA_KEY]).toBe(true)
  })
})

function requiredInput(runtimeId: AgentRuntimeId): AgentRuntimeTurnStartInput {
  return {
    runtimeId,
    threadId: `${runtimeId}-thread`,
    text: 'Runtime-enforced visual completion gate',
    metadata: { [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true }
  }
}

function completedEvent(runtimeId: AgentRuntimeId): AgentRuntimeEvent {
  return {
    kind: 'turn_lifecycle',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    state: 'completed'
  }
}

function attestedCaptureEvent(runtimeId: AgentRuntimeId): AgentRuntimeEvent {
  const detail = JSON.stringify({
    ok: true,
    evidence: { provider: 'model-router', attestation: ATTESTATION }
  })
  return {
    kind: 'tool_event',
    runtimeId,
    threadId: `${runtimeId}-thread`,
    turnId: `${runtimeId}-turn`,
    itemId: `${runtimeId}-capture`,
    status: 'success',
    receipt: createExecutionReceipt({ status: 'success', detail }),
    summary: 'sciforge_invoke',
    detail,
    meta: { toolName: 'sciforge_invoke' }
  }
}

function captureOnlyEvent(): AgentRuntimeEvent {
  const detail = JSON.stringify({ ok: true })
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'codex-turn',
    itemId: 'capture-only',
    status: 'success',
    receipt: createExecutionReceipt({ status: 'success', detail }),
    summary: 'sciforge_invoke',
    detail,
    meta: { toolName: 'sciforge_invoke' }
  }
}

function reasoningOnlyEvent(): AgentRuntimeEvent {
  return {
    kind: 'reasoning_delta',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'codex-turn',
    itemId: 'reasoning',
    text: 'I used view_image and it returned nothing.',
    visibility: 'summary',
    source: 'runtime_summary'
  }
}

function toolEvent(toolName: string, detail: unknown): AgentRuntimeEvent {
  const serializedDetail = JSON.stringify(detail)
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'codex-thread',
    turnId: 'codex-turn',
    itemId: `${toolName}-result`,
    status: 'success',
    receipt: createExecutionReceipt({ status: 'success', detail: serializedDetail }),
    summary: toolName,
    detail: serializedDetail,
    meta: { toolName }
  }
}
