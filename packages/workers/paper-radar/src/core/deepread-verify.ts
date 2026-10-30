import {
  ARGUMENT_PAPER_TYPES,
  allChecklistKeys,
  requiredChecklistKeys,
  type DeepReadAnalysis,
  type EvidenceQuote,
} from './deepread-schema.js';
import type { FulltextDocument, FulltextSectionKind } from './fulltext.js';

/**
 * Mechanical checks on an agent-submitted deep-read analysis.
 *
 * The agent does the reading; these checks catch what code can catch reliably: quotations that do
 * not appear in the paper (the usual signature of a hallucinated citation), required fields and
 * checklist items that are missing, and conclusions graded "direct" without evidence behind them.
 * They cannot judge whether the analysis is insightful, and a passing report says nothing about that.
 */

export type DeepReadStrategy = 'deep' | 'standard' | 'fast';
export type VerificationSeverity = 'error' | 'warning';

export interface VerificationIssue {
  severity: VerificationSeverity;
  code: string;
  /** Location inside the analysis, e.g. "dimension3.findings[1].evidence[0]". */
  path: string;
  message: string;
}

export interface VerificationReport {
  /** True when there are no errors. Warnings do not fail the analysis. */
  passed: boolean;
  issues: VerificationIssue[];
  quotes: { total: number; verified: number };
}

export interface VerifyOptions {
  strategy: DeepReadStrategy;
  /** The reader's own projects or questions. When given, graft targets are checked against them. */
  researchTargets?: readonly string[];
}

export type QuoteLocation =
  | { found: false; reason?: 'fragment_too_short' }
  | { found: true; sectionIndex: number; kind: FulltextSectionKind; heading: string; pageStart: number; pageEnd: number };

const MIN_FRAGMENT_CHARS = 12;
const MIN_QUOTE_CHARS = 20;
const MIN_RESTATEMENT_CHARS = 30;
const MIN_CREDIBILITY_CHARS = 25;

/**
 * Reduce text to a form that survives PDF extraction noise: unicode compatibility forms, quote
 * styles, hyphenation artifacts and, above all, whitespace, which extraction places inconsistently.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '');
}

export class QuoteIndex {
  private readonly normalizedSections: string[];

  constructor(private readonly document: FulltextDocument) {
    this.normalizedSections = document.sections.map((section) => normalizeForMatch(section.text));
  }

  /**
   * Find a quotation in the paper. An ellipsis splits it into fragments that must all appear, in
   * order, inside the same section; fragments are matched without regard to whitespace. A
   * fragment that is too short to verify is an error, never silently skipped: dropping it would
   * attest text the check never looked at.
   */
  locate(quote: string): QuoteLocation {
    const fragments = quote
      .split(/…|\.{3}/)
      .map(normalizeForMatch)
      .filter((fragment) => fragment.length > 0);
    if (fragments.length === 0) return { found: false };
    if (fragments.some((fragment) => fragment.length < MIN_FRAGMENT_CHARS)) {
      return { found: false, reason: 'fragment_too_short' };
    }
    if (fragments.reduce((total, fragment) => total + fragment.length, 0) < MIN_QUOTE_CHARS) return { found: false };

    for (let index = 0; index < this.normalizedSections.length; index += 1) {
      const haystack = this.normalizedSections[index];
      let from = 0;
      let ok = true;
      for (const fragment of fragments) {
        const at = haystack.indexOf(fragment, from);
        if (at < 0) {
          ok = false;
          break;
        }
        from = at + fragment.length;
      }
      if (ok) {
        const section = this.document.sections[index];
        return {
          found: true,
          sectionIndex: index,
          kind: section.kind,
          heading: section.heading,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
        };
      }
    }
    return { found: false };
  }
}

interface CollectedQuote {
  path: string;
  quote: EvidenceQuote;
  /** Index of the finding this quote supports, when it supports one. */
  findingIndex?: number;
}

/** Sections whose text is background or citation rather than this paper's own data. */
const NON_DATA_KINDS: ReadonlySet<FulltextSectionKind> = new Set(['introduction', 'background', 'references']);

