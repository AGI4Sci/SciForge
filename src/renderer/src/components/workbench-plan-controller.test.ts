import { describe, expect, it } from 'vitest'
import { createGuiPlanArtifact } from '../plan/plan-store'
import {
  buildDraftGuiPlanTurnOverrides,
  buildGuiPlanTurnOverrides,
  extractPlanModeOriginalRequest,
  resolvePlanTurnWorkspaceRoot
} from './workbench-plan-controller'

describe('workbench plan controller helpers', () => {
  it('prefers an explicit target workspace over stale workbench state', () => {
    expect(resolvePlanTurnWorkspaceRoot('/Users/codex/sdd-workspace/', '/Users/codex/stale-workspace')).toBe(
      '/Users/codex/sdd-workspace'
    )
    expect(resolvePlanTurnWorkspaceRoot(undefined, '/Users/codex/current-workspace/')).toBe(
      '/Users/codex/current-workspace'
    )
  })

  it('builds refine context only for the current plan workspace and thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/Users/codex/app/',
      threadId: 'thread-current',
      relativePath: '.sciforge/plan/checkout.md',
      sourceRequest: 'Improve checkout',
      now: 1
    })

    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/app', 'thread-current')).toMatchObject({
      guiPlan: {
        operation: 'refine',
        workspaceRoot: '/Users/codex/app',
        relativePath: '.sciforge/plan/checkout.md',
        planId: '/Users/codex/app:.sciforge/plan/checkout.md',
        sourceRequest: 'Improve checkout'
      }
    })
    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/app', 'thread-stale')).toBeUndefined()
    expect(buildGuiPlanTurnOverrides(plan, '/Users/codex/other', 'thread-current')).toBeUndefined()

    const windowsPlan = createGuiPlanArtifact({
      workspaceRoot: 'C:\\Users\\Codex\\APP\\',
      threadId: 'thread-current',
      relativePath: '.sciforge\\plan\\Checkout.md',
      sourceRequest: 'Improve checkout',
      now: 1
    })

    expect(
      buildGuiPlanTurnOverrides(windowsPlan, 'c:/users/codex/app', 'thread-current')
    ).toMatchObject({
      guiPlan: {
        workspaceRoot: 'C:/Users/Codex/APP',
        relativePath: '.sciforge/plan/Checkout.md',
        planId: 'C:/Users/Codex/APP:.sciforge/plan/checkout.md'
      }
    })
  })

  it('builds draft context for first-class GUI plan turns', () => {
    const result = buildDraftGuiPlanTurnOverrides({
      request: 'Build Login: OAuth / SSO?',
      workspaceRoot: '/Users/codex/app/',
      activeThreadId: 'thread-current',
      existingRelativePaths: ['.sciforge/plan/build-login-oauth-sso.md']
    })

    expect(result.guiPlan).toEqual({
      operation: 'draft',
      workspaceRoot: '/Users/codex/app',
      relativePath: '.sciforge/plan/build-login-oauth-sso-2.md',
      planId: '/Users/codex/app:.sciforge/plan/build-login-oauth-sso-2.md',
      sourceRequest: 'Build Login: OAuth / SSO?',
      title: 'build-login-oauth-sso-2'
    })
  })

  it('extracts the visible user query from long-horizon plan prompts', () => {
    const wrappedPrompt = [
      '# Plan Mode Prompt',
      '',
      'Schema: sciforge.plan-mode-prompt.v3',
      '',
      '## Original User Request',
      '<user_request>',
      '阅读Deepseek R1,并在本地复现',
      '</user_request>',
      '',
      '## Available Context',
      '- Workspace root: D:/Project/SciForge'
    ].join('\n')

    expect(extractPlanModeOriginalRequest(wrappedPrompt)).toBe('阅读Deepseek R1,并在本地复现')
    const result = buildDraftGuiPlanTurnOverrides({
      request: extractPlanModeOriginalRequest(wrappedPrompt),
      workspaceRoot: '/Users/codex/app/',
      activeThreadId: 'thread-current'
    })
    expect(result.guiPlan.sourceRequest).toBe('阅读Deepseek R1,并在本地复现')
    expect(result.guiPlan.relativePath).not.toContain('plan-mode-prompt')
  })

  it('unescapes XML-safe user requests from plan prompts', () => {
    const wrappedPrompt = [
      '# Plan Mode Prompt',
      '',
      '## Original User Request',
      '<user_request>',
      '整理 A &amp; B &lt;draft&gt;',
      '</user_request>',
      '',
      '## Available Context',
      '- Workspace root: D:/Project/SciForge'
    ].join('\n')

    expect(extractPlanModeOriginalRequest(wrappedPrompt)).toBe('整理 A & B <draft>')
  })
})
