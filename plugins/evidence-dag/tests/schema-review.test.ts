import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as entry from '../src/dsh-adapter.js'
import { evidenceDagClosurePolicyV1Schema, evidenceDagSidechainAppendInputSchema, evidenceDagExportSnapshotProductsInputSchema, evidenceDagDataCiteMetadataV1Schema } from '../src/core.js'
import { artifactFixture } from './artifact-fixture.js'

it('official discovery publishes canonical nested policy, sidechain and export fields before authorization', async () => {
  const f = await artifactFixture(), ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', f.ports); await ctx.plugin(entry)
    const schemas = ctx.tools.schemas()
    const parameters = (name: string): any => schemas.find(s => s.name === name)!.parameters
    const policy = parameters('evidence_dag_seal_closure').properties.policy
    expect(Object.keys(policy.properties).sort()).toEqual(Object.keys(evidenceDagClosurePolicyV1Schema.shape).sort())
    expect(policy.additionalProperties).toBe(false)
    const sidechain = parameters('evidence_dag_append_sidechain').properties.input
    expect(Object.keys(sidechain.properties).sort()).toEqual(Object.keys(evidenceDagSidechainAppendInputSchema.shape).sort())
    const products = parameters('evidence_dag_export_snapshot_products').properties.input
    expect(Object.keys(products.properties).sort()).toEqual(Object.keys(evidenceDagExportSnapshotProductsInputSchema.shape).sort())
    expect(Object.keys(products.properties.datacite.properties).sort()).toEqual(Object.keys(evidenceDagDataCiteMetadataV1Schema.shape).sort())
    f.calls.length = 0
    const invalid = await ctx.tools.execute({ name: 'evidence_dag_seal_closure', arguments: { ...f.scope, idempotencyKey: 'invalid-policy', policy: {} },
      callId: brandString<ToolCallId>('invalid-policy'), signal: new AbortController().signal })
    expect(invalid.isError).toBe(true); expect(f.calls).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
