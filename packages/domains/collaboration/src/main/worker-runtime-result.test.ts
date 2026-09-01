import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  WORKER_RESULT_SUMMARY_MAX_CODE_POINTS,
  parseWorkerRuntimeResult,
  workerGuidancePrompt,
  workerHumanAnswerPrompt,
  workerResultRepairPrompt,
  workerRuntimeResultOutputSchema,
  workerTaskPrompt
} from './worker-runtime-result.js'

test('Worker Runtime result is strict and never accepts Markdown-wrapped or extra fields', () => {
  assert.deepEqual(parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Result ready.'
    }
  })), {
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'Result ready.'
  })
  assert.throws(
    () => parseWorkerRuntimeResult(JSON.stringify({
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Legacy flat result.'
    })),
    /strict Worker JSON result/u
  )
  assert.throws(
    () => parseWorkerRuntimeResult('```json\n{"result":{"schemaVersion":1,"outcome":"completed","summary":"x"}}\n```'),
    /strict Worker JSON result/u
  )
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    result: { schemaVersion: 1, outcome: 'completed', summary: 'x' },
    workspacePath: '/tmp/secret'
  })))
})

test('Worker Runtime permits Markdown-fence text only inside an exact envelope string field', () => {
  const compact = {
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'The literal diagnostic marker is ``` and is part of the result.'
  }
  const wire = { result: compact }
  assert.deepEqual(parseWorkerRuntimeResult(JSON.stringify(wire)), compact)
  assert.throws(
    () => parseWorkerRuntimeResult(`Result follows:\n${JSON.stringify(wire)}\nEnd of result.`),
    /strict Worker JSON result/u
  )
  assert.throws(
    () => parseWorkerRuntimeResult(`${JSON.stringify(wire)}\n\`\`\`trailing fence`),
    /strict Worker JSON result/u
  )
})

test('Worker Runtime accepts the provider-safe nested result envelope and normalizes it', () => {
  assert.deepEqual(parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: '  A bounded protein-design report.\n'
    }
  })), {
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'A bounded protein-design report.'
  })
  assert.deepEqual(parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'needs_human',
      question: 'Confirm the selected non-pathogenic host.',
      requiredAssurance: 'verified'
    }
  })), {
    schemaVersion: 1,
    outcome: 'needs_human',
    question: 'Confirm the selected non-pathogenic host.',
    requiredAssurance: 'verified'
  })
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Result ready.',
      requiredAssurance: 'verified'
    }
  })))
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'needs_human',
      summary: 'not allowed in this branch',
      question: 'Confirm.',
      requiredAssurance: 'verified'
    }
  })))
})

test('Worker Runtime wire strings use the same non-whitespace constraints as the output schema', () => {
  const providerOutputValidator = z.fromJSONSchema(workerRuntimeResultOutputSchema)
  const providerValid = [
    {
      result: { schemaVersion: 1, outcome: 'completed', summary: 'Result ready.' }
    },
    {
      result: { schemaVersion: 1, outcome: 'completed', summary: ' padded result ' }
    },
    {
      result: {
        schemaVersion: 1,
        outcome: 'needs_human',
        question: 'Confirm the host.',
        requiredAssurance: 'strong'
      }
    }
  ]
  for (const value of providerValid) {
    assert.equal(providerOutputValidator.safeParse(value).success, true)
    assert.doesNotThrow(() => parseWorkerRuntimeResult(JSON.stringify(value)))
  }

  const providerInvalid: unknown[] = []
  for (const summary of ['', ' ', '\n\t']) {
    providerInvalid.push({
      result: { schemaVersion: 1, outcome: 'completed', summary }
    })
  }
  for (const question of ['', ' ', '\n\t']) {
    providerInvalid.push({
      result: {
        schemaVersion: 1,
        outcome: 'needs_human',
        question,
        requiredAssurance: 'verified'
      }
    })
  }
  providerInvalid.push(
    {
      result: {
        schemaVersion: 1,
        outcome: 'completed',
        summary: 'Done.',
        requiredAssurance: 'verified'
      }
    },
    {
      result: {
        schemaVersion: 1,
        outcome: 'needs_human',
        summary: 'Inactive branch field.',
        question: 'Confirm.',
        requiredAssurance: 'verified'
      }
    }
  )
  for (const value of providerInvalid) {
    assert.equal(providerOutputValidator.safeParse(value).success, false)
    assert.throws(() => parseWorkerRuntimeResult(JSON.stringify(value)))
  }
})

