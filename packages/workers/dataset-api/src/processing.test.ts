import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDatasetProcessingService } from './processing.js'

async function fixture() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-processing-'))
  const service = createDatasetProcessingService({ workspaceRoot })
  return { workspaceRoot, service, cleanup: () => rm(workspaceRoot, { recursive: true, force: true }) }
}

async function confirmedPlan(service: ReturnType<typeof createDatasetProcessingService>) {
  const result = await service.preparePlan({
    objective: 'Prepare a deterministic test dataset.',
    sources: [{ providerId: 'fixture', purpose: 'Test processing.' }],
    operations: [
      { tool: 'dataset_profile', description: 'Inspect the source.' },
      { tool: 'dataset_filter', description: 'Filter records.' },
      { tool: 'dataset_select_columns', description: 'Select output fields.' },
      { tool: 'dataset_transform', description: 'Standardize fields.' },
      { tool: 'dataset_deduplicate', description: 'Remove duplicate records.' },
      { tool: 'dataset_id_map', description: 'Map biomedical identifiers.' },
      { tool: 'dataset_join', description: 'Join source artifacts.' },
      { tool: 'dataset_validate', description: 'Validate output.' },
      { tool: 'dataset_publish', description: 'Publish output.' }
    ],
    outputs: [{ name: 'prepared.json', format: 'json' }],
    confirmedByUser: true
  })
  return result.plan.planId
}

test('runs a reproducible JSON preparation, validation, and publication chain', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const sourcePath = join(workspaceRoot, 'proteins.json')
  const sourceText = JSON.stringify([
    { accession: 'P04637', gene: 'TP53', reviewed: true, length: 393, organism: 'human' },
    { accession: 'P04637', gene: 'TP53', reviewed: true, length: 393, organism: 'human' },
    { accession: 'Q9TEST', gene: 'TEST', reviewed: false, length: 90, organism: 'human' },
    { accession: 'MOUSE1', gene: 'Trp53', reviewed: true, length: 390, organism: 'mouse' }
  ], null, 2)
  await writeFile(sourcePath, sourceText)
  try {
    const planId = await confirmedPlan(service)
    const profile = await service.profile({ inputArtifact: sourcePath })
    assert.equal(profile.profile.records, 4)
    assert.match(profile.artifact.path, /dataset_profile/)

    const filtered = await service.filter({
      planId,
      inputArtifact: sourcePath,
      conditions: [
        { field: 'organism', operator: 'equals', value: 'human' },
        { field: 'reviewed', operator: 'equals', value: true },
        { field: 'length', operator: 'between', value: [100, 1000] }
      ],
      outputFileName: 'human-reviewed.json'
    })
    assert.equal(filtered.counts.outputRecords, 2)
    const filteredManifest = JSON.parse(await readFile(filtered.artifact.manifestPath, 'utf8'))
    assert.equal(filteredManifest.version, 2)
    assert.deepEqual(filteredManifest.schema.fields.map((field: { name: string }) => field.name), [
      'accession', 'gene', 'reviewed', 'length', 'organism'
    ])

    const selected = await service.selectColumns({
      planId,
      inputArtifact: filtered.artifact.path,
      columns: [
        { source: 'accession' },
        { source: 'gene', target: 'gene_symbol' },
        { source: 'length', required: true }
      ],
      outputFormat: 'tsv',
      outputFileName: 'human-reviewed.tsv'
    })
    assert.match(await readFile(selected.artifact.path, 'utf8'), /^accession\tgene_symbol\tlength/m)

    const deduplicated = await service.deduplicate({
      planId,
      inputArtifact: selected.artifact.path,
      keys: ['accession'],
      outputFileName: 'human-reviewed-unique.tsv'
    })
    assert.equal(deduplicated.counts.duplicateRecordsRemoved, 1)

    const validation = await service.validate({
      inputArtifact: deduplicated.artifact.path,
      rules: [
        { field: 'accession', required: true, type: 'string', unique: true },
        { field: 'length', required: true, type: 'number', min: 100, max: 1000 }
      ],
      minRecords: 1,
      maxMissingFraction: 0
    })
    assert.equal(validation.validation.valid, true)

    const published = await service.publish({
      planId,
      name: 'tp53-prepared',
      artifacts: [deduplicated.artifact.path, validation.artifact.path],
      description: 'Human reviewed TP53 records.'
    })
    assert.equal(published.publication.artifactCount, 2)
    assert.equal(published.quality.validationReportCount, 1)
    assert.equal(JSON.parse(await readFile(published.publication.manifestPath, 'utf8')).planId, planId)
    assert.equal(await readFile(sourcePath, 'utf8'), sourceText)

    const repeated = await service.filter({
      planId,
      inputArtifact: sourcePath,
      conditions: [
        { field: 'organism', operator: 'equals', value: 'human' },
        { field: 'reviewed', operator: 'equals', value: true },
        { field: 'length', operator: 'between', value: [100, 1000] }
      ],
      outputFileName: 'human-reviewed.json'
    })
    assert.equal(repeated.artifact.path, filtered.artifact.path)
    assert.equal(repeated.artifact.reused, true)
  } finally {
    await cleanup()
  }
})

