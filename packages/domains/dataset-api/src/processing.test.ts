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
      { tool: 'dataset_structure_profile', description: 'Profile structure files.' },
      { tool: 'dataset_structure_validate', description: 'Validate structure files.' },
      { tool: 'dataset_graph_organize', description: 'Organize graph data.' },
      { tool: 'dataset_materialize', description: 'Materialize generated records.' },
      { tool: 'dataset_validate', description: 'Validate output.' },
      { tool: 'dataset_publish', description: 'Publish output.' }
    ],
    outputs: [{ name: 'prepared.json', format: 'json' }],
    confirmedByUser: true
  })
  return result.plan.planId
}

test('places the exact executable plan identity at the start of prepare-plan receipts', async () => {
  const { service, cleanup } = await fixture()
  try {
    const prepared = await service.preparePlan({
      objective: 'Publish a compact receipt fixture.',
      operations: [{
        tool: 'dataset_materialize',
        description: 'Materialize records.',
        parameters: { records: [{ id: 'fixture' }], outputFileName: 'fixture.jsonl', format: 'jsonl' }
      }],
      outputs: [{ name: 'fixture.jsonl', format: 'jsonl' }],
      confirmedByUser: true
    })

    assert.equal(prepared.planId, prepared.plan.planId)
    assert.equal(prepared.status, 'confirmed')
    assert.equal(prepared.artifact.path.endsWith('.json'), true)
    assert.match(JSON.stringify(prepared).slice(0, 96), /^\{"planId":"plan-[a-f0-9]{16}","status":"confirmed"/)
  } finally {
    await cleanup()
  }
})

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
    assert.deepEqual(JSON.parse(await readFile(filtered.excludedArtifact.path, 'utf8')).map((row: { accession: string }) => row.accession), [
      'Q9TEST', 'MOUSE1'
    ])
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
    assert.equal((await readFile(deduplicated.duplicatesArtifact.path, 'utf8')).trim().split('\n').length, 2)

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
    const publicationManifestBytes = await readFile(published.publication.manifestPath)
    const publicationManifest = JSON.parse(publicationManifestBytes.toString('utf8'))
    assert.equal(publicationManifest.planId, planId)
    assert.deepEqual(JSON.parse(await readFile(published.publication.preparationPlanPath, 'utf8')).planId, planId)
    assert.deepEqual(publicationManifest.artifacts[0].parameters.keys, ['accession'])
    const checksumBytes = await readFile(published.publication.checksumsPath)
    assert.match(checksumBytes.toString('utf8'), new RegExp(`${published.publication.sha256}  manifest\\.json`))
    assert.match(checksumBytes.toString('utf8'), / {2}preparation-plan\.json/)
    assert.equal(await readFile(sourcePath, 'utf8'), sourceText)

    const repeatedPublication = await service.publish({
      planId,
      name: 'tp53-prepared',
      artifacts: [deduplicated.artifact.path, validation.artifact.path],
      description: 'Human reviewed TP53 records.'
    })
    assert.equal(repeatedPublication.publication.sha256, published.publication.sha256)
    assert.deepEqual(await readFile(repeatedPublication.publication.manifestPath), publicationManifestBytes)
    assert.deepEqual(await readFile(repeatedPublication.publication.checksumsPath), checksumBytes)

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

test('materializes generated records with model metadata and parent provenance', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const parentPath = join(workspaceRoot, 'grounding.json')
  await writeFile(parentPath, '[{"source":"fixture"}]\n')
  try {
    const planId = await confirmedPlan(service)
    const result = await service.materialize({
      planId,
      records: [
        { id: 'sample-1', question: 'What does TP53 encode?', answer: 'A tumor suppressor protein.' },
        { id: 'sample-2', question: 'Which pathway contains TP53?', answer: 'The p53 signaling pathway.' }
      ],
      format: 'jsonl',
      outputFileName: 'synthetic-tp53.jsonl',
      parentArtifacts: [parentPath],
      generation: {
        objective: 'Create grounded TP53 questions.',
        loopId: 'tp53-generation-loop',
        runId: 'run-1',
        models: { weak: 'weak-model', strong: 'strong-model' },
        qualityCriteria: ['Every answer must be grounded.']
      }
    })
    assert.equal(result.counts.records, 2)
    assert.match(await readFile(result.artifact.path, 'utf8'), /"sample-2"/)
    const manifest = JSON.parse(await readFile(result.artifact.manifestPath, 'utf8'))
    assert.equal(manifest.operation, 'dataset_materialize')
    assert.equal(manifest.records, 2)
    assert.equal(manifest.parents.length, 1)
    assert.equal(manifest.parameters.generation.models.weak, 'weak-model')

    const repeated = await service.materialize({
      planId,
      records: [
        { id: 'sample-1', question: 'What does TP53 encode?', answer: 'A tumor suppressor protein.' },
        { id: 'sample-2', question: 'Which pathway contains TP53?', answer: 'The p53 signaling pathway.' }
      ],
      format: 'jsonl',
      outputFileName: 'synthetic-tp53.jsonl',
      parentArtifacts: [parentPath],
      generation: {
        objective: 'Create grounded TP53 questions.',
        loopId: 'tp53-generation-loop',
        runId: 'run-1',
        models: { weak: 'weak-model', strong: 'strong-model' },
        qualityCriteria: ['Every answer must be grounded.']
      }
    })
    assert.equal(repeated.artifact.path, result.artifact.path)
    assert.equal(repeated.artifact.reused, true)

    const changed = await service.materialize({
      planId,
      records: [{ id: 'sample-3', question: 'What activates TP53?', answer: 'Cellular stress signals.' }],
      format: 'jsonl',
      outputFileName: 'synthetic-tp53.jsonl',
      parentArtifacts: [parentPath],
      generation: {
        objective: 'Create grounded TP53 questions.',
        loopId: 'tp53-generation-loop',
        runId: 'run-2',
        models: { weak: 'weak-model', strong: 'strong-model' },
        qualityCriteria: ['Every answer must be grounded.']
      }
    })
    assert.notEqual(changed.artifact.path, result.artifact.path)
  } finally {
    await cleanup()
  }
})

