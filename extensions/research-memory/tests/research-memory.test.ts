import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { decideEvidenceStatus } from '../src/evidence-gate'
import { createProjectExtensionTools } from '../src/index'
import { createResearchMemoryService } from '../src/service'
import { ResearchMemoryStore } from '../src/store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(__dirname, '..')

let tempRoot: string | null = null

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

function tempWorkspace(name: string): string {
  tempRoot = mkdtempSync(join(tmpdir(), `${name}-`))
  return tempRoot
}

describe('Research Memory evidence gate', () => {
  it('keeps unsupported and discussion-only insights out of active status', () => {
    expect(decideEvidenceStatus({
      type: 'research_principle',
      claim: 'Prefer small ablations.'
    })).toMatchObject({
      status: 'candidate',
      evidenceLevel: 'model_reflection'
    })

    expect(decideEvidenceStatus({
      type: 'debug_insight',
      claim: 'The loader fails on empty labels.',
      evidenceRefs: ['thread:t1', 'file:src/loader.py'],
      confidence: 0.8
    })).toMatchObject({
      status: 'candidate',
      evidenceLevel: 'discussion'
    })
  })

  it('promotes metric-backed experiment evidence and human approval to active', () => {
    expect(decideEvidenceStatus({
      type: 'experiment_insight',
      claim: 'v3 is better.',
      evidenceRefs: ['experiment:run_v3', 'metric:run_v3:accuracy', 'artifact:artifacts/runs/v3/metrics.json'],
      sourceRunIds: ['run_v3']
    })).toMatchObject({
      status: 'active',
      evidenceLevel: 'metric_supported'
    })

    expect(decideEvidenceStatus({
      type: 'analysis_insight',
      claim: 'Use this research principle.',
      evidenceRefs: ['human:review_1']
    })).toMatchObject({
      status: 'active',
      evidenceLevel: 'human_approved'
    })
  })
})

