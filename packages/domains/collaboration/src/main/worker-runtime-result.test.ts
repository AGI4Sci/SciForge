import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseWorkerRuntimeResult,
  workerHumanAnswerPrompt,
  workerTaskPrompt
} from './worker-runtime-result.js'

test('Worker Runtime result is strict and never accepts Markdown-wrapped or extra fields', () => {
  assert.deepEqual(parseWorkerRuntimeResult(JSON.stringify({
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'Result ready.'
  })), {
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'Result ready.'
  })
  assert.throws(
    () => parseWorkerRuntimeResult('```json\n{"schemaVersion":1,"outcome":"completed","summary":"x"}\n```'),
    /strict Worker JSON result/u
  )
  assert.throws(() => parseWorkerRuntimeResult(JSON.stringify({
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'x',
    workspacePath: '/tmp/secret'
  })))
})

test('Worker Runtime result tolerates bounded prose around one plain JSON object', () => {
  assert.deepEqual(parseWorkerRuntimeResult(
    'I completed the requested investigation. Here is the result:\n' +
    '{"schemaVersion":1,"outcome":"completed","summary":"Result ready."}\n' +
    'The output is ready for review.'
  ), {
    schemaVersion: 1,
    outcome: 'completed',
    summary: 'Result ready.'
  })
})

test('Worker Runtime result rejects Markdown fences and ambiguous JSON results', () => {
  assert.throws(
    () => parseWorkerRuntimeResult(
      '{"schemaVersion":1,"outcome":"completed","summary":"one"}\n' +
      '{"schemaVersion":1,"outcome":"completed","summary":"two"}'
    ),
    /multiple Worker JSON results/u
  )
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
})

test('generic text Worker tasks do not inherit the design-only report contract', () => {
  const prompt = workerTaskPrompt({
    title: 'Run the requested analysis',
    objective: 'Use the available tools and return the requested result.',
    completionCriteria: ['Return a concise result.'],
    fileIntent: null
  })

  assert.doesNotMatch(prompt, /Design-analysis-only collaboration task/iu)
})
