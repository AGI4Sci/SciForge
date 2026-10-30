/**
 * Reasoning-level vocabulary (词表).
 *
 * Purpose: when a model API is bound, SciForge needs to know which thinking
 * levels that model exposes. Upstream declarations are the primary source; this
 * table is the *fallback of record* for endpoints that do not declare anything.
 *
 * Rules (mirrors `docs/model-reasoning-discovery.zh-CN.md`):
 *  - Evidence only. Every entry carries `source` and (when known) `verifiedAt`.
 *    No entry may be added from a model's name, family or marketing copy.
 *  - Exact matching. `provider` + `model` must match exactly after trimming and
 *    lower-casing; `protocol` matches exactly or through the explicit `'*'`
 *    wildcard. Endpoint-scoped entries beat endpoint-agnostic ones. There is no
 *    prefix/family/substring matching, so a model that merely resembles a known
 *    one stays `unknown`.
 *  - `declaredUnsupported` means upstream said this model exposes no reasoning
 *    levels. It is a distinct outcome and must never be overridden by levels.
 *  - `completeness` separates a full declaration from a partial verification: a
 *    model whose only verified observation is "an explicit `high` was accepted"
 *    is `partial`. Callers must not present that as the complete ladder, and must
 *    not stop the user from choosing a level outside the verified set.
 */

export const REASONING_LEVEL_PROTOCOLS = [
  'responses',
  'chat-completions',
  'anthropic-messages'
] as const

export type ReasoningLevelProtocol = (typeof REASONING_LEVEL_PROTOCOLS)[number] | '*'

/** `complete` = the observation enumerated every level; `partial` = only some. */
export type ReasoningLevelCompleteness = 'complete' | 'partial'

export type ReasoningLevelEntry = Readonly<{
  /** Binding identifier as it appears in the model-access settings. */
  provider: string
  /** Exact upstream model identifier. */
  model: string
  /** Wire protocol this observation applies to, or `'*'` for any. */
  protocol: ReasoningLevelProtocol
  /** Endpoint-specific observation; omitted means "any endpoint of this binding". */
  endpoint?: string
  /** Levels observed/declared for this model, shallowest first. */
  levels?: readonly string[]
  /** Required with `levels`: whether the observation covered every level. */
  completeness?: ReasoningLevelCompleteness
  /** Upstream-declared default level, when it declares one. */
  defaultLevel?: string | null
  /** Upstream explicitly reported that this model exposes no reasoning levels. */
  declaredUnsupported?: boolean
  /** Where the observation came from (PR, live probe, upstream listing, vendor doc). */
  source: string
  /** ISO date of the observation; omit when no dated verification exists. */
  verifiedAt?: string
}>

export type ReasoningLevelTable = Readonly<{
  schemaVersion: 1
  entries: readonly ReasoningLevelEntry[]
}>

export type ReasoningLevelQuery = Readonly<{
  provider: string
  model: string
  protocol: string
  endpoint?: string | null
}>

/**
 * Discovery outcome. `unknown` is a first-class answer: it means "no evidence",
 * and callers must treat it as "do not attach a reasoning parameter" rather than
 * as "unsupported".
 */
export type ReasoningLevelEvidence =
  | Readonly<{
      kind: 'declared'
      levels: readonly string[]
      completeness: ReasoningLevelCompleteness
      defaultLevel: string | null
      source: string
      verifiedAt: string | null
      endpoint: string | null
    }>
  | Readonly<{
      kind: 'declared-unsupported'
      source: string
      verifiedAt: string | null
      endpoint: string | null
    }>
  | Readonly<{ kind: 'unknown' }>

/**
 * Shipped vocabulary.
 *
 * Only one entry has dated first-hand evidence in this repository today:
 * PR #83 (`fix(model-router): 止血`) exercised the intern binding against
 * `deepseek-v4-flash-0731` on 2026-10-23 and recorded that (a) a request without
 * any reasoning field reached upstream untouched, and (b) an explicit
 * `reasoning_effort: "high"` was forwarded and completed. The request body
 * (`{"model":…,"messages":[…]}`) shows the chat-completions wire shape, so the
 * observation is scoped to that protocol.
 *
 * That observation says nothing about which other levels exist, so the entry is
 * `partial`: one accepted `high` proves the parameter is accepted — not that the
 * ladder is complete, and not that deeper thinking actually happened. Everything
 * else stays out until someone verifies it.
 */
