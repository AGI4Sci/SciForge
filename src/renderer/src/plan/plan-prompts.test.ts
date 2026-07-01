import { describe, expect, it } from 'vitest'
import { GUI_PLAN_CLOSE_TAG, GUI_PLAN_OPEN_TAG } from '@shared/gui-plan'
import {
  buildDraftPlanPrompt,
  buildPlanBuildPrompt,
  buildRefinePlanPrompt,
  extractGuiPlanMarkdown,
  formatGuiPlanPromptForDisplay,
  getGuiPlanPromptKind,
  isGuiPlanDraftOrRefinePrompt,
  isGuiPlanInternalPrompt
} from './plan-prompts'

describe('plan-prompts', () => {
  it('builds draft prompts that route through the native create_plan tool', () => {
    const prompt = buildDraftPlanPrompt({
      request: 'Add auth',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.sciforge/plan/add-auth.md'
    })
    expect(prompt).toContain('The GUI will save your answer')
    expect(prompt).toContain('create_plan')
    expect(prompt).toContain(GUI_PLAN_OPEN_TAG)
    expect(prompt).toContain(GUI_PLAN_CLOSE_TAG)
    expect(prompt).toContain('request_user_input')
    expect(prompt).toContain('read-only investigation tools')
    expect(prompt).toContain('acceptance criteria')
    expect(prompt).toContain('Add auth')
  })

  it('formats internal plan prompts for chat display', () => {
    const draft = buildDraftPlanPrompt({
      request: 'Add auth',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.sciforge/plan/add-auth.md'
    })
    const refine = buildRefinePlanPrompt({
      feedback: 'Make it smaller',
      currentPlan: '# Old',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.sciforge/plan/add-auth.md'
    })
    expect(formatGuiPlanPromptForDisplay(draft)).toMatch(/^Create plan: Add auth/)
    expect(formatGuiPlanPromptForDisplay(refine)).toMatch(/^Revise plan: Make it smaller/)
    expect(formatGuiPlanPromptForDisplay(buildPlanBuildPrompt('.sciforge/plan/add-auth.md'))).toBe(
      'Build plan: .sciforge/plan/add-auth.md'
    )
    expect(isGuiPlanInternalPrompt(draft)).toBe(true)
    expect(getGuiPlanPromptKind(draft)).toBe('draft')
    expect(getGuiPlanPromptKind('Create plan: Add auth')).toBe('draft')
    expect(getGuiPlanPromptKind('Revise plan: Make it smaller')).toBe('refine')
    expect(getGuiPlanPromptKind('Build plan: .sciforge/plan/add-auth.md')).toBe('build')
    expect(isGuiPlanDraftOrRefinePrompt('Revise plan: Make it smaller')).toBe(true)
    expect(isGuiPlanDraftOrRefinePrompt('Build plan: .sciforge/plan/add-auth.md')).toBe(false)
  })

  it('builds refine prompts with the existing plan and feedback', () => {
    const prompt = buildRefinePlanPrompt({
      feedback: 'Make it smaller',
      currentPlan: '# Old',
      workspaceRoot: '/tmp/app',
      planRelativePath: '.sciforge/plan/add-auth.md'
    })
    expect(prompt).toContain('overwrite')
    expect(prompt).toContain('create_plan')
    expect(prompt).toContain('Make it smaller')
    expect(prompt).toContain('# Old')
  })

  it('builds execution prompts that point at the plan file', () => {
    expect(buildPlanBuildPrompt('.sciforge/plan/add-auth.md')).toContain(
      'Please read and execute the GUI plan file at `.sciforge/plan/add-auth.md`'
    )
  })

  it('extracts tagged and fenced plan markdown', () => {
    expect(extractGuiPlanMarkdown(`${GUI_PLAN_OPEN_TAG}\n# Plan\n${GUI_PLAN_CLOSE_TAG}`)).toBe(
      '# Plan'
    )
    expect(extractGuiPlanMarkdown('```markdown\n# Plan\n```')).toBe('# Plan')
  })

  it('extracts partial streaming tagged markdown', () => {
    expect(extractGuiPlanMarkdown(`intro\n${GUI_PLAN_OPEN_TAG}\n# Streaming`)).toBe('# Streaming')
  })
})
