#!/usr/bin/env node
// Controlled source-build benchmark; no real Cloud, credentials or demo apps.
import { execFile as execFileCallback } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { defineAuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import { restRequestSchema, restResponseSchema } from '@sciforge/collaboration-contracts'
import { projectFixture, TEST_IDS, TEST_LATER_TIMESTAMP } from '@sciforge/collaboration-contracts/testing'
import { CollaborationLocalStore, CollaborationSettingsService } from '@sciforge/domain-collaboration/main'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const execFile = promisify(execFileCallback)
const baseline = process.argv.find((argument) => argument.startsWith('--baseline='))?.slice('--baseline='.length)
if (!baseline || baseline.startsWith('-')) throw new Error('Supply --baseline=<local Git commit>.')
const output = resolve(root, 'artifacts/sync-latency/source-benchmark')
await mkdir(output, { recursive: true })
const entry = resolve(root, 'packages/domains/collaboration/src/main/connection.ts')
const relativeEntry = 'packages/domains/collaboration/src/main/connection.ts'
const { stdout: beforeSource } = await execFile('git', ['show', `${baseline}:${relativeEntry}`], { cwd: root })
const afterSource = await readFile(entry, 'utf8')
const projects = Array.from({ length: 12 }, (_, index) => ({
  ...projectFixture, projectId: `prj_BenchmarkProject${String(index).padStart(4, '0')}`
}))

function coordinationResponse(request) {
  const project = projects.find(({ projectId }) => projectId === request.projectId)
  if (!project) throw new Error('Unknown fixture project.')
  const items = {
    user_label_facts: [{ schemaVersion: 1, type: 'project_user_label_fact', projectId: project.projectId,
      userId: project.ownerUserId, displayName: 'Benchmark Owner', status: 'active', revision: 1,
      observedAt: TEST_LATER_TIMESTAMP }],
    agent_label_facts: [{ schemaVersion: 1, type: 'project_agent_label_fact', projectId: project.projectId,
      agentId: project.coordinatorAgentId, ownerUserId: project.ownerUserId, deviceId: TEST_IDS.deviceId,
      displayName: 'Benchmark Agent', nodeType: 'desktop', lifecycleStatus: 'active', revision: 1,
      observedAt: TEST_LATER_TIMESTAMP }],
    memberships: [{ schemaVersion: 1, type: 'project_membership', revision: 1,
      createdAt: TEST_LATER_TIMESTAMP, updatedAt: TEST_LATER_TIMESTAMP,
      projectMembershipId: `pmb_BenchmarkOwner${project.projectId.slice(-4)}`, projectId: project.projectId,
      userId: project.ownerUserId, state: 'active', authorityEpoch: 1, activatedAt: TEST_LATER_TIMESTAMP,
      removalRequestedAt: null, removalRequestedByUserId: null, removedAt: null }]
  }
  return {
    protocolVersion: '1.0', type: 'rest.project_coordination', requestId: request.requestId,
    project, observedAt: TEST_LATER_TIMESTAMP, finalSummary: null,
    pages: request.collections.map(({ collection, limit }) => ({ collection, limit, items: items[collection] ?? [] })),
    dashboard: { schemaVersion: 1, revision: 1, createdAt: TEST_LATER_TIMESTAMP,
      updatedAt: TEST_LATER_TIMESTAMP, type: 'cloud_project_dashboard', projectId: project.projectId,
      projectName: project.displayName, role: 'owner', view: 'board', tasks: [], activity: [],
      activityCursor: null, mentionableUsers: [], materialConflicts: [], stale: false, offline: false, revoked: false }
  }
}

async function measure(label, source) {
  const modulePath = resolve(output, `connection-${label}.mjs`)
  await build({ entryPoints: [entry], outfile: modulePath, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', plugins: [{ name: 'immutable-benchmark-entry', setup(builder) {
      builder.onLoad({ filter: /[/\\]main[/\\]connection\.ts$/ }, ({ path }) => (
        path === entry ? { contents: source, loader: 'ts', resolveDir: resolve(entry, '..') } : undefined
      ))
    } }] })
  const { CollaborationConnection } = await import(pathToFileURL(modulePath).href)
  let active = 0
  let peakConcurrentHttp = 0
  let commands = 0
  const server = createServer((request, response) => {
    void (async () => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const input = restRequestSchema.parse(JSON.parse(raw))
      commands += 1; active += 1; peakConcurrentHttp = Math.max(peakConcurrentHttp, active)
      try {
        await delay(200)
        const body = input.type === 'project.list'
          ? { protocolVersion: '1.0', type: 'rest.project_page', requestId: input.requestId,
              limit: 250, projects, observedAt: TEST_LATER_TIMESTAMP }
          : coordinationResponse(input)
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(restResponseSchema.parse(body)))
      } finally { active -= 1 }
    })().catch(() => { response.statusCode = 500; response.end('{}') })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const connections = []
  try {
    for (let index = 0; index < 5; index += 1) {
      const store = new CollaborationLocalStore({ read: async () => undefined, write: async () => undefined })
      await store.open()
      const transport = defineAuthenticatedCloudTransport({
        status: () => ({ state: 'ready', baseUrl, userId: TEST_IDS.userId, deviceId: TEST_IDS.deviceId, deviceRevision: 1 }),
        stageObject: async () => { throw new Error('Unused by read benchmark.') },
        readObject: async () => { throw new Error('Unused by read benchmark.') },
        execute: async (request, options) => {
          const response = await fetch(baseUrl, { method: 'POST', body: JSON.stringify(request.payload), signal: options?.signal })
          return { contractVersion: 1, status: response.status, body: await response.json() }
        }
      })
      connections.push(new CollaborationConnection({ store,
        settings: new CollaborationSettingsService({ read: async () => ({ revision: 0, value: null }),
          write: async () => ({ revision: 0, value: null }), clear: async () => ({ revision: 0, value: null }) }),
        outbox: { stop() {} }, authenticatedCloudTransport: transport, agentCloudRuntime: {},
        inboxHandler: { handle: async () => undefined } }))
    }
    const samples = []
    for (let round = 0; round < 3; round += 1) {
      samples.push(...await Promise.all(connections.map(async (connection, client) => {
        const started = performance.now()
        await connection.refreshDashboardsForPage()
        if (connection.cloudDashboards().length !== projects.length) throw new Error('Incomplete Dashboard result.')
        return { round, client, ms: Math.round(performance.now() - started) }
      })))
    }
    const values = samples.map(({ ms }) => ms).sort((a, b) => a - b)
    return { label, clients: 5, projectsPerClient: 12, rounds: 3, httpDelayMs: 200,
      commands, peakConcurrentHttp, samples, p50Ms: values[7], p95Ms: values[14] }
  } finally {
    await Promise.all(connections.map((connection) => connection.dispose()))
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const before = await measure('before', beforeSource)
const after = await measure('after', afterSource)
const report = { baseline, scope: 'Source-built production Connection with isolated HTTP fixture and ready Identity fixture.',
  unverified: ['Real Cloud', 'Authenticated source Electron GUI latency', 'Physical devices', 'Device revalidation latency'], before, after }
await writeFile(resolve(output, 'comparison.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