export const REASONING_LEVEL_TABLE: ReasoningLevelTable = {
  schemaVersion: 1,
  entries: [
    {
      provider: 'intern',
      model: 'deepseek-v4-flash-0731',
      protocol: 'chat-completions',
      levels: ['high'],
      completeness: 'partial',
      defaultLevel: null,
      source: 'pr-83-live-probe',
      verifiedAt: '2026-10-23'
    }
  ]
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeEndpoint(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}

function matchesProtocol(entry: ReasoningLevelEntry, protocol: string): boolean {
  return entry.protocol === '*' || normalizeToken(entry.protocol) === protocol
}

function matchesEndpoint(entry: ReasoningLevelEntry, endpoint: string | null): boolean {
  const entryEndpoint = normalizeEndpoint(entry.endpoint)
  // An endpoint-agnostic entry applies to every endpoint of the binding.
  if (entryEndpoint === null) return true
  return entryEndpoint === endpoint
}

function evidenceFrom(entry: ReasoningLevelEntry): ReasoningLevelEvidence {
  const endpoint = normalizeEndpoint(entry.endpoint)
  const verifiedAt = entry.verifiedAt?.trim() ? entry.verifiedAt.trim() : null
  if (entry.declaredUnsupported) {
    return { kind: 'declared-unsupported', source: entry.source, verifiedAt, endpoint }
  }
  const levels = [...(entry.levels ?? [])].map((level) => level.trim()).filter(Boolean)
  if (levels.length === 0) {
    // An entry without levels is treated as no evidence at all rather than as an
    // implicit "unsupported": absence of data is not a declaration.
    return { kind: 'unknown' }
  }
  const defaultLevel = entry.defaultLevel?.trim() ? entry.defaultLevel.trim() : null
  return {
    kind: 'declared',
    levels,
    completeness: entry.completeness === 'partial' ? 'partial' : 'complete',
    defaultLevel,
    source: entry.source,
    verifiedAt,
    endpoint
  }
}

/**
 * Look up the reasoning-level evidence for a binding.
 *
 * Endpoint-specific entries win over endpoint-agnostic ones; ties are impossible
 * because equal-scope duplicates are rejected by `reasoningLevelTableIssues`.
 */
export function lookupReasoningLevels(
  query: ReasoningLevelQuery,
  table: ReasoningLevelTable = REASONING_LEVEL_TABLE
): ReasoningLevelEvidence {
  const provider = normalizeToken(query.provider)
  const model = normalizeToken(query.model)
  const protocol = normalizeToken(query.protocol)
  const endpoint = normalizeEndpoint(query.endpoint)

  if (!provider || !model || !protocol) return { kind: 'unknown' }

  const candidates = table.entries.filter(
    (entry) =>
      normalizeToken(entry.provider) === provider &&
      normalizeToken(entry.model) === model &&
      matchesProtocol(entry, protocol)
  )
  if (candidates.length === 0) return { kind: 'unknown' }

  const matches = candidates.filter((entry) => matchesEndpoint(entry, endpoint))
  if (matches.length === 0) return { kind: 'unknown' }
  // Endpoint-specific evidence is stronger than endpoint-agnostic evidence.
  const specific = matches.find((entry) => normalizeEndpoint(entry.endpoint) !== null)
  return evidenceFrom(specific ?? matches[0])
}

/**
 * Table invariants, used by tests and by the maintenance rules documented in
 * `docs/model-reasoning-discovery.zh-CN.md`. Returns the violations found.
 */
export function reasoningLevelTableIssues(table: ReasoningLevelTable): readonly string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const entry of table.entries) {
    const key = [
      normalizeToken(entry.provider),
      normalizeToken(entry.model),
      normalizeToken(entry.protocol),
      normalizeEndpoint(entry.endpoint) ?? ''
    ].join('\u0000')
    if (seen.has(key)) {
      issues.push(`duplicate entry for ${entry.provider}/${entry.model}/${entry.protocol}`)
    }
    seen.add(key)
    if (!entry.source.trim()) issues.push(`entry without source: ${entry.provider}/${entry.model}`)
    if (entry.provider.trim() !== entry.provider || entry.model.trim() !== entry.model) {
      issues.push(`entry with padded provider/model: ${entry.provider}/${entry.model}`)
    }
    if (entry.declaredUnsupported) {
      if (entry.levels !== undefined) {
        issues.push(`declaredUnsupported entry must not carry levels: ${entry.provider}/${entry.model}`)
      }
      if (entry.completeness !== undefined) {
        issues.push(`declaredUnsupported entry must not carry completeness: ${entry.provider}/${entry.model}`)
      }
      continue
    }
    if (entry.levels === undefined || entry.levels.length === 0) {
      issues.push(`entry without levels or declaredUnsupported: ${entry.provider}/${entry.model}`)
      continue
    }
    if (entry.completeness === undefined) {
      issues.push(`levels entry without completeness: ${entry.provider}/${entry.model}`)
    }
    if (entry.levels.some((level) => level.trim() !== level || level.length === 0)) {
      issues.push(`entry with padded/empty level: ${entry.provider}/${entry.model}`)
    }
  }
  return issues
}