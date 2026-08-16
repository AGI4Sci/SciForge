import { compactStrings } from './app-settings-normalizers'
import type { SkillsSettingsPatchV1, SkillsSettingsV1 } from './app-settings-types'

export function defaultSkillsSettings(): SkillsSettingsV1 {
  return { extraDirs: [] }
}

export function normalizeSkillsSettings(input: unknown): SkillsSettingsV1 {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Partial<SkillsSettingsV1>
    : {}
  return {
    extraDirs: compactStrings(raw.extraDirs)
  }
}

export function mergeSkillsSettings(
  current: SkillsSettingsV1,
  patch?: SkillsSettingsPatchV1
): SkillsSettingsV1 {
  return normalizeSkillsSettings({
    ...current,
    ...(patch ?? {})
  })
}
