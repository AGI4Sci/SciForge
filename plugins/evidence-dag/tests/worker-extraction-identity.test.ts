import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import { EvidenceRuntime } from '../src/runtime.js'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { workerOptions } from './worker-fixture.js'

const fixtureUrl = new URL('./fixtures/captured-host-page.json', import.meta.url)
// Component acceptance: captured real Host page + formal wheel, controlled
// reasoner. This is NOT real-model or running-application acceptance.
const platformDescribe = process.platform === 'win32' ? describe.skip : describe
platformDescribe('captured Host → canonical immutable graph → seal', () => {
  for (const restart of [false, true]) it(`preserves canonical identities, cold restart=${restart}`, async () => {
    const page = JSON.parse(await readFile(fixtureUrl, 'utf8'))
    const trace = page.turns.find((t: any) => t.status === 'completed').items
    const quoteItem = trace.find((i: any) => i.kind === 'tool' && typeof i.detail === 'string' && i.detail.startsWith('# Local source'))
    const quote = quoteItem.detail.split('\n').find((s: string) => s.startsWith('A glass bead'))
    expect(quote).toBeTruthy()
    const opts = await workerOptions()
    const scope = { runtimeId: 'captured-runtime', threadId: 'captured-thread', workspaceRoot: join(opts.root, 'workspace') }
    const identity = { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'isolated-component' }
    const counts = { extract: 0, nli: 0, adversarial: 0 }
    const calls: string[] = []
    let extractingSnapshot: any, extractedGraph: any
    const reasoner = async (input: any) => {
      const system = input.messages.find((m: any) => m.role === 'system')?.content ?? ''
      if (system.includes('EDAG-TASK: extract')) {
        counts.extract++
        if (counts.extract > 1) throw new Error('seal/restart must never extract again')
        const user = input.messages.filter((m: any) => m.role !== 'system').map((m: any) => m.content).join('\n')
        expect(user).toContain('decodedText')
        expect(user).toContain('A glass bead immersed')
        expect(user).toContain(quoteItem.id)
        return JSON.stringify({ nodes: [
          { tmp_id: 'external-note', type: 'source_assertion', content: quote, trace_ref: quoteItem.id },
          { tmp_id: 'reported-assertion', type: 'claim', content: quote, trace_ref: quoteItem.id },
        ], edges: [{ src: 'external-note', dst: 'reported-assertion', rel: 'supports' }] })
      }
      if (system.includes('EDAG-TASK: nli')) { counts.nli++; return '{"entailment":0.9,"label":"entailment"}' }
      if (system.includes('EDAG-TASK: adversarial')) { counts.adversarial++; return '{"result":"passed","confidence":0.9,"rationale":"Controlled component review of captured note; not model evidence."}' }
      throw new Error('Unexpected reasoning task')
    }
    const make = async (packaged = false) => {
      const production = createEvidenceProductionService({ identity, storageRoot: join(opts.root, 'state'), clientModule: 'unused', worker: { ...opts, reasoner },
        threads: { read: async () => ({ ...scope, watermark: '7', trace }), list: async () => [scope] },
        artifacts: { invoke: async operation => { if (operation === 'artifacts.listEvents') return { ok: true, value: { events: [], lastSequence: 0 } }; throw new Error(`No artifact was authorized: ${operation}`) } },
      })
      const controller = new AbortController()
      const ports: any = { identity, storageRoot: join(opts.root, 'state'), cancel: async () => ({ cancelled: true, quiescent: true }), request: async (payload: any) => {
        calls.push(payload.operation)
        if (payload.operation === 'sidecar.close') { await production.close(); return { exited: true } }
        const result = await production.providers.evidenceDagPorts.operations[payload.operation]({
          requestId: payload.requestId, serviceId: 'evidenceDagPorts', operation: payload.operation, input: payload,
          owner: { connectionId: 'component', pluginId: identity.pluginId, packageName: identity.pluginId, version: identity.version, generation: 1, invocationId: payload.requestId,
            authority: { effect: 'workspace-write', caller: { principalId: 'isolated-owner', workspaceId: scope.workspaceRoot }, ordinarySession: scope } },
          signal: controller.signal, assertCurrent() { controller.signal.throwIfAborted() },
        } as any) as any
        if (payload.operation === 'sidecar.extract') { extractingSnapshot = result.snapshot; extractedGraph = result.graph }
        return result
      } }
      const Runtime = packaged ? (await import(pathToFileURL(join(opts.release, 'runtime.mjs')).href)).EvidenceRuntime : EvidenceRuntime
      const runtime = new Runtime(ports)
      await runtime.start()
      return { runtime, production }
    }
    await mkdir(opts.storageRoot, { recursive: true })
    let owner = await make()
    try {
      const update = await owner.runtime.update(scope)
      const claims = update.status.provisional?.lastGood?.claims as any[]
      expect(claims?.length, 'canonical provisional must be nonempty').toBeGreaterThan(0)
      expect(extractedGraph?.nodes.length).toBeGreaterThan(0)
      const ids = extractedGraph.nodes.filter((n: any) => n.type === 'claim').map((n: any) => n.id)
      expect(claims.map(c => c.id)).toEqual(ids)
      expect(ids.every((id: string) => id !== 'reported-assertion' && id !== 'claim:1')).toBe(true)
      const diskBefore = JSON.parse(await readFile(join(opts.root, 'state/deltas.json'), 'utf8'))
      const recordsBefore = diskBefore.chains[0].records
      expect(recordsBefore[0].payload.graph).toEqual(extractedGraph)
      expect(recordsBefore[0].payload.claims.map((c: any) => c.id)).toEqual(ids)
      expect(recordsBefore[0].payload.graph.edges.length).toBeGreaterThan(0)
      const reviewsBefore = counts.nli
      if (restart) {
        const pid = owner.production.worker.pid!
        await owner.runtime.close(); await owner.production.close()
        expect(() => process.kill(pid, 0)).toThrow()
        // Deliberately remove the disposable Python snapshots too: replay must
        // come from immutable delta graph, not a runtime or worker cache.
        await rm(opts.storageRoot, { recursive: true, force: true }); await mkdir(opts.storageRoot)
        owner = await make(true)
        const cold = await owner.runtime.snapshotStatus(scope)
        expect(cold.provisional.lastGood.claims.map((c: any) => c.id)).toEqual(ids)
      }
      const closure = await owner.runtime.sealClosure({ ...scope, idempotencyKey: 'captured-canonical-seal', policy: {
        version: 'EvidenceClosurePolicyV1', targetClaimIds: ids, expectedHeadDigest: update.status.authoritativeHead.headDigest, barrierWatermark: '7',
        edgeFamilies: ['supports'], directions: ['inbound'], maxDepth: 4, termination: 'depth', expandEquivalent: false, expandRefinement: false,
        cycleHandling: 'fail', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [],
      } })
      expect(closure.status).toBe('complete'); expect(closure.gapCodes).toEqual([])
      expect(closure.includedDeltaDigests).toContain(update.deltaDigest)
      expect(counts.extract).toBe(1)
      expect(counts.nli).toBeGreaterThan(reviewsBefore)
      const status = await owner.runtime.snapshotStatus(scope)
      expect(status.committed?.digest).toMatch(/^sha256:/)
      const signal = new AbortController().signal
      const read = await owner.production.worker.request('readSnapshot', { threadId: `${scope.runtimeId}:${scope.threadId}`, workspaceRoot: scope.workspaceRoot, snapshotDigest: status.committed!.digest }, { signal, assertCurrent() {} })
      const document = JSON.parse(read.document)
      expect(JSON.stringify(document)).toContain(quote)
      expect(JSON.stringify(document)).toContain(ids[0])
      const diskAfter = JSON.parse(await readFile(join(opts.root, 'state/deltas.json'), 'utf8'))
      expect(diskAfter.chains[0].records).toEqual(recordsBefore)
      const graph = (await owner.production.worker.request('readSnapshot', { threadId: `${scope.runtimeId}:${scope.threadId}`, workspaceRoot: scope.workspaceRoot, snapshotDigest: status.committed!.digest }, { signal, assertCurrent() {} })).graph
      expect(graph.nodes.map((n: any) => n.id).sort()).toEqual(extractedGraph.nodes.map((n: any) => n.id).sort())
      expect(graph.edges.map((e: any) => e.id).sort()).toEqual(extractedGraph.edges.map((e: any) => e.id).sort())
      // Seal may reevaluate statuses/assessments, never rewrite semantic content,
      // provenance or topology. These values come from the actual extractor.
      const semanticNodes = (value: any) => value.nodes.map(({ status, freshness, atms_label, ...node }: any) => node).sort((a: any, b: any) => a.id.localeCompare(b.id))
      const topology = (value: any) => value.edges.map(({ nli_score, assessment_ids, ...edge }: any) => edge).sort((a: any, b: any) => a.id.localeCompare(b.id))
      expect(semanticNodes(graph)).toEqual(semanticNodes(extractedGraph))
      expect(topology(graph)).toEqual(topology(extractedGraph))
      await writeFile(join(opts.root, 'canonical-runtime-proof.json'), JSON.stringify({ restart, counts, claimIds: ids, deltaDigest: update.deltaDigest, updateSnapshot: extractingSnapshot.digest, sealedSnapshot: status.committed!.digest, wheel: opts.wheelSha256, wheelPath: opts.wheelPath, release: opts.release, stateRoot: join(opts.root, 'state'), calls }, null, 2))
    } finally { await owner.runtime.close(); await owner.production.close() }
  }, 120000)
})
