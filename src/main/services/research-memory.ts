import type {
  AgentRuntimeMemoryRecord,
  AgentRuntimeResearchMemory,
  AgentRuntimeResearchSnapshot
} from '../../shared/agent-runtime-contract'

export const MAX_RESEARCH_MEMORY_PROMPT_BYTES = 8 * 1024
export const MAX_RESEARCH_MEMORY_CONTEXT_BYTES = 32 * 1024
export const RESEARCH_MEMORY_OMITTED_PROMPT = '- [research: unverified; context omitted] Complete research bundle not loaded within the UTF-8 context budget; source lookup required. Conditions, counterexamples and history were not loaded.'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid research memory object.')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error('Invalid research memory text (1–2000 characters required).')
  return value
}

function texts(value: unknown, required = false): string[] {
  if (!Array.isArray(value) || value.length > 8 || (required && !value.length)) throw new Error('Invalid research memory list (maximum 8 items).')
  return value.map(text)
}

function snapshot(value: unknown): AgentRuntimeResearchSnapshot {
  const v = object(value)
  return { text: text(v.text), ...body(v) }
}

function body(v: Record<string, unknown>): Omit<AgentRuntimeResearchSnapshot, 'text'> {
  if (!Array.isArray(v.sources) || !v.sources.length || v.sources.length > 8) throw new Error('Research memory requires 1–8 exact sources.')
  return {
    sources: v.sources.map((value) => {
      const source = object(value)
      if (!['unknown', 'partial', 'inaccessible'].includes(source.access as string)) throw new Error('Research source access must be unknown, partial or inaccessible; caller verification is not accepted.')
      return {
        owner: text(source.owner), locator: text(source.locator), version: text(source.version),
        ...(source.digest !== undefined ? { digest: text(source.digest) } : {}),
        access: source.access as 'unknown' | 'partial' | 'inaccessible'
      }
    }),
    conditions: texts(v.conditions, true),
    counterexamples: texts(v.counterexamples)
  }
}

/** No request or stored freshness/confidence field can manufacture verification. */
export function parseResearchMemory(value: unknown): AgentRuntimeResearchMemory {
  const v = object(value)
  if (v.status !== undefined && !['unverified', 'stale', 'withdrawn'].includes(v.status as string)) throw new Error('Invalid research memory status; source lookup required.')
  if (v.history !== undefined && (!Array.isArray(v.history) || v.history.length > 8)) throw new Error('Invalid research memory history.')
  return {
    ...body(v),
    status: (v.status ?? 'unverified') as AgentRuntimeResearchMemory['status'],
    corrections: v.corrections === undefined ? [] : texts(v.corrections),
    history: v.history === undefined ? [] : (v.history as unknown[]).map(snapshot)
  }
}

export function reviseResearchMemory(previous: AgentRuntimeMemoryRecord, value: unknown, nextText = previous.text): AgentRuntimeResearchMemory {
  const next = parseResearchMemory(value)
  if (!previous.research) return { ...next, status: next.status === 'withdrawn' ? 'withdrawn' : 'unverified', history: [] }
  const prior = previous.research
  const corrections = texts([...new Set([...prior.corrections, ...next.corrections])])
  // Access declarations can restrict exposure without revising scientific evidence.
  const content = (r: AgentRuntimeResearchMemory) => JSON.stringify({
    sources: r.sources.map(({ access: _access, ...identity }) => identity),
    conditions: r.conditions, counterexamples: r.counterexamples, corrections: r.corrections
  })
  if (nextText === previous.text && content({ ...next, corrections }) === content(prior)) {
    return {
      ...prior,
      status: prior.status === 'withdrawn' || next.status === 'withdrawn' ? 'withdrawn' : prior.status,
      sources: prior.sources.map((source, i) => ({
        ...source, access: source.access === 'inaccessible' ? 'inaccessible' : next.sources[i].access
      }))
    }
  }
  if (previous.research.history.length >= 8) throw new Error('Research memory history is full; retain this record and create a new source-bound record.')
  return {
    ...next,
    status: previous.research.status === 'withdrawn' || next.status === 'withdrawn' ? 'withdrawn' : 'stale',
    corrections,
    history: [...previous.research.history, {
      text: previous.text, sources: previous.research.sources,
      conditions: previous.research.conditions, counterexamples: previous.research.counterexamples
    }]
  }
}

/** Current and historical restrictions cannot be released by caller declarations. */
export function researchIsInaccessible(record: AgentRuntimeMemoryRecord): boolean {
  const r = record.research
  return Boolean(r && [...r.sources, ...r.history.flatMap((h) => h.sources)].some((s) => s.access === 'inaccessible'))
}

export function memoryForExposure(record: AgentRuntimeMemoryRecord): AgentRuntimeMemoryRecord {
  const withdrawn = record.research?.status === 'withdrawn'
  if (!withdrawn && !researchIsInaccessible(record)) return structuredClone(record)
  return {
    id: record.id, text: withdrawn ? '[Research withdrawn; content omitted]' : '[Research source inaccessible; content omitted; source lookup required]',
    scope: record.scope, disabled: record.disabled, deleted: record.deleted,
    createdAt: record.createdAt, updatedAt: record.updatedAt, tags: [],
    research: { status: record.research!.status, sources: [{ owner: '[omitted]', locator: '[omitted]', version: '[omitted]', access: 'inaccessible' }], conditions: [], counterexamples: [], corrections: [], history: [] }
  }
}

export function renderResearchMemory(record: AgentRuntimeMemoryRecord, byteBudget = MAX_RESEARCH_MEMORY_PROMPT_BYTES): string {
  const exposed = memoryForExposure(record)
  const r = exposed.research!
  if (r.status === 'withdrawn') return '- [research: withdrawn] Content omitted.'
  if (researchIsInaccessible(exposed)) {
    return '- [research: inaccessible] Content omitted. Source lookup and access authorization required.'
  }
  const rendered = `- [research: ${r.status}; access unknown/partial; source lookup required] Conditional context, not current factual knowledge: ${JSON.stringify({
    claim: exposed.text, ...r
  })}`
  // Keep the whole scientific bundle or omit it; a clipped positive claim could lose its counterevidence.
  const budget = Math.max(Buffer.byteLength(RESEARCH_MEMORY_OMITTED_PROMPT, 'utf8'),
    Math.min(MAX_RESEARCH_MEMORY_PROMPT_BYTES, Number.isFinite(byteBudget) ? Math.floor(byteBudget) : MAX_RESEARCH_MEMORY_PROMPT_BYTES))
  return Buffer.byteLength(rendered, 'utf8') <= budget ? rendered : RESEARCH_MEMORY_OMITTED_PROMPT
}
