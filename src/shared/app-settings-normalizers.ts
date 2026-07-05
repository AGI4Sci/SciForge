import {
  DEFAULT_DEEPSEEK_BASE_URL,
  type RemoteChannelGuardModeV1,
  type RemoteChannelProvider,
  type RemoteChannelModel,
  type RemoteChannelRunMode,
  type ScheduleKind,
  type ScheduleModel,
  type ScheduleReasoningEffort,
  type ScheduleTaskStatus
} from './app-settings-types'

export function normalizeDeepseekBaseUrl(baseUrl: string | null | undefined): string {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  return trimmed || DEFAULT_DEEPSEEK_BASE_URL
}

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

export function normalizePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function normalizeRunMode(value: unknown): RemoteChannelRunMode {
  return value === 'plan' ? 'plan' : 'agent'
}

export function normalizeImProvider(value: unknown): RemoteChannelProvider {
  if (value === 'weixin') return 'weixin'
  if (value === 'discord') return 'discord'
  if (value === 'zulip') return 'zulip'
  return 'feishu'
}

export function normalizeRemoteChannelGuardMode(value: unknown): RemoteChannelGuardModeV1 {
  if (value === 'all_messages' || value === 'off') return value
  return 'only_mention'
}

export function normalizeRemoteChannelModel(value: unknown): RemoteChannelModel {
  return value === 'deepseek-v4-pro' || value === 'deepseek-v4-flash' ? value : 'auto'
}

export function normalizeScheduleModel(value: unknown): ScheduleModel {
  return normalizeRemoteChannelModel(value)
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

export function normalizePathSegment(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '/remote-channel/webhook'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function normalizeStatus(value: unknown): ScheduleTaskStatus {
  if (value === 'running' || value === 'success' || value === 'error') return value
  return 'idle'
}
