/**
 * Per-(runtime × model) memory for composer turn controls (reasoning level).
 *
 * The design requires the reasoning choice to be remembered for the exact
 * runtime + model pair: switching models away and back restores that pair's
 * choice, which is then re-validated against current discovery — an invalid
 * restored value is reset to “upstream default” with a notice by the caller.
 *
 * Best-effort storage: parse errors and denied storage degrade to “no memory”.
 */
export type ComposerTurnControlMemoryEntry = Readonly<{
  reasoningEffort?: string
}>

const STORAGE_KEY = 'sciforge.composerTurnControlMemory.v1'
const MAX_SCOPES = 50

type ScopeMap = Record<string, ComposerTurnControlMemoryEntry>

export function composerTurnControlScopeKey(runtimeId: string, modelId: string): string {
  return `${runtimeId.trim()}::${modelId.trim()}`
}

function browserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    const candidate = (globalThis as { localStorage?: Storage }).localStorage
    return candidate ?? null
  } catch {
    // Accessing localStorage itself can throw (storage denied) — no memory.
    return null
  }
}

function readMap(): ScopeMap {
  try {
    const raw = browserStorage()?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as ScopeMap
  } catch {
    return {}
  }
}

export function readComposerTurnControlMemory(
  scopeKey: string
): ComposerTurnControlMemoryEntry | null {
  const entry = readMap()[scopeKey]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  return typeof entry.reasoningEffort === 'string' ? entry : null
}

export function writeComposerTurnControlMemory(
  scopeKey: string,
  entry: ComposerTurnControlMemoryEntry
): void {
  try {
    const map = readMap()
    const next: ScopeMap = { ...map, [scopeKey]: entry }
    const keys = Object.keys(next)
    // Bounded memory: drop the oldest scopes beyond the cap (insertion order).
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_SCOPES))) {
      delete next[stale]
    }
    browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage denied — memory is best-effort; the live selection is unaffected.
  }
}