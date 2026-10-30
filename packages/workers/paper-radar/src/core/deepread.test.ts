import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_PACKET_MAX_CHARS,
  buildDeepReadPacket,
  detectDomainSignals,
  planDeepRead,
  selectSections,
  type PlannedPaper,
} from './deepread-plan.js';
import { buildDeepReadProtocol } from './deepread-protocol.js';
import { deepReadAnalysisSchema, requiredChecklistKeys, type DeepReadAnalysis } from './deepread-schema.js';
import { QuoteIndex, normalizeForMatch, verifyDeepReadAnalysis } from './deepread-verify.js';
import type { FulltextDocument, FulltextSection, FulltextSectionKind } from './fulltext.js';

// ---------------------------------------------------------------------------------------------
// A small paper with known text, so every check has a known right and wrong answer
// ---------------------------------------------------------------------------------------------

function section(kind: FulltextSectionKind, heading: string, text: string, page: number): FulltextSection {
  return { kind, heading, text, pageStart: page, pageEnd: page };
}

const paperSections: FulltextSection[] = [
  section('abstract', 'Abstract', 'We measured interoceptive accuracy in 120 participants using an adaptive heartbeat detection task and found that accuracy correlated with trait anxiety.', 1),
  section('introduction', 'Introduction', 'Interoception is the sensing of the internal state of the body. Prior work has relied on fixed-trial tasks that are slow and noisy.', 1),
  section('methods', 'Methods', 'Participants wore a wrist sensor for four days. Sampling was adaptive across four-hour blocks, with an inverse frequency weighting of heart rate buckets.', 2),
  section('results', 'Results', 'Accuracy was higher in the low anxiety group, t(118) = 2.31, p = 0.022, d = 0.42. The correlation with trait anxiety was r = -0.27.', 4),
  section('discussion', 'Discussion', 'These results suggest that anxiety disrupts interoceptive accuracy, although causality cannot be inferred from the present design.', 5),
  section('references', 'References', '1. Smith J. Interoception and anxiety. Journal of Testing. 2019; a passage that only occurs in the reference list.', 7),
];

function documentOf(sections: FulltextSection[] = paperSections): FulltextDocument {
  return {
    pageCount: 7,
    charCount: sections.reduce((sum, s) => sum + s.text.length, 0),
    sections,
    reliability: { status: 'ok', recognizedKinds: ['introduction', 'methods', 'results'], missingCoreKinds: [], warnings: [] },
  };
}

function validAnalysis(overrides: Partial<DeepReadAnalysis> = {}): DeepReadAnalysis {
  const checklist = Object.fromEntries(requiredChecklistKeys('psych').map((key) => [key, { status: 'absent' as const }]));
  return {
    paperId: 'paper-1',
    paperType: 'empirical',
    domain: 'psych',
    dimension1: {
      known: ['Interoception is the sensing of the internal state of the body', 'Fixed-trial tasks are slow', 'Anxiety relates to bodily awareness'],
      gaps: [{ text: 'No ecological measure exists', type: 'known_unknown' }],
      aim: 'Measure interoceptive accuracy in daily life.',
    },
    dimension2: {
      kind: 'methodology',
      operations: 'Participants wore a wrist sensor for four days.',
      designLogic: [
        { choice: 'Adaptive sampling', why: 'Fixed trials are slow and noisy.' },
        { choice: 'Four-hour blocks', why: 'Balances coverage and burden.' },
        { choice: 'Inverse frequency weighting', why: 'Rare heart rates would otherwise be under-sampled.' },
      ],
      checklist,
      limits: [{ change: 'Halve the sample', verdict: 'unknown' }],
    },
    dimension3: {
      findings: [
        {
          finding: 'Accuracy is higher with low anxiety',
          credibility: 'Moderate: medium effect, no correction reported.',
          strength: 'direct',
          source: 'empirical',
          evidence: [{ quote: 'Accuracy was higher in the low anxiety group, t(118) = 2.31', section: 'results' }],
        },
        {
          finding: 'Anxiety disrupts accuracy',
          credibility: 'Weak: the design is correlational.',
          strength: 'indirect',
          source: 'empirical',
          evidence: [],
        },
      ],
    },
    dimension4: { grafts: [{ type: 'method', plan: 'Adopt the adaptive sampler.', target: 'Phase 2 wearable study' }] },
    dimension5: { category: 'signpost', rationale: 'It shows how to sample in the field.' },
    conceptTargets: [],
    scqa: {
      situation: 'Interoceptive accuracy is usually measured with fixed-trial lab tasks.',
      complication: 'Fixed-trial tasks are slow, noisy and far from daily life.',
      question: 'Can accuracy be measured continuously in everyday settings?',
      answer: 'Yes, with an adaptive wrist-sensor design that tracks heartbeat detection in the field.'
    },
    reviewerAudit: {
      attacks: [{ dimension: 'validity_threats', attack: 'The task may measure attention, not interoception.', severity: 'medium', anchor: 'Methods, section 2', status: 'to_verify' }],
      noAttackFound: false,
      mostFragileConclusion: { conclusion: 'Anxiety disrupts accuracy', because: 'The design cannot establish causality.' },
    },
    ...overrides,
  };
}