test('requires the confirmed materialize plan to use the generation schema field', async () => {
  const { service, cleanup } = await fixture()
  const records = [{ accession: 'P04637', question: 'Length?', answer: '393 aa.' }]
  const generation = {
    objective: 'Create one grounded UniProt question.',
    loopId: 'uniprot-generation-loop'
  }
  try {
    const invalid = await service.preparePlan({
      objective: generation.objective,
      operations: [{
        tool: 'dataset_materialize',
        description: 'Materialize the accepted sample.',
        parameters: {
          records,
          format: 'jsonl',
          outputFileName: 'uniprot-invalid.jsonl',
          generationMetadata: { loopId: generation.loopId }
        }
      }],
      outputs: [{ name: 'uniprot-invalid.jsonl', format: 'jsonl' }],
      confirmedByUser: true
    })
    await assert.rejects(
      service.materialize({
        planId: invalid.plan.planId,
        records,
        format: 'jsonl',
        outputFileName: 'uniprot-invalid.jsonl',
        generation
      }),
      /parameters do not authorize/
    )

    const valid = await service.preparePlan({
      objective: generation.objective,
      operations: [{
        tool: 'dataset_materialize',
        description: 'Materialize the accepted sample.',
        parameters: {
          planId: 'plan-placeholder',
          records,
          format: 'jsonl',
          outputFileName: 'uniprot-valid.jsonl',
          generation
        }
      }],
      outputs: [{ name: 'uniprot-valid.jsonl', format: 'jsonl' }],
      confirmedByUser: true
    })
    const result = await service.materialize({
      planId: valid.plan.planId,
      records,
      format: 'jsonl',
      outputFileName: 'uniprot-valid.jsonl',
      generation
    })
    assert.equal(result.counts.records, 1)
  } finally {
    await cleanup()
  }
})

