import { expect, test } from 'vitest'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { ProjectDagRuntime } from '../../../packages/domains/project-dag/src/runtime.js'

test('static update URL preserves the exact baseline UI authentication contract', async () => {
  const scratch = await mkdtemp(join(process.env.TMPDIR!, 'static-contract-'))
  const source = await readFile(new URL('./fixtures/legacy-runtime.ts.txt', import.meta.url), 'utf8')
  const provenance = JSON.parse(await readFile(new URL('./fixtures/legacy-runtime.source.json', import.meta.url), 'utf8'))
  expect(createHash('sha256').update(source).digest('hex')).toBe(provenance.sha256)
  const file = join(scratch, 'baseline.mjs')
  await build({ stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../../packages/domains/project-dag/src/', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: file })
  const baseline = await import(pathToFileURL(file).href)
  const now = '2026-07-26T05:30:20.000Z', digest = 'sha256:' + 'a'.repeat(64)
  const receipt = { projectKey: 'path:/synthetic', jobId: 'pjob_test', acceptedRequestVersion: 1,
    desiredFingerprint: 'project-update-desired:' + 'b'.repeat(64), desiredEvidenceVector: [{ threadId: 'codex:t', digest }],
    capturedScope: { includedSessions: ['codex:t'], excludedSessions: [], isolatedSessions: [] },
    state: 'queued', acceptedAt: now, updatedAt: now }
  async function getUrl(Runtime: typeof ProjectDagRuntime) {
    const runtime = new Runtime({ sidecar: { ensure: async () => ({ baseUrl: 'http://127.0.0.1:3898', runtimeToken: 'synthetic-ui-token' }),
      stop: async () => {} } as never,
      readEvidenceSnapshot: async () => ({ threadId: 'codex:t', version: 1, digest, inputWatermark: 'turn:1',
        schemaVersion: '1', extractorVersion: '1', verifierVersion: '1', artifactDigests: [], createdAt: now }),
      fetchImpl: async url => new Response(JSON.stringify({ ok: true, data: String(url).includes('/updates/status')
        ? { projectKey: 'path:/synthetic', state: 'pending', latestReceipt: receipt, activeReceipt: receipt } : receipt }),
        { headers: { 'Content-Type': 'application/json' } }) })
    const dispose = await runtime.activate({ signal: new AbortController().signal,
      enablement: { isEnabled: async () => true, subscribe: () => () => {} }, log: () => {},
      agentThreads: { read: async () => ({ id: 't', runtimeId: 'codex', workspaceRoot: '/synthetic' }) } } as never)
    try { return (await runtime.update({ workspaceRoot: '/synthetic', scope: ['codex:t'] })).url }
    finally { await dispose() }
  }
  const original = await getUrl(baseline.ProjectDagRuntime)
  expect(new URL(original).hash).toBe('#token=synthetic-ui-token')
  expect(await getUrl(ProjectDagRuntime)).toBe(original)
})
