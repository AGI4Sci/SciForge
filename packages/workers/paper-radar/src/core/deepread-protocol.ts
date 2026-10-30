import {
  ARGUMENT_PAPER_TYPES,
  REVIEWER_DIMENSIONS,
  requiredChecklistKeys,
  type DeepReadDomain,
  type PaperType,
} from './deepread-schema.js';
import type { DeepReadStrategy } from './deepread-verify.js';

/**
 * The instructions an agent follows when it deep-reads a paper from a packet.
 *
 * The method is a five-dimension reading: what the paper builds on, how its method works and where
 * it is fragile, what it found, how the reader can use it, and how much it matters. Everything the
 * agent writes is checked afterwards against the paper text (see deepread-verify.ts), so the
 * protocol tells it plainly what will and will not pass.
 */

export const DEEP_READ_PROTOCOL_VERSION = '1';

const CHECKLIST_QUESTIONS: Record<string, string> = {
  effect_size: 'Are effect sizes reported (Cohen\'s d, eta squared, r)?',
  confidence_interval: 'Are confidence intervals reported?',
  multiple_comparison_correction: 'Is a multiple-comparison correction applied and named (Bonferroni, FDR, FWE)?',
  a_priori_power_analysis: 'Was sample size justified by an a priori power analysis?',
  preregistration: 'Was the study preregistered? (Absence is normal before about 2015.)',
  open_data: 'Are the raw data available?',
  confirmatory_vs_exploratory: 'Were analyses specified in advance, or are they post hoc?',
  baseline_fairness: 'Were baselines tuned with the same budget as the proposed method?',
  significance_testing: 'Are significance tests reported, or only means?',
  metric_choice: 'Why this metric, and would the conclusion survive another metric?',
  multiple_runs: 'Are results averaged over several seeds with variance, or from a single run?',
  ablation_completeness: 'Does every new component have its own ablation?',
  contamination_leakage: 'Could training and test data overlap, or could pretraining data be contaminated?',
  human_evaluation: 'For human evaluation: how many raters, what instructions, what agreement (kappa, ICC)?',
  code_and_weights_released: 'Are code and weights released so the result can be reproduced?',
  acquisition_parameters: 'Are the fMRI acquisition parameters given (TR, TE, voxel size, sequence)?',
  preprocessing_pipeline: 'Is the preprocessing pipeline specified (motion correction, smoothing, normalization)?',
  roi_definition: 'Were ROIs defined in advance or from the data?',
  mvpa_scheme: 'For MVPA: which classifier and which cross-validation scheme?',
  image_controls: 'Were low-level visual features controlled?',
};

export interface DeepReadProtocol {
  version: string;
  strategy: DeepReadStrategy;
  domain: DeepReadDomain | null;
  paperType: PaperType | null;
  /** Checklist items the analysis must cover for this domain. */
  checklist: Array<{ key: string; question: string }>;
  /** Markdown the agent reads before analysing. */
  instructions: string;
}

