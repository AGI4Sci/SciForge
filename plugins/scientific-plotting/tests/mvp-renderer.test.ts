import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { getScientificPlottingStatus, mapScientificPlottingData, prepareTemplateCode } from '../src/worker/scientific-plotting-engine.js'
import { scientificPlottingRenderRequestSchema } from '../src/worker/contract.js'
import { SCIENTIFIC_PLOTTING_TEMPLATES, type ScientificPlottingTemplate } from '../src/worker/types.js'

const workspaceRoot = tmpdir()
const base = { workspaceRoot, documentId: 'renderer-test', generationId: 'generation-test' }
const missingPython = '/nonexistent-scientific-figures-test/python'
const line = { series: [{ name: 'Control', x: [0, 1, 2], y: [1, 1.2, 1.4] }] }
const fixtures: Array<[ScientificPlottingTemplate, unknown]> = [
  ['line', line], ['scatter', line],
  ['bar', { categories: ['A', 'B'], series: [{ name: 'Measured', values: [1, 2] }] }],
  ['errorbar-bar', { categories: ['A', 'B'], series: [{ name: 'Measured', values: [1, 2], error: [0.1, 0.2] }] }],
  ['heatmap', { matrix: [[1, 2], [3, 4]] }], ['attention-map', { matrix: [[0.1, 0.9], [0.7, 0.3]] }],
  ['box-violin', { groups: [{ name: 'A', values: [1, 2, 3] }] }],
  ['histogram-density', { series: [{ name: 'A', values: [1, 2, 3, 4] }], bins: 5 }],
  ['multi-panel', { panels: [{ template: 'line', data: line }] }],
  ['flowchart', { nodes: [{ id: 'a', label: 'Prepare' }, { id: 'b', label: 'Measure' }], edges: [{ from: 'a', to: 'b' }] }],
  ['schematic-grid', { nodes: [{ id: 'a', label: 'Sample' }] }]
]

test('all eleven templates prepare ordinary Python snapshots with explicit PNG output and valid isolated grammar', async () => {
  assert.deepEqual(fixtures.map(([template]) => template).sort(), [...SCIENTIFIC_PLOTTING_TEMPLATES].sort())
  for (const [template, data] of fixtures) {
    const prepared = await prepareTemplateCode({ ...base, template, data })
    assert.equal(prepared.entrypoint, 'main.py', template)
    assert.deepEqual(prepared.files.map(file => file.path), ['main.py'])
    assert.deepEqual(prepared.inputPaths, [])
    assert.equal(prepared.parameters.template, template)
    assert.deepEqual(prepared.parameters.data, data)
    const code = prepared.files[0]!.content
    assert.match(code, /SCIENTIFIC_FIGURES_PARAMETERS_JSON/)
    assert.match(code, /with open\(os\.path\.join\(os\.environ\["SCIENTIFIC_FIGURES_OUTPUT_DIR"\], "figure\.png"\), "xb"\)/)
    assert.match(code, /output_file\.write\(image_buffer\.getvalue\(\)\)/)
    assert.doesNotMatch(code, /json\.load\(sys\.stdin\)|imageBase64|base64\.b64encode/)
    const syntax = spawnSync(process.env.SCIENTIFIC_FIGURES_TEST_PYTHON ?? 'python3', ['-I', '-S', '-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8', timeout: 10_000 })
    assert.equal(syntax.status, 0, `${template}: ${syntax.error?.message ?? syntax.stderr}`)
  }
})

test('mapping retains numerical data and explicit labels and returns a preparable controlled request', async () => {
  const result = await mapScientificPlottingData({ ...base, task: 'Plot treatment trend over time', templateHint: 'line', data: line, labels: { title: 'Measured control', x: 'Time', y: 'Response' } })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.selectedTemplate, 'line')
  assert.deepEqual(result.renderRequest.data, line)
  assert.deepEqual(result.renderRequest.labels, { title: 'Measured control', x: 'Time', y: 'Response' })
  assert.equal(result.renderRequest.documentId, base.documentId)
  assert.equal(result.renderRequest.generationId, base.generationId)
  assert.equal(scientificPlottingRenderRequestSchema.safeParse(result.renderRequest).success, true)
  assert.equal('visualPlan' in result.renderRequest, false)
  assert.equal('versioning' in result.renderRequest, false)
  const prepared = await prepareTemplateCode(result.renderRequest)
  assert.deepEqual(prepared.parameters.data, line)
  assert.deepEqual(prepared.parameters.labels, result.renderRequest.labels)
})

test('preparation rejects malformed data and undeclared scientific uncertainty', async () => {
  await assert.rejects(prepareTemplateCode({ ...base, template: 'line', data: { series: [{ x: [1], y: [1, 2] }] } }), /match y length/)
  await assert.rejects(prepareTemplateCode({ ...base, template: 'errorbar-bar', data: fixtures[3]![1], reproducibilityMode: 'reproducible', statistics: { schemaVersion: 1, estimator: 'mean', missingValues: 'reject' }, dataSources: [{ schemaVersion: 1, sourceId: 'measured', kind: 'inline', locator: 'inputs.json', sha256: 'a'.repeat(64) }] }), /uncertainty/)
})

test('preparation verifies inline source claims against actual data and rejects absolute source content', async () => {
  await assert.rejects(prepareTemplateCode({ ...base, template: 'line', data: line, dataSources: [{ schemaVersion: 1, sourceId: 'claimed-source', kind: 'inline', locator: 'inputs.json', sha256: 'a'.repeat(64) }] }), /digest does not match the actual rendering data/)
  await assert.rejects(prepareTemplateCode({ ...base, template: 'line', data: line, labels: { title: '/private/source/path' } }), /must not contain absolute paths/)
})

test('configured status reports missing runtime truthfully without attempting generation', async () => {
  const status = await getScientificPlottingStatus({ pythonCommand: missingPython })
  assert.equal(status.renderer.available, false)
  assert.equal(status.degraded, true)
  assert.match(status.renderer.message ?? '', /nonexistent-scientific-figures-test\/python.*ENOENT/)
  assert.equal(status.outputPolicy.persistsImages, false)
  assert.deepEqual(status.supportedTemplates, [...SCIENTIFIC_PLOTTING_TEMPLATES])
})

test('preparation preserves source workspace without running Python or persisting image files', async () => {
  const parent = await realpath(tmpdir())
  const isolated = await mkdtemp(join(parent, 'scientific-figures-prepare-check-'))
  try {
    const prepared = await prepareTemplateCode({ ...base, workspaceRoot: isolated, template: 'line', data: line })
    assert.equal(prepared.entrypoint, 'main.py')
    assert.deepEqual(await readdir(isolated), [])
  } finally {
    assert.equal(await realpath(isolated), isolated)
    assert.ok(isolated.startsWith(join(parent, 'scientific-figures-prepare-check-')))
    await rm(isolated, { recursive: true, force: true })
  }
})
