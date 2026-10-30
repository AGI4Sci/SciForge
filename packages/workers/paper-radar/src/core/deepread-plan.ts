import type { DeepReadDomain } from './deepread-schema.js';
import type { DeepReadStrategy } from './deepread-verify.js';
import type { FulltextDocument, FulltextReliability, FulltextSection, FulltextSectionKind } from './fulltext.js';

/**
 * Deciding how much of which paper gets read, and preparing the text the agent will read.
 *
 * Reading every paper in full is neither affordable nor useful, so ranked papers are split into
 * tiers: the top few are read completely, the next group is read for its method and results, and
 * the rest keep their abstract-level treatment.
 */

export type DeepReadTier = 1 | 2 | 3;

export interface TierOptions {
  tier1Count: number;
  tier2Count: number;
}

export const DEFAULT_TIER_OPTIONS: TierOptions = { tier1Count: 3, tier2Count: 10 };
const MAX_TIER1_COUNT = 10;
const MAX_TIER2_COUNT = 50;

export interface PlanInput {
  id: string;
  title: string;
  /** Relevance score from the ranking step. Higher is better. */
  score: number;
}

export type SectionSelection = 'all_but_references' | readonly FulltextSectionKind[] | 'none';

export interface PlannedPaper {
  id: string;
  title: string;
  /** 1-based position after sorting by score. */
  rank: number;
  tier: DeepReadTier;
  strategy: Exclude<DeepReadStrategy, 'fast'> | 'metadata';
  sections: SectionSelection;
}

const TIER2_SECTIONS: readonly FulltextSectionKind[] = ['abstract', 'methods', 'results'];

