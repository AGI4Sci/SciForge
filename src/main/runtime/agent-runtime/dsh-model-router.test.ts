import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import yaml from 'js-yaml'
import { DSH_SAFETY_PATCH, DSH_MODEL_ROUTER_PATCH } from '@sciforge/dsh-runtime'
import { createProductionDshHostRuntimeAdapter } from './dsh-agent-runtime-adapter'
import { defaultModelRouterSettings } from '../../../shared/app-settings-model-router'
import type { AppSettingsV1 } from '../../../shared/app-settings-types'
const releases = vi.hoisted(() => [] as unknown[])
// Only the reviewed release metadata is fixture-specific. Real closure, hash,
// safety and full-config verification execute through the production factory.
vi.mock('@sciforge/dsh-runtime', async original => ({ ...await original<object>(), DSH_RELEASE_PINS: releases }))
// Discovery policy has dedicated coverage; these tests own the packaged pinned
// target so the host machine's own dsh installation cannot preempt the fixture.
vi.mock('./dsh-executable-discovery', async () => {
  const { createPinnedDshDeployment, DSH_RELEASE_PINS } = await import('@sciforge/dsh-runtime')
  return {
    createDshDeploymentTargetResolver: (options: { resourcesDirectory: string }) => async () => {
      const artifactDirectory = join(options.resourcesDirectory, 'agent-runtimes', 'dsh', '0.2.0-rc.2', `${process.platform}-${process.arch}`)
      const executable = join(artifactDirectory, process.platform === 'win32' ? 'dsh.exe' : 'dsh')
      const pin = DSH_RELEASE_PINS.find(release => release.platform === process.platform && release.arch === process.arch)?.pin
      return { executable, artifactRoot: artifactDirectory, expectedVersion: '0.2.0-rc.2', ...createPinnedDshDeployment({ artifactDirectory, executable, pin }), source: 'packaged-application' as const }
    }
  }
})
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const surface = { tools: () => [], call: vi.fn(), abortTurn: vi.fn(), assertPrincipalLease: vi.fn() }

async function setup() {
  const root = await mkdtemp(join(process.env.TMPDIR!, 'dsh-route-'))
  const requests: { url?: string; auth?: string; body: any }[] = []
  let healthy = true
  const server = createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(healthy ? 200 : 503); res.end('{"ok":true}'); return }
    let text = ''; for await (const chunk of req) text += chunk
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(text) })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'fixture-response' }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const modelRouter = defaultModelRouterSettings()
  modelRouter.baseUrl = `http://127.0.0.1:${port}/v1`
  modelRouter.runtimeApiKey = 'local-only-one'
  modelRouter.publicModelAlias = 'user-alias-one'
  modelRouter.profiles.default.textReasoner = { baseUrl: 'https://upstream.invalid/v1', apiKey: 'never-send-upstream', model: 'upstream-name', protocol: 'openai-chat' as never }
  const settings = { activeAgentRuntime: 'dsh', modelAccess: { mode: 'api' }, modelRouter } as AppSettingsV1
  const artifact = join(root, 'agent-runtimes/dsh/0.2.0-rc.2', `${process.platform}-${process.arch}`)
  await mkdir(artifact, { recursive: true })
  const source = await readFile(new URL('./tests/fixtures/dsh-router-acp.mjs', import.meta.url), 'utf8')
  const script = `#!${process.execPath}\n` + source.replace('YAML_MODULE', new URL('file://' + createRequire(import.meta.url).resolve('js-yaml')).href)
  await writeFile(join(artifact, 'dsh'), script, { mode: 0o700 })
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expr: value }) })])
  const rows = yaml.load(yaml.dump(JSON.parse(DSH_SAFETY_PATCH)) + DSH_MODEL_ROUTER_PATCH, { schema }) as any[]
  const composed = new Map<string, any>()
  for (const row of rows) composed.set(row.id, { ...composed.get(row.id), ...row, config: { ...composed.get(row.id)?.config, ...row.config } })
  const text = JSON.stringify([...composed.values()])
  releases.splice(0, releases.length, { platform: process.platform, arch: process.arch, pin: { version: '0.2.0-rc.2', sourceCommit: 'a'.repeat(40), files: { dsh: sha(script) }, configDigest: sha(text), entryIds: [...composed.keys()], pluginNames: [] } })
  const adapter = createProductionDshHostRuntimeAdapter({ userDataDirectory: root, resourcesDirectory: root, toolSurface: surface })
  return { root, settings, adapter, requests, setHealthy: (value: boolean) => { healthy = value }, close: async () => { await adapter.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) } }
}

