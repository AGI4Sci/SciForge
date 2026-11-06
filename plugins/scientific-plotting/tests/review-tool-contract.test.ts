import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { VISUAL_REVIEW_CAPABILITY_IDS } from '../src/review/contract.js'
import { createVisualReviewOperations } from '../src/review/operations.js'
import {
  EXPECTED_REVIEW_HOST_GRANTS,
  REVIEW_TOOL_CAPABILITIES,
  registerVisualReviewTools,
  visualReviewTools
} from '../src/review-adapter/tools.js'

const operations = createVisualReviewOperations()
const tools = visualReviewTools(operations)

test('review tools preserve all ten capability IDs in the unified plugin', () => {
  assert.deepEqual(Object.values(REVIEW_TOOL_CAPABILITIES), Object.values(VISUAL_REVIEW_CAPABILITY_IDS))
  assert.deepEqual(tools.map(({ name }) => name), Object.keys(REVIEW_TOOL_CAPABILITIES))
  const registered: unknown[] = []
  registerVisualReviewTools(operations, (tool) => registered.push(tool), (tool) => tool)
  assert.deepEqual(registered.map((tool) => (tool as { name: string }).name), tools.map(({ name }) => name))
})

test('review host grants preserve canonical workspace scope, effect and approval', () => {
  for (const definition of operations.definitions()) {
    const grant = Object.values(EXPECTED_REVIEW_HOST_GRANTS).find(({ id }) => id === definition.id)
    assert.deepEqual(grant, {
      id: definition.id, scope: definition.scope, effect: definition.effect, approval: definition.approval
    })
    assert.equal(grant?.scope, 'workspace')
  }
  assert.equal(EXPECTED_REVIEW_HOST_GRANTS.visual_review_accept_candidate?.approval, 'confirmation')
  assert.equal(EXPECTED_REVIEW_HOST_GRANTS.visual_review_accept_candidate?.effect, 'destructive')
})

test('review tools publish canonical complete input/output schemas, not opaque object outputs', () => {
  for (const [name, id] of Object.entries(REVIEW_TOOL_CAPABILITIES)) {
    const tool = tools.find((tool) => tool.name === name)!
    const definition = operations.definitions().find((definition) => definition.id === id)!
    const input = z.toJSONSchema(definition.inputSchema, { target: 'draft-7', unrepresentable: 'any' })
    const { properties } = tool.inputSchema as { properties: Record<string, unknown> }
    assert.deepEqual(tool.inputSchema, {
      ...input,
      properties: { ...input.properties, workspaceRoot: { type: 'string', minLength: 1, maxLength: 4_096 } }
    })
    assert.deepEqual(tool.output.schema, z.toJSONSchema(definition.outputSchema, { target: 'draft-7', unrepresentable: 'any' }))
    assert.deepEqual(Object.keys(tool.parameters).sort(), Object.keys(properties).sort())
    assert.deepEqual(tool.parameters.workspaceRoot, { type: 'string' })
    assert.equal(tool.inputSchema.additionalProperties, false)
  }
  const annotations = tools.find(({ name }) => name === 'visual_review_save_annotations')!
  const schema = annotations.inputSchema as { properties: { annotations: { items: { properties: Record<string, unknown> } } } }
  assert.ok(schema.properties.annotations.items.properties.geometry)
})

test('review tools reject unbound/relative workspaces and forged nested workspace identity', async () => {
  const open = tools.find(({ name }) => name === 'visual_review_open')!
  await assert.rejects(open.execute({ documentId: 'figure' }))
  await assert.rejects(open.execute({ documentId: 'figure', workspaceRoot: 'relative' }), /absolute path/)
  await assert.rejects(open.execute({
    documentId: 'figure', workspaceRoot: '/tmp',
    artifact: { kind: 'image', sourcePath: 'figure.png', workspaceRoot: '/forged' }
  }), z.ZodError)
  await assert.rejects(operations.invoke(VISUAL_REVIEW_CAPABILITY_IDS.open, {
    documentId: 'figure', workspaceRoot: '/forged'
  }, '/tmp'), z.ZodError)
})