export function buildDeepReadProtocol(input: {
  strategy: DeepReadStrategy;
  domain?: DeepReadDomain;
  paperType?: PaperType;
}): DeepReadProtocol {
  const { strategy } = input;
  const domain = input.domain ?? null;
  const paperType = input.paperType ?? null;
  const argumentPaper = paperType !== null && ARGUMENT_PAPER_TYPES.includes(paperType);
  const checklistKeys = domain && !argumentPaper ? requiredChecklistKeys(domain) : [];
  const checklist = checklistKeys.map((key) => ({ key, question: CHECKLIST_QUESTIONS[key] ?? key }));

  const lines: string[] = [];
  lines.push('# Deep-read protocol');
  lines.push('');
  lines.push(
    'Read the packet and write one analysis object. The aim is to understand the paper well enough to reproduce it, criticize it, borrow from it, and argue with it. Your analysis is checked against the paper text afterwards.',
  );
  lines.push('');
  lines.push('## Rules that are checked mechanically');
  lines.push('');
  lines.push('- Every `evidence.quote` must be copied **verbatim** from the packet, at least 20 characters. Use "..." to skip text inside one section. A quotation that does not appear in the paper fails the analysis.');
  lines.push('- Do not put your own wording inside a quote. Put paraphrase in the surrounding field.');
  lines.push('- A finding graded `direct` must have at least one verified quotation, preferably from the results. Grade `indirect` for claims that rest on other work or inference, and `unsupported` for claims asserted without data.');
  lines.push('- If the packet omits sections (see `omitted` and `notes`), say what you could not check. Do not guess at what the missing text says.');
  lines.push('- When unsure, use `unclear` or `to_verify`. A confident wrong answer is worse than an honest gap.');
  lines.push('');
  lines.push('## What to produce');
  lines.push('');
  lines.push('**Dimension 1 — what it builds on.** Three to five established premises, two or three gaps (mark each as known unknown or unknown unknown where it applies), and the aim in one sentence.');
  lines.push('');
  if (argumentPaper) {
    lines.push('**Dimension 2 — argument structure.** This is a ' + paperType + ' paper, so there is no experiment to dissect. Give the chain of claims, the kind of evidence behind each, and the points where the reasoning jumps.');
  } else {
    lines.push('**Dimension 2 — method, in three layers.**');
    lines.push('1. What the authors did: participants or data, task or pipeline, procedure.');
    lines.push('2. Why they did it: for each design choice, the reason. ' + (strategy === 'deep' ? 'Give at least three.' : 'Keep it short for this tier.'));
    lines.push('3. Where it breaks: for each change (fewer participants, another statistic, another baseline, another seed), whether the conclusion holds. Mark a conclusion `sensitive` if any change overturns it.');
    if (checklist.length === 0) {
      lines.push('');
      lines.push('Decide the domain (`psych`, `nlp`, `neuroscience`, `hybrid`) and fill the matching methodology checklist from `checklists`. `domainSignals` in the packet is only a hint, not a verdict.');
    } else {
      lines.push('');
      lines.push(`Fill the **${domain}** checklist. Every key below needs a status (\`reported\`, \`absent\` or \`unclear\`); quote the passage when you say \`reported\`.`);
      for (const item of checklist) lines.push(`- \`${item.key}\`: ${item.question}`);
    }
  }
  lines.push('');
  lines.push('**Dimension 3 — core findings.** Two to four, most important first. For each: what was found with the reported numbers, which theory it supports or challenges, whether you believe the effect size and why, its `strength` and `source`, and the quotations behind it. Watch for conclusions that start as direct evidence in the results and drift toward unsupported claims in the discussion.');
  lines.push('');
  lines.push('**Dimension 4 — how the reader can use it.** At least one concrete plan (method, theory, concept, quotable passage, rebuttal or implementation), each tied to a specific project, phase or question of the reader\'s own work in `target`.');
  lines.push('');
  lines.push('**Dimension 5 — importance.** One of `cornerstone`, `signpost`, `toolbox`, `fork_in_the_road`, `horizon`, with the reason.');
  lines.push('');
  if (strategy === 'deep') {
    lines.push('**SCQA scout (required for this tier).** Before the full read, write the four-line frame: the situation the field is in, the complication or gap that motivates the paper, the question it asks, and its answer in one line. It keeps the long read anchored.');
    lines.push('');
  }
  lines.push('**Concept excavation.** For each load-bearing term in `conceptTargets`, write a `concepts` entry: a plain-language first sentence (not an academic restatement), a `provenance` quote that locates the concept in the paper (or set `provenanceUncertain` honestly when the source cannot be pinned down), an optional `contrastWith` for the neighbouring concept it is confused with, a real-life `analogy`, and at most one load-bearing `subConcept`. Every `contrast`-depth target in `conceptTargets` must be covered by an entry.');
  lines.push('');
  lines.push('**Model setups.** When the paper leans on a statistical model (RM-ANOVA, GLM, hierarchical Bayes, linear mixed effects, Bayesian ANOVA/t-test), say in `dimension2.modelSetups` how it is actually set up — factors or design matrix, priors, corrections — in plain language, with an evidence quote. "They used a GLM" is not a setup.');
  lines.push('');
  lines.push('**Concept targets.** Key terms worth a deeper look later, each with a category and a depth.');
  lines.push('');
  if (strategy === 'deep') {
    lines.push('## Reviewer self-audit (required for this tier)');
    lines.push('');
    lines.push('After the analysis, argue against it. Scan all seven dimensions and record the attacks that hold up:');
    for (const dimension of REVIEWER_DIMENSIONS) lines.push(`- \`${dimension}\``);
    lines.push('');
    lines.push('Each attack needs a severity and an **anchor**: a verbatim quotation, or a named table, figure, section or value. Mark attacks you are sure of `rebuttal` and the rest `to_verify`. If nothing holds up after all seven, set `noAttackFound` and say so. Finish with the conclusion that is hardest to defend and why.');
    lines.push('');
  } else if (strategy === 'standard') {
    lines.push('The reviewer self-audit is optional for this tier.');
    lines.push('');
  } else {
    lines.push('For this tier, spend your effort on dimensions 1, 3 and 4. Keep dimensions 2 and 5 brief.');
    lines.push('');
  }
  return { version: DEEP_READ_PROTOCOL_VERSION, strategy, domain, paperType, checklist, instructions: lines.join('\n') };
}

/** The protocol plus every domain's checklist, for callers that do not know the domain yet. */
export function buildProtocolBundle(strategy: DeepReadStrategy): {
  version: string;
  strategy: DeepReadStrategy;
  instructions: string;
  checklists: Record<string, Array<{ key: string; question: string }>>;
} {
  const base = buildDeepReadProtocol({ strategy });
  const checklists: Record<string, Array<{ key: string; question: string }>> = {};
  for (const domain of ['psych', 'nlp', 'neuroscience', 'hybrid'] as const) {
    checklists[domain] = buildDeepReadProtocol({ strategy, domain, paperType: 'empirical' }).checklist;
  }
  return { version: base.version, strategy, instructions: base.instructions, checklists };
}