const codes = (report: ReturnType<typeof verifyDeepReadAnalysis>, severity?: 'error' | 'warning'): string[] =>
  report.issues.filter((issue) => !severity || issue.severity === severity).map((issue) => issue.code);

// ---------------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------------

test('a complete analysis satisfies the schema', () => {
  assert.equal(deepReadAnalysisSchema.safeParse(validAnalysis()).success, true);
});

test('the schema rejects a too-short quote, unknown fields and a missing dimension', () => {
  const shortQuote = validAnalysis();
  shortQuote.dimension3.findings[0].evidence = [{ quote: 'too short' }];
  assert.equal(deepReadAnalysisSchema.safeParse(shortQuote).success, false);

  assert.equal(deepReadAnalysisSchema.safeParse({ ...validAnalysis(), surprise: true }).success, false);

  const { dimension4: _removed, ...withoutGraft } = validAnalysis();
  assert.equal(deepReadAnalysisSchema.safeParse(withoutGraft).success, false);
});

// ---------------------------------------------------------------------------------------------
// Quote location
// ---------------------------------------------------------------------------------------------

test('normalizeForMatch ignores whitespace, case, quote styles and ligatures', () => {
  assert.equal(normalizeForMatch('The  “result”\n was ﬁne'), normalizeForMatch('the "result" was fine'));
});

test('QuoteIndex finds a quote despite whitespace differences and reports its section and page', () => {
  const index = new QuoteIndex(documentOf());
  const location = index.locate('Accuracy   was higher in the low anxiety\ngroup, t(118) = 2.31');
  assert.equal(location.found, true);
  assert.equal(location.found && location.kind, 'results');
  assert.equal(location.found && location.pageStart, 4);
});

test('QuoteIndex handles an ellipsis, in order and within one section', () => {
  const index = new QuoteIndex(documentOf());
  assert.equal(index.locate('Accuracy was higher in the low anxiety group ... The correlation with trait anxiety was r = -0.27').found, true);
  assert.equal(index.locate('The correlation with trait anxiety was r = -0.27 ... Accuracy was higher in the low anxiety group').found, false, 'fragments must appear in order');
  assert.equal(index.locate('Accuracy was higher in the low anxiety group ... causality cannot be inferred from the present design').found, false, 'fragments from different sections do not combine');
});

test('QuoteIndex rejects invented, too-short and empty quotes', () => {
  const index = new QuoteIndex(documentOf());
  assert.equal(index.locate('Accuracy was dramatically higher in every single group tested').found, false);
  assert.equal(index.locate('r = -0.27').found, false, 'a very short snippet proves nothing');
  assert.equal(index.locate('   ').found, false);
});

test('QuoteIndex refuses a quote with a short fragment instead of skipping it', () => {
  const index = new QuoteIndex(documentOf());
  // The trailing fragment is fabricated. Silently dropping fragments under the floor
  // would attest the quote because the first fragment does appear in the paper.
  const forged = index.locate('Accuracy was higher in the low anxiety group ... d = 9.99');
  assert.equal(forged.found, false);
  assert.equal(forged.found ? undefined : forged.reason, 'fragment_too_short');
});

