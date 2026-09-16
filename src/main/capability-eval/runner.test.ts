import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseCapabilityReferenceMarkdown } from './reference'
import { createDeterministicSimulationExecutor, runEvalCases } from './runner'
import { evalCaseSchema } from './schema'

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
})
