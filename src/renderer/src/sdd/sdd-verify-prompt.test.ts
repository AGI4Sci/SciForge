import { describe, expect, it } from 'vitest'
import { buildSddVerifyPrompt, isSddVerifyPrompt } from './sdd-verify-prompt'

describe('buildSddVerifyPrompt', () => {
  it('asks the agent to verify acceptance items and update the requirement file only', () => {
    const prompt = buildSddVerifyPrompt({
      workspaceRoot: '/tmp/ws',
      draftRelativePath: '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md',
      planRelativePath: '.sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md'
    })

    expect(prompt).toContain('SciForge is asking you to verify')
    expect(prompt).toContain('Workspace: /tmp/ws')
    expect(prompt).toContain('Requirement file: .sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md')
    expect(prompt).toContain('Implementation plan: .sciforge/plan/sdd-123e4567-e89b-12d3-a456-426614174000.md')
    expect(prompt).toContain('`### R-1: title {status}`')
    expect(prompt).toContain('change `- [ ]` to `- [x]`')
    expect(prompt).toContain('set `{verified}` only when all of its criteria passed')
    expect(prompt).toContain('Do not rewrite descriptions or titles')
    expect(prompt).toContain('Do not edit the implementation plan or unrelated implementation files')
    expect(prompt).toContain('which criteria failed and why')
    expect(isSddVerifyPrompt(prompt)).toBe(true)
    expect(isSddVerifyPrompt('normal user prompt')).toBe(false)
  })
})
