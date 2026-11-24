/**
 * Concept index: a derived read model over committed deep-read analyses
 * (LitEngram §26.5 D4/D10). It is rebuilt from sealed Artifact Versions on
 * every call and never holds write authority; the committed analyses remain
 * the only source of truth.
 */

export const MAX_ANNOTATE_SPANS = 100;

export type ConceptEntry = Readonly<{
  term: string;
  normalizedTerm: string;
  /** Latin aliases mined from the definition's parentheticals, e.g. 偏心度偏置（eccentricity bias）. */
  aliases: readonly string[];
  definition: string;
  paperId: string;
  versionId: string;
  contentDigest: string;
  provenanceQuote?: string;
  contrastWith?: string;
  analogy?: string;
  /** One inline sub-concept, excavated with the parent (schema caps depth at 2). */
  subConcept?: Readonly<{
    term: string;
    normalizedTerm: string;
    definition: string;
  }>;
}>;

export type ConceptTargetEntry = Readonly<{
  term: string;
  normalizedTerm: string;
  paperId: string;
  versionId: string;
  contentDigest: string;
  /** Always true here: a reading target without an excavated concept yet. */
  unexcavated: true;
}>;

export type ConceptIndex = Readonly<{
  concepts: readonly ConceptEntry[];
  /** Terms the reader targeted but has not excavated yet: lookup hits here are gaps. */
  targets: readonly ConceptTargetEntry[];
}>;

export type ConceptSource = Readonly<{
  term: string;
  definition: string;
  provenance?: Readonly<{ quote?: string }>;
  contrastWith?: string;
  analogy?: string;
  subConcept?: Readonly<{ term: string; definition: string }>;
}>;

export type ConceptTargetSource = Readonly<{ term: string }>;

/** The post-parse structural subset the index reads; the full zod schema is validated upstream. */
export type ConceptBearingAnalysis = Readonly<{
  concepts?: readonly ConceptSource[];
  conceptTargets?: readonly ConceptTargetSource[];
}>;

export type AnalysisSource = Readonly<{
  paperId: string;
  versionId: string;
  contentDigest: string;
  analysis: ConceptBearingAnalysis;
}>;

export function normalizeConceptTerm(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase();
}

const MAX_ALIASES = 3;

/**
 * Deterministic alias mining: Latin segments inside full-width or half-width
 * parentheses of the definition's first line ("偏心度偏置（eccentricity bias）：…").
 * No model involved; what the note states explicitly is what the index matches.
 */
export function extractAliases(definition: string): readonly string[] {
  const firstLine = definition.split('\n', 1)[0] ?? '';
  const head = firstLine.slice(0, 240);
  const aliases: string[] = [];
  const pattern = /[（(]([A-Za-z][A-Za-z0-9 ,&/-]{2,60})[）)]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(head)) !== null && aliases.length < MAX_ALIASES) {
    const alias = match[1]!.trim();
    if (alias) aliases.push(alias);
  }
  return Object.freeze(aliases);
}

/**
 * A term written as "中文（English）" is one concept under two names. Both parts
 * are aliases: the Latin parenthetical, and the term with that parenthetical removed.
 */
export function extractTermAliases(term: string): readonly string[] {
  const pattern = /[（(]([A-Za-z][A-Za-z0-9 ,&/-]{2,60})[）)]/g;
  const aliases: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(term)) !== null) {
    const alias = match[1]!.trim();
    if (alias) aliases.push(alias);
  }
  if (aliases.length > 0) {
    const bare = term.replace(pattern, ' ').replace(/\s+/gu, ' ').trim();
    if (bare) aliases.push(bare);
  }
  return aliases;
}