test('Worker Runtime length limits count Unicode code points like JSON Schema maxLength', () => {
  const summaryAtLimit = '🧬'.repeat(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
  const summaryOverLimit = `${summaryAtLimit}🧬`
  const paddedSummaryOverLimit = ` ${'a'.repeat(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)} `
  const questionAtLimit = '🧪'.repeat(4_000)
  const questionOverLimit = `${questionAtLimit}🧪`
  assert.equal([...summaryAtLimit].length, WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
  assert.equal(summaryAtLimit.length, WORKER_RESULT_SUMMARY_MAX_CODE_POINTS * 2)
  assert.equal([...questionAtLimit].length, 4_000)
  assert.equal(questionAtLimit.length, 8_000)

  for (const value of [
    { result: { schemaVersion: 1, outcome: 'completed', summary: summaryAtLimit } },
    {
      result: {
        schemaVersion: 1,
        outcome: 'needs_human',
        question: questionAtLimit,
        requiredAssurance: 'verified'
      }
    }
  ]) {
    assert.doesNotThrow(() => parseWorkerRuntimeResult(JSON.stringify(value)))
  }

  for (const value of [
    { result: { schemaVersion: 1, outcome: 'completed', summary: summaryOverLimit } },
    { result: { schemaVersion: 1, outcome: 'completed', summary: paddedSummaryOverLimit } },
    {
      result: {
        schemaVersion: 1,
        outcome: 'needs_human',
        question: questionOverLimit,
        requiredAssurance: 'verified'
      }
    }
  ]) {
    assert.throws(() => parseWorkerRuntimeResult(JSON.stringify(value)))
  }
})

test('Worker Runtime result rejects Markdown fences and ambiguous JSON results', () => {
  assert.throws(
    () => parseWorkerRuntimeResult(
      '{"result":{"schemaVersion":1,"outcome":"completed","summary":"one"}}\n' +
      '{"result":{"schemaVersion":1,"outcome":"completed","summary":"two"}}'
    ),
    /strict Worker JSON result/u
  )
  assert.throws(() => parseWorkerRuntimeResult(
    'prefix ' + JSON.stringify({
      result: {
        schemaVersion: 1,
        outcome: 'completed',
        summary: {
          nested: { schemaVersion: 1, outcome: 'completed', summary: 'inner' }
        }
      },
      decisionMatrix: []
    })
  ))
  assert.throws(() => parseWorkerRuntimeResult(
    '[{"result":{"schemaVersion":1,"outcome":"completed","summary":"array wrapped"}}]'
  ))
})

test('Worker Runtime output schema closes the envelope used by the parser', () => {
  const schema = workerRuntimeResultOutputSchema as Record<string, unknown>
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#')
  assert.equal(schema.type, 'object')
  assert.equal('oneOf' in schema, false)
  assert.equal('anyOf' in schema, false)
  assert.deepEqual(schema.required, ['result'])
  assert.equal(schema.additionalProperties, false)
  const properties = schema.properties as Record<string, Record<string, unknown>>
  assert.deepEqual(Object.keys(properties), ['result'])
  assert.ok(Array.isArray(properties.result.oneOf ?? properties.result.anyOf))

  const branches = (properties.result.oneOf ?? properties.result.anyOf) as Array<Record<string, unknown>>
  assert.equal(branches.length, 2)
  for (const branch of branches) {
    assert.equal(branch.type, 'object')
    assert.equal(branch.additionalProperties, false)
  }
  const completed = branches.find((branch) => {
    const branchProperties = branch.properties as Record<string, Record<string, unknown>>
    return branchProperties.outcome?.const === 'completed'
  }) as Record<string, unknown>
  const needsHuman = branches.find((branch) => {
    const branchProperties = branch.properties as Record<string, Record<string, unknown>>
    return branchProperties.outcome?.const === 'needs_human'
  }) as Record<string, unknown>
  assert.deepEqual(completed.required, ['schemaVersion', 'outcome', 'summary'])
  assert.deepEqual(needsHuman.required, [
    'schemaVersion',
    'outcome',
    'question',
    'requiredAssurance'
  ])
  const completedProperties = completed.properties as Record<string, Record<string, unknown>>
  const needsHumanProperties = needsHuman.properties as Record<string, Record<string, unknown>>
  assert.equal(completedProperties.summary.pattern, '\\S')
  assert.equal(
    completedProperties.summary.maxLength,
    WORKER_RESULT_SUMMARY_MAX_CODE_POINTS
  )
  assert.equal(needsHumanProperties.question.pattern, '\\S')
  assert.equal(needsHumanProperties.question.maxLength, 4_000)

  // A design report must put its detail inside the bounded summary string;
  // the observed model shape (object summary) is intentionally rejected.
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: { decisionMatrix: [] }
    }
  })))
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      summary: 'Result ready.'
    },
    decisionMatrix: []
  })))
})