describe('Research Memory service', () => {
  it('initializes storage and supports experiment run upsert, list, and get', () => {
    const workspaceRoot = tempWorkspace('research-memory-store')
    const store = new ResearchMemoryStore({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    store.upsertExperimentRun({
      id: 'run_upsert',
      projectId: workspaceRoot,
      title: 'first title',
      status: 'running'
    })
    store.upsertExperimentRun({
      id: 'run_upsert',
      projectId: workspaceRoot,
      title: 'updated title',
      status: 'completed',
      metrics: { accuracy: 0.9 }
    })

    expect(store.getExperimentRun('run_upsert')).toMatchObject({
      id: 'run_upsert',
      title: 'updated title',
      status: 'completed',
      metrics: { accuracy: 0.9 }
    })
    expect(store.listExperimentRuns(workspaceRoot).map((run) => run.id)).toEqual(['run_upsert'])
    expect(existsSync(join(workspaceRoot, '.sciforge', 'research-memory', 'research-memory.sqlite'))).toBe(true)
    store.close()
  })

  it('records experiments, reflects reusable memory, resolves context, and writes snapshots', () => {
    const workspaceRoot = tempWorkspace('research-memory-service')
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    service.recordExperiment({
      id: 'run_v1',
      title: 'baseline',
      metrics: { accuracy: 0.7, loss: 0.8 },
      logsExcerpt: 'baseline plateau',
      artifactRefs: ['artifacts/runs/v1/metrics.json']
    })
    service.recordExperiment({
      id: 'run_v2',
      title: 'normalized lower lr',
      metrics: { accuracy: 0.82, loss: 0.61 },
      logsExcerpt: 'validation stabilized',
      artifactRefs: ['artifacts/runs/v2/metrics.json']
    })

    const reflected = service.reflectExperiments({ includeWeakCandidates: true })
    expect(reflected.created.map((item) => item.type)).toEqual(expect.arrayContaining([
      'method_choice',
      'experiment_insight',
      'negative_result',
      'hypothesis'
    ]))
    expect(reflected.activeCount).toBeGreaterThanOrEqual(2)
    expect(reflected.hypothesisCount).toBe(1)

    service.proposeInsight({
      type: 'metric_interpretation',
      claim: 'Accuracy should be read together with loss because v1 plateaued.',
      evidenceRefs: ['thread:analysis-1'],
      confidence: 0.7
    })

    const withoutHypotheses = service.resolveContext({ query: 'next training plan' })
    expect(withoutHypotheses.hypotheses).toEqual([])
    expect(withoutHypotheses.warnings.join(' ')).toContain('Hypotheses were excluded')
    expect(withoutHypotheses.methodChoices[0]?.claim).toContain('run_v2')

    const withHypotheses = service.resolveContext({
      query: 'next training plan',
      includeHypotheses: true
    })
    expect(withHypotheses.hypotheses.length).toBe(1)
    expect(withHypotheses.evidenceRefs).toEqual(expect.arrayContaining([
      'experiment:run_v2',
      'metric:run_v2:loss'
    ]))

    const snapshot = service.snapshot({ format: 'markdown' })
    expect(snapshot.path).toBe(join(workspaceRoot, 'artifacts', 'research_memory_snapshot.md'))
    expect(readFileSync(snapshot.path, 'utf8')).toContain('## Active Memory')
    const jsonSnapshot = service.snapshot({ format: 'json' })
    expect(JSON.parse(readFileSync(jsonSnapshot.path, 'utf8'))).toMatchObject({
      projectId: workspaceRoot
    })
    expect(existsSync(join(workspaceRoot, '.sciforge', 'research-memory', 'research-memory.sqlite'))).toBe(true)

    const candidate = service.proposeInsight({
      type: 'research_principle',
      claim: 'Prefer single-factor ablations for this project.',
      confidence: 0.6
    }).item
    expect(candidate.status).toBe('candidate')
    const approved = service.reviewItem({
      memoryId: candidate.id,
      action: 'approve',
      note: 'User confirmed this principle.'
    }).item
    expect(approved.status).toBe('active')
    expect(approved.evidenceLevel).toBe('human_approved')
    expect(approved.evidenceRefs.some((ref) => ref.startsWith('human:'))).toBe(true)
    const invalidated = service.reviewItem({
      memoryId: candidate.id,
      action: 'invalidate',
      note: 'Later experiment contradicted it.'
    }).item
    expect(invalidated.status).toBe('invalidated')
    expect(service.resolveContext({ query: 'single-factor ablations', includeHypotheses: true }).relevantInsights)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: candidate.id })]))
    service.close()
  })

  it('reflects threads into candidate analysis memory and trims resolve_context by budget', () => {
    const workspaceRoot = tempWorkspace('research-memory-thread')
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    const emptyReflection = service.reflectThread({
      threadId: 'thread-empty',
      scope: 'full_thread'
    })
    expect(emptyReflection.created).toEqual([])
    expect(emptyReflection.warnings.join(' ')).toContain('No thread content')

    const threadReflection = service.reflectThread({
      threadId: 'thread-debug-1',
      scope: 'full_thread',
      threadText: 'Debug insight: the loader fails when labels are empty, so validate labels before training.',
      turns: [{
        id: 'turn-debug-1',
        role: 'assistant',
        text: 'Root cause: empty labels bypass preprocessing and should be rejected before the next run.'
      }]
    })
    service.proposeInsight({
      type: 'analysis_insight',
      claim: 'A very long analysis insight '.repeat(50),
      evidenceRefs: ['thread:thread-debug-1'],
      confidence: 0.65
    })

    expect(threadReflection.created[0]).toMatchObject({
      type: 'debug_insight',
      status: 'candidate',
      evidenceRefs: expect.arrayContaining(['thread:thread-debug-1', 'turn:turn-debug-1'])
    })
    expect(threadReflection.created[0]?.claim).toContain('loader fails')
    const resolved = service.resolveContext({
      query: 'debug analysis',
      budgetChars: 700,
      includeHypotheses: true
    })
    expect(JSON.stringify(resolved.relevantInsights)).not.toContain('A very long analysis insight')
    expect(resolved.evidenceRefs).toEqual(expect.arrayContaining(['thread:thread-debug-1']))
    service.close()
  })

  it('falls back to the only memory-bearing project when resolve_context receives a stale projectId', () => {
    const workspaceRoot = tempWorkspace('research-memory-project-fallback')
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    service.proposeInsight({
      projectId: 'canonical-project',
      type: 'method_choice',
      claim: 'Use weight decay as the first regularization baseline.',
      evidenceRefs: ['experiment:r04_weight_decay', 'metric:r04_weight_decay:test_loss'],
      sourceRunIds: ['r04_weight_decay'],
      confidence: 0.72
    })

    const resolved = service.resolveContext({
      projectId: 'guessed-project',
      query: 'regularization baseline'
    })
    expect(resolved.methodChoices[0]?.claim).toContain('weight decay')
    expect(resolved.evidenceRefs).toEqual(expect.arrayContaining(['experiment:r04_weight_decay']))
    expect(resolved.warnings.join(' ')).toContain('guessed-project')
    expect(resolved.warnings.join(' ')).toContain('canonical-project')
    service.close()
  })

  it('validates reflect_thread tool input before optional fields can cause runtime TypeErrors', async () => {
    const workspaceRoot = tempWorkspace('research-memory-reflect-tool-validation')
    const reflectTool = researchMemoryTool('research_memory_reflect_thread')

    await expect(reflectTool.execute({
      scope: 'full_thread',
      threadText: 'Metric insight: loss is the objective now.'
    }, toolContext(workspaceRoot))).rejects.toThrow(/threadId must be a non-empty string/)

    const output = await reflectTool.execute({
      threadId: 'thread-validation',
      scope: 'full_thread',
      threadText: undefined,
      highlights: [undefined, 'Metric insight: test loss is more informative than saturated accuracy.'],
      turns: [
        undefined,
        { id: 12, text: null },
        { id: 'turn-validation', role: 'assistant', text: 'Next: prefer calibrated dropout ablations.' }
      ]
    }, toolContext(workspaceRoot))

    expect((output.output as { created?: Array<{ claim: string; evidenceRefs: string[] }> }).created?.[0])
      .toMatchObject({
        claim: 'Metric insight: test loss is more informative than saturated accuracy.',
        evidenceRefs: expect.arrayContaining(['thread:thread-validation', 'turn:turn-validation'])
      })
  })

  it('validates resolve_context tool input before service code can throw TypeErrors', async () => {
    const workspaceRoot = tempWorkspace('research-memory-resolve-tool-validation')
    const resolveTool = researchMemoryTool('research_memory_resolve_context')

    await expect(resolveTool.execute({
      includeHypotheses: true
    }, toolContext(workspaceRoot))).rejects.toThrow(/query must be a non-empty string/)
  })

  it('keeps experiment artifact reads inside workspace and honors tool file path policy', async () => {
    const workspaceRoot = tempWorkspace('research-memory-path-policy')
    const insideMetrics = join(workspaceRoot, 'metrics.json')
    const outsideMetrics = resolve(workspaceRoot, '..', 'outside-metrics.json')
    writeFileSync(insideMetrics, '{"accuracy":0.9}\n', 'utf8')
    const service = createResearchMemoryService({ workspaceRoot })

    expect(() => service.recordExperiment({
      title: 'outside metrics',
      metricsPath: outsideMetrics
    })).toThrow(/within the workspace/)

    const recordTool = researchMemoryTool('research_memory_record_experiment')
    await expect(recordTool.execute({
      title: 'blocked metrics',
      metricsPath: 'metrics.json'
    }, toolContext(workspaceRoot, {
      filePathPolicy: { denyPatterns: ['metrics\\.json$'] }
    }))).rejects.toThrow(/denyPattern/)

    const output = await recordTool.execute({
      title: 'project scoped metrics',
      metricsPath: 'metrics.json'
    }, toolContext(workspaceRoot, {
      project: 'project-a'
    }))
    expect((output.output as { run?: { projectId?: string } }).run?.projectId).toBe('project-a')
    service.close()
  })

  it('ignores completed runs missing the selected lower-is-better metric while ranking', () => {
    const workspaceRoot = tempWorkspace('research-memory-missing-metric')
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    service.recordExperiment({
      id: 'run_loss_best',
      title: 'best loss',
      metrics: { loss: 0.4 },
      artifactRefs: ['artifacts/runs/best/metrics.json']
    })
    service.recordExperiment({
      id: 'run_loss_worst',
      title: 'worst loss',
      metrics: { loss: 0.9 },
      artifactRefs: ['artifacts/runs/worst/metrics.json']
    })
    service.recordExperiment({
      id: 'run_missing_loss',
      title: 'missing loss',
      metrics: { other: 999 },
      artifactRefs: ['artifacts/runs/missing/metrics.json']
    })

    const reflected = service.reflectExperiments({})
    const methodChoice = reflected.created.find((item) => item.type === 'method_choice')
    expect(methodChoice?.claim).toContain('run_loss_best')
    expect(methodChoice?.sourceRunIds).toEqual(['run_loss_best'])
    expect(methodChoice?.rationale).toContain('0.4')
    service.close()
  })

  it('selects evaluation metrics instead of epoch or hyperparameter fields', () => {
    const workspaceRoot = tempWorkspace('research-memory-eval-metric-selection')
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    service.recordExperiment({
      id: 'run_v1',
      title: 'high lr',
      metrics: { best_epoch: 1, lr: 0.3, test_acc: 1.0, test_loss: 31.9 },
      artifactRefs: ['artifacts/runs/v1/metrics.json']
    })
    service.recordExperiment({
      id: 'run_v4',
      title: 'regularized',
      metrics: { best_epoch: 25, lr: 0.03, test_acc: 1.0, test_loss: 8.39 },
      artifactRefs: ['artifacts/runs/v4/metrics.json']
    })
    service.recordExperiment({
      id: 'run_v5',
      title: 'larger hidden',
      metrics: { best_epoch: 3, lr: 0.03, test_acc: 1.0, test_loss: 19.47 },
      artifactRefs: ['artifacts/runs/v5/metrics.json']
    })

    const reflected = service.reflectExperiments({ includeWeakCandidates: true })
    const methodChoice = reflected.created.find((item) => item.type === 'method_choice')
    const insight = reflected.created.find((item) => item.type === 'experiment_insight')
    expect(methodChoice?.claim).toBe('run_v4 is the current baseline for test_loss.')
    expect(methodChoice?.evidenceRefs).toEqual(expect.arrayContaining([
      'metric:run_v4:test_loss',
      'artifact:artifacts/runs/v4/metrics.json'
    ]))
    expect(insight?.claim).toBe('test_loss currently tracks the most useful model iteration signal.')
    service.close()
  })

  it('keeps project-scoped storage isolated across workspaces', () => {
    const root = tempWorkspace('research-memory-isolation')
    const workspaceA = join(root, 'project-a')
    const workspaceB = join(root, 'project-b')
    const serviceA = createResearchMemoryService({
      workspaceRoot: workspaceA,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })
    const serviceB = createResearchMemoryService({
      workspaceRoot: workspaceB,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    serviceA.proposeInsight({
      type: 'analysis_insight',
      claim: 'Project A insight.',
      evidenceRefs: ['thread:a']
    })

    expect(serviceA.resolveContext({ query: 'Project A' }).relevantInsights.length).toBe(1)
    expect(serviceB.resolveContext({ query: 'Project A', includeHypotheses: true }).relevantInsights.length).toBe(0)
    expect(existsSync(join(workspaceA, '.sciforge', 'research-memory', 'research-memory.sqlite'))).toBe(true)
    expect(existsSync(join(workspaceB, '.sciforge', 'research-memory', 'research-memory.sqlite'))).toBe(true)
    serviceA.close()
    serviceB.close()
  })
})

