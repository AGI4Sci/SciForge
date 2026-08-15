import {
  type AgentRuntimeId,
  type AgentThreadIdsV1,
  type ScheduleRunMode,
  type ScheduleKind,
  type ScheduleModel,
  type ScheduleReasoningEffort,
  type ScheduleTaskStatus
} from './app-settings-types'

export function compactStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeInstallationId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9._:-]{8,128}$/.test(raw) ? raw : ''
}

export function normalizeAgentThreadIds(input: unknown): AgentThreadIdsV1 {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const sciforgeThreadId = typeof raw.sciforge === 'string' ? raw.sciforge.trim() : ''
  const codexThreadId = typeof raw.codex === 'string' ? raw.codex.trim() : ''
  const claudeThreadId = typeof raw.claude === 'string' ? raw.claude.trim() : ''
  return {
    ...(sciforgeThreadId ? { sciforge: sciforgeThreadId } : {}),
    ...(codexThreadId ? { codex: codexThreadId } : {}),
    ...(claudeThreadId ? { claude: claudeThreadId } : {})
  }
}

export function normalizeSettingsRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'sciforge' || value === 'codex' || value === 'claude') return value
  return 'codex'
}

export function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function normalizeRunMode(value: unknown): ScheduleRunMode {
  return value === 'plan' ? 'plan' : 'agent'
}

export function normalizeScheduleModel(value: unknown): ScheduleModel {
  return value === 'deepseek-v4-pro' || value === 'deepseek-v4-flash' ? value : 'auto'
}

export function normalizeScheduleReasoningEffort(value: unknown): ScheduleReasoningEffort {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'max') return value
  return 'medium'
}

export function normalizeScheduleKind(value: unknown): ScheduleKind {
  if (value === 'interval' || value === 'daily' || value === 'at') return value
  return 'manual'
}

export function normalizeTimeOfDay(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '09:00'
}

export function normalizeAtTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : ''
}

export function normalizeStatus(value: unknown): ScheduleTaskStatus {
  if (value === 'running' || value === 'success' || value === 'error') return value
  return 'idle'
}