describe('production DSH ModelRouter route over local HTTP', () => {
  it('rejects an explicitly blank model rather than silently choosing the default alias, then recovers', async () => {
    const f = await setup()
    try {
      f.settings.modelRouter!.publicModelAlias = ' '
      expect(await f.adapter.probe({ settings: f.settings })).toMatchObject({ available: false, failure: { technicalDetail: 'runtime_model_route_missing' } })
      expect(f.requests).toHaveLength(0)
      await expect(f.adapter.startThread({ settings: f.settings }, { runtimeId: 'dsh', workspace: f.root })).rejects.toMatchObject({ code: 'runtime_model_route_missing', recoverable: true })
      f.settings.modelRouter!.publicModelAlias = 'recovered'
      expect(await f.adapter.probe({ settings: f.settings })).toMatchObject({ available: true })
    } finally { await f.close() }
  })
  it.each(['disabled', 'policy', 'readiness', 'credential', 'upstream', 'remote'] as const)('fails closed for %s and never dispatches model traffic', async fault => {
    const f = await setup()
    try {
      if (fault === 'disabled') f.settings.modelRouter!.enabled = false
      if (fault === 'policy') f.settings.modelAccess = { mode: 'coding-plan', planAdapterId: '' }
      if (fault === 'readiness') f.setHealthy(false)
      if (fault === 'credential') f.settings.modelRouter!.runtimeApiKey = ''
      if (fault === 'upstream') f.settings.modelRouter!.profiles.default.textReasoner.model = ''
      if (fault === 'remote') f.settings.modelRouter!.baseUrl = 'https://remote.invalid/v1'
      expect(await f.adapter.probe({ settings: f.settings })).toMatchObject({ available: false })
      expect(f.requests).toHaveLength(0)
    } finally { await f.close() }
  })
  it('settings invalidation retires the owned child before replacement and keeps the adapter reusable', async () => {
    const f = await setup()
    try {
      const context = { settings: f.settings }
      await f.adapter.startThread(context, { runtimeId: 'dsh', workspace: f.root })
      const pid = f.requests[0].body.fixturePid
      await f.adapter.invalidateModelAccess()
      expect(() => process.kill(pid, 0)).toThrow()
      await f.adapter.startThread(context, { runtimeId: 'dsh', workspace: f.root })
      expect(f.requests[1].body.fixturePid).not.toBe(pid)
    } finally { await f.close() }
  })
  it('uses the current neutral route, never upstream secrets, and restarts on alias/key changes', async () => {
    const f = await setup()
    try {
      const context = { settings: f.settings }
      expect(await f.adapter.probe(context)).toMatchObject({ available: true })
      await f.adapter.startThread(context, { runtimeId: 'dsh', workspace: f.root })
      expect(f.requests).toMatchObject([{ url: '/v1/chat/completions', auth: 'Bearer local-only-one', body: { model: 'user-alias-one' } }])
      const pid1 = f.requests[0].body.fixturePid
      f.settings.modelRouter!.runtimeApiKey = 'local-only-two'
      f.settings.modelRouter!.publicModelAlias = 'user-alias-two'
      await f.adapter.startThread(context, { runtimeId: 'dsh', workspace: f.root })
      expect(f.requests[1]).toMatchObject({ auth: 'Bearer local-only-two', body: { model: 'user-alias-two' } })
      expect(f.requests[1].body.fixturePid).not.toBe(pid1)
      expect(JSON.stringify(f.requests)).not.toContain('never-send-upstream')
    } finally { await f.close() }
  })
})