function boundedCount(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

/** Assign each paper a tier from its rank. Equal scores keep their input order. */
export function planDeepRead(papers: readonly PlanInput[], options: Partial<TierOptions> = {}): PlannedPaper[] {
  const tier1Count = boundedCount(options.tier1Count, DEFAULT_TIER_OPTIONS.tier1Count, MAX_TIER1_COUNT);
  const tier2Count = boundedCount(options.tier2Count, DEFAULT_TIER_OPTIONS.tier2Count, MAX_TIER2_COUNT);
  const ordered = papers
    .map((paper, position) => ({ paper, position }))
    .sort((a, b) => b.paper.score - a.paper.score || a.position - b.position);

  return ordered.map(({ paper }, index): PlannedPaper => {
    const rank = index + 1;
    const tier: DeepReadTier = rank <= tier1Count ? 1 : rank <= tier1Count + tier2Count ? 2 : 3;
    return plannedPaperForTier(paper, rank, tier);
  });
}

/** The reading strategy and sections that belong to a tier. */
export function plannedPaperForTier(paper: { id: string; title: string }, rank: number, tier: DeepReadTier): PlannedPaper {
  switch (tier) {
    case 1:
      return { id: paper.id, title: paper.title, rank, tier, strategy: 'deep', sections: 'all_but_references' };
    case 2:
      return { id: paper.id, title: paper.title, rank, tier, strategy: 'standard', sections: TIER2_SECTIONS };
    case 3:
      return { id: paper.id, title: paper.title, rank, tier, strategy: 'metadata', sections: 'none' };
  }
}

export interface SelectedSections {
  sections: FulltextSection[];
  /** True when the wanted sections were not recognized in the paper, so the whole body was used. */
  fellBack: boolean;
}

/** Pick the sections a tier reads. A paper without the wanted sections falls back to its whole body. */
export function selectSections(document: FulltextDocument, selection: SectionSelection): SelectedSections {
  if (selection === 'none') return { sections: [], fellBack: false };
  const body = document.sections.filter((section) => section.kind !== 'references');
  if (selection === 'all_but_references') return { sections: body, fellBack: false };
  const wanted = body.filter((section) => selection.includes(section.kind));
  return wanted.length > 0 ? { sections: wanted, fellBack: false } : { sections: body, fellBack: true };
}

// ---------------------------------------------------------------------------------------------
// The text packet handed to the agent
// ---------------------------------------------------------------------------------------------

export const DEFAULT_PACKET_MAX_CHARS = 120_000;

/** Dropped first when a paper is too long to hand over whole. */
const DROP_ORDER: readonly FulltextSectionKind[] = ['appendix', 'acknowledgements', 'other', 'background', 'front_matter'];

export interface DeepReadPacket {
  paperId: string;
  title: string;
  tier: DeepReadTier;
  strategy: DeepReadStrategy;
  reliability: FulltextReliability;
  domainSignals: DomainSignals;
  sections: Array<{ kind: FulltextSectionKind; heading: string; pageStart: number; pageEnd: number; text: string }>;
  /** What was left out to keep the packet within budget, so the agent knows the text is partial. */
  omitted: Array<{ kind: FulltextSectionKind; heading: string; reason: 'over_budget' | 'truncated' }>;
  notes: string[];
}

export function buildDeepReadPacket(input: {
  planned: PlannedPaper;
  document: FulltextDocument;
  maxChars?: number;
}): DeepReadPacket {
  const { planned, document } = input;
  if (planned.strategy === 'metadata') {
    throw new Error('A tier-3 paper is not read in full; no packet is built for it.');
  }
  const maxChars = Math.max(1_000, Math.floor(input.maxChars ?? DEFAULT_PACKET_MAX_CHARS));
  const selected = selectSections(document, planned.sections);
  const notes: string[] = [];
  if (selected.fellBack) notes.push('The sections of interest were not recognized in this paper; the whole body is provided instead.');
  for (const warning of document.reliability.warnings) {
    if (warning === 'introduction_unheaded') notes.push('The introduction has no heading and is included in the front matter or abstract text.');
    if (warning === 'core_sections_missing') notes.push('Some core sections (introduction, methods, results) were not recognized; they may sit inside another section.');
  }

  let sections = [...selected.sections];
  const omitted: DeepReadPacket['omitted'] = [];
  const total = (items: readonly { text: string }[]): number => items.reduce((sum, item) => sum + item.text.length, 0);

  // Too long: drop whole low-priority sections first, from the end of the paper backwards.
  for (const kind of DROP_ORDER) {
    for (let i = sections.length - 1; i >= 0 && total(sections) > maxChars; i -= 1) {
      if (sections[i].kind !== kind) continue;
      omitted.push({ kind: sections[i].kind, heading: sections[i].heading, reason: 'over_budget' });
      sections = sections.filter((_, position) => position !== i);
    }
  }

  // Still too long: cut the longest remaining section rather than silently exceed the budget.
  const packetSections = sections.map((section) => ({ ...section }));
  const truncated = new Set<(typeof packetSections)[number]>();
  while (total(packetSections) > maxChars) {
    const longest = packetSections.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const excess = total(packetSections) - maxChars;
    longest.text = longest.text.slice(0, Math.max(0, longest.text.length - excess));
    if (!truncated.has(longest)) {
      truncated.add(longest);
      omitted.push({ kind: longest.kind, heading: longest.heading, reason: 'truncated' });
    }
  }
  if (omitted.length > 0) notes.push('The text was shortened to fit the size budget; see "omitted".');

  const fullText = packetSections.map((section) => section.text).join('\n');
  return {
    paperId: planned.id,
    title: planned.title,
    tier: planned.tier,
    strategy: planned.strategy,
    reliability: document.reliability,
    domainSignals: detectDomainSignals(fullText),
    sections: packetSections,
    omitted,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------
// Advisory domain detection
// ---------------------------------------------------------------------------------------------

export interface DomainSignals {
  psych: number;
  nlp: number;
  neuroscience: number;
  /** A starting point for the agent, which makes the actual call. Null when the text gives no clear signal. */
  suggestion: DeepReadDomain | null;
}

const PSYCH_TERMS = /\b(?:participants?|subjects?|questionnaires?|anova|effect sizes?|cohen'?s|power analysis|pre-?regist\w*|likert|self-report)\b/gi;
const NLP_TERMS = /\b(?:baselines?|benchmarks?|datasets?|gpus?|ablations?|prompts?|fine-?tun\w*|f1|bleu|rouge|llms?|language models?|transformers?)\b/gi;
const NEURO_TERMS = /\b(?:fmri|bold|glm|voxels?|mvpa|rois?|neuroimaging|cortex|amygdala|insula|striatum)\b/gi;
const SIGNAL_THRESHOLD = 8;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** Count domain vocabulary. This is a hint to the agent, never a verdict. */
export function detectDomainSignals(text: string): DomainSignals {
  const psych = count(text, PSYCH_TERMS);
  const nlp = count(text, NLP_TERMS);
  const neuroscience = count(text, NEURO_TERMS);
  let suggestion: DeepReadDomain | null = null;
  if (neuroscience >= SIGNAL_THRESHOLD) suggestion = 'neuroscience';
  else if (psych >= SIGNAL_THRESHOLD && nlp >= SIGNAL_THRESHOLD) suggestion = 'hybrid';
  else if (nlp >= SIGNAL_THRESHOLD && nlp > psych) suggestion = 'nlp';
  else if (psych >= SIGNAL_THRESHOLD) suggestion = 'psych';
  return { psych, nlp, neuroscience, suggestion };
}
