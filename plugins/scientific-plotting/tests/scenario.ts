/**
 * Baseline scenario runner: drives the plugin operations with the real engine
 * in its dependency-free degraded mode (G1) and records deterministic output.
 * `mapData` is pure data mapping (no rendering), so its output is stable
 * across runs once the workspace path is normalized to a placeholder. The
 * `status` surface is environment-dependent (Python/poppler discovery) and is
 * pinned structurally in dsh-tools/host-loading tests instead of the golden
 * file. While the static module exists, capability-parity.test.ts is the
 * primary guard; the golden file keeps the baseline after the static module
 * is removed.
 */
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mapData } from '../src/core/operations.js'
import { createScientificPlottingServiceFactory } from '../src/core/service-factory.js'

export type BaselineStep = Readonly<{ step: string; output: unknown }>
export type BaselineGolden = Readonly<{ scenarios: Record<string, readonly BaselineStep[]> }>

export const CONTROLLED_PLAN = {
  planId: 'plan-baseline-1',
  route: 'code',
  routeLocked: true,
  rationale: 'baseline',
  sourceArtifacts: [],
  reproducibleInputs: ['inline-data'],
  lockedElements: ['all'],
  modelOwnedElements: [],
  contextStatus: 'ready',
  contextStopReason: 'sufficient',
  contextEvidenceIds: [],
  unresolvedContext: [],
  releaseCeiling: 'draft_ready',
  fallbackPolicy: 'fail_closed'
} as const

/** Recursively replaces the ephemeral workspace path with a fixed placeholder. */
function normalizeWorkspace(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === 'string') return value.split(workspaceRoot).join('<workspace>')
  if (Array.isArray(value)) return value.map((entry) => normalizeWorkspace(entry, workspaceRoot))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeWorkspace(entry, workspaceRoot)])
    )
  }
  return value
}

export async function runBaselineScenarios(): Promise<BaselineGolden> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'plotting-baseline-'))
  try {
    const factory = createScientificPlottingServiceFactory()
    const steps: BaselineStep[] = []
    const mapped = await mapData(factory, {
      operationId: 'baseline-map-0000001',
      task: 'Baseline mapping',
      visualPlan: CONTROLLED_PLAN,
      data: { series: [{ name: 'S1', x: [1, 2, 3], y: [2, 4, 9] }] },
      templateHint: 'scatter'
    }, workspaceRoot)
    const canonicalRoot = await realpath(workspaceRoot)
    assert.equal((mapped.output as { renderRequest: { workspaceRoot: string } }).renderRequest.workspaceRoot, canonicalRoot)
    steps.push({
      step: 'map-data',
      output: normalizeWorkspace(mapped.output, canonicalRoot)
    })
    return { scenarios: { 'map-data': steps } }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}
