import { PaperRadarWorkerError } from '../contract.js';
import type {
  PaperDeepReadPacketInput,
  PaperDeepReadPacketResult,
  PaperDeepReadPlanResult,
  PaperDeepReadVerifyInput,
  PaperDeepReadVerifyResult,
} from '../deepread-contract.js';
import {
  buildDeepReadPacket,
  planDeepRead,
  plannedPaperForTier,
  type DeepReadTier,
  type TierOptions,
} from './deepread-plan.js';
import { buildProtocolBundle } from './deepread-protocol.js';
import { verifyDeepReadAnalysis } from './deepread-verify.js';
import { extractFulltext, fetchPdfBytes, FulltextError, type FulltextDocument } from './fulltext.js';
import type { RankedPaper } from './types.js';

/**
 * Orchestration of the deep-read capabilities on top of the paper index: which papers to read, the
 * text of one paper, and the mechanical check of an analysis. No model is called here; the agent
 * does the reading.
 */

const DEFAULT_CACHE_ENTRIES = 16;

/** Extracted papers kept in memory so a packet and the later verification see the same text. */
export class FulltextCache {
  private readonly entries = new Map<string, FulltextDocument>();

  constructor(private readonly limit = DEFAULT_CACHE_ENTRIES) {}

  get(key: string): FulltextDocument | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, document: FulltextDocument): void {
    this.entries.delete(key);
    this.entries.set(key, document);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export interface DeepReadRuntime {
  fetchImpl?: typeof fetch;
  cache: FulltextCache;
  getPaper(id: string): RankedPaper;
}

export interface RankedForPlan {
  profile: string;
  count: number;
  papers: readonly RankedPaper[];
}

export function buildPlanResult(ranked: RankedForPlan, options: Partial<TierOptions>): PaperDeepReadPlanResult {
  const byId = new Map(ranked.papers.map((paper) => [paper.id, paper]));
  const plan = planDeepRead(
    ranked.papers.map((paper) => ({ id: paper.id, title: paper.title, score: paper.score })),
    options,
  ).map((item) => ({
    id: item.id,
    title: item.title,
    rank: item.rank,
    tier: item.tier,
    strategy: item.strategy,
    hasPdf: Boolean(byId.get(item.id)?.pdfUrl),
  }));
  return { profile: ranked.profile, count: ranked.count, plan };
}

/** Download and extract one paper, or return the copy extracted earlier. */
async function loadFulltext(runtime: DeepReadRuntime, paper: RankedPaper, signal?: AbortSignal): Promise<FulltextDocument> {
  if (!paper.pdfUrl) {
    throw new PaperRadarWorkerError({
      code: 'not_found',
      reason: `Paper "${paper.id}" has no PDF address in the index, so its full text cannot be read.`,
      retryable: false,
      suggestion: 'Work from the abstract, or choose another paper.',
    });
  }
  const key = `${paper.id}|${paper.pdfUrl}`;
  const cached = runtime.cache.get(key);
  if (cached) return cached;
  try {
    const bytes = await fetchPdfBytes(paper.pdfUrl, { fetchImpl: runtime.fetchImpl, signal });
    const document = await extractFulltext(bytes);
    runtime.cache.set(key, document);
    return document;
  } catch (error) {
    if (error instanceof FulltextError) {
      const transient = error.code === 'timeout' || error.code === 'upstream_error';
      throw new PaperRadarWorkerError({
        code: error.code === 'extract_failed' ? 'unknown' : 'upstream_error',
        reason: error.message,
        retryable: transient,
        suggestion: transient
          ? 'Retry later; the publisher or network may be unavailable.'
          : 'This PDF cannot be read automatically. Work from the abstract, or obtain the file another way.',
      });
    }
    throw error;
  }
}

const STRATEGY_TIER: Record<PaperDeepReadPacketInput['strategy'], DeepReadTier> = { deep: 1, standard: 2 };

export async function buildPacketResult(
  runtime: DeepReadRuntime,
  input: PaperDeepReadPacketInput,
  signal?: AbortSignal,
): Promise<PaperDeepReadPacketResult> {
  const paper = runtime.getPaper(input.paper_id);
  const document = await loadFulltext(runtime, paper, signal);
  const planned = plannedPaperForTier(paper, 1, STRATEGY_TIER[input.strategy]);
  const packet = buildDeepReadPacket({ planned, document, maxChars: input.max_chars });
  return { packet, protocol: buildProtocolBundle(input.strategy) };
}

export async function buildVerifyResult(
  runtime: DeepReadRuntime,
  input: PaperDeepReadVerifyInput,
  signal?: AbortSignal,
): Promise<PaperDeepReadVerifyResult> {
  const paper = runtime.getPaper(input.paper_id);
  const document = await loadFulltext(runtime, paper, signal);
  const report = verifyDeepReadAnalysis(document, input.analysis, {
    strategy: input.strategy,
    researchTargets: input.research_targets,
  });
  const issues = [...report.issues];
  if (input.analysis.paperId !== paper.id) {
    issues.unshift({
      severity: 'error',
      code: 'paper_id_mismatch',
      path: 'analysis.paperId',
      message: `The analysis is labelled "${input.analysis.paperId}" but was submitted for "${paper.id}".`,
    });
  }
  return {
    paperId: paper.id,
    passed: !issues.some((issue) => issue.severity === 'error'),
    issues,
    quotes: report.quotes,
  };
}
