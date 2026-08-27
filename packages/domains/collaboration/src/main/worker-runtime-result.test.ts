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