test('profiles and filters JSONL plus quoted CSV and TSV records', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const jsonlPath = join(workspaceRoot, 'records.jsonl')
  const csvPath = join(workspaceRoot, 'records.csv')
  await writeFile(jsonlPath, '{"id":"a","score":1}\n{"id":"b","score":2}\n')
  await writeFile(csvPath, 'id,name,score\n1,"alpha, beta",3\n2,gamma,5\n')
  try {
    const planId = await confirmedPlan(service)
    assert.equal((await service.profile({ inputArtifact: jsonlPath })).profile.format, 'jsonl')
    const jsonlFiltered = await service.filter({
      planId,
      inputArtifact: jsonlPath,
      conditions: [{ field: 'score', operator: 'gte', value: 2 }],
      outputFileName: 'records-filtered.jsonl'
    })
    assert.equal(jsonlFiltered.counts.outputRecords, 1)

    const csvProfile = await service.profile({ inputArtifact: csvPath })
    assert.equal(csvProfile.profile.records, 2)
    const tsv = await service.selectColumns({
      planId,
      inputArtifact: csvPath,
      columns: [{ source: 'id' }, { source: 'name' }, { source: 'score' }],
      outputFormat: 'tsv',
      outputFileName: 'records.tsv'
    })
    assert.match(await readFile(tsv.artifact.path, 'utf8'), /alpha, beta/)
    assert.equal((await service.profile({ inputArtifact: tsv.artifact.path })).profile.format, 'tsv')
  } finally {
    await cleanup()
  }
})

