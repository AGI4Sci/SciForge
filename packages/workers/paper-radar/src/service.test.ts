import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  createPaperRadarFixtureFetch,
  createPaperRadarService,
  paperRadarPathsFromEnv,
  type PaperRadarAuditRecord
} from './service.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

test('Paper Radar service executes authorized writes, SQLite sync, FTS search, rank, digest, and resources', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'paper-radar-worker-'))
  const dbPath = join(tempDir, 'paper-radar.sqlite')
  const profilesPath = join(tempDir, 'profiles.json')
  const auditSinkRecords: PaperRadarAuditRecord[] = []
  const service = createPaperRadarService({
    dbPath,
    profilesPath,
    fetchImpl: createPaperRadarFixtureFetch(fixturesDir),
    now: () => new Date('2026-06-17T00:00:00.000Z'),
    auditSink: (record) => auditSinkRecords.push(record)
  })
  t.after(async () => {
    service.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  const defaultProfiles = service.listProfiles()
  assert.equal(defaultProfiles.count, 1)
  assert.equal(defaultProfiles.profiles[0]?.name, 'lab_default')
  await assert.rejects(access(profilesPath))

  const saveInput = {
    name: 'protein focus',
    keywords: ['protein design', 'diffusion', 'single-cell'],
    exclude_keywords: [],
    arxiv_categories: ['cs.LG', 'q-bio'],
    biorxiv_subjects: ['bioinformatics']
  }

  const saved = service.saveProfile(saveInput)
  assert.equal(saved.profile.name, 'protein_focus')
  assert.match(saved.auditId, /^pr_audit_\d{6}$/)
  assert.equal(service.listProfiles().count, 2)
  await access(profilesPath)

  const saveAudit = service.auditRecords()
  assert.equal(saveAudit.count, 1)
  assert.equal(auditSinkRecords.length, saveAudit.count)
  assert.deepEqual(saveAudit.records.map((record) => [record.capability, record.action, record.ok]), [
    ['paper_profile_save', 'write', true]
  ])
  assert.doesNotMatch(JSON.stringify(saveAudit.records), /protein design|diffusion|single-cell/)

  const sync = await service.syncProfile({
    profile: 'protein_focus',
    from: '2026-06-16',
    to: '2026-06-17',
    max_records: 10
  })
  assert.equal(sync.upserted, 2)
  assert.deepEqual(service.diagnostics().stats, { papers: 2, arxiv: 1, biorxiv: 1 })

  const audit = service.auditRecords()
  assert.equal(audit.count, 2)
  assert.ok(audit.records.some((record) => record.capability === 'paper_profile_sync' && record.ok === true && record.upserted === 2))
  assert.doesNotMatch(JSON.stringify(audit.records), /abstract|protein design|single-cell/)

  const search = service.search({
    query: 'protein diffusion',
    sources: ['arxiv'],
    top_k: 5
  })
  assert.equal(search.count, 1)
  assert.equal(search.papers[0]?.id, 'arxiv:2606.12345')

  const rank = service.rank({
    profile: 'protein_focus',
    from: '2026-06-16',
    top_k: 5
  })
  assert.ok(rank.count >= 1)
  assert.equal(rank.profile, 'protein_focus')

  const digest = service.digest({
    profile: 'protein_focus',
    from: '2026-06-16',
    top_k: 10
  })
  assert.equal(digest.generatedAt, '2026-06-17T00:00:00.000Z')
  assert.ok(digest.papers.some((paper) => paper.id === 'biorxiv:10.1101/2026.06.17.123456'))

  const paper = service.getPaper('arxiv:2606.12345')
  assert.match(paper.title, /protein design/i)

  const syncState = service.syncState()
  assert.equal(syncState.count, 4)
  assert.ok(syncState.state.some((item) => item.source === 'arxiv' && item.key === 'last_sync_date'))
})

test('Paper Radar path resolution follows env, userData, and db-only precedence', () => {
  const userDataPaths = paperRadarPathsFromEnv({
    env: {},
    userDataDir: '/tmp/sciforge-user-data'
  })
  assert.equal(userDataPaths.dbPath, '/tmp/sciforge-user-data/paper-radar/paper-radar.sqlite')
  assert.equal(userDataPaths.profilesPath, '/tmp/sciforge-user-data/paper-radar/profiles.json')

  const dbOnlyPaths = paperRadarPathsFromEnv({
    env: {},
    dbPath: '/tmp/custom/papers.sqlite'
  })
  assert.equal(dbOnlyPaths.dbPath, '/tmp/custom/papers.sqlite')
  assert.equal(dbOnlyPaths.profilesPath, '/tmp/custom/profiles.json')

  const envPaths = paperRadarPathsFromEnv({
    env: {
      PAPER_RADAR_DB: '/tmp/env/papers.sqlite',
      PAPER_RADAR_PROFILES: '/tmp/env/profiles.json'
    } as NodeJS.ProcessEnv
  })
  assert.equal(envPaths.dbPath, '/tmp/env/papers.sqlite')
  assert.equal(envPaths.profilesPath, '/tmp/env/profiles.json')
})
