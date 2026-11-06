import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { defineContractTool } from '@sciforge/plugin-sdk'
import {
  EXPECTED_AUXILIARY_HOST_GRANTS,
  scientificPlottingAuxiliaryTools,
  scientificPlottingCompositeInputSchema,
  scientificPlottingCompositeOutputSchema,
  scientificPlottingPrepareReferenceInputSchema,
  scientificPlottingPrepareReferenceOutputSchema,
  scientificPlottingReviewPacketInputSchema,
  scientificPlottingReviewPacketOutputSchema,
  scientificPlottingStyleProfilesInputSchema,
  scientificPlottingStyleProfilesOutputSchema
} from '../src/dsh-adapter/auxiliary-tools.js'

const plan = {
  planId: 'aux-focused', route: 'hybrid' as const, routeLocked: true as const,
  rationale: 'Model decoration with immutable code truth', sourceArtifacts: [],
  reproducibleInputs: ['fixture images'], lockedElements: ['code truth'], modelOwnedElements: ['background'],
  contextStatus: 'ready' as const, contextStopReason: 'sufficient' as const, contextEvidenceIds: [],
  unresolvedContext: [], releaseCeiling: 'publication_ready' as const, fallbackPolicy: 'fail_closed' as const
}
const composite = { visualPlan: plan, reviewTask: 'Check locked truth', layers: [
  { path: 'code.png', owner: 'code' as const, opacity: 0.1 },
  { path: 'model.png', owner: 'model' as const }
] }

function tool(name: string) {
  const found = scientificPlottingAuxiliaryTools().find((candidate) => candidate.name === name)
  assert.ok(found)
  return defineContractTool(found)
}
async function workspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'plotting-aux-focused-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function image(root: string, name: string, color: string) {
  const canvas = createCanvas(128, 128)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, 128, 128)
  await writeFile(join(root, name), canvas.toBuffer('image/png'))
}

test('four auxiliaries expose strict complete schemas, optional advertised but mandatory bound workspace', async () => {
  for (const definition of scientificPlottingAuxiliaryTools()) {
    assert.ok(Object.hasOwn(EXPECTED_AUXILIARY_HOST_GRANTS, definition.name))
    assert.equal(definition.inputSchema.additionalProperties, false)
    assert.ok(!(definition.inputSchema.required as string[] | undefined)?.includes('workspaceRoot'))
    const native = defineContractTool(definition)
    assert.deepEqual(native.parameters, JSON.parse(JSON.stringify(definition.inputSchema)))
    assert.deepEqual(native.contractOutputSchema, JSON.parse(JSON.stringify(definition.output.schema)))
    await assert.rejects(definition.execute({}), /workspaceRoot|invalid/i)
  }
})

test('legacy inline constraints and strict nested shapes remain enforced', () => {
  assert.equal(scientificPlottingStyleProfilesInputSchema.safeParse({ topK: 21 }).success, false)
  assert.equal(scientificPlottingStyleProfilesInputSchema.safeParse({ styleSpec: {} }).success, false)
  assert.equal(scientificPlottingStyleProfilesInputSchema.safeParse({ extra: true }).success, false)
  assert.equal(scientificPlottingPrepareReferenceInputSchema.safeParse({ sourcePath: 'x', page: 5001 }).success, false)
  assert.equal(scientificPlottingPrepareReferenceInputSchema.safeParse({ sourcePath: 'x', dpi: 361 }).success, false)
  assert.equal(scientificPlottingPrepareReferenceInputSchema.safeParse({ sourcePath: 'x', cropBox: { x: 0, y: 0, width: 1, height: 1, extra: 0 } }).success, false)
  assert.equal(scientificPlottingReviewPacketInputSchema.safeParse({ manifestPaths: [] }).success, false)
  assert.equal(scientificPlottingReviewPacketInputSchema.safeParse({ manifestPaths: Array(31).fill('x') }).success, false)
  assert.equal(scientificPlottingCompositeInputSchema.safeParse({ ...composite, visualPlan: { ...plan, route: 'code' } }).success, false)
  assert.equal(scientificPlottingCompositeInputSchema.safeParse({ ...composite, layers: composite.layers.map((layer) => ({ ...layer, owner: 'model' })) }).success, false)
  assert.equal(scientificPlottingCompositeInputSchema.safeParse({ ...composite, canvas: { width: 127, height: 128 } }).success, false)
})

test('all declared engine failure statuses are complete and reject extra/missing fields', () => {
  const cases = [
    [scientificPlottingStyleProfilesOutputSchema, ['not_found', 'invalid_request'], { availableProfileIds: [], warnings: [] }],
    [scientificPlottingCompositeOutputSchema, ['invalid_request', 'invalid_workspace', 'image_unreadable', 'write_failed'], {}],
    [scientificPlottingPrepareReferenceOutputSchema, ['invalid_request', 'invalid_workspace', 'unsupported_source', 'pdf_renderer_unavailable', 'crop_failed'], {}],
    [scientificPlottingReviewPacketOutputSchema, ['invalid_request', 'invalid_workspace', 'manifest_read_failed'], {}]
  ] as const
  for (const [schema, statuses, fields] of cases) for (const status of statuses) {
    const result = { ok: false, status, message: 'fixture error', ...fields }
    assert.equal(schema.safeParse(result).success, true, status)
    assert.equal(schema.safeParse({ ...result, extra: true }).success, false, status)
    assert.equal(schema.safeParse({ ...result, message: undefined }).success, false, status)
  }
})

