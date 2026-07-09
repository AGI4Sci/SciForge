import type {
  ExperimentRun,
  MemoryItemDraft,
  ReflectionOutput
} from './types.js'

export function reflectExperimentRuns(input: {
  projectId: string
  runs: ExperimentRun[]
  includeWeakCandidates?: boolean
  create: (draft: MemoryItemDraft) => unknown
}): ReflectionOutput {
  const completed = input.runs.filter((run) => run.status === 'completed')
  const created = []
  if (completed.length === 0) {
    return { created: [], activeCount: 0, candidateCount: 0, hypothesisCount: 0 }
  }

  const metric = selectMetric(completed)
  if (!metric) {
    if (input.includeWeakCandidates) {
      created.push(input.create({
        projectId: input.projectId,
        type: 'hypothesis',
        claim: 'Completed runs exist but no parseable numeric metric was recorded; the next iteration should add a stable evaluation metric.',
        rationale: 'Research Memory could not compare runs without numeric metrics.',
        recommendedAction: 'Add metrics.json to every run before treating any model variant as better.',
        evidenceRefs: completed.map((run) => `experiment:${run.id}`),
        sourceRunIds: completed.map((run) => run.id),
        confidence: 0.4
      }))
    }
    return summarizeCreated(created)
  }

  const comparable = completed.filter((run) => hasNumericMetric(run, metric.name))
  const ranked = [...comparable].sort((a, b) => metric.higherIsBetter
    ? numericMetric(b, metric.name) - numericMetric(a, metric.name)
    : numericMetric(a, metric.name) - numericMetric(b, metric.name))
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  const evidenceRefs = runEvidenceRefs(best, metric.name)

  created.push(input.create({
    projectId: input.projectId,
    type: 'method_choice',
    claim: `${best.id} is the current baseline for ${metric.name}.`,
    rationale: `${best.title} produced the strongest ${metric.name} (${formatMetric(numericMetric(best, metric.name))}) among ${comparable.length} comparable completed run(s).`,
    recommendedAction: `Use ${best.id} as the baseline for the next training plan and change one factor at a time.`,
    evidenceRefs,
    sourceRunIds: [best.id],
    confidence: completed.length > 1 ? 0.78 : 0.68
  }))

  created.push(input.create({
    projectId: input.projectId,
    type: 'experiment_insight',
    claim: `${metric.name} currently tracks the most useful model iteration signal.`,
    rationale: `The latest reflection ranked completed runs by ${metric.name}; ${best.id} led the comparison.`,
    recommendedAction: `Report ${metric.name} with every future run and keep artifact/log refs attached.`,
    evidenceRefs,
    sourceRunIds: [best.id],
    confidence: 0.72
  }))

  if (worst.id !== best.id) {
    created.push(input.create({
      projectId: input.projectId,
      type: 'negative_result',
      claim: `${worst.id} should not be the mainline configuration unless a new constraint changes the objective.`,
      rationale: `${worst.title} was weakest on ${metric.name} (${formatMetric(numericMetric(worst, metric.name))}) compared with ${best.id}.`,
      recommendedAction: `Avoid repeating ${worst.id}'s parameter mix without a targeted ablation.`,
      evidenceRefs: runEvidenceRefs(worst, metric.name),
      sourceRunIds: [worst.id],
      confidence: 0.7
    }))
  }

  if (input.includeWeakCandidates) {
    created.push(input.create({
      projectId: input.projectId,
      type: 'hypothesis',
      claim: `A targeted ablation around ${best.id}'s strongest parameter may improve ${metric.name}.`,
      rationale: 'The current run ledger identifies a baseline but does not yet isolate which parameter caused the improvement.',
      recommendedAction: `Design the next run by varying one parameter from ${best.id} and keeping dataset, seed, and evaluation fixed.`,
      evidenceRefs,
      sourceRunIds: [best.id],
      confidence: 0.48
    }))
  }

  return summarizeCreated(created)
}

type MetricSelection = {
  name: string
  higherIsBetter: boolean
}

function selectMetric(runs: ExperimentRun[]): MetricSelection | null {
  const counts = new Map<string, number>()
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.metrics ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (!isComparableMetricName(key)) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const candidates = [...counts.entries()].filter(([, count]) => count > 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1]
    const ai = metricPriority(a[0])
    const bi = metricPriority(b[0])
    if (ai !== bi) return ai - bi
    return a[0].localeCompare(b[0])
  })
  const name = candidates[0][0]
  return {
    name,
    higherIsBetter: !/(loss|error|rmse|mae|wer|cer|nll|brier|ece)$/i.test(name)
  }
}

function isComparableMetricName(name: string): boolean {
  const lower = name.toLowerCase()
  if (/(^|_)(epoch|step|timestamp|elapsed|duration|time|seed|batch|lr|learning_rate|warmup|weight_decay|dropout|params?|samples?|noise|gpu|torch|version|marker|schedule|optimizer)(_|$)/u.test(lower)) {
    return false
  }
  return /(loss|acc|accuracy|f1|auc|auroc|score|error|rmse|mae|wer|cer|precision|recall|ece|calibration|nll|brier)/u.test(lower)
}

function metricPriority(name: string): number {
  const lower = name.toLowerCase()
  const preferred = [
    /^test_loss$/,
    /^val(?:idation)?_loss$/,
    /^eval_loss$/,
    /^final_val_loss$/,
    /^loss$/,
    /^test_(?:acc|accuracy)$/,
    /^val(?:idation)?_(?:acc|accuracy)$/,
    /^best_val_(?:acc|accuracy)$/,
    /^accuracy$/,
    /^f1$/,
    /^test_f1$/,
    /^auroc$/,
    /^auc$/,
    /^ece$/,
    /^brier$/,
    /^score$/
  ]
  const index = preferred.findIndex((pattern) => pattern.test(lower))
  return index === -1 ? 999 : index
}

function numericMetric(run: ExperimentRun, key: string): number {
  const value = run.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY
}

function hasNumericMetric(run: ExperimentRun, key: string): boolean {
  const value = run.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value)
}

function runEvidenceRefs(run: ExperimentRun, metricName: string): string[] {
  return [
    `experiment:${run.id}`,
    `metric:${run.id}:${metricName}`,
    ...(run.logsExcerpt ? [`log:${run.id}`] : []),
    ...run.artifactRefs.map((artifact) => artifact.startsWith('artifact:') ? artifact : `artifact:${artifact}`)
  ]
}

function formatMetric(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : 'n/a'
}

function summarizeCreated(created: unknown[]): ReflectionOutput {
  const items = created as Array<{ status?: string }>
  return {
    created: items as ReflectionOutput['created'],
    activeCount: items.filter((item) => item.status === 'active').length,
    candidateCount: items.filter((item) => item.status === 'candidate').length,
    hypothesisCount: items.filter((item) => item.status === 'hypothesis').length
  }
}
