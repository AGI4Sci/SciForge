import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { createBgcDiscoveryService } from './service.js'

test('runPipeline builds BGC cards, ranking, and summary from structured tool outputs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-bgc-'))
  const antismashDir = join(workspaceRoot, 'inputs', 'antismash')
  const mibigDir = join(workspaceRoot, 'db', 'mibig')
  const bigscapeDir = join(workspaceRoot, 'inputs', 'bigscape')
  await mkdir(antismashDir, { recursive: true })
  await mkdir(mibigDir, { recursive: true })
  await mkdir(bigscapeDir, { recursive: true })

  await writeFile(join(antismashDir, 'regions.json'), JSON.stringify([
    {
      id: 'contig_1_region_1',
      region_id: 'region_001',
      contig_id: 'contig_1',
      organism: 'Marine fungus isolate A',
      start: 1200,
      end: 56000,
      bgc_type: 'NRPS',
      product: 'nonribosomal peptide synthetase cluster',
      core_genes: ['NRPS adenylation domain'],
      tailoring_enzymes: ['cytochrome P450'],
      regulators: ['Zn2Cys6 transcription factor'],
      known_cluster_hits: ['BGC0000001'],
      nearest_mibig_hit: 'BGC0000001'
    },
    {
      id: 'contig_2_region_1',
      region_id: 'region_001',
      contig_id: 'contig_2',
      organism: 'Marine fungus isolate A',
      start: 400,
      end: 32000,
      bgc_type: 'terpene',
      product: 'terpene synthase cluster',
      core_genes: ['terpene synthase'],
      tailoring_enzymes: ['methyltransferase'],
      regulators: [],
      known_cluster_hits: []
    }
  ], null, 2), 'utf8')

  await writeFile(join(mibigDir, 'BGC0000001.json'), JSON.stringify({
    accession: 'BGC0000001',
    product: 'marinopyrrole-like peptide',
    product_class: 'NRP',
    bioactivity: 'antimicrobial',
    organism: 'reference fungus'
  }, null, 2), 'utf8')

  await writeFile(
    join(bigscapeDir, 'clustering.tsv'),
    [
      'bgc_id\tgcf_id\tfamily_size\tmibig_members\tnetwork_neighbors',
      'contig_1_region_1\tGCF_42\t8\tBGC0000001\tcontig_9_region_2'
    ].join('\n'),
    'utf8'
  )

  const service = createBgcDiscoveryService({ workspaceRoot })
  await service.registerResource({
    kind: 'mibig_json',
    path: join(mibigDir),
    version: 'test'
  })
  const result = await service.runPipeline({
    antismashOutput: 'inputs/antismash',
    bigscapePath: 'inputs/bigscape',
    accession: 'GCA_TEST_001',
    outputDir: 'outputs/bgc-test'
  })

  assert.equal(result.ok, true)
  assert.equal(result.counts.antismashRegions, 2)
  assert.equal(result.counts.mibigRecordsUsed, 1)
  assert.equal(result.counts.bigscapeAssignments, 1)
  assert.equal(result.topCandidates[0].nearestMibigHit, 'BGC0000001')
  assert.equal(result.topCandidates[0].geneClusterFamily, 'GCF_42')

  const manifest = JSON.parse(await readFile(join(workspaceRoot, result.files.manifest), 'utf8')) as {
    counts: { cards: number }
  }
  assert.equal(manifest.counts.cards, 2)

  const summary = await readFile(join(workspaceRoot, result.files.summaryMarkdown), 'utf8')
  assert.match(summary, /BGC Discovery Summary/)
  assert.match(summary, /contig_1_region_1/)
})

test('service launch workspace cannot be overridden by tool input', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-bgc-scope-'))
  const service = createBgcDiscoveryService({ workspaceRoot })

  const result = await service.status({ workspaceRoot: '/tmp/untrusted-override' })
  assert.equal(result.workspaceRoot, workspaceRoot)
})
