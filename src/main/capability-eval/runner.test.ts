import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseCapabilityReferenceMarkdown } from './reference'
import { createDeterministicSimulationExecutor, runEvalCases } from './runner'
import { evalCaseSchema } from './schema'
import {
  CapabilityEvalPreflightError,
  type CapabilityEvalPreflightSnapshot
} from './preflight'

const reference = parseCapabilityReferenceMarkdown([
  '| Action ID | Version | Audiences | Effect | Approval | Scope |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `paper-radar.search` | 1.0.0 | ui, agent | read | none | global |'
].join('\n'), '<test>')

describe('capability eval runner', () => {
  it('creates and cleans an isolated context for each deterministic case', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'isolated-case',
      query: 'test',
      initialState: { seed: 'case-a' },
      fixtures: { files: [{ path: 'fixtures/input.jsonl', content: '{"value":1}\n' }] },
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      simulation: {
        discoveries: [],
        calls: [],
        taskSuccess: true
      }
    })
    let directory = ''
    const results = await runEvalCases([evalCase], {
      run: async (_case, context) => {
        directory = context.directory
        expect(context.initialState).toEqual({ seed: 'case-a' })
        expect(JSON.parse(await readFile(`${context.directory}/initial-state.json`, 'utf8'))).toEqual({ seed: 'case-a' })
        expect(await readFile(`${context.directory}/fixtures/input.jsonl`, 'utf8')).toBe('{"value":1}\n')
        return { trace: {
          discoveredActions: [], selectedActions: [], invocations: [], authorizationEvents: [],
          toolCalls: 0, retryCount: 0, latencyMs: 0, taskSuccess: true
        } }
      }
    })
    expect(results[0]?.passed).toBe(true)
    await expect(readFile(`${directory}/initial-state.json`, 'utf8')).rejects.toThrow()
    await expect(readFile(`${directory}/fixtures/input.jsonl`, 'utf8')).rejects.toThrow()
  })

  it('preserves an isolated workspace snapshot before cleanup when requested', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'snapshot-case',
      query: 'test',
      fixtures: { files: [{ path: 'artifacts/result.json', content: '{"ok":true}\n' }] },
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      simulation: {
        discoveries: [],
        calls: [],
        taskSuccess: true
      }
    })
    const outputDirectory = await mkdtemp(join(tmpdir(), 'sciforge-workspace-snapshots-'))
    try {
      const [result] = await runEvalCases([evalCase], {
        run: async () => ({ trace: {
          discoveredActions: [], selectedActions: [], invocations: [], authorizationEvents: [],
          toolCalls: 0, retryCount: 0, latencyMs: 0, taskSuccess: true
        } })
      }, {
        workspaceSnapshotDirectory: outputDirectory
      })
      const snapshotDirectory = result?.actual.workspaceSnapshotDirectory
      expect(snapshotDirectory?.startsWith(join(outputDirectory, 'case-snapshot-case', 'run-1-'))).toBe(true)
      expect(await readFile(join(snapshotDirectory ?? '', 'artifacts/result.json'), 'utf8'))
        .toBe('{"ok":true}\n')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('keeps workspace snapshots for repeated runs separate', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'repeated-snapshot-case',
      query: 'test',
      fixtures: { files: [{ path: 'artifacts/result.json', content: '{"ok":true}\n' }] },
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      simulation: { discoveries: [], calls: [], taskSuccess: true }
    })
    const outputDirectory = await mkdtemp(join(tmpdir(), 'sciforge-workspace-repeat-snapshots-'))
    try {
      const results = await runEvalCases([evalCase, evalCase], {
        run: async () => ({ trace: {
          discoveredActions: [], selectedActions: [], invocations: [], authorizationEvents: [],
          toolCalls: 0, retryCount: 0, latencyMs: 0, taskSuccess: true
        } })
      }, {
        experimentId: 'repeat-test',
        runIndices: [1, 2],
        workspaceSnapshotDirectory: outputDirectory
      })
      const snapshots = results.map((result) => result.actual.workspaceSnapshotDirectory)
      expect(snapshots[0]).toBeTruthy()
      expect(snapshots[1]).toBeTruthy()
      expect(snapshots[0]).not.toBe(snapshots[1])
      expect(await readFile(join(snapshots[0] ?? '', 'artifacts/result.json'), 'utf8')).toBe('{"ok":true}\n')
      expect(await readFile(join(snapshots[1] ?? '', 'artifacts/result.json'), 'utf8')).toBe('{"ok":true}\n')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('rejects workspace fixtures that escape the isolated context', () => {
    expect(() => evalCaseSchema.parse({
      id: 'unsafe-fixture',
      query: 'test',
      fixtures: { files: [{ path: '../outside.txt', content: 'no' }] },
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      simulation: { discoveries: [], calls: [], taskSuccess: true }
    })).toThrow()
  })

  it('validates simulated action IDs against the generated capability reference', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'known-action',
      query: 'test',
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      simulation: {
        discoveries: [{ actions: ['paper-radar.search'] }],
        calls: [],
        taskSuccess: true
      }
    })
    const [result] = await runEvalCases([evalCase], createDeterministicSimulationExecutor(reference))
    expect(result?.passed).toBe(true)
  })

  it('carries an explicit simulated behavior label into the evaluator trace', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'simulated-clarify',
      query: 'Run the analysis',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['behavior'],
      expectedBehavior: 'clarify',
      expected: {},
      simulation: {
        discoveries: [],
        calls: [],
        observedBehavior: 'clarify'
      }
    })
    const [result] = await runEvalCases([evalCase], createDeterministicSimulationExecutor(reference))
    expect(result?.passed).toBe(true)
    expect(result?.actual.observedBehavior).toBe('clarify')
  })

  it('requires the behavior dimension when a v2 case declares expected behavior', () => {
    expect(() => evalCaseSchema.parse({
      id: 'behavior-dimension-required',
      query: 'Ask for missing context',
      semanticsVersion: 'semantics-v2',
      taskType: 'routing',
      evaluationDimensions: ['action_selection'],
      expectedBehavior: 'clarify',
      expected: {}
    })).toThrow()
  })

  it('marks an executor failure before any trace as inconclusive', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'executor-start-failure',
      query: 'test',
      expected: {
        requiredActions: ['paper-radar.search'],
        allowedActions: ['paper-radar.search'],
        taskSuccess: true
      },
      simulation: {
        discoveries: [],
        calls: [],
        taskSuccess: false
      }
    })
    const [result] = await runEvalCases([evalCase], {
      run: async () => {
        throw new Error('bridge unavailable')
      }
    })
    expect(result?.outcome).toBe('INCONCLUSIVE')
    expect(result?.failures).toEqual([{
      type: 'execution_error',
      message: 'bridge unavailable'
    }])
  })

  it('persists a structured preflight block without reporting an Agent action miss', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'preflight-block',
      query: 'test',
      expected: {
        requiredActions: ['paper-radar.search'],
        allowedActions: ['paper-radar.search'],
        taskSuccess: true
      }
    })
    const snapshot = {
      contractVersion: 1,
      capabilityContractVersion: 1,
      status: 'incomplete' as const,
      registryFingerprint: 'b'.repeat(64),
      referenceActionIds: ['paper-radar.search'],
      actualAgentActionIds: [],
      missingActionIds: ['paper-radar.search'],
      unexpectedActionIds: [],
      versionMismatches: [],
      requiredContributionActionIds: ['paper-radar.search'],
      missingContributionActionIds: ['paper-radar.search'],
      contributionActionIds: [],
      evaluationActionIds: [],
      contributions: [],
      message: 'missing eval contributions: paper-radar.search'
    } satisfies CapabilityEvalPreflightSnapshot
    const [result] = await runEvalCases([evalCase], {
      run: async () => { throw new CapabilityEvalPreflightError(snapshot) }
    })

    expect(result?.outcome).toBe('INCONCLUSIVE')
    expect(result?.actual.preflight).toEqual(snapshot)
    expect(result?.actual.invocations).toEqual([])
  })

  it('attaches a case-scoped LLM Judge sidecar before scoring', async () => {
    const evalCase = evalCaseSchema.parse({
      id: 'judge-sidecar-case',
      query: 'test',
      expected: { requiredActions: [], allowedActions: [], taskSuccess: true },
      rubric: [{
        id: 'quality',
        description: 'Quality',
        type: 'llm_judge',
        weight: 1,
        maxScore: 1,
        threshold: 0.5
      }],
      simulation: { discoveries: [], calls: [], taskSuccess: true }
    })
    const directory = await mkdtemp('/tmp/sciforge-llm-judge-')
    try {
      await writeFile(join(directory, 'judge-sidecar-case.json'), JSON.stringify({
        schemaVersion: 'sciforge.capability-eval.llm-judge.v1',
        caseId: 'judge-sidecar-case',
        results: [{ rubricId: 'quality', score: 0.8, evidence: 'fixture judge' }]
      }), 'utf8')
      const [result] = await runEvalCases([evalCase], createDeterministicSimulationExecutor(reference), {
        llmJudgeResultsDirectory: directory
      })
      expect(result?.passed).toBe(true)
      expect(result?.rubric[0]).toMatchObject({ id: 'quality', status: 'passed', score: 0.8 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
