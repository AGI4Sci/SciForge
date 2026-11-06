import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { defineContractTool } from './contract-tool.js'

test('native DSH projection retains exact nested contracts and validates before execution', async () => {
  const inputSchema = z.toJSONSchema(z.object({ packet: z.object({ mode: z.enum(['code', 'hybrid']), count: z.number().int().min(2) }).strict() }).strict(), { target: 'draft-7' })
  const outputSchema = z.toJSONSchema(z.object({ ok: z.literal(true) }).strict(), { target: 'draft-7' })
  let calls = 0
  const tool = defineContractTool({ name: 'nested_contract', description: 'Canonical nested contract', inputSchema, output: { schema: outputSchema, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }, execute: async () => { calls++; return { ok: true } } })
  const projected = (ToolRuntime.prototype as unknown as { schemaOf: (definition: unknown, detach: boolean) => { parameters: unknown } }).schemaOf.call({}, tool, true)
  assert.deepEqual(projected.parameters, inputSchema)
  assert.deepEqual(tool.contractOutputSchema, outputSchema)
  await assert.rejects(tool.execute({ packet: { mode: 'invented', count: 3 } }))
  await assert.rejects(tool.execute({ packet: { mode: 'code', count: 1 } }))
  await assert.rejects(tool.execute({ packet: { mode: 'code', count: 3, forged: true } }))
  assert.equal(calls, 0)
  assert.deepEqual(await tool.execute({ packet: { mode: 'code', count: 3 } }), { ok: true })
  assert.equal(calls, 1)
})

test('native DSH contract rejects invalid outputs and non-object inputs', async () => {
  assert.throws(() => defineContractTool({ name: 'invalid', description: 'Invalid', inputSchema: { type: 'string' }, output: { schema: {}, render: () => [] }, execute: async () => ({}) }))
  const tool = defineContractTool({ name: 'invalid_output', description: 'Invalid output', inputSchema: { type: 'object', additionalProperties: false }, output: { schema: { type: 'object', properties: { ok: { const: true } }, required: ['ok'], additionalProperties: false }, render: () => [] }, execute: async () => ({ ok: false }) })
  await assert.rejects(tool.execute({}))
})