test('a quotation that smuggles a fabricated value in a short fragment fails verification', () => {
  const analysis = validAnalysis();
  analysis.dimension3.findings[0].evidence = [{ quote: 'Accuracy was higher in the low anxiety group … d = 9.99' }];
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.equal(report.passed, false);
  assert.ok(codes(report, 'error').includes('quote_fragment_too_short'));
  assert.deepEqual(report.quotes, { total: 1, verified: 0 });
});

// ---------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------

test('a sound deep analysis passes verification', () => {
  const report = verifyDeepReadAnalysis(documentOf(), validAnalysis(), { strategy: 'deep' });
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  assert.deepEqual(report.quotes, { total: 1, verified: 1 });
});

test('a quote that is not in the paper is an error', () => {
  const analysis = validAnalysis();
  analysis.dimension3.findings[0].evidence = [{ quote: 'Accuracy was dramatically higher in every single group tested' }];
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.equal(report.passed, false);
  assert.ok(codes(report, 'error').includes('quote_not_found'));
  assert.ok(codes(report, 'error').includes('direct_without_evidence'), 'the direct finding is left with no verified evidence');
  assert.deepEqual(report.quotes, { total: 1, verified: 0 });
});

test('a quote claimed for the wrong section is a warning, not an error', () => {
  const analysis = validAnalysis();
  analysis.dimension3.findings[0].evidence = [{ quote: 'Accuracy was higher in the low anxiety group, t(118) = 2.31', section: 'discussion' }];
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.equal(report.passed, true);
  assert.ok(codes(report, 'warning').includes('quote_section_mismatch'));
});

test('a direct finding backed only by the introduction or references draws a warning', () => {
  const fromIntro = validAnalysis();
  fromIntro.dimension3.findings[0].evidence = [{ quote: 'Prior work has relied on fixed-trial tasks that are slow and noisy' }];
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), fromIntro, { strategy: 'deep' }), 'warning').includes('direct_evidence_not_from_data'));

  const fromReferences = validAnalysis();
  fromReferences.dimension3.findings[0].evidence = [{ quote: 'a passage that only occurs in the reference list' }];
  const report = verifyDeepReadAnalysis(documentOf(), fromReferences, { strategy: 'deep' });
  assert.ok(codes(report, 'warning').includes('quote_from_references'));
});

test('a finding that only copies its quotation, or a one-word credibility, draws a warning', () => {
  const analysis = validAnalysis();
  analysis.dimension3.findings[0].finding = 'Accuracy was higher in the low anxiety group, t(118) = 2.31';
  analysis.dimension3.findings[0].credibility = 'direct';
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.equal(report.passed, true, 'these are warnings, not errors');
  assert.ok(codes(report, 'warning').includes('finding_restates_quote'));
  assert.ok(codes(report, 'warning').includes('credibility_too_thin'));

  const sound = verifyDeepReadAnalysis(documentOf(), validAnalysis(), { strategy: 'deep' });
  assert.equal(codes(sound).includes('finding_restates_quote'), false);
  assert.equal(codes(sound).includes('credibility_too_thin'), false);
});

test('missing checklist items are errors for deep and standard tiers but only warnings for fast', () => {
  const analysis = validAnalysis();
  if (analysis.dimension2.kind === 'methodology') delete analysis.dimension2.checklist.preregistration;
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' }), 'error').includes('checklist_item_missing'));
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'standard' }), 'error').includes('checklist_item_missing'));
  const fast = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'fast' });
  assert.equal(fast.passed, true);
  assert.ok(codes(fast, 'warning').includes('checklist_item_missing'));
});

test('a checklist item marked reported without a quotation draws a warning, and unknown keys are flagged', () => {
  const analysis = validAnalysis();
  if (analysis.dimension2.kind === 'methodology') {
    analysis.dimension2.checklist.effect_size = { status: 'reported' };
    analysis.dimension2.checklist.vibes = { status: 'unclear' };
  }
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.ok(codes(report, 'warning').includes('checklist_reported_without_evidence'));
  assert.ok(codes(report, 'warning').includes('unknown_checklist_item'));
});

