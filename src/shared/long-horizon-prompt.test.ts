import { describe, expect, it } from 'vitest'

import {
  LONG_HORIZON_MAX_CLARIFYING_QUESTIONS,
  LONG_HORIZON_PROMPT_SCHEMA_VERSION,
  analyzeLongHorizonPrompt,
  buildLongHorizonPrompt,
  maybeBuildLongHorizonPrompt
} from './long-horizon-prompt'

const taskPrompts = [
  'Build a settings page module for API key rotation with acceptance tests and no changes to existing login behavior.',
  'Fix the file upload retry workflow in the chat composer; success means failed uploads can be retried without duplicate attachments.',
  'Refactor the model picker component to support grouped providers while preserving keyboard navigation.',
  'Design and implement a database migration for archived sessions with rollback instructions and verification queries.',
  'Analyze the current CI failures, patch the root cause, and verify the targeted test suite passes.',
  'Create a documentation page for workspace onboarding including constraints, examples, and acceptance criteria.',
  'Implement a background sync pipeline for research memories with clear non-goals and smoke tests.',
  'Review the uncommitted changes for regressions, risk, and missing tests; output findings with file references.',
  'Migrate the image generation adapter to a new endpoint without changing the public renderer API.',
  'Write tests for the goal resume scheduler so the success criteria cover paused, blocked, and complete states.'
]

describe('plan mode prompt builder', () => {
  it('builds structured plan-mode prompts for ten different task shapes', () => {
    for (const userPrompt of taskPrompts) {
      const result = buildLongHorizonPrompt({
        userPrompt,
        mode: 'agent',
        workspaceRoot: 'D:/Project/SciForge',
        attachments: [{ name: 'design-notes.md', kind: 'text/markdown' }],
        fileReferences: [{ relativePath: 'src/example.ts', kind: 'file' }]
      })

      expect(result.text).toContain('# Plan Mode Prompt')
      expect(result.text).toContain(LONG_HORIZON_PROMPT_SCHEMA_VERSION)
      expect(result.text).toContain('<plan_mode_contract>')
      expect(result.text).toContain('<user_request>')
      expect(result.text).toContain(userPrompt)
      expect(result.text).toContain('## Acceptance Criteria')
      expect(result.text).toContain('The approved plan directly addresses the original user request.')
      expect(result.text).toContain('Do not implement')
      expect(result.text).toContain('request_user_input')
      expect(result.text).toContain('create_plan')
      expect(result.text).toContain('Keep exploration bounded')
      expect(result.text).toContain('pass a glob as `pattern` or `glob`')
      expect(result.text).toContain('## Subagent Delegation')
      expect(result.text).toContain('## Plan Structure')
      expect(result.text).toContain('<final_plan_contract>')
      expect(result.text).toContain('Source request')
      expect(result.text).toContain('design-notes.md')
      expect(result.text).toContain('src/example.ts')
      expect(result.clarifyingQuestions.length).toBeLessThanOrEqual(LONG_HORIZON_MAX_CLARIFYING_QUESTIONS)
    }
  })

  it('separates user data from plan-mode instructions with XML-safe boundaries', () => {
    const result = buildLongHorizonPrompt({
      userPrompt: 'Plan changes for <script>alert("x")</script> & preserve auth.',
      workspaceRoot: 'D:/Project/SciForge'
    })

    expect(result.text).toContain('<user_request>')
    expect(result.text).toContain('&lt;script&gt;alert("x")&lt;/script&gt; &amp; preserve auth.')
    expect(result.text).toContain('Separate instructions from data')
    expect(result.text).toContain('The final saved plan must be Markdown, not XML.')
  })

  it('flags lazy prompts, asks an interview round, and caps clarification questions', () => {
    const result = buildLongHorizonPrompt({ userPrompt: '做一下这个' })

    expect(result.needsClarification).toBe(true)
    expect(result.clarifyingQuestions.length).toBeGreaterThan(0)
    expect(result.clarifyingQuestions.length).toBeLessThanOrEqual(LONG_HORIZON_MAX_CLARIFYING_QUESTIONS)
    expect(result.text).toContain('Iterative Planning Workflow')
    expect(result.text).toContain('Use at most 5 questions')
    expect(result.text).toContain('wait for the user answer')
  })

  it('promotes validation commands and constraints into explicit acceptance criteria', () => {
    const result = buildLongHorizonPrompt({
      userPrompt: 'Fix the parser so node test.mjs passes without changing the test file.'
    })

    expect(result.text).toContain('## Acceptance Criteria')
    expect(result.text).toContain('Run `node test.mjs` successfully.')
    expect(result.text).toContain('Honor every explicit constraint and non-goal stated in the original request.')
  })

  it('asks for source material before doing paper analysis without an attached paper', () => {
    const result = buildLongHorizonPrompt({
      userPrompt: '整理Deepseek-R1这篇论文的核心发现，并生成一份可复用的实验设计总结'
    })

    expect(result.needsClarification).toBe(true)
    expect(result.clarifyingQuestions.some((question) => question.id === 'source-material')).toBe(true)
    expect(result.text).toContain('Which source material should be used')
    expect(result.text).toContain('before doing source-dependent work')
  })

  it('does not ask for source material when a paper file is attached', () => {
    const result = buildLongHorizonPrompt({
      userPrompt: '整理Deepseek-R1这篇论文的核心发现，并生成一份可复用的实验设计总结',
      fileReferences: [{ relativePath: 'papers/deepseek-r1.pdf', kind: 'pdf' }]
    })

    expect(result.clarifyingQuestions.some((question) => question.id === 'source-material')).toBe(false)
  })

  it('does not require clarification for sufficiently specific prompts', () => {
    const analysis = analyzeLongHorizonPrompt({
      userPrompt: 'Implement the checkout API module with acceptance criteria, tests, and a constraint to preserve existing cart behavior.'
    })

    expect(analysis.needsClarification).toBe(false)
  })

  it('returns the original prompt unchanged when the mode is not enabled', () => {
    const original = 'Fix the upload bug.'
    const result = maybeBuildLongHorizonPrompt({ enabled: false, userPrompt: original })

    expect(result.applied).toBe(false)
    expect(result.text).toBe(original)
    expect(result.text).not.toContain('Plan Mode Prompt')
  })
})
