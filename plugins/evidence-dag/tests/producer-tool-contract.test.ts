import { it, expect } from 'vitest'
import { readFile, mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as entry from '../src/dsh-adapter.js'
import { createDomainHostServiceResolver } from '@sciforge/domain-evidence-dag/host-services'

it('declares every official tool and executes scoped producer poll through public Context', async () => {
  const contract = JSON.parse(await readFile(new URL('../sciforge.dsh.json', import.meta.url), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(contract.packageName).toBe(manifest.name)
  expect(contract.tools.evidence_dag_poll_producer_provenance).toMatchObject({ id: 'evidence-dag.poll-producer-provenance', effect: 'workspace-write', scope: 'workspace' })
  const root = await mkdtemp(join(tmpdir(), 'evidence-producer-tool-'))
  const scope = { runtimeId: 'dsh', threadId: 'actual-thread', workspaceRoot: join(root, 'workspace') }
  await mkdir(scope.workspaceRoot)
  const calls: any[] = []
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', { storageRoot: join(root, 'evidence'), identity: { pluginId: manifest.name, version: manifest.version, profileId: root },
      request: async (request: any) => {
        calls.push(request)
        if (request.operation === 'threads.read') return { ...scope, watermark: '7', trace: [] }
        if (request.operation === 'sidecar.close') return { exited: true }
        throw new Error('unexpected operation')
      }, cancel: async () => ({ cancelled: true, quiescent: true }) })
    await ctx.plugin(entry)
    const result = await ctx.tools.execute({ name: 'evidence_dag_poll_producer_provenance', arguments: scope, callId: brandString<ToolCallId>('producer-tool-call'), signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ delivered: 0, idempotent: 0, skipped: 0, pending: [], drained: true })
    expect(calls[0]).toMatchObject({ operation: 'threads.read', scope, caller: { callId: 'producer-tool-call' } })
    // Declaration is exhaustive, not merely a documentation-only new-tool row.
    const source = await readFile(new URL('../src/dsh-adapter.ts', import.meta.url), 'utf8')
    for (const name of Object.keys(contract.tools)) expect(source).toContain(`'${name}'`)
  } finally { await ctx.fiber.dispose() }
})

it('public resolver accepts canonical manifest package identity, not the old Cordis entry name', () => {
  const resolver = createDomainHostServiceResolver({ userDataDir: '/private/profile', environment: {
    SCIFORGE_EVIDENCE_PYTHON: '/usr/bin/python3', SCIFORGE_EVIDENCE_WHEEL_PATH: '/private/wheel.whl',
    SCIFORGE_EVIDENCE_WHEEL_SHA256: 'a'.repeat(64), SCIFORGE_EVIDENCE_CLIENT_MODULE: '/private/client.mjs',
  }, reasoner: async () => '', threads: { read: async () => { throw new Error('not invoked') }, list: async () => [] }, capabilities: { invoke: async () => { throw new Error('not invoked') } }, logUnavailable() {} })
  expect(resolver.resolve('sciforge-evidence-dag', '1.0.0', 1)).toBeUndefined()
  expect(resolver.resolve('@sciforge/plugin-evidence-dag', '1.0.0', 1)?.evidenceDagPorts).toBeDefined()
  const client = resolver.resolveClients('@sciforge/plugin-evidence-dag', '1.0.0', 1)[0]!
  expect(client.config).toMatchObject({ identity: { pluginId: '@sciforge/plugin-evidence-dag', version: '1.0.0' } })
})
