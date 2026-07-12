import { describe, expect, it } from 'vitest'
import {
  ReviewOutputSchema,
  StartReviewRequest,
  TurnItem
} from '../src/contracts/index.js'
import { parseReviewOutput, renderReviewOutput } from '../src/review/review-output.js'
import { resolveReviewTargetPrompt } from '../src/review/git-review-target.js'
import { SCIFORGE_RUNTIME_REVIEW_PROMPT } from '../src/review/review-prompt.js'
import { SCIFORGE_RUNTIME_SYSTEM_PROMPT } from '../src/prompt/kun-system-prompt.js'

describe('review contracts', () => {
  it('accepts review start requests and persisted review items', () => {
    const request = StartReviewRequest.parse({
      target: { kind: 'baseBranch', branch: 'main' }
    })
    expect(request.target).toEqual({ kind: 'baseBranch', branch: 'main' })
    expect(StartReviewRequest.safeParse({
      target: { kind: 'baseBranch', branch: 'main' },
      model: 'deepseek-chat'
    }).success).toBe(false)

    const item = TurnItem.parse({
      id: 'item_review_1',
      turnId: 'turn_1',
      threadId: 'thr_1',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-06-04T00:00:00.000Z',
      finishedAt: '2026-06-04T00:00:01.000Z',
      kind: 'review',
      title: 'Review current changes',
      target: { kind: 'uncommittedChanges' },
      reviewText: 'No review findings.',
      output: {
        findings: [],
        overallCorrectness: 'patch is correct',
        overallExplanation: 'No blocking issues found.',
        overallConfidenceScore: 0.8
      }
    })
    expect(item.kind).toBe('review')
  })
})

describe('review output parsing', () => {
  it('parses Codex-style snake_case JSON and renders review text', () => {
    const output = parseReviewOutput(JSON.stringify({
      findings: [{
        title: '[P1] Missing bounds check',
        body: 'The new index can exceed the array length.',
        confidence_score: 0.9,
        priority: 1,
        code_location: {
          absolute_file_path: '/tmp/project/src/a.ts',
          line_range: { start: 10, end: 10 }
        }
      }],
      overall_correctness: 'patch is incorrect',
      overall_explanation: 'One correctness bug should be fixed.',
      overall_confidence_score: 0.85
    }))

    expect(ReviewOutputSchema.parse(output).findings).toHaveLength(1)
    expect(renderReviewOutput(output)).toContain('/tmp/project/src/a.ts:10-10')
  })

  it.each([
    ['', 'an empty response'],
    ['No obvious issues.', 'prose'],
    ['{}', 'JSON without an explicit correctness judgement']
  ])('fails closed for %s (%s)', (rawText) => {
    expect(() => parseReviewOutput(rawText)).toThrow(
      'Review inconclusive: reviewer did not return valid structured JSON.'
    )
  })
})

describe('review tool-use guidance', () => {
  it('stops inspection when evidence is sufficient and batches independent reads', () => {
    expect(SCIFORGE_RUNTIME_REVIEW_PROMPT).toContain(
      'As soon as the evidence is sufficient, stop using tools'
    )
    expect(SCIFORGE_RUNTIME_REVIEW_PROMPT).toContain(
      'request them together in one response'
    )
    expect(SCIFORGE_RUNTIME_REVIEW_PROMPT).toContain(
      'Do not reread equivalent content'
    )
  })

  it('applies evidence-sensitive tool use to explanation and review requests', () => {
    expect(SCIFORGE_RUNTIME_SYSTEM_PROMPT).toContain(
      'For explanation, analysis, and review requests, inspect only the evidence needed to answer'
    )
    expect(SCIFORGE_RUNTIME_SYSTEM_PROMPT).toContain(
      'request them together in one response'
    )
    expect(SCIFORGE_RUNTIME_SYSTEM_PROMPT).toContain(
      'Do not reread equivalent content'
    )
  })

  it('advertises the in-process apply_patch capability without shell probing', () => {
    expect(SCIFORGE_RUNTIME_SYSTEM_PROMPT).toContain(
      '`edit`/`apply_patch`/`write` for file mutations'
    )
    expect(SCIFORGE_RUNTIME_SYSTEM_PROMPT).toContain(
      'never probe for or invoke a shell `apply_patch`/`patch` binary'
    )
  })
})

describe('review target prompt resolution', () => {
  it('resolves custom review instructions without requiring a git workspace', async () => {
    const resolved = await resolveReviewTargetPrompt({
      target: { kind: 'custom', instructions: 'Review src/auth.ts for regressions.' },
      workspace: '/tmp/not-a-git-workspace'
    })

    expect(resolved.title).toBe('Custom code review')
    expect(resolved.prompt).toContain('Review src/auth.ts for regressions.')
  })
})