test('a review paper must analyse its argument, and an empirical paper its method', () => {
  const review = validAnalysis({ paperType: 'review', domain: 'review-theory' });
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), review, { strategy: 'standard' }), 'error').includes('dimension2_kind_mismatch'));

  const argumentOnEmpirical = validAnalysis({
    dimension2: { kind: 'argument', claimChain: ['A causes B'], evidenceTypes: ['correlational'], inferenceJumps: [] },
  });
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), argumentOnEmpirical, { strategy: 'standard' }), 'error').includes('dimension2_kind_mismatch'));

  const goodReview = validAnalysis({
    paperType: 'review',
    domain: 'review-theory',
    dimension2: { kind: 'argument', claimChain: ['A causes B'], evidenceTypes: ['correlational'], inferenceJumps: ['From correlation to cause'] },
  });
  assert.equal(verifyDeepReadAnalysis(documentOf(), goodReview, { strategy: 'standard' }).passed, true);
});

test('the reviewer self-audit is required for deep papers and must be anchored and consistent', () => {
  const missing = validAnalysis();
  delete missing.reviewerAudit;
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), missing, { strategy: 'deep' }), 'error').includes('reviewer_audit_missing'));
  assert.equal(verifyDeepReadAnalysis(documentOf(), missing, { strategy: 'standard' }).passed, true, 'optional below the deep tier');

  const empty = validAnalysis();
  empty.reviewerAudit = { attacks: [], noAttackFound: false, mostFragileConclusion: { conclusion: 'x', because: 'y' } };
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), empty, { strategy: 'deep' }), 'error').includes('audit_empty_without_declaration'));

  const declared = validAnalysis();
  declared.reviewerAudit = { attacks: [], noAttackFound: true, mostFragileConclusion: { conclusion: 'x', because: 'y' } };
  assert.equal(verifyDeepReadAnalysis(documentOf(), declared, { strategy: 'deep' }).passed, true);

  const vague = validAnalysis();
  vague.reviewerAudit!.attacks[0].anchor = 'the whole thing is suspicious';
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), vague, { strategy: 'deep' }), 'warning').includes('attack_anchor_vague'));
});

test('an audit attack anchored by a quotation is verified like any other quote', () => {
  const analysis = validAnalysis();
  analysis.reviewerAudit!.attacks[0].anchor = { quote: 'causality cannot be inferred from the present design' };
  const ok = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.deepEqual(ok.quotes, { total: 2, verified: 2 });

  analysis.reviewerAudit!.attacks[0].anchor = { quote: 'a sentence that the authors never wrote anywhere' };
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' }), 'error').includes('quote_not_found'));
});

test('graft targets are checked only when research targets are provided', () => {
  const analysis = validAnalysis();
  assert.equal(codes(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' })).includes('graft_target_unknown'), false);
  const withTargets = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep', researchTargets: ['Phase 1 survey', 'phase 2 wearable study'] });
  assert.equal(codes(withTargets).includes('graft_target_unknown'), false, 'case-insensitive match');
  const unknown = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep', researchTargets: ['Unrelated project'] });
  assert.ok(codes(unknown, 'warning').includes('graft_target_unknown'));
});

// ---------------------------------------------------------------------------------------------
// Concept excavation, model setups, SCQA
// ---------------------------------------------------------------------------------------------

test('the deep tier requires the four-line SCQA scout', () => {
  const without = validAnalysis();
  delete without.scqa;
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), without, { strategy: 'deep' }), 'error').includes('scqa_missing'));
  assert.equal(verifyDeepReadAnalysis(documentOf(), without, { strategy: 'standard' }).passed, true, 'optional at standard');
  assert.equal(verifyDeepReadAnalysis(documentOf(), validAnalysis(), { strategy: 'deep' }).passed, true);
});

