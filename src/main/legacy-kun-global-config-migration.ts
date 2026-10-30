import { mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type LegacyKunGlobalConfigKind = 'mcp' | 'skills'
export type LegacyKunGlobalConfigMigrationStatus = 'moved' | 'legacy-missing' | 'target-exists' | 'error'

export type LegacyKunGlobalConfigMigrationEntry = {
  kind: LegacyKunGlobalConfigKind
  legacyPath: string
  targetPath: string
  status: LegacyKunGlobalConfigMigrationStatus
  error?: string
}

export type LegacyKunGlobalConfigMigrationResult = {
  homeDir: string
  entries: LegacyKunGlobalConfigMigrationEntry[]
}

export type LegacyKunGlobalConfigMigrationOptions = {
  homeDir?: string
}

export async function migrateLegacyKunGlobalConfig(
  options: LegacyKunGlobalConfigMigrationOptions = {}
): Promise<LegacyKunGlobalConfigMigrationResult> {
  const home = options.homeDir ?? homedir()
  const entries = await Promise.all([
    moveLegacyEntry('mcp', join(home, '.kun', 'mcp.json'), join(home, '.sciforge', 'mcp.json')),
    moveLegacyEntry('skills', join(home, '.kun', 'skills'), join(home, '.sciforge', 'skills'))
  ])
  return { homeDir: home, entries }
}

async function moveLegacyEntry(
  kind: LegacyKunGlobalConfigKind,
  legacyPath: string,
  targetPath: string
): Promise<LegacyKunGlobalConfigMigrationEntry> {
  if (await pathExists(targetPath)) {
    return { kind, legacyPath, targetPath, status: 'target-exists' }
  }
  if (!await pathExists(legacyPath)) {
    return { kind, legacyPath, targetPath, status: 'legacy-missing' }
  }
  try {
    await mkdir(dirname(targetPath), { recursive: true })
    await rename(legacyPath, targetPath)
    return { kind, legacyPath, targetPath, status: 'moved' }
  } catch (error) {
    return { kind, legacyPath, targetPath, status: 'error', error: errorMessage(error) }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
