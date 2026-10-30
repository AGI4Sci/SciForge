import { z } from 'zod';

/**
 * Shape of a deep-read analysis that the agent submits for one paper.
 *
 * The agent does the reading and reasoning; this package only defines what a complete analysis
 * looks like and checks it mechanically (see deepread-verify.ts). The structure follows a
 * five-dimension reading method: background, methodology, findings, strategic use, importance.
 */

export const PAPER_TYPES = [
  'empirical',
  'methods',
  'theory',
  'review',
  'benchmark',
  'replication',
  'position',
  'resource',
  'system',
] as const;
export type PaperType = (typeof PAPER_TYPES)[number];

/** Review, theory and position papers have no participants or experiment to dissect. */
export const ARGUMENT_PAPER_TYPES: readonly PaperType[] = ['theory', 'review', 'position'];

export const DEEP_READ_DOMAINS = ['psych', 'nlp', 'hybrid', 'neuroscience', 'review-theory'] as const;
export type DeepReadDomain = (typeof DEEP_READ_DOMAINS)[number];

/** Methodology checklist items required for each domain. Hybrid papers run both lists. */
export const DOMAIN_CHECKLISTS: Record<'psych' | 'nlp' | 'neuroscience', readonly string[]> = {
  psych: [
    'effect_size',
    'confidence_interval',
    'multiple_comparison_correction',
    'a_priori_power_analysis',
    'preregistration',
    'open_data',
    'confirmatory_vs_exploratory',
  ],
  nlp: [
    'baseline_fairness',
    'significance_testing',
    'metric_choice',
    'multiple_runs',
    'ablation_completeness',
    'contamination_leakage',
    'human_evaluation',
    'code_and_weights_released',
  ],
  neuroscience: [
    'acquisition_parameters',
    'preprocessing_pipeline',
    'roi_definition',
    'mvpa_scheme',
    'multiple_comparison_correction',
    'image_controls',
  ],
};

export function requiredChecklistKeys(domain: DeepReadDomain): string[] {
  switch (domain) {
    case 'psych':
      return [...DOMAIN_CHECKLISTS.psych];
    case 'nlp':
      return [...DOMAIN_CHECKLISTS.nlp];
    case 'neuroscience':
      return [...DOMAIN_CHECKLISTS.neuroscience];
    case 'hybrid':
      return [...new Set([...DOMAIN_CHECKLISTS.psych, ...DOMAIN_CHECKLISTS.nlp])];
    case 'review-theory':
      return [];
  }
}

/** Every checklist key across all domains. */
export function allChecklistKeys(): string[] {
  return [...new Set([...DOMAIN_CHECKLISTS.psych, ...DOMAIN_CHECKLISTS.nlp, ...DOMAIN_CHECKLISTS.neuroscience])];
}

export const REVIEWER_DIMENSIONS = [
  'methodological_hazards',
  'unexcluded_alternative_explanations',
  'missing_controls',
  'statistical_robustness',
  'validity_threats',
  'generalizability',
  'novelty',
] as const;

const sectionKindSchema = z.enum([
  'front_matter',
  'abstract',
  'introduction',
  'background',
  'methods',
  'results',
  'discussion',
  'conclusion',
  'references',
  'acknowledgements',
  'appendix',
  'other',
]);

const text = (max = 2_000) => z.string().trim().min(1).max(max);

/** A verbatim quotation from the paper that backs a statement. It is checked against the text. */
export const evidenceQuoteSchema = z
  .object({
    quote: z.string().trim().min(20).max(1_200),
    /** Where the agent says the quote is. Checked, not trusted. */
    section: sectionKindSchema.optional(),
  })
  .strict();
export type EvidenceQuote = z.infer<typeof evidenceQuoteSchema>;

const checklistItemSchema = z
  .object({
    status: z.enum(['reported', 'absent', 'unclear']),
    note: text(600).optional(),
    evidence: evidenceQuoteSchema.optional(),
  })
  .strict();