test('a concept provenance quote is verified against the paper like any quotation', () => {
  const withConcept = validAnalysis();
  withConcept.concepts = [{
    term: 'Adaptive sampling',
    definition: 'Giving rare events a higher sampling probability so the data cover the full range.',
    provenance: { quote: 'Sampling was adaptive across four-hour blocks, with an inverse frequency weighting of heart rate buckets' },
    analogy: 'Testing a car on highways and mountain roads, not only in the parking lot.'
  }];
  const ok = verifyDeepReadAnalysis(documentOf(), withConcept, { strategy: 'deep' });
  assert.equal(ok.passed, true, JSON.stringify(ok.issues));
  assert.deepEqual(ok.quotes, { total: 2, verified: 2 });

  const forged = validAnalysis();
  forged.concepts = [{
    term: 'Adaptive sampling',
    definition: 'Giving rare events a higher sampling probability so the data cover the full range.',
    provenance: { quote: 'The authors invented adaptive sampling in a prior unpublished manuscript' }
  }];
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), forged, { strategy: 'deep' }), 'error').includes('quote_not_found'));
});

test('a contrast-depth concept target without a matching concept entry draws a warning', () => {
  const analysis = validAnalysis();
  analysis.conceptTargets = [{ term: 'Adaptive sampling', category: 'method', depth: 'contrast' }];
  const report = verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' });
  assert.ok(codes(report, 'warning').includes('concept_missing_for_target'));
  const covered = validAnalysis();
  covered.conceptTargets = [{ term: 'Adaptive sampling', category: 'method', depth: 'contrast' }];
  covered.concepts = [{
    term: 'Adaptive sampling',
    definition: 'Rare events get sampled more often so coverage is complete.',
    provenance: { quote: 'Sampling was adaptive across four-hour blocks, with an inverse frequency weighting of heart rate buckets' }
  }];
  assert.equal(codes(verifyDeepReadAnalysis(documentOf(), covered, { strategy: 'deep' }), 'warning').includes('concept_missing_for_target'), false);
});

test('an unknown-unknown gap that no graft picks up draws a warning', () => {
  const analysis = validAnalysis();
  analysis.dimension1.gaps = [{ text: 'No ecological measure captures interoceptive accuracy during real-world stress', type: 'unknown_unknown' }];
  assert.ok(codes(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' }), 'warning').includes('unknown_unknown_gap_not_grafted'));
  const grafted = validAnalysis();
  grafted.dimension1.gaps = [{ text: 'No ecological measure captures interoceptive accuracy during real-world stress', type: 'unknown_unknown' }];
  grafted.dimension4.grafts = [{
    type: 'method',
    plan: 'No ecological measure captures interoceptive accuracy during real-world stress; build a wearable EMA study to fill exactly that gap.',
    target: 'Phase 2 wearable study'
  }];
  assert.equal(codes(verifyDeepReadAnalysis(documentOf(), grafted, { strategy: 'deep' }), 'warning').includes('unknown_unknown_gap_not_grafted'), false);
});

test('a statistical model setup must anchor its description in the paper when evidence is given', () => {
  const analysis = validAnalysis();
  if (analysis.dimension2.kind === 'methodology') {
    analysis.dimension2.modelSetups = [{
      model: 'lme',
      setup: 'A linear mixed-effects model with by-subject intercepts and the sampling block as a fixed effect.',
      evidence: { quote: 'an inverse frequency weighting of heart rate buckets' }
    }];
  }
  assert.equal(verifyDeepReadAnalysis(documentOf(), analysis, { strategy: 'deep' }).passed, true);

  const forged = validAnalysis();
  if (forged.dimension2.kind === 'methodology') {
    forged.dimension2.modelSetups = [{
      model: 'glm',
      setup: 'A general linear model over the whole time series.',
      evidence: { quote: 'a hierarchical Bayesian model with NUTS sampling and four chains' }
    }];
  }
  const report = verifyDeepReadAnalysis(documentOf(), forged, { strategy: 'deep' });
  assert.ok(codes(report, 'error').includes('quote_not_found'));
});

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

test('planDeepRead assigns tiers by score and keeps input order for ties', () => {
  const papers = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, title: id.toUpperCase(), score: [0.5, 0.9, 0.9, 0.1, 0.7][i] }));
  const plan = planDeepRead(papers, { tier1Count: 2, tier2Count: 2 });
  assert.deepEqual(plan.map((p) => [p.id, p.rank, p.tier]), [['b', 1, 1], ['c', 2, 1], ['e', 3, 2], ['a', 4, 2], ['d', 5, 3]]);
  assert.equal(plan[0].strategy, 'deep');
  assert.equal(plan[2].strategy, 'standard');
  assert.equal(plan[4].strategy, 'metadata');
  assert.equal(plan[4].sections, 'none');
});