test('Worker prompt binds exact input and output names without inventing a legacy transfer port', () => {
  const prompt = workerTaskPrompt({
    title: 'Prepare minutes',
    objective: 'Summarize the meeting.',
    completionCriteria: ['Keep decisions'],
    fileIntent: {
      inputs: [{ destinationName: 'agenda.md' }],
      output: {
        fileName: 'meeting-minutes.md',
        mediaType: 'text/markdown',
        maxBytes: 65_536
      }
    }
  })
  assert.match(prompt, /agenda\.md/u)
  assert.match(prompt, /meeting-minutes\.md/u)
  assert.match(prompt, /Do not rename/u)
  assert.doesNotMatch(prompt, /materialize|agentUploadNew|safeName/u)
  assert.match(workerHumanAnswerPrompt('Proceed with option B.'), /same Project Task/u)
})

test('Worker design-analysis prompt defines the minimum attributed report shape', () => {
  const prompt = workerTaskPrompt({
    title: '评估结构方案',
    objective: 'design-analysis-only：比较候选方案并给出设计建议；不执行实验。',
    completionCriteria: ['返回可供 Coordinator 复审的文本报告。'],
    fileIntent: null
  })

  assert.match(prompt, /design-analysis-only collaboration task/iu)
  assert.match(prompt, /propose an experiment.*do not run or claim an experiment/isu)
  assert.match(prompt, /Expert.*Role.*Sub-question/isu)
  assert.match(prompt, /Conclusion/iu)
  assert.match(prompt, /Evidence|basis/iu)
  assert.match(prompt, /\[expert:<role>\]|\[source:<label>\]/u)
  assert.match(prompt, /Recommendation|next step/iu)
  assert.match(prompt, /Uncertainty/iu)
  assert.match(prompt, /summary/iu)
  assert.match(prompt, /envelope is closed.*exactly one top-level key/iu)
  assert.match(prompt, /result.*completed.*needs_human/isu)
  assert.match(prompt, /summary must be one JSON string/iu)
  assert.match(prompt, /Never .*object-valued summary/iu)
})

test('generic text Worker tasks do not inherit the design-only report contract', () => {
  const prompt = workerTaskPrompt({
    title: 'Run the requested analysis',
    objective: 'Use the available tools and return the requested result.',
    completionCriteria: ['Return a concise result.'],
    fileIntent: null
  })

  assert.doesNotMatch(prompt, /Design-analysis-only collaboration task/iu)
  assert.match(prompt, /always contains exactly one top-level key/iu)
})

test('Worker human-answer prompt repeats the closed result envelope contract', () => {
  const prompt = workerHumanAnswerPrompt('Use the conservative option.')
  assert.match(prompt, /envelope is closed/iu)
  assert.match(prompt, /summary must be one JSON string/iu)
  assert.match(prompt, /add another root key/iu)
  assert.match(prompt, /\{"result":\{"schemaVersion":1,"outcome":"completed"/u)
})

test('Worker guidance and repair prompts keep the canonical one-key result envelope', () => {
  for (const prompt of [
    workerGuidancePrompt('Keep the evidence attribution.'),
    workerResultRepairPrompt()
  ]) {
    assert.match(prompt, /envelope is closed.*exactly one top-level key/iu)
    assert.match(prompt, /\{"result":\{"schemaVersion":1,"outcome":"completed"/u)
    assert.match(prompt, /\{"result":\{"schemaVersion":1,"outcome":"needs_human"/u)
    assert.doesNotMatch(prompt, /(?:^|\n)\{"schemaVersion":1/u)
  }
})
