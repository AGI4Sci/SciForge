import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as plugin from '../src/dsh-adapter.js'
import { artifactFixture } from './artifact-fixture.js'
it.each(['threads.list', 'artifacts.listEvents', 'threads.prepare'])('manual DSH poll reports %s denial as an error', async operation => {
  const f = await artifactFixture(), ctx = new Context()
  let reads = 0, armed = false
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', { ...f.ports, request: async (r: any) => {
      if (r.operation === 'threads.read') reads++
      if (r.operation === operation || (armed && operation === 'threads.prepare' && r.operation === 'threads.read' && reads > 1)) throw Object.assign(new Error('DENIED synthetic'), { code: 'DENIED' })
      return f.ports.request(r)
    } })
    await ctx.plugin(plugin)
    if (operation === 'threads.prepare') {
      const updated = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: f.scope,
        callId: brandString<ToolCallId>('prepare-poll-seed'), signal: new AbortController().signal })
      expect(updated.isError).toBe(false); reads = 0; armed = true
    }
    const result = await ctx.tools.execute({ name: 'evidence_dag_poll_artifact_events', arguments: f.scope,
      callId: brandString<ToolCallId>('denied-poll'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('DENIED')
  } finally { await ctx.fiber.dispose() }
})