test('transforms fields and performs a full multi-source join with unmatched artifacts', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const proteinsPath = join(workspaceRoot, 'proteins.json')
  const pathwaysPath = join(workspaceRoot, 'pathways.tsv')
  const proteins = [
    { accession: ' P04637 ', reviewed: 'YES', length: '393' },
    { accession: ' Q9TEST ', reviewed: 'no', length: '90' }
  ]
  const pathways = 'protein_id\tpathway\nP04637\tR-HSA-69563\nP99999\tR-HSA-00000\n'
  await writeFile(proteinsPath, JSON.stringify(proteins))
  await writeFile(pathwaysPath, pathways)
  try {
    const planId = await confirmedPlan(service)
    const transformed = await service.transform({
      planId,
      inputArtifact: proteinsPath,
      operations: [
        { operation: 'trim', field: 'accession' },
        { operation: 'to_boolean', field: 'reviewed', trueValues: ['yes'], falseValues: ['no'] },
        { operation: 'to_number', field: 'length' }
      ],
      outputFileName: 'proteins-standardized.json'
    })
    assert.deepEqual(JSON.parse(await readFile(transformed.artifact.path, 'utf8')), [
      { accession: 'P04637', reviewed: true, length: 393 },
      { accession: 'Q9TEST', reviewed: false, length: 90 }
    ])
    assert.deepEqual(JSON.parse(await readFile(proteinsPath, 'utf8')), proteins)

    const joined = await service.join({
      planId,
      leftArtifact: transformed.artifact.path,
      rightArtifact: pathwaysPath,
      rightFormat: 'tsv',
      keys: [{ left: 'accession', right: 'protein_id' }],
      joinType: 'full',
      rightPrefix: 'pathway_',
      outputFormat: 'tsv',
      outputFileName: 'protein-pathways.tsv'
    })
    assert.deepEqual(joined.counts, {
      leftRecords: 2,
      rightRecords: 2,
      outputRecords: 3,
      matchedLeftRecords: 1,
      matchedRightRecords: 1,
      unmatchedLeftRecords: 1,
      unmatchedRightRecords: 1
    })
    assert.match(await readFile(joined.artifact.path, 'utf8'), /P04637\ttrue\t393\tP04637\tR-HSA-69563/)
    assert.deepEqual(JSON.parse(await readFile(joined.unmatchedArtifacts.left.path, 'utf8')), [
      { accession: 'Q9TEST', reviewed: false, length: 90 }
    ])
    assert.deepEqual(JSON.parse(await readFile(joined.unmatchedArtifacts.right.path, 'utf8')), [
      { protein_id: 'P99999', pathway: 'R-HSA-00000' }
    ])
    const rerun = await service.join({
      planId,
      leftArtifact: transformed.artifact.path,
      rightArtifact: pathwaysPath,
      rightFormat: 'tsv',
      keys: [{ left: 'accession', right: 'protein_id' }],
      joinType: 'full',
      rightPrefix: 'pathway_',
      outputFormat: 'tsv',
      outputFileName: 'protein-pathways.tsv'
    })
    assert.equal(rerun.artifact.reused, true)
    assert.equal(rerun.artifact.sha256, joined.artifact.sha256)
    await assert.rejects(service.join({
      planId,
      leftArtifact: transformed.artifact.path,
      rightArtifact: pathwaysPath,
      rightFormat: 'tsv',
      keys: [{ left: 'accession', right: 'protein_id' }],
      joinType: 'full',
      outputFileName: 'bounded-join.json',
      maxOutputRecords: 1
    }), /exceeded maxOutputRecords=1/)
  } finally {
    await cleanup()
  }
})

test('maps biomedical identifiers with explicit one-to-many and unmatched semantics', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const proteinsPath = join(workspaceRoot, 'protein-ids.json')
  const mappingPath = join(workspaceRoot, 'uniprot-ensembl.tsv')
  await writeFile(proteinsPath, JSON.stringify([
    { accession: 'P04637', gene: 'TP53' },
    { accession: 'Q9UNMAPPED', gene: 'UNKNOWN' }
  ]))
  await writeFile(mappingPath, [
    'uniprot\tensembl',
    'P04637\tENSG00000141510',
    'P04637\tENST00000269305',
    'P04637\tENSG00000141510',
    '\tINVALID'
  ].join('\n'))
  try {
    const planId = await confirmedPlan(service)
    const mapped = await service.mapIds({
      planId,
      inputArtifact: proteinsPath,
      mappingArtifact: mappingPath,
      mappingFormat: 'tsv',
      inputField: 'accession',
      mappingFromField: 'uniprot',
      mappingToField: 'ensembl',
      outputField: 'ensembl_id',
      cardinality: 'explode',
      onUnmapped: 'drop',
      outputFormat: 'tsv',
      outputFileName: 'protein-ensembl.tsv'
    })
    assert.deepEqual(mapped.counts, {
      inputRecords: 2,
      mappingRecords: 4,
      outputRecords: 2,
      mappedRecords: 1,
      unmatchedRecords: 1,
      ambiguousRecords: 1,
      invalidMappingRecords: 1
    })
    assert.match(await readFile(mapped.artifact.path, 'utf8'), /P04637\tTP53\tENSG00000141510/)
    assert.match(await readFile(mapped.artifact.path, 'utf8'), /P04637\tTP53\tENST00000269305/)
    const unmatched = JSON.parse(await readFile(mapped.unmatchedArtifact.path, 'utf8'))
    assert.equal(unmatched[0].inputId, 'Q9UNMAPPED')
    const ambiguous = JSON.parse(await readFile(mapped.ambiguousArtifact.path, 'utf8'))
    assert.deepEqual(ambiguous[0].targets, ['ENSG00000141510', 'ENST00000269305'])

    const allMappings = await service.mapIds({
      planId,
      inputArtifact: proteinsPath,
      mappingArtifact: mappingPath,
      mappingFormat: 'tsv',
      inputField: 'accession',
      mappingFromField: 'uniprot',
      mappingToField: 'ensembl',
      outputField: 'ensembl_ids',
      cardinality: 'all',
      onUnmapped: 'keep',
      outputFileName: 'protein-ensembl-all.json'
    })
    assert.deepEqual(JSON.parse(await readFile(allMappings.artifact.path, 'utf8')), [
      { accession: 'P04637', gene: 'TP53', ensembl_ids: ['ENSG00000141510', 'ENST00000269305'] },
      { accession: 'Q9UNMAPPED', gene: 'UNKNOWN', ensembl_ids: 'Q9UNMAPPED' }
    ])
  } finally {
    await cleanup()
  }
})