describe('Research Memory showcase acceptance', () => {
  it('uses five run artifacts, reflects memory, resolves next-plan context, and preserves evidence boundaries', () => {
    const workspaceRoot = tempWorkspace('research-memory-showcase')
    cpSync(join(extensionRoot, 'showcase', 'ai4ai-model-iteration'), workspaceRoot, { recursive: true })
    const service = createResearchMemoryService({
      workspaceRoot,
      nowIso: () => '2026-07-09T00:00:00.000Z',
      idGenerator: deterministicIds()
    })

    for (const version of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      service.recordExperiment({
        id: `run_${version}`,
        title: `AI4AI training ${version}`,
        metricsPath: `artifacts/runs/${version}/metrics.json`,
        logPath: `artifacts/runs/${version}/run.log`,
        artifactManifestPath: `artifacts/runs/${version}/manifest.json`,
        parameters: { version },
        seed: 42
      })
    }

    const reflected = service.reflectExperiments({ includeWeakCandidates: true })
    const analysis = service.proposeInsight({
      type: 'metric_interpretation',
      claim: 'v5 improved F1 without sacrificing loss, so next runs should keep v5 threshold calibration as the baseline.',
      evidenceRefs: ['experiment:run_v5', 'metric:run_v5:f1', 'log:run_v5', 'artifact:artifacts/runs/v5/metrics.json'],
      sourceRunIds: ['run_v5'],
      confidence: 0.74
    }).item
    const resolved = service.resolveContext({
      query: '下一轮训练怎么设计?',
      includeHypotheses: true
    })
    const snapshot = service.snapshot({ format: 'markdown' })
    const transcript = [
      'tool: research_memory_resolve_context',
      `memory id: ${resolved.methodChoices[0]?.id}`,
      `analysis memory id: ${analysis.id}`,
      `run id: ${resolved.methodChoices[0]?.sourceRunIds[0]}`,
      `artifact refs: ${resolved.evidenceRefs.filter((ref) => ref.startsWith('artifact:')).join(', ')}`,
      `boundary: active=${resolved.methodChoices[0]?.status}; hypothesis=${resolved.hypotheses[0]?.status}`
    ].join('\n')

    expect(service.listExperimentRuns().length).toBe(5)
    expect(reflected.created.some((item) => item.type === 'negative_result')).toBe(true)
    expect(reflected.created.some((item) => item.type === 'method_choice')).toBe(true)
    expect(reflected.created.some((item) => item.type === 'experiment_insight')).toBe(true)
    expect(reflected.created.some((item) => item.status === 'hypothesis' || item.status === 'candidate')).toBe(true)
    expect(analysis.type).toBe('metric_interpretation')
    expect(resolved.methodChoices[0]?.sourceRunIds[0]).toBe('run_v5')
    expect(resolved.hypotheses[0]?.status).toBe('hypothesis')
    expect(transcript).toContain('research_memory_resolve_context')
    expect(transcript).toContain('memory id: mem_1')
    expect(transcript).toContain('run id: run_v5')
    expect(transcript).toContain('artifact:artifacts/runs/v5/metrics.json')
    expect(transcript).toContain('active=active; hypothesis=hypothesis')
    expect(readFileSync(snapshot.path, 'utf8')).toContain('run_v5')
    service.close()
  })
})

function deterministicIds(): (prefix: string) => string {
  let next = 0
  return (prefix) => `${prefix}_${++next}`
}

type TestTool = {
  name: string
  execute: (
    args: Record<string, unknown>,
    context: {
      threadId: string
      turnId: string
      workspace: string
      project?: string
      filePathPolicy?: {
        allowPaths?: readonly string[]
        allowPatterns?: readonly string[]
        denyPatterns?: readonly string[]
      }
      abortSignal: AbortSignal
    }
  ) => Promise<{ output: unknown; isError?: boolean }>
}

function researchMemoryTool(name: string): TestTool {
  const tools = createProjectExtensionTools({
    defineTool: (tool) => tool
  }) as TestTool[]
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`Missing Research Memory tool: ${name}`)
  return tool
}

function toolContext(
  workspace: string,
  overrides: Partial<Omit<Parameters<TestTool['execute']>[1], 'threadId' | 'turnId' | 'workspace' | 'abortSignal'>> = {}
): Parameters<TestTool['execute']>[1] {
  return {
    threadId: 'thread-test',
    turnId: 'turn-test',
    workspace,
    abortSignal: new AbortController().signal,
    ...overrides
  }
}