export const methodologyDimensionSchema = z
  .object({
    kind: z.literal('methodology'),
    /** Layer 1: what the authors did. */
    operations: text(4_000),
    /** Layer 2: why they did it, one entry per design choice. */
    designLogic: z.array(z.object({ choice: text(400), why: text(1_000) }).strict()).min(1).max(12),
    checklist: z.record(z.string(), checklistItemSchema),
    /** Layer 3: what happens to the conclusion if a design choice changes. */
    limits: z
      .array(
        z
          .object({
            change: text(400),
            verdict: z.enum(['robust', 'sensitive', 'unknown']),
            note: text(800).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    /**
     * For papers that fit a known statistical model family: how the model is
     * actually set up (factors, design matrix, priors, corrections), in plain
     * language, anchored in the paper. "They used a GLM" is not a setup.
     */
    modelSetups: z
      .array(
        z
          .object({
            model: z.enum(['rm_anova', 'glm', 'hbm', 'lme', 'bayesian_anova', 'bayesian_t', 'other']),
            setup: text(1_500),
            evidence: evidenceQuoteSchema.optional(),
          })
          .strict(),
      )
      .max(6)
      .optional(),
  })
  .strict();

export const argumentDimensionSchema = z
  .object({
    kind: z.literal('argument'),
    claimChain: z.array(text(600)).min(1).max(12),
    evidenceTypes: z.array(text(200)).min(1).max(8),
    inferenceJumps: z.array(text(600)).max(12),
  })
  .strict();

export const findingSchema = z
  .object({
    finding: text(800),
    /** Numbers, effect size and direction as reported. */
    reported: text(600).optional(),
    theoryRelation: text(600).optional(),
    credibility: text(800),
    /** direct: this paper's data support it. indirect: cites other work or inference. unsupported: asserted only. */
    strength: z.enum(['direct', 'indirect', 'unsupported']),
    source: z.enum(['empirical', 'simulation', 'theoretical', 'review']),
    evidence: z.array(evidenceQuoteSchema).max(4),
  })
  .strict();

export const graftSchema = z
  .object({
    type: z.enum(['method', 'theory', 'concept', 'quotable_passage', 'rebuttal', 'implementation']),
    plan: text(1_200),
    /** The concrete project, phase or question of the reader's own work that this feeds. */
    target: text(300),
  })
  .strict();

/**
 * One level of concept excavation (the second level cannot nest further, so
 * the recursion depth is structurally capped at 2). Aligned with the
 * concept-excavation method: a plain-language first sentence, provenance that
 * is either located in the paper or explicitly declared uncertain, an
 * optional contrast with a neighbouring concept, a human analogy, and one
 * load-bearing sub-concept at most.
 */
const conceptCoreShape = {
  term: text(200),
  /** First sentence must be plain language, not an academic restatement. */
  definition: text(600),
  /** Where the paper introduces or uses the concept; checked against the text. */
  provenance: evidenceQuoteSchema,
  /** Set when the source cannot be pinned down; honesty over false precision. */
  provenanceUncertain: z.boolean().optional(),
  contrastWith: text(300).optional(),
  /** A real-life analogy, not a restatement of the definition. */
  analogy: text(400).optional(),
};

const innerConceptSchema = z.object(conceptCoreShape).strict();

export const conceptSchema = z
  .object({
    ...conceptCoreShape,
    /** One load-bearing sub-concept, excavated inline. No deeper nesting. */
    subConcept: innerConceptSchema.optional(),
  })
  .strict();
export type Concept = z.infer<typeof conceptSchema>;

export const reviewerAttackSchema = z
  .object({
    dimension: z.enum(REVIEWER_DIMENSIONS),
    attack: text(1_200),
    severity: z.enum(['high', 'medium', 'low']),
    /** Every attack must be anchored in the paper: a quotation, or a named table, figure or value. */
    anchor: z.union([evidenceQuoteSchema, text(300)]),
    status: z.enum(['rebuttal', 'to_verify']),
  })
  .strict();

export const reviewerAuditSchema = z
  .object({
    attacks: z.array(reviewerAttackSchema).max(14),
    /** Set when all seven dimensions were scanned and nothing held up. */
    noAttackFound: z.boolean().default(false),
    mostFragileConclusion: z.object({ conclusion: text(600), because: text(1_000) }).strict(),
  })
  .strict();

export const deepReadAnalysisSchema = z
  .object({
    paperId: text(200),
    paperType: z.enum(PAPER_TYPES),
    domain: z.enum(DEEP_READ_DOMAINS),
    dimension1: z
      .object({
        known: z.array(text(600)).min(1).max(8),
        gaps: z
          .array(
            z
              .object({
                text: text(600),
                type: z.enum(['known_known', 'known_unknown', 'unknown_unknown']).optional(),
              })
              .strict(),
          )
          .max(5),
        aim: text(600),
      })
      .strict(),
    dimension2: z.discriminatedUnion('kind', [methodologyDimensionSchema, argumentDimensionSchema]),
    dimension3: z.object({ findings: z.array(findingSchema).min(1).max(6) }).strict(),
    dimension4: z.object({ grafts: z.array(graftSchema).min(1).max(10) }).strict(),
    dimension5: z
      .object({
        category: z.enum(['cornerstone', 'signpost', 'toolbox', 'fork_in_the_road', 'horizon']),
        rationale: text(1_000),
      })
      .strict(),
    conceptTargets: z
      .array(
        z
          .object({
            term: text(200),
            category: z.enum(['method', 'concept', 'theory', 'neuroscience']),
            depth: z.enum(['simple', 'standard', 'contrast']),
          })
          .strict(),
      )
      .max(40),
    /** First-pass scout: four lines that frame the paper before the full read. Required at the deep tier. */
    scqa: z
      .object({
        situation: text(400),
        complication: text(400),
        question: text(300),
        answer: text(400),
      })
      .strict()
      .optional(),
    /** Excavated concepts, one per load-bearing term. Provenance quotes are checked against the text. */
    concepts: z.array(conceptSchema).max(8).optional(),
    /** Required for deep-tier papers. */
    reviewerAudit: reviewerAuditSchema.optional(),
  })
  .strict();

export type DeepReadAnalysis = z.infer<typeof deepReadAnalysisSchema>;
export type ReviewerAudit = z.infer<typeof reviewerAuditSchema>;