test('planDeepRead defaults to three deep and ten partial reads and bounds bad counts', () => {
  const papers = Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: String(i), score: 20 - i }));
  const plan = planDeepRead(papers);
  assert.equal(plan.filter((p) => p.tier === 1).length, 3);
  assert.equal(plan.filter((p) => p.tier === 2).length, 10);
  assert.equal(plan.filter((p) => p.tier === 3).length, 7);
  const bounded = planDeepRead(papers, { tier1Count: -4, tier2Count: Number.NaN });
  assert.equal(bounded.filter((p) => p.tier === 1).length, 0);
  assert.equal(bounded.filter((p) => p.tier === 2).length, 10);
  assert.equal(planDeepRead(papers, { tier1Count: 999 }).filter((p) => p.tier === 1).length, 10);
});

test('selectSections gives the whole body, only method and results, or falls back', () => {
  const doc = documentOf();
  assert.deepEqual(selectSections(doc, 'all_but_references').sections.map((s) => s.kind), ['abstract', 'introduction', 'methods', 'results', 'discussion']);
  assert.deepEqual(selectSections(doc, ['abstract', 'methods', 'results']).sections.map((s) => s.kind), ['abstract', 'methods', 'results']);
  assert.deepEqual(selectSections(doc, 'none'), { sections: [], fellBack: false });

  const review = documentOf([section('other', 'Topic', 'Some topical text of a review article that has no standard sections.', 1), section('references', 'References', 'refs', 3)]);
  const fallback = selectSections(review, ['abstract', 'methods', 'results']);
  assert.equal(fallback.fellBack, true);
  assert.deepEqual(fallback.sections.map((s) => s.kind), ['other']);
});

// ---------------------------------------------------------------------------------------------
// Packet
// ---------------------------------------------------------------------------------------------

const tier1: PlannedPaper = { id: 'paper-1', title: 'A paper', rank: 1, tier: 1, strategy: 'deep', sections: 'all_but_references' };

test('buildDeepReadPacket carries the sections, reliability and domain hint', () => {
  const packet = buildDeepReadPacket({ planned: tier1, document: documentOf() });
  assert.equal(packet.sections.length, 5);
  assert.equal(packet.sections.some((s) => s.kind === 'references'), false);
  assert.deepEqual(packet.omitted, []);
  assert.equal(packet.reliability.status, 'ok');
  assert.equal(DEFAULT_PACKET_MAX_CHARS > 0, true);
});

test('buildDeepReadPacket explains partial reliability to the agent', () => {
  const doc = documentOf();
  doc.reliability = { status: 'partial', recognizedKinds: ['results'], missingCoreKinds: ['introduction'], warnings: ['core_sections_missing', 'introduction_unheaded'] };
  const packet = buildDeepReadPacket({ planned: tier1, document: doc });
  assert.equal(packet.notes.some((note) => note.includes('no heading')), true);
  assert.equal(packet.notes.some((note) => note.includes('not recognized')), true);
});

test('buildDeepReadPacket drops low-priority sections first and says what it dropped', () => {
  const doc = documentOf([
    section('abstract', 'Abstract', 'a'.repeat(300), 1),
    section('methods', 'Methods', 'm'.repeat(300), 2),
    section('results', 'Results', 'r'.repeat(300), 3),
    section('appendix', 'Appendix A', 'x'.repeat(900), 9),
  ]);
  const packet = buildDeepReadPacket({ planned: tier1, document: doc, maxChars: 1_000 });
  assert.deepEqual(packet.sections.map((s) => s.kind), ['abstract', 'methods', 'results']);
  assert.deepEqual(packet.omitted, [{ kind: 'appendix', heading: 'Appendix A', reason: 'over_budget' }]);
  assert.ok(packet.notes.some((note) => note.includes('shortened')));
});