test('filters, deduplicates, and validates FASTA without modifying the source', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const fastaPath = join(workspaceRoot, 'proteins.fasta')
  const fasta = '>P04637 TP53 human\nMEEPQSDPSVEPPLSQETFSDLWKLLPEN\n>P04637 duplicate\nMEEPQSDPSVEPPLSQETFSDLWKLLPEN\n>SHORT\nMEE\n'
  await writeFile(fastaPath, fasta)
  try {
    const planId = await confirmedPlan(service)
    const filtered = await service.filter({
      planId,
      inputArtifact: fastaPath,
      conditions: [{ field: 'length', operator: 'gte', value: 10 }],
      outputFileName: 'long.fasta'
    })
    assert.equal(filtered.counts.outputRecords, 2)
    const deduplicated = await service.deduplicate({
      planId,
      inputArtifact: filtered.artifact.path,
      keys: ['sequence'],
      outputFileName: 'long-unique.fasta'
    })
    assert.equal(deduplicated.counts.outputRecords, 1)
    const validation = await service.validate({
      inputArtifact: deduplicated.artifact.path,
      rules: [{ field: 'id', required: true }, { field: 'sequence', required: true }],
      minRecords: 1,
      failOnInvalid: true
    })
    assert.equal(validation.validation.valid, true)
    assert.match(await readFile(deduplicated.artifact.path, 'utf8'), /^>P04637/m)
    assert.equal(await readFile(fastaPath, 'utf8'), fasta)
  } finally {
    await cleanup()
  }
})

test('requires confirmed plans and rejects inputs outside the workspace', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const sourcePath = join(workspaceRoot, 'records.json')
  await writeFile(sourcePath, '[{"id":1}]')
  try {
    const draft = await service.preparePlan({
      objective: 'Draft only.',
      operations: [{ tool: 'dataset_filter', description: 'Filter.' }],
      outputs: [{ name: 'out.json', format: 'json' }],
      confirmedByUser: false
    })
    await assert.rejects(service.filter({
      planId: draft.plan.planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 1 }],
      outputFileName: 'out.json'
    }), /not confirmed/)
    const filterOnlyPlan = await service.preparePlan({
      objective: 'Authorize filtering only.',
      operations: [{ tool: 'dataset_filter', description: 'Filter records.' }],
      outputs: [{ name: 'out.json', format: 'json' }],
      confirmedByUser: true
    })
    await assert.rejects(service.deduplicate({
      planId: filterOnlyPlan.plan.planId,
      inputArtifact: sourcePath,
      keys: ['id'],
      outputFileName: 'deduplicated.json'
    }), /does not authorize operation 'dataset_deduplicate'/)
    await assert.rejects(service.profile({ inputArtifact: '/etc/hosts', format: 'csv' }), /selected workspace/)
    const planId = await confirmedPlan(service)
    await assert.rejects(service.publish({
      planId,
      name: 'unvalidated',
      artifacts: [sourcePath]
    }), /requires at least one dataset_validate report/)
    await assert.rejects(service.filter({
      planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 1 }],
      outputFileName: '../escape.json'
    }), /safe file name/)
  } finally {
    await cleanup()
  }
})
