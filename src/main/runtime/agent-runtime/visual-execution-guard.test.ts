import { describe, expect, it } from 'vitest'

import type { AgentRuntimeTurnStartInput } from '../../../shared/agent-runtime-contract'
import { withVisualExecutionRequirement } from './visual-execution-guard'

describe('visual execution request policy', () => {
  it('does not infer a visual requirement from task prose', () => {
    const input = baseInput('准确截取论文中的方法总览图')

    expect(withVisualExecutionRequirement(input)).toEqual(input)
  })

  it('injects region-capture guidance from typed receipt requirements', () => {
    const input = baseInput('按照任务模板生成报告')
    input.executionIntent = {
      mode: 'execute',
      requirements: [
        {
          id: 'visual-look-locate',
          receiptKind: 'visual.look'
        },
        {
          id: 'visual-capture',
          receiptKind: 'visual.capture',
          requiresRegionRef: true,
          dependsOn: ['visual-look-locate']
        },
        {
          id: 'visual-look-final',
          receiptKind: 'visual.look',
          dependsOn: ['visual-capture']
        }
      ]
    }

    const guarded = withVisualExecutionRequirement(input)

    expect(guarded.text).toContain('Runtime-enforced visual completion gate')
    expect(guarded.text).toContain('sciforge_look')
    expect(guarded.text).toContain('sciforge_capture')
    expect(guarded.text).toContain('Persist the located region, not the full snapshot')
    expect(guarded.displayText).toBe(input.displayText)
    expect(guarded.metadata).toBeUndefined()
    expect(guarded.executionIntent).toEqual(input.executionIntent)
  })

  it('adds reference guidance only for a typed consumer receipt', () => {
    const input = baseInput('Apply the prepared task template.')
    input.executionIntent = {
      mode: 'execute',
      requirements: [
        { id: 'visual-look-locate', receiptKind: 'visual.look' },
        {
          id: 'visual-capture',
          receiptKind: 'visual.capture',
          dependsOn: ['visual-look-locate']
        },
        {
          id: 'visual-look-final',
          receiptKind: 'visual.look',
          dependsOn: ['visual-capture']
        },
        {
          id: 'consumer-reference',
          receiptKind: 'artifact.reference-validation',
          dependsOn: ['visual-look-final']
        }
      ]
    }

    expect(withVisualExecutionRequirement(input).text)
      .toContain('typed artifact reference validation')
  })

  it('does not add visual guidance for unrelated typed execution requirements', () => {
    const input = baseInput('Write the result.')
    input.executionIntent = {
      mode: 'execute',
      requirements: [{ effectClass: 'local_write' }]
    }

    expect(withVisualExecutionRequirement(input)).toEqual(input)
  })

  it('does not execute requirements attached to an answer-only intent', () => {
    const input = baseInput('Explain the planned visual workflow.')
    input.executionIntent = {
      mode: 'answer',
      requirements: [{ receiptKind: 'visual.look' }]
    }

    expect(withVisualExecutionRequirement(input)).toEqual(input)
  })
})

function baseInput(text: string): AgentRuntimeTurnStartInput {
  return {
    runtimeId: 'codex',
    threadId: 'codex-thread',
    text,
    displayText: text
  }
}
