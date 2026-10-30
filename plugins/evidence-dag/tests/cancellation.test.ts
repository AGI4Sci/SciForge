import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { it, expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as plugin from '../src/dsh-adapter.js'
it('forwards the official call identity and cancellation, waiting for actual host quiescence before returning', async () => {
  const ctx = new Context(), storageRoot = await mkdtemp(join(tmpdir(), 'evidence-cancel-'))
  const scope = { runtimeId: 'codex', threadId: 'thread-1', workspaceRoot: '/synthetic' }
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(r => enter = r), blocked = new Promise<void>(r => release = r)
  const requests: any[] = [], cancelled: string[] = []
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', { storageRoot, identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' },
      request: async (r: any) => { requests.push(r); if (r.operation === 'sidecar.close') return { exited: true }; enter(); await blocked; return { ...scope, trace: [], watermark: '7' } },
      cancel: async (id: string) => { cancelled.push(id); await blocked; return { cancelled: true, quiescent: true } },
    })
    await ctx.plugin(plugin)
    const controller = new AbortController()
    let settled = false
    const call = ctx.tools.execute({ name: 'evidence_dag_update', arguments: scope, callId: brandString<ToolCallId>('official-cancel-1'), signal: controller.signal }).then(r => { settled = true; return r })
    await entered
    expect(requests[0].caller).toEqual({ callId: brandString<ToolCallId>('official-cancel-1') })
    controller.abort(); await new Promise(r => setImmediate(r))
    expect(cancelled).toEqual([requests[0].requestId]); expect(settled).toBe(false)
    release(); expect((await call).isError).toBe(true)
    expect(existsSync(join(storageRoot, 'deltas.json'))).toBe(false)
  } finally { release?.(); await ctx.fiber.dispose() }
})
