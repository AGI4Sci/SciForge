import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { stableTimelineItems, deriveTurnSections, type TurnSections } from './derive-turn-sections'
import type { Turn } from './message-timeline-turns'

function processBlocks(result: TurnSections) {
  return result.timeline.flatMap((section) => section.kind === 'process' ? section.blocks : [])
}
function conversationBlocks(result: TurnSections) {
  return result.timeline.flatMap((section) => section.kind === 'conversation' ? [section.block] : [])
}

function sections(blocks: ChatBlock[]) {
  return deriveTurnSections({
    turn: { blocks } satisfies Turn,
    isProcessing: false,
    liveProcessText: '',
    liveContent: '',
    workspaceRoot: '/tmp'
  })
}

function processingSections(input: {
  blocks?: ChatBlock[]
  liveProcessText?: string
  liveContent?: string
}) {
  return deriveTurnSections({
    turn: { blocks: input.blocks ?? [] } satisfies Turn,
    isProcessing: true,
    liveProcessText: input.liveProcessText ?? '',
    liveContent: input.liveContent ?? '',
    workspaceRoot: '/tmp'
  })
}

describe('deriveTurnSections', () => {
  it('keeps additional user directives in the conversation stream', () => {
    const result = sections([
      { kind: 'assistant', id: 'answer', text: '先处理原始请求。' },
      { kind: 'user', id: 'directive-1', text: '请再核对生成的图片。' }
    ])

    expect(conversationBlocks(result)).toEqual([
      { kind: 'assistant', id: 'answer', text: '先处理原始请求。' },
      { kind: 'user', id: 'directive-1', text: '请再核对生成的图片。' }
    ])
  })

  it('shows only pending approvals and removes settled approval cards', () => {
    const result = sections([
      {
        kind: 'approval',
        id: 'approval-pending',
        approvalId: 'pending',
        summary: 'Pending approval',
        status: 'pending'
      },
      {
        kind: 'approval',
        id: 'approval-allowed',
        approvalId: 'allowed',
        summary: 'Allowed approval',
        status: 'allowed'
      },
      {
        kind: 'approval',
        id: 'approval-error',
        approvalId: 'error',
        summary: 'Failed approval',
        status: 'error'
      }
    ])

    expect(conversationBlocks(result)).toEqual([
      expect.objectContaining({ id: 'approval-pending', status: 'pending' })
    ])
  })

  it('renders the final assistant answer as content even when reasoning was persisted after it', () => {
    const result = sections([
      { kind: 'assistant', id: 'answer', text: '你好！' },
      { kind: 'reasoning', id: 'reasoning', text: 'The user greeted me.' }
    ])

    expect(conversationBlocks(result)).toEqual([
      { kind: 'assistant', id: 'answer', text: '你好！' }
    ])
    expect(processBlocks(result).map((block) => block.kind)).toEqual(['reasoning'])
  })

  it('uses the last assistant text as final content without duplicating it in process work', () => {
    const result = sections([
      { kind: 'assistant', id: 'preface', text: '我先检查一下。' },
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call'
      }
    ])

    expect(conversationBlocks(result)).toEqual([
      { kind: 'assistant', id: 'preface', text: '我先检查一下。' }
    ])
    expect(processBlocks(result).map((block) => block.kind)).toEqual(['tool'])
  })

  it('keeps intermediate assistant text in the completed process timeline', () => {
    const result = sections([
      { kind: 'assistant', id: 'intro', text: 'I found the likely cause.' },
      {
        kind: 'tool',
        id: 'tool_read',
        summary: 'read: source',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'read output'
      },
      {
        kind: 'assistant',
        id: 'analysis',
        text: [
          'Here is the detailed analysis:',
          '',
          '```txt',
          'command output line 1',
          'command output line 2',
          '```'
        ].join('\n')
      },
      {
        kind: 'tool',
        id: 'tool_issue',
        summary: 'web_fetch: issue',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'https://github.com/XingYu-Zhong/SciForge/issues/96'
      },
      { kind: 'assistant', id: 'next', text: 'The issue link above should still be visible.' }
    ])

    expect(conversationBlocks(result).map((block) => block.id)).toEqual([
      'next'
    ])
    expect(processBlocks(result).map((block) => block.id)).toEqual([
      'intro',
      'tool_read',
      'analysis',
      'tool_issue'
    ])
    expect(processBlocks(result).map((block) => 'text' in block ? block.text : '').join('\n\n')).toContain(
      'command output line 2'
    )
  })

  it('does not create assistant content from tool-only process work', () => {
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call'
      }
    ])

    expect(conversationBlocks(result)).toEqual([])
    expect(processBlocks(result).map((block) => block.kind)).toEqual(['tool'])
  })

  it('hides internal user-input tool calls while keeping the input card', () => {
    const result = processingSections({
      blocks: [
        {
          kind: 'tool',
          id: 'tool_input',
          summary: 'request_user_input: {"questions":[{"question":"Pick one"}]}',
          status: 'running',
          toolKind: 'tool_call',
          detail: '{"questions":[{"question":"Pick one"}]}',
          meta: { toolName: 'request_user_input' }
        },
        {
          kind: 'user_input',
          id: 'input_card',
          requestId: 'in_1',
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: '复现的粒度是什么？',
              options: [{ label: 'Demo', description: '小规模验证。' }]
            }
          ],
          status: 'pending'
        }
      ]
    })

    expect(processBlocks(result)).toEqual([])
    expect(conversationBlocks(result).map((block) => block.id)).toEqual(['input_card'])
  })

  it('dedupes repeated user-input cards by request id', () => {
    const questions = [
      {
        id: 'scope',
        header: 'Scope',
        question: '复现的粒度是什么？',
        options: [{ label: 'Demo', description: '小规模验证。' }]
      }
    ]
    const result = processingSections({
      blocks: [
        {
          kind: 'user_input',
          id: 'input_old',
          requestId: 'in_1',
          questions,
          status: 'pending'
        },
        {
          kind: 'user_input',
          id: 'input_new',
          requestId: 'in_1',
          questions,
          status: 'pending'
        }
      ]
    })

    expect(processBlocks(result)).toEqual([])
    expect(conversationBlocks(result).map((block) => block.id)).toEqual(['input_new'])
  })

  it('renders approval cards directly in the conversation instead of process work', () => {
    const result = processingSections({
      blocks: [
        {
          kind: 'approval',
          id: 'approval-card',
          approvalId: 'approval-1',
          summary: 'Run command?',
          toolName: 'command execution',
          status: 'pending'
        },
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'read',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(conversationBlocks(result).map((block) => block.id)).toEqual(['approval-card'])
    expect(processBlocks(result).map((block) => block.id)).toEqual(['tool_1'])
  })

  it('extracts file changes from JSON-wrapped tool output diffs', () => {
    const patch = [
      'diff --git a/demo.ts b/demo.ts',
      '--- a/demo.ts',
      '+++ b/demo.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new'
    ].join('\n')
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'Edit',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/demo.ts',
        detail: JSON.stringify({ path: '/tmp/demo.ts', diff: patch }, null, 2)
      }
    ])

    expect(result.turnFileChanges).toMatchObject([
      {
        id: 'tool_1',
        detail: patch,
        filePath: 'demo.ts'
      }
    ])
  })

  it('merges repeated file changes for the same displayed path', () => {
    const firstPatch = [
      'diff --git a/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md b/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '--- a/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '+++ b/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '@@ -1,1 +1,1 @@',
      '-old title',
      '+new title'
    ].join('\n')
    const secondPatch = [
      'diff --git a/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md b/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '--- a/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '+++ b/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      '@@ -4,1 +4,2 @@',
      ' context',
      '+new detail'
    ].join('\n')
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_first_edit',
        summary: 'Edit requirement',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
        detail: firstPatch
      },
      {
        kind: 'tool',
        id: 'tool_second_edit',
        summary: 'Edit requirement again',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
        detail: secondPatch
      }
    ])

    expect(result.turnFileChanges).toHaveLength(1)
    expect(result.turnFileChanges[0]).toMatchObject({
      id: 'tool_first_edit',
      filePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'
    })
    expect(result.turnFileChanges[0]?.detail).toContain('+new title')
    expect(result.turnFileChanges[0]?.detail).toContain('+new detail')
  })

  it('keeps live assistant output out of the active process timeline', () => {
    const result = processingSections({
      liveProcessText: 'private reasoning',
      liveContent: '这里是正在生成的回答。'
    })

    expect(conversationBlocks(result)).toEqual([])
    expect(processBlocks(result)).toEqual([
      { kind: 'reasoning', id: 'live-reasoning', text: 'private reasoning' }
    ])
  })

  it('attaches live reasoning metadata to the process block', () => {
    const result = deriveTurnSections({
      turn: { blocks: [] } satisfies Turn,
      isProcessing: true,
      liveProcessText: 'visible reasoning',
      liveProcessMeta: { reasoning: { visibility: 'trace', source: 'model' } },
      liveContent: '',
      workspaceRoot: '/tmp'
    })

    expect(processBlocks(result)).toEqual([
      {
        kind: 'reasoning',
        id: 'live-reasoning',
        text: 'visible reasoning',
        meta: { reasoning: { visibility: 'trace', source: 'model' } }
      }
    ])
  })

  it('keeps assistant content in chronological process order while a later tool is still running', () => {
    const result = processingSections({
      blocks: [
        { kind: 'assistant', id: 'answer', text: '先给你一部分结果。' },
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'read',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(conversationBlocks(result)).toEqual([])
    expect(processBlocks(result)).toEqual([
      { kind: 'assistant', id: 'answer', text: '先给你一部分结果。' },
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'running',
        toolKind: 'tool_call'
      }
    ])
  })

  it('places assistant output between process steps while processing', () => {
    const result = processingSections({
      blocks: [
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'read',
          status: 'success',
          toolKind: 'tool_call'
        },
        { kind: 'assistant', id: 'answer', text: '读完了，下一步继续查。' },
        {
          kind: 'tool',
          id: 'tool_2',
          summary: 'grep',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(conversationBlocks(result)).toEqual([])
    expect(processBlocks(result).map((block) => block.id)).toEqual(['tool_1', 'answer', 'tool_2'])
  })

  it('does not duplicate historical thinking when a live reasoning stream is active', () => {
    const result = processingSections({
      blocks: [
        { kind: 'assistant', id: 'assistant-1', text: 'hidden <thinking>first thought</thinking> shown answer' }
      ],
      liveProcessText: 'first thought'
    })

    expect(processBlocks(result).map((block) => block.id)).toEqual([
      'assistant-1', 'live-reasoning'
    ])
    expect(processBlocks(result)).not.toContainEqual(
      expect.objectContaining({ id: 'assistant-1-think' })
    )
  })
})


it.each([true, false])('keeps multiple questionnaires in their original order (processing: %s)', (isProcessing) => {
  const blocks: ChatBlock[] = [
    { kind: 'tool', id: 'before', summary: 'Before', status: 'success' },
    { kind: 'user_input', id: 'q1', requestId: 'r1', questions: [], status: 'submitted' },
    { kind: 'assistant', id: 'between', text: 'Continue after first answer' },
    { kind: 'tool', id: 'middle', summary: 'Between', status: 'success' },
    { kind: 'user_input', id: 'q2', requestId: 'r2', questions: [], status: isProcessing ? 'pending' : 'submitted' },
    { kind: 'assistant', id: 'after', text: 'Final response' }
  ]
  const result = deriveTurnSections({ turn: { blocks }, isProcessing, liveContent: '', liveProcessText: '', workspaceRoot: '/tmp' })
  expect(result.timeline.flatMap((section) => section.kind === 'process' ? section.blocks.map((block) => block.id) : [section.block.id]))
    .toEqual(['before', 'q1', 'between', 'middle', 'q2', 'after'])
})


it('replays updates at the first source position instead of moving them to the tail', () => {
  const initial: ChatBlock = { id: 'question', kind: 'user_input', requestId: 'request', questions: [], status: 'pending' }
  const following: ChatBlock = { id: 'following', kind: 'tool', summary: 'Later work', status: 'success' }
  const updated: ChatBlock = { ...initial, id: 'question-update', status: 'submitted' }
  expect(stableTimelineItems([initial, following, updated, { ...following, summary: 'Updated work' }]))
    .toEqual([updated, { ...following, summary: 'Updated work' }])
})