export function verifyDeepReadAnalysis(
  document: FulltextDocument,
  analysis: DeepReadAnalysis,
  options: VerifyOptions,
): VerificationReport {
  const issues: VerificationIssue[] = [];
  const add = (severity: VerificationSeverity, code: string, path: string, message: string): void => {
    issues.push({ severity, code, path, message });
  };
  const strict = options.strategy !== 'fast';

  // A failed extraction means there is no trustworthy text to verify against:
  // nothing may pass, including analyses with no quotes to check.
  if (document.reliability.status === 'failed') {
    add('error', 'fulltext_unreliable', 'reliability.status',
      'Fulltext extraction failed, so no analysis can be verified against the paper text.')
  }

  // ---- collect every quotation, then verify each against the text --------------------------------
  const collected: CollectedQuote[] = [];
  analysis.dimension3.findings.forEach((finding, findingIndex) => {
    finding.evidence.forEach((quote, i) =>
      collected.push({ path: `dimension3.findings[${findingIndex}].evidence[${i}]`, quote, findingIndex }),
    );
  });
  if (analysis.dimension2.kind === 'methodology') {
    for (const [key, item] of Object.entries(analysis.dimension2.checklist)) {
      if (item.evidence) collected.push({ path: `dimension2.checklist.${key}.evidence`, quote: item.evidence });
    }
  }
  analysis.reviewerAudit?.attacks.forEach((attack, i) => {
    if (typeof attack.anchor !== 'string') collected.push({ path: `reviewerAudit.attacks[${i}].anchor`, quote: attack.anchor });
  });

  // ---- concept and model-setup quotations are verified like any other quote --
  analysis.concepts?.forEach((concept, i) => {
    collected.push({ path: `concepts[${i}].provenance`, quote: concept.provenance });
    if (concept.subConcept) {
      collected.push({ path: `concepts[${i}].subConcept.provenance`, quote: concept.subConcept.provenance });
    }
  });
  if (analysis.dimension2.kind === 'methodology' && analysis.dimension2.modelSetups) {
    analysis.dimension2.modelSetups.forEach((setup, i) => {
      if (setup.evidence) {
        collected.push({ path: `dimension2.modelSetups[${i}].evidence`, quote: setup.evidence });
      }
    });
  }

  const index = new QuoteIndex(document);
  const locations = new Map<string, QuoteLocation>();
  let verified = 0;
  for (const item of collected) {
    const location = index.locate(item.quote.quote);
    locations.set(item.path, location);
    if (!location.found) {
      if (location.reason === 'fragment_too_short') {
        add('error', 'quote_fragment_too_short', item.path, 'A fragment between ellipses is too short to verify reliably. Quote longer exact passages so every fragment can be checked.');
      } else {
        add('error', 'quote_not_found', item.path, 'The quoted passage does not appear in the paper text. Quote it exactly as written.');
      }
      continue;
    }
    verified += 1;
    if (item.quote.section && item.quote.section !== location.kind) {
      add('warning', 'quote_section_mismatch', item.path, `The quote was claimed to be in "${item.quote.section}" but appears in "${location.kind}".`);
    }
    if (location.kind === 'references') {
      add('warning', 'quote_from_references', item.path, 'The quoted passage comes from the reference list, which is not this paper\'s own evidence.');
    }
  }

  // ---- dimension 3: strength must match the evidence behind it -------------------------------------
  const findings = analysis.dimension3.findings;
  if (findings.length < 2) add('warning', 'few_findings', 'dimension3.findings', 'Two to four core findings are expected.');
  if (findings.length > 4) add('warning', 'too_many_findings', 'dimension3.findings', 'More than four findings dilutes the analysis; keep the most important.');
  findings.forEach((finding, findingIndex) => {
    const own = collected
      .filter((item) => item.findingIndex === findingIndex)
      .map((item) => locations.get(item.path))
      .filter((location): location is Extract<QuoteLocation, { found: true }> => location?.found === true);
    const path = `dimension3.findings[${findingIndex}]`;
    const restated = normalizeForMatch(finding.finding);
    if (restated.length >= MIN_RESTATEMENT_CHARS && finding.evidence.some((quote) => {
      const quoted = normalizeForMatch(quote.quote);
      return quoted.includes(restated) || restated.includes(quoted);
    })) {
      add('warning', 'finding_restates_quote', path, 'The finding is a copy of its quotation. Say what the result means, not only what the paper says.');
    }
    if (finding.credibility.trim().length < MIN_CREDIBILITY_CHARS) {
      add('warning', 'credibility_too_thin', `${path}.credibility`, 'Explain why you do or do not trust this finding; one word is not an assessment.');
    }
    if (finding.strength === 'direct') {
      if (own.length === 0) {
        add('error', 'direct_without_evidence', path, 'A finding graded "direct" needs at least one verified quotation from the paper.');
      } else if (own.every((location) => NON_DATA_KINDS.has(location.kind))) {
        add('warning', 'direct_evidence_not_from_data', path, 'Every supporting quotation is from the introduction, background or references, not from the paper\'s own results.');
      }
    } else if (finding.strength === 'indirect' && own.length === 0) {
      add('warning', 'indirect_without_evidence', path, 'An "indirect" finding should still point to the passage it rests on.');
    }
  });

  // ---- first-pass scout: the deep tier requires the four-line SCQA frame ----
  if (options.strategy === 'deep' && !analysis.scqa) {
    add('error', 'scqa_missing', 'scqa', 'A deep-tier analysis starts with the four-line SCQA scout (situation, complication, question, answer) before the full read.');
  }

  // ---- concept excavation: declared targets must be delivered; provenance is quote-checked above ----
  const concepts = analysis.concepts ?? [];
  const conceptTerms = concepts.map((concept) => normalizeForMatch(concept.term));
  for (const [i, target] of (analysis.conceptTargets ?? []).entries()) {
    if (target.depth !== 'contrast') continue;
    const wanted = normalizeForMatch(target.term);
    if (!conceptTerms.some((term) => term.includes(wanted) || wanted.includes(term))) {
      add('warning', 'concept_missing_for_target', `conceptTargets[${i}]`, `"${target.term}" was flagged for full excavation (contrast depth) but no concept entry covers it.`);
    }
  }

  // ---- unknown-unknown gaps are the prime graft material; flag when none of them reach dimension 4 ----
  const graftText = normalizeForMatch(analysis.dimension4.grafts.map((graft) => `${graft.plan} ${graft.target}`).join(' '));
  analysis.dimension1.gaps.forEach((gap, i) => {
    if (gap.type !== 'unknown_unknown') return;
    const gapText = normalizeForMatch(gap.text);
    if (gapText.length < 12) return;
    if (!graftText.includes(gapText)) {
      add('warning', 'unknown_unknown_gap_not_grafted', `dimension1.gaps[${i}]`, 'This gap is a newly revealed problem direction; consider grafting it into your own research in dimension 4.');
    }
  });

  // ---- dimension 1 ----------------------------------------------------------------------------------
  if (analysis.dimension1.known.length < 3 && strict) {
    add('warning', 'few_known', 'dimension1.known', 'Three to five established premises are expected.');
  }

  // ---- dimension 2 ----------------------------------------------------------------------------------
  const argumentPaper = ARGUMENT_PAPER_TYPES.includes(analysis.paperType);
  if (argumentPaper && analysis.dimension2.kind !== 'argument') {
    add('error', 'dimension2_kind_mismatch', 'dimension2', `A ${analysis.paperType} paper has no experiment to dissect; analyse its argument structure instead.`);
  }
  if (!argumentPaper && analysis.dimension2.kind !== 'methodology') {
    add('error', 'dimension2_kind_mismatch', 'dimension2', `A ${analysis.paperType} paper needs a methodology dissection.`);
  }
  if (analysis.domain === 'review-theory' && !argumentPaper) {
    add('warning', 'domain_type_mismatch', 'domain', 'The "review-theory" domain is meant for review, theory and position papers.');
  }
  if (analysis.dimension2.kind === 'methodology') {
    const dimension2 = analysis.dimension2;
    const required = requiredChecklistKeys(analysis.domain);
    for (const key of required) {
      if (!(key in dimension2.checklist)) {
        add(strict ? 'error' : 'warning', 'checklist_item_missing', `dimension2.checklist.${key}`, `The "${key}" checklist item is required for the ${analysis.domain} domain.`);
      }
    }
    const known = new Set<string>(allChecklistKeys());
    for (const [key, item] of Object.entries(dimension2.checklist)) {
      if (!known.has(key)) add('warning', 'unknown_checklist_item', `dimension2.checklist.${key}`, `"${key}" is not a recognized checklist item.`);
      if (item.status === 'reported' && !item.evidence) {
        add('warning', 'checklist_reported_without_evidence', `dimension2.checklist.${key}`, 'An item marked "reported" should quote where the paper reports it.');
      }
    }
    if (dimension2.designLogic.length < 3 && options.strategy === 'deep') {
      add('warning', 'few_design_whys', 'dimension2.designLogic', 'A deep analysis asks three "why" questions about the design.');
    }
  }

  // ---- dimension 4 ----------------------------------------------------------------------------------
  const targets = options.researchTargets?.map((target) => target.trim().toLowerCase()).filter(Boolean) ?? [];
  if (targets.length > 0) {
    analysis.dimension4.grafts.forEach((graft, i) => {
      const target = graft.target.trim().toLowerCase();
      if (!targets.some((candidate) => candidate.includes(target) || target.includes(candidate))) {
        add('warning', 'graft_target_unknown', `dimension4.grafts[${i}].target`, `"${graft.target}" is not one of the research targets that were provided.`);
      }
    });
  }

  // ---- reviewer self-audit --------------------------------------------------------------------------
  const audit = analysis.reviewerAudit;
  if (!audit) {
    if (options.strategy === 'deep') add('error', 'reviewer_audit_missing', 'reviewerAudit', 'A deep-tier analysis requires the reviewer self-audit.');
  } else {
    if (audit.attacks.length === 0 && !audit.noAttackFound) {
      add('error', 'audit_empty_without_declaration', 'reviewerAudit', 'No attacks were listed. If nothing held up after all seven dimensions, say so with noAttackFound.');
    }
    if (audit.attacks.length > 0 && audit.noAttackFound) {
      add('warning', 'audit_inconsistent', 'reviewerAudit', 'noAttackFound is set although attacks are listed.');
    }
    audit.attacks.forEach((attack, i) => {
      if (typeof attack.anchor === 'string' && !/\b(?:table|fig(?:ure)?|section|page|p\.|eq(?:uation)?|supplement\w*)\b|\d/i.test(attack.anchor)) {
        add('warning', 'attack_anchor_vague', `reviewerAudit.attacks[${i}].anchor`, 'An attack should be anchored in a quotation, or a named table, figure, section or value.');
      }
    });
  }

  return {
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    quotes: { total: collected.length, verified },
  };
}
