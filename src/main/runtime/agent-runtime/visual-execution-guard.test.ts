import { describe, expect, it } from 'vitest'

import type { AgentRuntimeTurnStartInput } from '../../../shared/agent-runtime-contract'
import {
  requiresVerifiedVisualInspection,
  VISUAL_EXECUTION_PLAN_METADATA_KEY,
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY,
  visualExecutionPlanForText,
  withVisualExecutionRequirement
} from './visual-execution-guard'

describe('visual execution request policy', () => {
  it('detects explicit Chinese and English visual inspection requirements', () => {
    expect(visualExecutionPlanForText('需要用视觉能力看一下排版后的表格图像，优化排版')).toBe('inspect')
    expect(visualExecutionPlanForText('Visually inspect the rendered table and improve its layout.')).toBe('inspect')
    expect(requiresVerifiedVisualInspection('Inspect the screenshot.')).toBe(true)
  })

  it.each([
    '准确截取论文中的方法总览图',
    '把图 2 摘录出来',
    '裁剪这个区域，不要整页',
    'Capture and crop the method overview figure.'
  ])('requires the locate, capture, and final-look chain for %s', (text) => {
    expect(visualExecutionPlanForText(text)).toBe('capture-region')
  })

  it.each([
    '把方法总览图截取并插入 Markdown 报告',
    '摘录这张图，写入文档',
    'Crop the figure and embed it in the report.'
  ])('does not invent an unsignable reference obligation from consumer prose: %s', (text) => {
    expect(visualExecutionPlanForText(text)).toBe('capture-region')
  })

  it.each([
    '给这个页面截图',
    'Capture a screenshot of this page.'
  ])('allows a full-snapshot capture for %s', (text) => {
    expect(visualExecutionPlanForText(text)).toBe('capture')
  })

  it('does not turn visual-chain diagnostics into a new visual obligation', () => {
    expect(visualExecutionPlanForText('只需要帮我排查视觉链路为什么失败')).toBeNull()
  })

  it('injects native visual instructions and a typed capture plan without changing display text', () => {
    const input: AgentRuntimeTurnStartInput = {
      runtimeId: 'claude',
      threadId: 'claude-thread',
      text: '把方法总览图截取并插入 Markdown 报告',
      displayText: '把方法总览图截取并插入 Markdown 报告'
    }

    const guarded = withVisualExecutionRequirement(input, true)

    expect(guarded.text).toContain('Runtime-enforced visual completion gate')
    expect(guarded.text).toContain('sciforge_look')
    expect(guarded.text).toContain('sciforge_capture')
    expect(guarded.text).not.toContain('typed artifact reference validation')
    expect(guarded.displayText).toBe(input.displayText)
    expect(guarded.metadata).toMatchObject({
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true,
      [VISUAL_EXECUTION_PLAN_METADATA_KEY]: 'capture-region'
    })
  })

  it('accepts capture-reference only as an explicit upstream plan', () => {
    const input: AgentRuntimeTurnStartInput = {
      runtimeId: 'claude',
      threadId: 'claude-thread',
      text: '把图片插入报告',
      metadata: {
        [VISUAL_EXECUTION_PLAN_METADATA_KEY]: 'capture-reference'
      }
    }

    const guarded = withVisualExecutionRequirement(input, false)

    expect(guarded.text).toContain('typed artifact reference validation')
    expect(guarded.metadata).toMatchObject({
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true,
      [VISUAL_EXECUTION_PLAN_METADATA_KEY]: 'capture-reference'
    })
  })
})
