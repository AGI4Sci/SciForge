import { z } from 'zod';

import { deepReadAnalysisSchema, DEEP_READ_DOMAINS } from './core/deepread-schema.js';

export { deepReadAnalysisSchema, type DeepReadAnalysis } from './core/deepread-schema.js';
import { paperRankInputSchema } from './contract.js';

/**
 * Service contract of the deep-read capabilities.
 *
 * Reading is split so that each call returns a bounded amount of text: first a plan over the ranked
 * papers, then one paper's text packet at a time, then a mechanical check of the analysis the agent
 * wrote for it.
 */

const paperIdSchema = z.string().trim().min(1).max(200);

export const DEEP_READ_PACKET_STRATEGIES = ['deep', 'standard'] as const;
export const DEEP_READ_VERIFY_STRATEGIES = ['deep', 'standard', 'fast'] as const;

export const paperDeepReadPlanInputSchema = paperRankInputSchema
  .extend({
    tier1_count: z.number().int().min(0).max(10).optional(),
    tier2_count: z.number().int().min(0).max(50).optional(),
  })
  .strict();

export const paperDeepReadPacketInputSchema = z
  .object({
    paper_id: paperIdSchema,
    strategy: z.enum(DEEP_READ_PACKET_STRATEGIES),
    max_chars: z.number().int().min(1_000).max(400_000).optional(),
  })
  .strict();

export const DEEP_READ_NOTE_RELATIONS = ['support', 'refute', 'qualify'] as const;

/** One note layer: a non-empty bounded string (at most 4 KiB). */
const deepReadNoteLayerSchema = z.string().trim().min(1).max(4096);

/**
 * Optional four-layer structured reading note (LitEngram-style): concept definition with
 * theoretical origin, the concept's role in this paper, its relation to the paper's core
 * argument, and a critical extension. Exactly these four layers; the object is strict.
 */
export const deepReadStructuredNoteSchema = z
  .object({
    definition: deepReadNoteLayerSchema,
    roleInPaper: deepReadNoteLayerSchema,
    argumentativeRelation: z
      .object({
        relation: z.enum(DEEP_READ_NOTE_RELATIONS),
        detail: z.string().trim().max(4096).optional(),
      })
      .strict(),
    criticalExtension: deepReadNoteLayerSchema,
  })
  .strict();

export type DeepReadStructuredNote = z.infer<typeof deepReadStructuredNoteSchema>;

export const paperDeepReadVerifyInputSchema = z
  .object({
    paper_id: paperIdSchema,
    strategy: z.enum(DEEP_READ_VERIFY_STRATEGIES),
    analysis: deepReadAnalysisSchema,
    /** The reader's own projects or questions. When given, graft targets are checked against them. */
    research_targets: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  })
  .strict();

const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
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

export const paperDeepReadPlanItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    rank: z.number().int().min(1),
    tier: tierSchema,
    strategy: z.enum(['deep', 'standard', 'metadata']),
    /** False when the index has no PDF address for the paper, so it cannot be read in full. */
    hasPdf: z.boolean(),
  })
  .strict();

export const paperDeepReadPlanResultSchema = z
  .object({
    profile: z.string(),
    count: z.number().int().nonnegative(),
    plan: z.array(paperDeepReadPlanItemSchema),
  })
  .strict();

const reliabilitySchema = z
  .object({
    status: z.enum(['ok', 'partial', 'failed']),
    recognizedKinds: z.array(sectionKindSchema),
    missingCoreKinds: z.array(sectionKindSchema),
    warnings: z.array(
      z.enum(['no_text_layer', 'no_headings_found', 'core_sections_missing', 'introduction_unheaded', 'truncated_pages', 'truncated_chars']),
    ),
  })
  .strict();

export const paperDeepReadPacketSchema = z
  .object({
    paperId: z.string(),
    title: z.string(),
    tier: tierSchema,
    strategy: z.enum(['deep', 'standard', 'fast']),
    reliability: reliabilitySchema,
    domainSignals: z
      .object({
        psych: z.number(),
        nlp: z.number(),
        neuroscience: z.number(),
        suggestion: z.enum(DEEP_READ_DOMAINS).nullable(),
      })
      .strict(),
    sections: z.array(
      z.object({ kind: sectionKindSchema, heading: z.string(), pageStart: z.number(), pageEnd: z.number(), text: z.string() }).strict(),
    ),
    omitted: z.array(
      z.object({ kind: sectionKindSchema, heading: z.string(), reason: z.enum(['over_budget', 'truncated']) }).strict(),
    ),
    notes: z.array(z.string()),
    /** Optional four-layer structured reading note attached to this packet. */
    note: deepReadStructuredNoteSchema.optional(),
  })
  .strict();

export const paperDeepReadProtocolSchema = z
  .object({
    version: z.string(),
    strategy: z.enum(['deep', 'standard', 'fast']),
    /** Markdown the agent reads before analysing. */
    instructions: z.string(),
    /** Methodology checklist items per domain; the analysis must cover the ones for its domain. */
    checklists: z.record(z.string(), z.array(z.object({ key: z.string(), question: z.string() }).strict())),
  })
  .strict();

export const paperDeepReadPacketResultSchema = z
  .object({
    packet: paperDeepReadPacketSchema,
    protocol: paperDeepReadProtocolSchema,
  })
  .strict();

export const paperDeepReadVerifyResultSchema = z
  .object({
    paperId: z.string(),
    passed: z.boolean(),
    issues: z.array(
      z.object({ severity: z.enum(['error', 'warning']), code: z.string(), path: z.string(), message: z.string() }).strict(),
    ),
    quotes: z.object({ total: z.number().int().nonnegative(), verified: z.number().int().nonnegative() }).strict(),
  })
  .strict();

export type PaperDeepReadPlanInput = z.infer<typeof paperDeepReadPlanInputSchema>;
export type PaperDeepReadPacketInput = z.infer<typeof paperDeepReadPacketInputSchema>;
export type PaperDeepReadVerifyInput = z.infer<typeof paperDeepReadVerifyInputSchema>;
export type PaperDeepReadPlanResult = z.infer<typeof paperDeepReadPlanResultSchema>;
export type PaperDeepReadPacketResult = z.infer<typeof paperDeepReadPacketResultSchema>;
export type PaperDeepReadVerifyResult = z.infer<typeof paperDeepReadVerifyResultSchema>;