test('native canonical style tool runs real engine and validates full nested styles', async () => {
  await workspace(async (workspaceRoot) => {
    const result = await tool('style_profiles').execute({ workspaceRoot, includeStyleSpec: true }) as { ok: boolean; profiles: unknown[] }
    assert.equal(result.ok, true)
    assert.ok(result.profiles.length > 0)
    const mutated = structuredClone(result) as { profiles: { styleSpec: { palette: { injected?: boolean } } }[] }
    mutated.profiles[0]!.styleSpec.palette.injected = true
    assert.equal(scientificPlottingStyleProfilesOutputSchema.safeParse(mutated).success, false)
  })
})

test('native hybrid tool reuses engine code-last/full-opacity and emits manifest-bound QA handoff', async () => {
  await workspace(async (workspaceRoot) => {
    await image(workspaceRoot, 'code.png', '#ff0000')
    await image(workspaceRoot, 'model.png', '#0000ff')
    const result = await tool('composite').execute({ ...composite, workspaceRoot, figureId: 'focused' }) as {
      ok: boolean; outputPath: string; manifestPath: string;
      layers: { owner: string; opacity: number }[];
      nextCall: { tool: string; arguments: { workspaceRoot: string; outputPath: string; manifestPath: string; task: string } }
    }
    assert.equal(result.ok, true)
    assert.deepEqual(result.layers.map((layer) => [layer.owner, layer.opacity]), [['model', 1], ['code', 1]])
    const rendered = createCanvas(128, 128)
    const context = rendered.getContext('2d')
    context.drawImage(await loadImage(result.outputPath), 0, 0)
    assert.deepEqual([...context.getImageData(64, 64, 1, 1).data], [255, 0, 0, 255])
    assert.deepEqual(result.nextCall, { tool: 'image_generation_review_candidate', arguments: {
      workspaceRoot, outputPath: result.outputPath, manifestPath: result.manifestPath, task: composite.reviewTask
    } })
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as { layers: unknown[] }
    assert.deepEqual(manifest.layers, result.layers)
    assert.equal(scientificPlottingCompositeOutputSchema.safeParse({ ...result, layers: [...result.layers].reverse() }).success, false)
    assert.equal(scientificPlottingCompositeOutputSchema.safeParse({ ...result, layers: result.layers.map((layer) => ({ ...layer, opacity: 0.5 })) }).success, false)
  })
})

test('reference preparation and packet failures travel through the real native canonical tools', async () => {
  await workspace(async (workspaceRoot) => {
    await image(workspaceRoot, 'reference.png', '#ffffff')
    const prepared = await tool('prepare_reference').execute({ workspaceRoot, sourcePath: 'reference.png', extractStyle: false }) as { ok: boolean; croppedImagePath: string }
    assert.equal(prepared.ok, true)
    assert.ok((await readFile(prepared.croppedImagePath)).byteLength > 0)
    const extracted = await tool('prepare_reference').execute({ workspaceRoot, sourcePath: 'reference.png', figureId: 'extracted', extractStyle: true }) as { ok: boolean }
    assert.equal(extracted.ok, true)
    assert.equal(scientificPlottingPrepareReferenceOutputSchema.safeParse(extracted).success, true)
    const packet = await tool('review_packet').execute({ workspaceRoot, manifestPaths: ['missing.manifest.json'] }) as { ok: boolean; status: string }
    assert.equal(packet.ok, false)
    assert.ok(['invalid_workspace', 'manifest_read_failed', 'invalid_request'].includes(packet.status))
    const outputPath = prepared.croppedImagePath
    const outputHash = createHash('sha256').update(await readFile(outputPath)).digest('hex')
    const manifestPath = join(workspaceRoot, 'render.manifest.json')
    const typography = { titleSize: 12, labelSize: 10, tickSize: 9, legendSize: 9, panelSize: 10, publicationClampApplied: true }
    const layoutQuality = { legendItemCount: 0, legendColumnCount: 0, legendOutsidePlot: false,
      legendOverlapRisk: 'none', textOverflowRisk: 'none', panelLabelAdjusted: false, warnings: [] }
    await writeFile(manifestPath, JSON.stringify({
      version: 1, renderer: 'sciforge-scientific-plotting-mcp', tool: 'scientific_plotting_render',
      template: 'line', outputPath, outputHash, plotVersionId: 'plot:focused', recipePath: 'recipe.json',
      createdAt: new Date().toISOString(), visualPlan: plan, warnings: [],
      recipe: { schemaVersion: 1, recipeId: 'plot-recipe:focused', template: 'line', dataHash: outputHash,
        dataSources: [], derivedTables: [], transformations: [], environment: {}, execution: {}, style: {}, render: {} },
      attempts: [{ repaired: false, warnings: [], rendererDiagnostics: { typography, layoutQuality, layoutNotes: [] } }]
    }))
    const created = await tool('review_packet').execute({ workspaceRoot, manifestPaths: [manifestPath] }) as {
      ok: boolean; packet: { items: { typography: typeof typography; layoutQuality: typeof layoutQuality }[] }; packetPath: string
    }
    assert.equal(created.ok, true)
    assert.deepEqual(created.packet.items[0]!.typography, typography)
    assert.deepEqual(created.packet.items[0]!.layoutQuality, layoutQuality)
    assert.match(await readFile(created.packetPath, 'utf8'), /Scientific Plotting Review Packet/)
    assert.equal(scientificPlottingReviewPacketOutputSchema.safeParse({ ...created,
      packet: { ...created.packet, items: [{ ...created.packet.items[0], typography: { ...typography, extra: true } }] }
    }).success, false)
  })
})
