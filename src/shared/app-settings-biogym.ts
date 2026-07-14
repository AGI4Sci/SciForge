import type {
  AppSettingsV1,
  BioGymSettingsPatchV1,
  BioGymSettingsV1
} from './app-settings-types'

export const DEFAULT_BIOGYM_SSH_HOST = ''
export const DEFAULT_BIOGYM_REMOTE_ROOT = ''

export function defaultBioGymSettings(): BioGymSettingsV1 {
  return {
    enabled: false,
    cliPath: '',
    sshHost: DEFAULT_BIOGYM_SSH_HOST,
    remoteRoot: DEFAULT_BIOGYM_REMOTE_ROOT
  }
}

export function normalizeBioGymSettings(
  input: BioGymSettingsPatchV1 | undefined
): BioGymSettingsV1 {
  const defaults = defaultBioGymSettings()
  return {
    enabled: input?.enabled === true,
    cliPath: cleanString(input?.cliPath),
    sshHost: cleanString(input?.sshHost) || defaults.sshHost,
    remoteRoot: normalizeRemoteRoot(input?.remoteRoot) || defaults.remoteRoot
  }
}

export function mergeBioGymSettings(
  current: BioGymSettingsV1 | undefined,
  patch: BioGymSettingsPatchV1 | undefined
): BioGymSettingsV1 {
  const normalized = normalizeBioGymSettings(current)
  if (!patch) return normalized
  return normalizeBioGymSettings({ ...normalized, ...patch })
}

export function getBioGymSettings(
  settings: AppSettingsV1 | { biogym?: BioGymSettingsPatchV1 }
): BioGymSettingsV1 {
  return normalizeBioGymSettings(settings.biogym)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRemoteRoot(value: unknown): string {
  const cleaned = cleanString(value).replace(/\/+$/g, '')
  return cleaned.startsWith('/') ? cleaned : ''
}