test('filters JSONL and publishes a validated quoted CSV-to-TSV dataset', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const jsonlPath = join(workspaceRoot, 'records.jsonl')
  const csvPath = join(workspaceRoot, 'records.csv')
  await writeFile(jsonlPath, '{"id":"a","score":1}\n{"id":"b","score":2}\n')
  const csv = 'id,name,score\n1,"alpha, beta",3\n2,gamma,5\n'
  await writeFile(csvPath, csv)
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
    const validation = await service.validate({
      inputArtifact: tsv.artifact.path,
      rules: [
        { field: 'id', required: true, unique: true },
        { field: 'name', required: true },
        { field: 'score', required: true }
      ],
      minRecords: 2,
      maxMissingFraction: 0
    })
    assert.equal(validation.validation.valid, true)
    const published = await service.publish({
      planId,
      name: 'csv-to-tsv-e2e',
      description: 'Quoted CSV normalized to a validated TSV dataset.',
      artifacts: [csvProfile.artifact.path, tsv.artifact.path, validation.artifact.path]
    })
    assert.equal(published.publication.artifactCount, 3)
    assert.equal(published.quality.status, 'passed')
    const publicationManifest = JSON.parse(await readFile(published.publication.manifestPath, 'utf8'))
    assert.equal(publicationManifest.planId, planId)
    assert.equal(publicationManifest.quality.validationReportCount, 1)
    assert.ok(publicationManifest.schema.artifacts.some((artifact: { format: string }) => artifact.format === 'tsv'))
    assert.match(publicationManifest.artifacts.find((artifact: { format: string }) => artifact.format === 'tsv').sha256, /^[a-f0-9]{64}$/)
    assert.equal(await readFile(csvPath, 'utf8'), csv)
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

test('runs bounded provider-backed UniProt ID mapping with polling, retries, and provenance', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-provider-map-'))
  const inputPath = join(workspaceRoot, 'protein-accessions.json')
  await writeFile(inputPath, JSON.stringify([
    { accession: 'P04637' },
    { accession: 'P38398' },
    { accession: 'BAD' }
  ]))
  let statusCalls = 0
  const sleeps: number[] = []
  const service = createDatasetProcessingService({
    workspaceRoot,
    sleepImpl: async (milliseconds) => { sleeps.push(milliseconds) },
    fetchImpl: async (url, init) => {
      const value = String(url)
      if (value.endsWith('/idmapping/run')) {
        assert.equal(init?.method, 'POST')
        assert.match(String(init?.body), /from=UniProtKB_AC-ID/)
        assert.match(String(init?.body), /to=Ensembl/)
        return new Response('{"jobId":"job123"}', { headers: { 'content-type': 'application/json' } })
      }
      if (value.endsWith('/idmapping/status/job123')) {
        statusCalls += 1
        if (statusCalls === 1) return new Response('temporary', { status: 503 })
        return new Response(JSON.stringify({ jobStatus: statusCalls === 2 ? 'RUNNING' : 'FINISHED' }), {
          headers: { 'content-type': 'application/json' }
        })
      }
      if (value.endsWith('/idmapping/details/job123')) {
        return new Response(JSON.stringify({
          redirectURL: 'https://rest.uniprot.org/idmapping/results/job123'
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (value === 'https://rest.uniprot.org/idmapping/stream/job123?format=json') {
        return new Response(JSON.stringify({
          results: [
            { from: 'P04637', to: 'ENSG00000141510' },
            { from: 'P38398', to: { id: 'ENSG00000012048' } }
          ],
          failedIds: ['BAD']
        }), { headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected provider URL: ${value}`)
    }
  })
  try {
    const prepared = await service.preparePlan({
      objective: 'Map UniProt accessions to Ensembl.',
      operations: [{ tool: 'dataset_id_map_provider', description: 'Use UniProt ID Mapping.' }],
      outputs: [{ name: 'mapped.json', format: 'json' }],
      confirmedByUser: true
    })
    const provider = await service.providerIdMapping({
      planId: prepared.plan.planId,
      inputArtifact: inputPath,
      inputField: 'accession',
      provider: 'uniprot',
      fromDatabase: 'UniProtKB_AC-ID',
      toDatabase: 'Ensembl',
      outputField: 'ensembl_id',
      outputFileName: 'mapped.json',
      pollIntervalMs: 100,
      maxPollAttempts: 5,
      maxRetries: 1
    })
    assert.equal(statusCalls, 3)
    assert.deepEqual(sleeps, [250, 100])
    assert.deepEqual(JSON.parse(await readFile(provider.mappingArtifact.path, 'utf8')), [
      { from: 'P04637', to: 'ENSG00000141510' },
      { from: 'P38398', to: 'ENSG00000012048' }
    ])
    const mappingManifest = JSON.parse(await readFile(provider.mappingArtifact.manifestPath, 'utf8'))
    assert.equal(mappingManifest.origins[0].source.id, 'uniprot-id-mapping')
    assert.equal(mappingManifest.origins[0].request.idCount, 3)
    assert.match(mappingManifest.origins[0].request.bodySha256, /^[a-f0-9]{64}$/)

    const mapped = await service.mapIds({
      planId: prepared.plan.planId,
      inputArtifact: inputPath,
      mappingArtifact: provider.mappingArtifact.path,
      inputField: 'accession',
      mappingFromField: 'from',
      mappingToField: 'to',
      outputField: 'ensembl_id',
      onUnmapped: 'null',
      outputFileName: 'mapped.json'
    })
    assert.equal(mapped.counts.mappedRecords, 2)
    assert.equal(mapped.counts.unmatchedRecords, 1)
    assert.deepEqual(JSON.parse(await readFile(mapped.artifact.path, 'utf8')), [
      { accession: 'P04637', ensembl_id: 'ENSG00000141510' },
      { accession: 'P38398', ensembl_id: 'ENSG00000012048' },
      { accession: 'BAD', ensembl_id: null }
    ])
    const mappedManifest = JSON.parse(await readFile(mapped.artifact.manifestPath, 'utf8'))
    assert.equal(mappedManifest.origins[0].source.id, 'uniprot-id-mapping')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('bounds provider mapping batches and rejects redirects outside the fixed UniProt origin', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-dataset-provider-map-security-'))
  const inputPath = join(workspaceRoot, 'ids.json')
  await writeFile(inputPath, '[{"id":"P04637"},{"id":"P38398"}]')
  const fetchImpl: typeof fetch = async (url) => {
    const value = String(url)
    if (value.endsWith('/idmapping/run')) return new Response('{"jobId":"secure123"}')
    if (value.endsWith('/idmapping/status/secure123')) return new Response('{"jobStatus":"FINISHED"}')
    if (value.endsWith('/idmapping/details/secure123')) {
      return new Response('{"redirectURL":"https://attacker.example/idmapping/results/secure123"}')
    }
    throw new Error(`Unexpected URL: ${value}`)
  }
  const service = createDatasetProcessingService({ workspaceRoot, fetchImpl, sleepImpl: async () => undefined })
  try {
    const plan = await service.preparePlan({
      objective: 'Security test provider mapping.',
      operations: [{ tool: 'dataset_id_map_provider', description: 'Map IDs.' }],
      outputs: [{ name: 'mapped.json', format: 'json' }],
      confirmedByUser: true
    })
    const request = {
      planId: plan.plan.planId,
      inputArtifact: inputPath,
      inputField: 'id',
      provider: 'uniprot' as const,
      fromDatabase: 'UniProtKB_AC-ID',
      toDatabase: 'Ensembl',
      outputField: 'ensembl_id',
      outputFileName: 'mapped.json'
    }
    await assert.rejects(service.providerIdMapping({ ...request, maxIds: 1 }), /exceeding maxIds=1/)
    await assert.rejects(service.providerIdMapping(request), /redirect left the fixed rest\.uniprot\.org/)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('profiles, filters, deduplicates, validates, and publishes FASTA without modifying the source', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const fastaPath = join(workspaceRoot, 'proteins.fasta')
  const fasta = '>P04637 TP53 human\nMEEPQSDPSVEPPLSQETFSDLWKLLPEN\n>P04637 duplicate\nMEEPQSDPSVEPPLSQETFSDLWKLLPEN\n>SHORT\nMEE\n'
  await writeFile(fastaPath, fasta)
  try {
    const planId = await confirmedPlan(service)
    const profile = await service.profile({ inputArtifact: fastaPath })
    assert.equal(profile.profile.records, 3)
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
    const published = await service.publish({
      planId,
      name: 'fasta-e2e',
      description: 'Filtered and deduplicated FASTA dataset.',
      artifacts: [
        profile.artifact.path,
        deduplicated.artifact.path,
        filtered.excludedArtifact.path,
        deduplicated.duplicatesArtifact.path,
        validation.artifact.path
      ]
    })
    assert.equal(published.publication.artifactCount, 5)
    assert.equal(published.quality.status, 'passed')
    const publicationManifest = JSON.parse(await readFile(published.publication.manifestPath, 'utf8'))
    assert.equal(publicationManifest.quality.validationReportCount, 1)
    assert.ok(publicationManifest.schema.artifacts.some((artifact: { format: string }) => artifact.format === 'fasta'))
    assert.ok(publicationManifest.artifacts.every((artifact: { sha256: string }) => /^[a-f0-9]{64}$/.test(artifact.sha256)))
    assert.ok(publicationManifest.artifacts.some((artifact: { operation: string }) => artifact.operation === 'dataset_filter_excluded'))
    assert.ok(publicationManifest.artifacts.some((artifact: { operation: string }) => artifact.operation === 'dataset_deduplicate_removed'))
    assert.equal(await readFile(fastaPath, 'utf8'), fasta)
  } finally {
    await cleanup()
  }
})

test('profiles and validates SDF and mmCIF structures with publication quality gating', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const sdfPath = join(workspaceRoot, 'molecules.sdf')
  const mmcifPath = join(workspaceRoot, 'structure.cif')
  await writeFile(sdfPath, [
    'Example molecule',
    '  SciForge',
    '',
    '  2  1  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    'M  END',
    '>  <CHEMBL_ID>',
    'CHEMBL25',
    '',
    '>  <ACTIVITY>',
    '12.5',
    '',
    '$$$$',
    ''
  ].join('\n'))
  await writeFile(mmcifPath, [
    'data_TEST',
    '_entry.id TEST',
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.id',
    '_atom_site.type_symbol',
    '_atom_site.label_asym_id',
    '_atom_site.pdbx_PDB_model_num',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
    'ATOM 1 C A 1 0.0 0.0 0.0',
    'ATOM 2 N B 1 1.0 0.0 0.0',
    '#',
    ''
  ].join('\n'))
  try {
    const planId = await confirmedPlan(service)
    const sdfProfile = await service.structureProfile({ inputArtifact: sdfPath })
    assert.equal(sdfProfile.profile.format, 'sdf')
    assert.equal(sdfProfile.profile.records, 1)
    assert.equal(sdfProfile.profile.coordinateRecords, 2)
    assert.deepEqual(
      (sdfProfile.profile.details.propertyFields as Array<{ name: string }>).map((field) => field.name),
      ['ACTIVITY', 'CHEMBL_ID']
    )
    const sdfValidation = await service.structureValidate({ inputArtifact: sdfPath, minRecords: 1 })
    assert.equal(sdfValidation.validation.valid, true)

    const cifProfile = await service.structureProfile({ inputArtifact: mmcifPath })
    assert.equal(cifProfile.profile.format, 'mmcif')
    assert.equal(cifProfile.profile.records, 1)
    assert.equal(cifProfile.profile.coordinateRecords, 2)
    assert.deepEqual((cifProfile.profile.details.atomSite as { chains: string[] }).chains, ['A', 'B'])
    const cifValidation = await service.structureValidate({ inputArtifact: mmcifPath, requireCoordinates: true })
    assert.equal(cifValidation.validation.valid, true)

    const published = await service.publish({
      planId,
      name: 'structure-release',
      artifacts: [mmcifPath, cifValidation.artifact.path]
    })
    assert.equal(published.quality.status, 'passed')
    assert.equal(published.quality.validationReportCount, 1)
  } finally {
    await cleanup()
  }
})

test('organizes pathway and network edges into bounded nodes, edges, and invalid artifacts', async () => {
  const { workspaceRoot, service, cleanup } = await fixture()
  const networkPath = join(workspaceRoot, 'interactions.tsv')
  await writeFile(networkPath, [
    'source\ttarget\tscore\ttype\tevidence',
    'TP53\tMDM2\t0.99\tphysical\texperiment-1',
    'MDM2\tTP53\t0.80\tphysical\texperiment-2',
    'TP53\tBRCA1\tinvalid\tfunctional\texperiment-3',
    '\tATM\t0.70\tfunctional\texperiment-4'
  ].join('\n'))
  try {
    const planId = await confirmedPlan(service)
    const organized = await service.organizeGraph({
      planId,
      inputArtifact: networkPath,
      format: 'tsv',
      graphType: 'network',
      sourceField: 'source',
      targetField: 'target',
      edgeTypeField: 'type',
      weightField: 'score',
      includeFields: ['evidence'],
      directed: false,
      deduplicateEdges: true,
      onInvalid: 'drop',
      outputFileName: 'tp53-network.graph.json'
    })
    assert.deepEqual(organized.counts, {
      inputRecords: 4,
      nodeRecords: 2,
      edgeRecords: 1,
      invalidRecords: 2,
      duplicateEdgesRemoved: 1
    })
    assert.deepEqual(JSON.parse(await readFile(organized.nodesArtifact.path, 'utf8')), [
      { id: 'MDM2', degree: 1 },
      { id: 'TP53', degree: 1 }
    ])
    assert.deepEqual(JSON.parse(await readFile(organized.edgesArtifact.path, 'utf8')), [{
      source: 'TP53',
      target: 'MDM2',
      type: 'physical',
      weight: 0.99,
      attributes: { evidence: 'experiment-1' }
    }])
    const invalid = JSON.parse(await readFile(organized.invalidArtifact.path, 'utf8'))
    assert.deepEqual(invalid.map((entry: { reason: string }) => entry.reason), [
      'invalid_weight', 'missing_or_invalid_endpoint'
    ])
    const graph = JSON.parse(await readFile(organized.graphArtifact.path, 'utf8'))
    assert.equal(graph.graphType, 'network')
    assert.equal(graph.edges.sha256, organized.edgesArtifact.sha256)
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
    const draftPath = draft.artifact.path
    const draftBytes = await readFile(draftPath)
    await assert.rejects(service.authorizePlan({
      planId: draft.plan.planId,
      operation: 'dataset_api_raw_data',
      parameters: {}
    }), /not confirmed/)
    const confirmedDraft = await service.preparePlan({
      draftPlanId: draft.plan.planId,
      confirmedByUser: true
    })
    assert.equal(confirmedDraft.plan.planId, draft.plan.planId)
    assert.equal(confirmedDraft.plan.status, 'confirmed')
    assert.equal(confirmedDraft.plan.confirmedByUser, true)
    assert.deepEqual(await readFile(draftPath), draftBytes)
    assert.deepEqual(confirmedDraft.artifact.parents, [{
      path: draftPath,
      sha256: draft.artifact.sha256
    }])
    const repeatedConfirmation = await service.preparePlan({
      draftPlanId: draft.plan.planId,
      confirmedByUser: true
    })
    assert.equal(repeatedConfirmation.artifact.sha256, confirmedDraft.artifact.sha256)
    await assert.rejects(service.authorizePlan({
      planId: draft.plan.planId,
      operation: 'dataset_api_raw_data',
      parameters: {}
    }), /does not authorize operation/)
    await service.filter({
      planId: draft.plan.planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 1 }],
      outputFileName: 'confirmed-out.json'
    })
    await assert.rejects(service.preparePlan({
      draftPlanId: draft.plan.planId,
      objective: 'Attempt to change the confirmed draft.',
      operations: [{ tool: 'dataset_filter', description: 'Changed operation.' }],
      outputs: [{ name: 'changed.json', format: 'json' }],
      confirmedByUser: true
    }), /Do not resubmit/)
    const tampered = JSON.parse(draftBytes.toString('utf8')) as Record<string, unknown>
    tampered.objective = 'Tampered after confirmation.'
    await writeFile(draftPath, JSON.stringify(tampered))
    await assert.rejects(service.filter({
      planId: draft.plan.planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 1 }],
      outputFileName: 'tampered-out.json'
    }), /confirmed draft has changed/)
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
    await assert.rejects(service.profile({
      planId: filterOnlyPlan.plan.planId,
      inputArtifact: sourcePath
    }), /does not authorize operation 'dataset_profile'/)
    await assert.rejects(service.structureProfile({
      planId: filterOnlyPlan.plan.planId,
      inputArtifact: sourcePath
    }), /does not authorize operation 'dataset_structure_profile'/)
    await assert.rejects(service.structureValidate({
      planId: filterOnlyPlan.plan.planId,
      inputArtifact: sourcePath
    }), /does not authorize operation 'dataset_structure_validate'/)
    const parameterBoundPlan = await service.preparePlan({
      objective: 'Execute exactly the reviewed filter approved by the user.',
      operations: [
        { tool: 'dataset_filter', description: 'Legacy unparameterized duplicate must not weaken binding.' },
        {
          tool: 'dataset_filter',
          description: 'Keep record id 1.',
          parameters: {
            inputArtifact: 'records.json',
            conditions: [{ field: 'id', operator: 'equals', value: 1 }],
            outputFileName: 'bound.json'
          }
        }
      ],
      outputs: [{ name: 'bound.json', format: 'json' }],
      confirmedByUser: true
    })
    const bound = await service.filter({
      planId: parameterBoundPlan.plan.planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 1 }],
      outputFileName: 'bound.json'
    })
    assert.equal(bound.counts.outputRecords, 1)
    await assert.rejects(service.filter({
      planId: parameterBoundPlan.plan.planId,
      inputArtifact: sourcePath,
      conditions: [{ field: 'id', operator: 'equals', value: 2 }],
      outputFileName: 'bound.json'
    }), /parameters do not authorize/)
    await assert.rejects(service.profile({ inputArtifact: '/etc/hosts', format: 'csv' }), /selected workspace/)
    const planId = await confirmedPlan(service)
    await assert.rejects(service.publish({
      planId,
      name: 'unvalidated',
      artifacts: [sourcePath]
    }), /requires at least one dataset_validate or dataset_structure_validate report/)
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
