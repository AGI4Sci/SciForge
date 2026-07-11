export type ToolBudgetProfileName = 'explanation' | 'review' | 'implementation' | 'long'

export type ToolBudgetProfile = {
  softLimit: number
  hardLimit: number
  maxAutomaticPhases: number
  totalLimit: number
}

export type ToolBudgetConfig = {
  enabled?: boolean
  profiles?: Partial<Record<ToolBudgetProfileName, Partial<ToolBudgetProfile>>>
}

export type ToolBudgetCheckpoint = {
  decision: 'continue' | 'finish'
  summary: string
  remaining: string[]
  nextPlan: string[]
}

export const DEFAULT_TOOL_BUDGET_PROFILES: Record<ToolBudgetProfileName, ToolBudgetProfile> = {
  explanation: { softLimit: 2, hardLimit: 5, maxAutomaticPhases: 1, totalLimit: 5 },
  review: { softLimit: 8, hardLimit: 16, maxAutomaticPhases: 1, totalLimit: 16 },
  implementation: { softLimit: 16, hardLimit: 32, maxAutomaticPhases: 1, totalLimit: 32 },
  long: { softLimit: 16, hardLimit: 16, maxAutomaticPhases: 3, totalLimit: 48 }
}

const IMPLEMENTATION_INTENT =
  /\b(?:add|build|change|create|delete|edit|fix|implement|migrate|modify|patch|refactor|remove|rename|replace|test|update|write)\b|(?:实现|修复|修改|新增|添加|删除|重构|迁移|替换|编写|开发|构建|改一下|改成)/iu
const EXPLANATION_INTENT =
  /\b(?:analy[sz]e|audit|check|compare|diagnose|explain|inspect|investigate|review|summari[sz]e|what|why)\b|(?:分析|解释|说明|评审|审查|检查|诊断|比较|总结|为什么|是什么|查一下)/iu

export function resolveToolBudgetProfile(
  config: ToolBudgetConfig | undefined,
  name: ToolBudgetProfileName
): ToolBudgetProfile {
  const defaults = DEFAULT_TOOL_BUDGET_PROFILES[name]
  const configured = config?.profiles?.[name]
  const hardLimit = positiveInteger(configured?.hardLimit, defaults.hardLimit)
  const softLimit = Math.min(hardLimit, positiveInteger(configured?.softLimit, defaults.softLimit))
  const maxAutomaticPhases = positiveInteger(
    configured?.maxAutomaticPhases,
    defaults.maxAutomaticPhases
  )
  const totalLimit = Math.max(
    hardLimit,
    positiveInteger(configured?.totalLimit, defaults.totalLimit)
  )
  return { softLimit, hardLimit, maxAutomaticPhases, totalLimit }
}

export function classifyToolBudgetProfile(input: {
  prompt: string
  explicit?: ToolBudgetProfileName
  hasActiveGoal?: boolean
  planTurnActive?: boolean
}): ToolBudgetProfileName {
  if (input.explicit) return input.explicit
  if (input.hasActiveGoal) return 'long'
  if (input.planTurnActive) return 'implementation'
  if (IMPLEMENTATION_INTENT.test(input.prompt)) return 'implementation'
  if (EXPLANATION_INTENT.test(input.prompt)) return 'explanation'
  // Preserve the current coding-agent behavior for ambiguous prompts. A
  // conservative implementation budget is safer than prematurely cutting off
  // a workspace task whose wording does not contain an obvious action verb.
  return 'implementation'
}

export function parseToolBudgetCheckpoint(text: string): ToolBudgetCheckpoint | null {
  const candidate = firstJsonObject(text)
  if (!candidate) return null
  try {
    const value = JSON.parse(candidate) as Record<string, unknown>
    const decision = value.decision
    if (decision !== 'continue' && decision !== 'finish') return null
    return {
      decision,
      summary: typeof value.summary === 'string' ? value.summary.trim() : '',
      remaining: stringArray(value.remaining),
      nextPlan: stringArray(value.nextPlan ?? value.next_plan)
    }
  } catch {
    return null
  }
}

export function checkpointSupportsContinuation(
  checkpoint: ToolBudgetCheckpoint,
  previousPlan: readonly string[] | undefined
): boolean {
  if (checkpoint.decision !== 'continue') return false
  if (checkpoint.remaining.length === 0 || checkpoint.nextPlan.length === 0) return false
  if (!previousPlan || previousPlan.length === 0) return true
  return normalizePlan(previousPlan) !== normalizePlan(checkpoint.nextPlan)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.floor(value))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function normalizePlan(value: readonly string[]): string {
  return value.map((entry) => entry.toLowerCase().replace(/\s+/g, ' ').trim()).join('\n')
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaping = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (escaping) {
      escaping = false
      continue
    }
    if (char === '\\' && inString) {
      escaping = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}
