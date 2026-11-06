import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, plainPath, within } from './local-release/release.mjs'

const requireThat = (value, message) => { if (!value) throw new Error(message) }
async function pinned(root, entry) {
  const path = within(root, entry.path); await plainPath(path)
  const bytes = await readFile(path)
  requireThat(digest(bytes) === entry.sha256, `Material integrity mismatch: ${entry.path}`)
  return bytes
}
export function scoreHuman(reference, seeded, observations, materials, cases) {
  if (!observations) return { status: 'not measured', reviewer: null, lookup: null, defects: null, reviewDurationMs: null }
  requireThat(observations.status === 'completed' && typeof observations.reviewer === 'string' && observations.reviewer.trim(), 'Completed human observations require reviewer pseudonym')
  requireThat(Number.isFinite(observations.reviewDurationMs) && observations.reviewDurationMs >= 0 && Array.isArray(observations.findings), 'Explicit human review duration and findings required')
  requireThat(reference.independentlyAnnotated === true && typeof reference.annotator === 'string', 'Independent reference annotation required')
  requireThat(reference.annotator !== observations.reviewer, 'Reference annotator and measured reviewer must be independent')
  const issues = [...reference.issues.map(i => ({ ...i, origin: 'reference' })), ...seeded.map(i => ({ ...i, origin: 'seeded' }))]
  requireThat(new Set(issues.map(i => i.id)).size === issues.length && issues.every(i => typeof i.id === 'string' && cases.some(c => c.id === i.caseId)), 'Unique, case-bound reference/seeded issue IDs required')
  requireThat(Array.isArray(observations.completedCaseIds) && observations.completedCaseIds.length === cases.length && cases.every(c => observations.completedCaseIds.includes(c.id)), 'Human observations must cover every case')
  const detected = new Set(), lookups = []
  let falsePositives = 0
  for (const f of observations.findings) {
    const c = cases.find(c => c.id === f.caseId), issue = issues.find(i => i.id === f.issueId && i.caseId === f.caseId)
    requireThat(c, 'Unknown human finding case')
    if (issue) detected.add(issue.id); else falsePositives++
    const material = materials.find(m => m.id === f.materialId)
    const valid = Boolean(material && c.materialIds.includes(material.id) && Number.isSafeInteger(f.start) && Number.isSafeInteger(f.end) && f.start >= 0 && f.end > f.start && f.end <= material.text.length && material.text.slice(f.start, f.end) === f.quote)
    lookups.push({ caseId: f.caseId, issueId: f.issueId, materialId: f.materialId, verifiedExactSpan: valid })
  }
  const group = origin => ({ total: issues.filter(i => i.origin === origin).length, detected: issues.filter(i => i.origin === origin && detected.has(i.id)).length, missedIds: issues.filter(i => i.origin === origin && !detected.has(i.id)).map(i => i.id) })
  return { status: 'measured from supplied human observations', reviewer: observations.reviewer, reviewDurationMs: observations.reviewDurationMs,
    lookup: lookups, defects: { reference: group('reference'), seeded: group('seeded'), falsePositives } }
}
export async function runHumanAudit(manifestPath, observationsPath) {
  await plainPath(manifestPath)
  const root = dirname(manifestPath), raw = await readFile(manifestPath), manifest = JSON.parse(raw)
  requireThat(manifest.schemaVersion === 1 && Array.isArray(manifest.materials) && Array.isArray(manifest.cases), 'Invalid evaluation manifest')
  const report = { schemaVersion: 1, manifestSHA: digest(raw), status: manifest.status, scope: 'Imported material review through production EvidenceDagRuntime/factory and Dossier query client. No models; no scientific validity or human benefit inferred.', materials: [], queries: [], human: { status: 'not measured', reviewer: null, lookup: null, defects: null, reviewDurationMs: null } }
  if (manifest.status === 'pending-human-import') {
    requireThat(!manifest.materials.length && !manifest.cases.length && !observationsPath, 'Pending import must remain empty/unmeasured')
    return report
  }
  requireThat(manifest.status === 'ready' && manifest.materials.length && manifest.cases.length, 'Ready manifest needs authorized fixed materials and cases')
  requireThat([...manifest.materials, ...manifest.cases].every(v => typeof v.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(v.id)), 'Safe material/case IDs required')
  requireThat(new Set(manifest.materials.map(m => m.id)).size === manifest.materials.length && new Set(manifest.cases.map(c => c.id)).size === manifest.cases.length, 'Duplicate material/case identity')
  const materials = []
  for (const m of manifest.materials) {
    requireThat(['authorized-local-sanitized', 'public-repository'].includes(m.sourceKind) && typeof m.authorization === 'string' && m.authorization.trim(), 'Explicit material authorization/provenance required')
    const bytes = await pinned(root, m)
    materials.push({ ...m, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) })
    report.materials.push({ id: m.id, path: m.path, sha256: digest(bytes), byteLength: bytes.length, sourceKind: m.sourceKind, authorization: m.authorization })
  }
  // Reference and defect labels are scoring-only; never supplied to the owner query.
  const reference = manifest.reference ? JSON.parse(await pinned(root, manifest.reference)) : null
  const seeded = manifest.seededDefects ? JSON.parse(await pinned(root, manifest.seededDefects)) : []
  const observationsRaw = observationsPath ? await readFile(await plainPath(observationsPath)) : null
  const observations = observationsRaw ? JSON.parse(observationsRaw) : null
  requireThat(!observations || reference, 'Human scoring requires independent reference file')
  const { EvidenceDagDeltaStore, EvidenceDagRuntime } = await import('@sciforge/domain-evidence-dag/main')
  const { auditClient } = await import('./scientific-audit-query-client.mjs')
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'human-audit-isolated-')))
  const store = new EvidenceDagDeltaStore(join(workspace, 'deltas.json'))
  const runtime = new EvidenceDagRuntime({ userDataDir: workspace, deltaStore: store,
    sidecar: { configure() {}, endpoint: () => ({ baseUrl: 'http://127.0.0.1:1', apiKey: '' }), ensureReady: async () => { throw new Error('No extraction/model allowed') }, stop: async () => {} },
    fetchImpl: async () => { throw new Error('No external service allowed') } })
  try {
    await runtime.activate({ userDataDir: workspace, signal: new AbortController().signal, agentThreads: { list: async () => [], read: async () => { throw new Error('No private threads') } }, enablement: { isEnabled: async () => true, subscribe: () => () => {} }, log() {}, capabilities: { invoke: async () => { throw new Error('No external capability') } } })
    const client = auditClient(runtime)
    for (const c of manifest.cases) {
      requireThat(Array.isArray(c.materialIds) && c.materialIds.length && c.materialIds.every(id => materials.some(m => m.id === id)), 'Case references unknown material')
      requireThat(c.reference && c.materialIds.some(id => { const m = report.materials.find(m => m.id === id); return m.sha256 === c.reference.contentDigest && m.byteLength === c.reference.byteLength }), 'Exact queried artifact digest and byteLength must bind an imported material')
      requireThat(Array.isArray(c.targetClaimIds) && c.targetClaimIds.length && c.targetClaimIds.every(id => c.basePayload?.claims?.some(claim => claim.id === id)), 'Explicit target claims must exist in imported base payload')
      const threadId = `codex:import-${c.id}`
      const payloads = [c.basePayload, ...(c.changedPayloads ?? [])]
      for (const [i, payload] of payloads.entries()) {
        const base = await store.append({ scope: { runtimeId: 'codex', threadId, operationId: `human-import:${c.id}:${i}`, kind: 'manual', workspaceRoot: workspace }, requestedWatermark: String(i + 1), schemaVersion: 'evidence.delta.v1', extractorVersion: 'authorized-manual-import', verifierVersion: 'unverified-import', idempotencyKey: `human-import:${c.id}:${i}`, payload: { ...payload, ref: c.reference }, createdAt: new Date().toISOString() })
        if (i === 0) {
          const closure = await store.seal(threadId, { version: 'EvidenceClosurePolicyV1', targetClaimIds: c.targetClaimIds, expectedHeadDigest: base.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] }, `import-seal:${c.id}`)
          // This boundary marker is explicitly unreviewed; it never impersonates a human approval.
          await store.appendSidechain({ threadId, closureDigest: closure.closureDigest, recordId: `unreviewed-import:${c.id}`, recordType: 'review', idempotencyKey: `import-marker:${c.id}`, producerIdentity: 'evaluation:unreviewed-import', reviewerIdentity: 'evaluation:unreviewed-import', createdAt: new Date().toISOString(), payload: { ref: c.reference, verdict: 'unreviewed-import-boundary; not human approval' } })
        }
      }
      const start = performance.now(), value = await client.queryEvidenceAudit(workspace, c.reference)
      report.queries.push({ caseId: c.id, task: c.task ?? null, boundary: 'unreviewed-import-marker; not human approval', queryDurationMs: performance.now() - start, result: value })
    }
  } finally { await runtime.close() }
  report.human = scoreHuman(reference, seeded, observations, materials, manifest.cases)
  report.isolatedWorkspace = workspace
  if (observations) report.observationsSHA = digest(observationsRaw)
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest, output, observations] = process.argv.slice(2)
  if (!manifest || !output) throw new Error('Usage: node --import tsx scripts/scientific-human-audit.mjs <absolute-manifest> <new-output.json> [absolute-human-observations]')
  const report = await runHumanAudit(manifest, observations)
  await plainPath(output); await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: report.status, human: report.human, output }))
}