test('verification fails closed when fulltext extraction failed, even for a quote-free fast analysis', () => {
  const doc = documentOf();
  doc.reliability = { status: 'failed', recognizedKinds: [], missingCoreKinds: ['introduction', 'methods', 'results'], warnings: ['no_text_layer'] };
  // A quote-free fast analysis currently passes vacuously (no error issues), yet
  // nothing it says can be checked against a text that failed to extract.
  const report = verifyDeepReadAnalysis(doc, validAnalysis(), { strategy: 'fast' });
  assert.equal(report.passed, false);
  assert.ok(codes(report, 'error').includes('fulltext_unreliable'));
})

test('buildDeepReadPacket truncates the longest section when dropping is not enough', () => {
  const doc = documentOf([section('results', 'Results', 'r'.repeat(5_000), 3), section('methods', 'Methods', 'm'.repeat(500), 2)]);
  const packet = buildDeepReadPacket({ planned: tier1, document: doc, maxChars: 1_200 });
  assert.equal(packet.sections.reduce((sum, s) => sum + s.text.length, 0) <= 1_200, true);
  assert.deepEqual(packet.omitted.map((o) => o.reason), ['truncated']);
});

test('buildDeepReadPacket refuses a tier-3 paper', () => {
  const metadataOnly: PlannedPaper = { ...tier1, tier: 3, strategy: 'metadata', sections: 'none' };
  assert.throws(() => buildDeepReadPacket({ planned: metadataOnly, document: documentOf() }), /tier-3/);
});

// ---------------------------------------------------------------------------------------------
// Domain hint and protocol
// ---------------------------------------------------------------------------------------------

test('detectDomainSignals suggests a domain only when the vocabulary is clear', () => {
  const psych = 'participants '.repeat(5) + 'questionnaire effect size '.repeat(3);
  assert.equal(detectDomainSignals(psych).suggestion, 'psych');
  assert.equal(detectDomainSignals('baseline dataset ablation prompt benchmark '.repeat(3)).suggestion, 'nlp');
  assert.equal(detectDomainSignals('participants questionnaire '.repeat(5) + 'baseline dataset benchmark '.repeat(4)).suggestion, 'hybrid');
  assert.equal(detectDomainSignals('fMRI voxel ROI cortex '.repeat(3)).suggestion, 'neuroscience');
  assert.equal(detectDomainSignals('A short and generic paragraph with no domain vocabulary.').suggestion, null);
});

test('the protocol lists the checklist for the domain and only asks for the audit at the deep tier', () => {
  const deep = buildDeepReadProtocol({ strategy: 'deep', domain: 'psych', paperType: 'empirical' });
  assert.deepEqual(deep.checklist.map((item) => item.key), requiredChecklistKeys('psych'));
  assert.match(deep.instructions, /Reviewer self-audit \(required/);
  assert.match(deep.instructions, /verbatim/);

  const standard = buildDeepReadProtocol({ strategy: 'standard', domain: 'nlp' });
  assert.equal(standard.checklist.length, requiredChecklistKeys('nlp').length);
  assert.match(standard.instructions, /optional for this tier/);
  assert.doesNotMatch(standard.instructions, /Reviewer self-audit \(required/);

  const hybrid = buildDeepReadProtocol({ strategy: 'deep', domain: 'hybrid' });
  assert.equal(hybrid.checklist.length, requiredChecklistKeys('hybrid').length);
});

test('the protocol asks for argument structure instead of a method checklist for reviews', () => {
  const review = buildDeepReadProtocol({ strategy: 'standard', domain: 'review-theory', paperType: 'review' });
  assert.equal(review.checklist.length, 0);
  assert.match(review.instructions, /argument structure/);
  assert.doesNotMatch(review.instructions, /three layers/);
});