function conceptAliases(term: string, definition: string): readonly string[] {
  const seen = new Set([normalizeConceptTerm(term)]);
  const aliases: string[] = [];
  for (const alias of [...extractTermAliases(term), ...extractAliases(definition)]) {
    const key = normalizeConceptTerm(alias);
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  return Object.freeze(aliases);
}

export function buildConceptIndex(sources: readonly AnalysisSource[]): ConceptIndex {
  const concepts: ConceptEntry[] = [];
  const targets: ConceptTargetEntry[] = [];
  for (const source of sources) {
    const base = {
      paperId: source.paperId,
      versionId: source.versionId,
      contentDigest: source.contentDigest
    };
    for (const concept of source.analysis.concepts ?? []) {
      concepts.push({
        term: concept.term,
        normalizedTerm: normalizeConceptTerm(concept.term),
        aliases: conceptAliases(concept.term, concept.definition),
        definition: concept.definition,
        ...base,
        ...(concept.provenance?.quote ? { provenanceQuote: concept.provenance.quote } : {}),
        ...(concept.contrastWith ? { contrastWith: concept.contrastWith } : {}),
        ...(concept.analogy ? { analogy: concept.analogy } : {}),
        ...(concept.subConcept
          ? {
              subConcept: {
                term: concept.subConcept.term,
                normalizedTerm: normalizeConceptTerm(concept.subConcept.term),
                definition: concept.subConcept.definition
              }
            }
          : {})
      });
    }
    const excavated = new Set((source.analysis.concepts ?? []).map((c) => normalizeConceptTerm(c.term)));
    for (const target of source.analysis.conceptTargets ?? []) {
      const normalizedTerm = normalizeConceptTerm(target.term);
      if (!normalizedTerm || excavated.has(normalizedTerm)) continue;
      targets.push({ term: target.term, normalizedTerm, ...base, unexcavated: true });
    }
  }
  return Object.freeze({ concepts: Object.freeze(concepts), targets: Object.freeze(targets) });
}

export type ConceptLookupResult = Readonly<{
  status: 'hit' | 'multiple_sources' | 'gap_unexcavated' | 'gap_unknown';
  /** Every matching sealed explanation, with no implicit synthesis or winner. */
  matches: readonly { concept: ConceptEntry; matchedSubConcept?: Readonly<{ term: string; definition: string }> }[];
  targets: readonly ConceptTargetEntry[];
  concept?: ConceptEntry;
  /** Set when the query matched the entry's inline sub-concept rather than the parent term. */
  matchedSubConcept?: Readonly<{ term: string; definition: string }>;
  target?: ConceptTargetEntry;
  /**
   * Near-misses for gap_unknown, closest relation first: literal prefixes in
   * either direction, then separator-folded prefixes and substrings (query ≥3
   * characters), then token-subset matches (multi-word query, all query words
   * present in order, stored term at most three times as long). Terms and
   * aliases are both scanned. Candidates never change the status — they only
   * show what the index does hold nearby.
   */
  candidates: readonly { term: string; paperId: string }[];
}>;

const MAX_CANDIDATES = 5;
const MIN_SUBSTRING_CANDIDATE_QUERY = 3;
const MIN_TOKEN_SUBSET_QUERY_TOKENS = 2;
const MIN_TOKEN_TOKEN_LENGTH = 2;
/** A stored term may carry this many times the query's words and still count. */
const MAX_TOKEN_SUBSET_EXPANSION = 3;

/**
 * Near-miss comparison key. `normalizeConceptTerm` keeps `-` so a hyphenated
 * term never matches its spaced spelling; fold the separators for candidates
 * only. Hits stay exact — this key never upgrades a near miss into a hit.
 */
function foldSeparators(value: string): string {
  return normalizeConceptTerm(value)
    .replace(/[-_–—/]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Strongest near-miss relation a stored key has to the query, lower is closer.
 * Ranking exists so a literal prefix never loses its candidate slot to a
 * looser token-subset hit further down the index.
 */
type NearMissRank = 0 | 1 | 2;

function tokenize(value: string): string[] {
  return foldSeparators(value).split(' ').filter(Boolean);
}

function isSubsequenceOf(needles: readonly string[], haystack: readonly string[]): boolean {
  let cursor = 0;
  for (const token of haystack) {
    if (token === needles[cursor]) cursor += 1;
    if (cursor === needles.length) return true;
  }
  return false;
}

function nearMissRank(
  key: string,
  query: string,
  queryTokens: readonly string[]
): NearMissRank | undefined {
  const candidate = foldSeparators(key);
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 0;
  if (query.length >= MIN_SUBSTRING_CANDIDATE_QUERY && candidate.includes(query)) return 1;
  // Word-order and intervening-word differences ("toe-tongue axis" vs
  // "… and toe–tongue ordinal axis") are neither prefixes nor substrings.
  // Require a real multi-word query, tokens long enough to carry meaning, the
  // query words kept in order inside the stored term, and a stored term that
  // does not swamp the query — otherwise two words would latch onto any
  // sentence that happens to contain them.
  if (queryTokens.length < MIN_TOKEN_SUBSET_QUERY_TOKENS) return undefined;
  if (queryTokens.some((token) => token.length < MIN_TOKEN_TOKEN_LENGTH)) return undefined;
  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length > queryTokens.length * MAX_TOKEN_SUBSET_EXPANSION) return undefined;
  return isSubsequenceOf(queryTokens, candidateTokens) ? 2 : undefined;
}

export function lookupConcept(index: ConceptIndex, query: string): ConceptLookupResult {
  const normalized = normalizeConceptTerm(query);
  if (!normalized) return { status: 'gap_unknown', matches: [], targets: [], candidates: [] };
  const targets = index.targets.filter((entry) => entry.normalizedTerm === normalized).sort(compareSources);
  const matches = index.concepts.flatMap((entry) => {
    if (entry.normalizedTerm === normalized || entry.aliases.some((alias) => normalizeConceptTerm(alias) === normalized)) {
      return [{ concept: entry }];
    }
    return entry.subConcept?.normalizedTerm === normalized
      ? [{ concept: entry, matchedSubConcept: entry.subConcept }] : [];
  }).sort((a, b) => compareSources(a.concept, b.concept));
  if (matches.length > 1) return { status: 'multiple_sources', matches, targets, candidates: [] };
  if (matches.length === 1) return { status: 'hit', ...matches[0]!, matches, targets, candidates: [] };
  const target = targets[0];
  if (target) return { status: 'gap_unexcavated', target, matches: [], targets, candidates: [] };
  const candidates: {
    term: string;
    paperId: string;
    rank: NearMissRank;
    index: number;
  }[] = [];
  const candidateQuery = foldSeparators(normalized);
  const queryTokens = candidateQuery.split(' ').filter(Boolean);
  for (const entry of index.concepts) {
    // Terms and their aliases are both names for the same concept; a near miss
    // on either should point back at the concept the reader would want.
    const keys = [entry.term, ...entry.aliases];
    let rank: NearMissRank | undefined;
    for (const key of keys) {
      const keyRank = nearMissRank(key, candidateQuery, queryTokens);
      if (keyRank !== undefined && (rank === undefined || keyRank < rank)) rank = keyRank;
    }
    if (rank !== undefined) candidates.push({ term: entry.term, paperId: entry.paperId, rank, index: candidates.length });
  }
  return {
    status: 'gap_unknown',
    matches: [],
    targets,
    candidates: candidates
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, MAX_CANDIDATES)
      .map(({ term, paperId }) => ({ term, paperId }))
  };
}

export type ConceptSpan = Readonly<{
  start: number;
  end: number;
  term: string;
  status: 'known' | 'unexcavated';
}>;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Longest-term-first single pass; a position already inside a span is not re-matched.
 * Token-boundary checks apply only to Latin/digit-initial patterns (avoiding
 * 'RSA' inside 'RSVP'); CJK terms legitimately occur mid-sentence, where the
 * surrounding characters are always letters. */
export function annotateText(index: ConceptIndex, text: string): readonly ConceptSpan[] {
  type Pattern = Readonly<{ match: string; term: string; status: 'known' | 'unexcavated' }>;
  const patterns: Pattern[] = [
    ...index.concepts.flatMap((entry) => [
      { match: entry.term, term: entry.term, status: 'known' as const },
      ...entry.aliases.map((alias) => ({ match: alias, term: entry.term, status: 'known' as const }))
    ]),
    ...index.targets.map((entry) => ({ match: entry.term, term: entry.term, status: 'unexcavated' as const }))
  ].sort((a, b) => b.match.length - a.match.length);
  const compiled = patterns.map((pattern) => ({
    ...pattern,
    latinStart: /^[A-Za-z0-9]/u.test(pattern.match),
    regex: new RegExp(`^${escapeRegExp(pattern.match)}${/^[A-Za-z0-9]/u.test(pattern.match) ? '(?![\\p{L}\\p{N}])' : ''}`, 'iu')
  }));
  const spans: ConceptSpan[] = [];
  let cursor = 0;
  outer: while (cursor < text.length && spans.length < MAX_ANNOTATE_SPANS) {
    const rest = text.slice(cursor);
    for (const pattern of compiled) {
      const match = pattern.regex.exec(rest);
      if (!match) continue;
      if (pattern.latinStart && cursor > 0 && /[\p{L}\p{N}]/u.test(text[cursor - 1]!)) continue;
      spans.push({ start: cursor, end: cursor + match[0].length, term: pattern.term, status: pattern.status });
      cursor += match[0].length;
      continue outer;
    }
    cursor += 1;
  }
  return Object.freeze(spans);
}

/** Code-unit identity ordering is stable across platforms and source arrival order. */
function compareSources(a: ConceptEntry | ConceptTargetEntry, b: ConceptEntry | ConceptTargetEntry): number {
  const left = JSON.stringify([a.paperId, a.versionId, a.contentDigest, a.term, a]);
  const right = JSON.stringify([b.paperId, b.versionId, b.contentDigest, b.term, b]);
  return left < right ? -1 : left > right ? 1 : 0;
}
