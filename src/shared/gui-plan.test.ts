import { describe, expect, it } from 'vitest'
import {
  buildGuiPlanId,
  buildPlanRelativePath,
  GUI_PLAN_RELATIVE_DIR,
  guiPlanWorkspaceMatches,
  isGuiPlanCurrentRelativePath,
  isGuiPlanRelativePath,
  normalizeGuiPlanRelativePath,
  nextAvailablePlanRelativePath,
  planDisplayNameFromRelativePath,
  planFeatureNameFromRequest,
  validateCreatePlanToolInput
} from './gui-plan'

describe('gui-plan path validation', () => {
  it('accepts direct Markdown files under the plan directory', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(true)
    expect(isGuiPlanRelativePath(`  ${GUI_PLAN_RELATIVE_DIR}/Login.md  `)).toBe(true)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}\\login.md`)).toBe(true)
    expect(isGuiPlanCurrentRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(true)
    expect(isGuiPlanCurrentRelativePath(`${GUI_PLAN_RELATIVE_DIR}\\login.md`)).toBe(true)
  })

  it('normalizes equivalent GUI plan relative path syntax', () => {
    expect(normalizeGuiPlanRelativePath(`  ./${GUI_PLAN_RELATIVE_DIR}\\Login.md  `)).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/Login.md`
    )
    expect(normalizeGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}//Login.md`)).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/Login.md`
    )
  })

  it('rejects non-canonical plan directories', () => {
    expect(isGuiPlanRelativePath('.legacy/plan/login.md')).toBe(false)
    expect(isGuiPlanRelativePath('.sciforge/plans/login.md')).toBe(false)
    expect(isGuiPlanCurrentRelativePath('.legacy/plan/login.md')).toBe(false)
    expect(isGuiPlanCurrentRelativePath('.sciforge/plans/login.md')).toBe(false)
  })

  it('rejects nested paths', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/nested/login.md`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/a/b/c.md`)).toBe(false)
  })

  it('rejects traversal paths', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/../escape.md`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/..`)).toBe(false)
    expect(isGuiPlanRelativePath('../plan.md')).toBe(false)
    expect(isGuiPlanRelativePath(`plans/foo.md`)).toBe(false)
  })

  it('rejects non-Markdown extensions and empty names', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.txt`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/.json`)).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/`)).toBe(false)
  })

  it('handles duplicate feature names by suffixing attempts', () => {
    const existing = [buildPlanRelativePath('login', 1), buildPlanRelativePath('login', 2)]
    const next = nextAvailablePlanRelativePath('login', existing)
    expect(next).toBe(buildPlanRelativePath('login', 3))
  })

  it('produces a stable plan id from workspace and path', () => {
    expect(buildGuiPlanId('/tmp/ws', `${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(
      `/tmp/ws:${GUI_PLAN_RELATIVE_DIR}/login.md`
    )
    expect(buildGuiPlanId('/tmp/ws', `${GUI_PLAN_RELATIVE_DIR}/Login.md`)).toBe(
      buildGuiPlanId('/tmp/ws', `${GUI_PLAN_RELATIVE_DIR}/login.md`)
    )
  })

  it('compares workspace roots case-insensitively with trailing slash tolerance', () => {
    expect(guiPlanWorkspaceMatches('/tmp/ws', '/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('/tmp/ws/', '/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('C:\\tmp\\ws', 'c:/tmp/ws')).toBe(true)
    expect(guiPlanWorkspaceMatches('/tmp/ws', '/tmp/other')).toBe(false)
  })
})

describe('plan feature name sanitisation', () => {
  it('handles unicode and emoji request strings', () => {
    const name = planFeatureNameFromRequest('登录：添加 OAuth 🪪')
    expect(name).toBeTruthy()
    expect(name).not.toMatch(/[<>:"\\|?*]/)
  })

  it('falls back to "plan" for empty or whitespace input', () => {
    expect(planFeatureNameFromRequest('')).toBe('plan')
    expect(planFeatureNameFromRequest('   ')).toBe('plan')
    // The sanitizer keeps printable punctuation in the name, so
    // '!!!' is preserved (it is a legal filename on disk). The
    // important contract is that empty/whitespace inputs degrade
    // to the default 'plan' identifier.
    expect(planFeatureNameFromRequest('!!!')).toBe('!!!')
  })

  it('keeps the display name in sync with the relative path', () => {
    const path = buildPlanRelativePath('demo-feature', 2)
    expect(planDisplayNameFromRelativePath(path)).toBe('demo-feature-2')
  })

  it('builds sanitized plan paths from raw request text', () => {
    const request = 'Build Login: OAuth / SSO?'
    expect(buildPlanRelativePath(request)).toBe(`${GUI_PLAN_RELATIVE_DIR}/build-login-oauth-sso.md`)
    expect(buildPlanRelativePath('../')).toBe(`${GUI_PLAN_RELATIVE_DIR}/plan.md`)
    expect(nextAvailablePlanRelativePath(request, [buildPlanRelativePath(request)])).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/build-login-oauth-sso-2.md`
    )
  })
})

describe('create_plan tool input validation', () => {
  it('flags missing markdown and operation', () => {
    expect(validateCreatePlanToolInput({ operation: 'draft' })).toContain(
      'markdown is required and must be non-empty'
    )
    expect(validateCreatePlanToolInput({ markdown: '# hi' })).toContain(
      'operation must be either "draft" or "refine"'
    )
  })

  it('rejects non-Markdown plan relative paths', () => {
    const issues = validateCreatePlanToolInput({
      markdown: '## plan',
      operation: 'draft',
      plan_relative_path: 'plans/foo.txt'
    })
    expect(issues.join('|')).toMatch(/plan_relative_path must be a direct Markdown file/)
  })

  it('accepts a fully populated draft input', () => {
    expect(
      validateCreatePlanToolInput({
        markdown: '## plan',
        operation: 'draft',
        plan_relative_path: `${GUI_PLAN_RELATIVE_DIR}/login.md`,
        plan_id: 'pid_1',
        source_request: 'build login',
        title: 'Login flow'
      })
    ).toEqual([])
  })
})
