import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  datasetDeduplicateInputSchema,
  datasetFilterInputSchema,
  datasetIdMapInputSchema,
  datasetJoinInputSchema,
  datasetProviderIdMapInputSchema,
  datasetPreparePlanInputSchema,
  datasetProfileInputSchema,
  datasetPublishInputSchema,
  datasetSelectColumnsInputSchema,
  datasetTransformInputSchema,
  datasetValidateInputSchema,
  type DatasetDeduplicateInput,
  type DatasetFilterInput,
  type DatasetIdMapInput,
  type DatasetJoinInput,
  type DatasetProviderIdMapInput,
  type DatasetPreparePlanInput,
  type DatasetProcessingFormat,
  type DatasetProfileInput,
  type DatasetPublishInput,
  type DatasetSelectColumnsInput,
  type DatasetTransformInput,
  type DatasetValidateInput
} from './contract.js'

type DatasetRow = Record<string, unknown>

type LoadedDataset = {
  path: string
  format: DatasetProcessingFormat
  rows: DatasetRow[]
  bytes: number
  sha256: string
}

type DatasetOrigin = {
  source: Record<string, unknown>
  request: Record<string, unknown>
  response?: Record<string, unknown>
}

type ArtifactManifest = {
  version: 1 | 2
  artifactId: string
  operation: string
  format: DatasetProcessingFormat | 'report' | 'plan' | 'publication'
  path: string
  manifestPath: string
  sha256: string
  bytes: number
  records?: number
  parents: Array<{ path: string; sha256: string }>
  parameters: Record<string, unknown>
  summary: Record<string, unknown>
  schema?: Record<string, unknown>
  origins?: DatasetOrigin[]
  createdAt: string
}

const DEFAULT_MAX_PROCESSING_BYTES = 64 * 1024 * 1024

export type DatasetProcessingService = ReturnType<typeof createDatasetProcessingService>

export function createDatasetProcessingService(options: {
  workspaceRoot?: string
  fetchImpl?: typeof fetch
  sleepImpl?: (milliseconds: number) => Promise<void>
} = {}) {
  const defaultWorkspaceRoot = options.workspaceRoot?.trim()
  const providerFetch = options.fetchImpl ?? globalThis.fetch
  const providerSleep = options.sleepImpl ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  return {
    async preparePlan(raw: DatasetPreparePlanInput) {
      const input = datasetPreparePlanInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      const normalized = {
        version: 1,
        objective: input.objective,
        sources: input.sources,
        operations: input.operations,
        outputs: input.outputs,
        exclusions: input.exclusions ?? [],
        confirmationNotes: input.confirmationNotes ?? [],
        confirmedByUser: input.confirmedByUser
      }
      const planId = `plan-${fingerprint(normalized).slice(0, 16)}`
      const path = join(workspaceRoot, '.sciforge', 'datasets', 'plans', `${planId}.json`)
      const document = {
        ...normalized,
        planId,
        status: input.confirmedByUser ? 'confirmed' : 'draft',
        createdAt: new Date().toISOString()
      }
      await writeIdempotentJson(path, document)
      return {
        plan: document,
        artifact: await describeStandaloneArtifact(path, 'plan', 'dataset_prepare_plan', {
          confirmedByUser: input.confirmedByUser
        }, { operations: input.operations.length, outputs: input.outputs.length })
      }
    },

    async profile(raw: DatasetProfileInput) {
      const input = datasetProfileInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      const dataset = await loadDataset(workspaceRoot, input)
      const profile = profileRows(dataset)
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_profile',
        format: 'report',
        outputFileName: input.outputFileName ?? `${basename(dataset.path)}.profile.json`,
        data: jsonBytes(profile),
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'outputFileName']),
        summary: profile
      })
      return { profile, artifact }
    },

    async filter(raw: DatasetFilterInput) {
      const input = datasetFilterInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_filter')
      const dataset = await loadDataset(workspaceRoot, input)
      const combine = input.combine ?? 'all'
      const rows = dataset.rows.filter((row) => {
        const matches = input.conditions.map((condition) => conditionMatches(row, condition))
        return combine === 'all' ? matches.every(Boolean) : matches.some(Boolean)
      })
      const data = serializeDataset(rows, dataset.format)
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_filter',
        format: dataset.format,
        outputFileName: input.outputFileName,
        data,
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'maxBytes']),
        summary: {
          inputRecords: dataset.rows.length,
          outputRecords: rows.length,
          excludedRecords: dataset.rows.length - rows.length,
          conditions: input.conditions,
          combine
        },
        records: rows.length
      })
      return { artifact, counts: artifact.summary }
    },

    async selectColumns(raw: DatasetSelectColumnsInput) {
      const input = datasetSelectColumnsInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_select_columns')
      const dataset = await loadDataset(workspaceRoot, input)
      const rows = dataset.rows.map((row, index) => Object.fromEntries(input.columns.map((column) => {
        const value = valueAtPath(row, column.source)
        if (value === undefined && column.required && column.defaultValue === undefined) {
          throw new Error(`Required field '${column.source}' is missing at record ${index + 1}.`)
        }
        return [column.target ?? column.source, value ?? column.defaultValue ?? null]
      })))
      const outputFormat = input.outputFormat ?? dataset.format
      const data = serializeDataset(rows, outputFormat)
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_select_columns',
        format: outputFormat,
        outputFileName: input.outputFileName,
        data,
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'maxBytes']),
        summary: {
          inputRecords: dataset.rows.length,
          outputRecords: rows.length,
          fields: input.columns.map((column) => column.target ?? column.source),
          inputFormat: dataset.format,
          outputFormat
        },
        records: rows.length
      })
      return { artifact, counts: { inputRecords: dataset.rows.length, outputRecords: rows.length } }
    },

    async transform(raw: DatasetTransformInput) {
      const input = datasetTransformInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_transform')
      const dataset = await loadDataset(workspaceRoot, input)
      const rows = dataset.rows.map((sourceRow, index) => {
        const row = structuredClone(sourceRow)
        for (const operation of input.operations) applyTransformOperation(row, operation, index)
        if ((input.outputFormat ?? dataset.format) === 'fasta' && typeof row.sequence === 'string') {
          row.length = row.sequence.replace(/\s+/g, '').length
        }
        return row
      })
      const outputFormat = input.outputFormat ?? dataset.format
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_transform',
        format: outputFormat,
        outputFileName: input.outputFileName,
        data: serializeDataset(rows, outputFormat),
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'maxBytes']),
        summary: {
          inputRecords: dataset.rows.length,
          outputRecords: rows.length,
          operationCount: input.operations.length,
          operations: input.operations,
          inputFormat: dataset.format,
          outputFormat
        },
        records: rows.length
      })
      return { artifact, counts: { inputRecords: dataset.rows.length, outputRecords: rows.length }, operations: input.operations }
    },

    async deduplicate(raw: DatasetDeduplicateInput) {
      const input = datasetDeduplicateInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_deduplicate')
      const dataset = await loadDataset(workspaceRoot, input)
      const keep = input.keep ?? 'first'
      const seen = new Map<string, DatasetRow>()
      for (const row of dataset.rows) {
        const key = canonicalJson(input.keys.map((field) => valueAtPath(row, field)))
        if (keep === 'last' || !seen.has(key)) seen.set(key, row)
      }
      const rows = [...seen.values()]
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_deduplicate',
        format: dataset.format,
        outputFileName: input.outputFileName,
        data: serializeDataset(rows, dataset.format),
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'maxBytes']),
        summary: {
          inputRecords: dataset.rows.length,
          outputRecords: rows.length,
          duplicateRecordsRemoved: dataset.rows.length - rows.length,
          keys: input.keys,
          keep
        },
        records: rows.length
      })
      return { artifact, counts: artifact.summary }
    },

    async providerIdMapping(raw: DatasetProviderIdMapInput) {
      const input = datasetProviderIdMapInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_id_map_provider')
      const dataset = await loadDataset(workspaceRoot, {
        inputArtifact: input.inputArtifact,
        format: input.inputFormat,
        recordPath: input.inputRecordPath,
        maxBytes: input.maxBytes
      })
      const ids = [...new Set(dataset.rows.map((row, index) => {
        const value = valueAtPath(row, input.inputField)
        if (value === undefined || value === null || value === '') return null
        if (!['string', 'number'].includes(typeof value)) {
          throw new Error(`Provider ID mapping field '${input.inputField}' must be a string or number at record ${index + 1}.`)
        }
        const id = String(value).trim()
        if (!id || /[,\r\n]/.test(id)) throw new Error(`Provider ID mapping found an invalid identifier at record ${index + 1}.`)
        return id
      }).filter((value): value is string => value !== null))]
      const maxIds = input.maxIds ?? 10_000
      if (ids.length === 0) throw new Error(`Provider ID mapping found no identifiers in field '${input.inputField}'.`)
      if (ids.length > maxIds) {
        throw new Error(`Provider ID mapping found ${ids.length} unique identifiers, exceeding maxIds=${maxIds}. Split or filter the dataset before retrying.`)
      }
      const mapped = await runUniProtIdMapping({
        fetchImpl: providerFetch,
        sleepImpl: providerSleep,
        ids,
        fromDatabase: input.fromDatabase,
        toDatabase: input.toDatabase,
        taxId: input.taxId,
        timeoutMs: input.timeoutMs ?? 30_000,
        pollIntervalMs: input.pollIntervalMs ?? 3_000,
        maxPollAttempts: input.maxPollAttempts ?? 100,
        maxRetries: input.maxRetries ?? 2,
        maxBytes: input.maxBytes ?? DEFAULT_MAX_PROCESSING_BYTES
      })
      const mappingRows = mapped.results.flatMap((entry) => {
        const target = providerMappingTarget(entry.to)
        return target === undefined ? [] : [{ from: entry.from, to: target }]
      })
      const mappingData = jsonBytes(mappingRows)
      const bodyFingerprint = hash(Buffer.from(canonicalJson({
        ids,
        from: input.fromDatabase,
        to: input.toDatabase,
        taxId: input.taxId
      })))
      const origin: DatasetOrigin = {
        source: { id: 'uniprot-id-mapping', name: 'UniProt ID Mapping API' },
        request: {
          method: 'POST',
          url: 'https://rest.uniprot.org/idmapping/run',
          fromDatabase: input.fromDatabase,
          toDatabase: input.toDatabase,
          idCount: ids.length,
          bodySha256: bodyFingerprint,
          resultsUrl: mapped.resultsUrl
        },
        response: {
          jobId: mapped.jobId,
          mappingRecords: mappingRows.length,
          failedIdCount: mapped.failedIds.length,
          status: 200
        }
      }
      const mappingArtifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_id_map_provider_mapping',
        format: 'json',
        outputFileName: `${safeId(input.provider)}-${providerDatabaseSlug(input.fromDatabase)}-to-${providerDatabaseSlug(input.toDatabase)}.mapping.json`,
        data: mappingData,
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: {
          provider: input.provider,
          fromDatabase: input.fromDatabase,
          toDatabase: input.toDatabase,
          taxId: input.taxId,
          inputField: input.inputField,
          idCount: ids.length,
          bodySha256: bodyFingerprint,
          providerResponseSha256: hash(mappingData)
        },
        summary: {
          requestedIds: ids.length,
          mappingRecords: mappingRows.length,
          failedIds: mapped.failedIds.length,
          invalidProviderResults: mapped.results.length - mappingRows.length,
          provider: input.provider,
          fromDatabase: input.fromDatabase,
          toDatabase: input.toDatabase
        },
        records: mappingRows.length,
        origins: [origin]
      })
      return { mappingArtifact, mapping: mapped, ids }
    },

    async mapIds(raw: DatasetIdMapInput) {
      const input = datasetIdMapInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_id_map')
      const [dataset, mappingDataset] = await Promise.all([
        loadDataset(workspaceRoot, {
          inputArtifact: input.inputArtifact,
          format: input.inputFormat,
          recordPath: input.inputRecordPath,
          maxBytes: input.maxBytes
        }),
        loadDataset(workspaceRoot, {
          inputArtifact: input.mappingArtifact,
          format: input.mappingFormat,
          recordPath: input.mappingRecordPath,
          maxBytes: input.maxBytes
        })
      ])
      const caseSensitive = input.caseSensitive ?? true
      const deduplicateTargets = input.deduplicateTargets ?? true
      const mapping = new Map<string, unknown[]>()
      let invalidMappingRecords = 0
      for (const row of mappingDataset.rows) {
        const from = valueAtPath(row, input.mappingFromField)
        const to = valueAtPath(row, input.mappingToField)
        if (from === undefined || from === null || from === '' || to === undefined || to === null || to === '') {
          invalidMappingRecords += 1
          continue
        }
        const key = comparableScalar(from, caseSensitive)
        const targets = mapping.get(key) ?? []
        if (!deduplicateTargets || !targets.some((target) => canonicalJson(target) === canonicalJson(to))) targets.push(to)
        mapping.set(key, targets)
      }
      const cardinality = input.cardinality ?? 'first'
      const onUnmapped = input.onUnmapped ?? 'null'
      const maxOutputRecords = input.maxOutputRecords ?? 1_000_000
      const rows: DatasetRow[] = []
      const unmatched: Array<{ recordIndex: number; inputId: unknown; record: DatasetRow }> = []
      const ambiguous: Array<{ recordIndex: number; inputId: unknown; targets: unknown[] }> = []
      let mappedRecords = 0
      const append = (row: DatasetRow) => {
        if (rows.length >= maxOutputRecords) {
          throw new Error(`Dataset ID mapping exceeded maxOutputRecords=${maxOutputRecords}; use cardinality=first/all or refine the input before retrying.`)
        }
        rows.push(row)
      }
      for (const [recordIndex, sourceRow] of dataset.rows.entries()) {
        const inputId = valueAtPath(sourceRow, input.inputField)
        const targets = inputId === undefined || inputId === null || inputId === ''
          ? []
          : mapping.get(comparableScalar(inputId, caseSensitive)) ?? []
        if (targets.length === 0) {
          unmatched.push({ recordIndex: recordIndex + 1, inputId: inputId ?? null, record: sourceRow })
          if (onUnmapped === 'drop' || onUnmapped === 'fail') continue
          const row = structuredClone(sourceRow)
          setValueAtPath(row, input.outputField, onUnmapped === 'keep' ? inputId : null)
          append(row)
          continue
        }
        mappedRecords += 1
        if (targets.length > 1) ambiguous.push({ recordIndex: recordIndex + 1, inputId, targets })
        if (cardinality === 'explode') {
          for (const target of targets) {
            const row = structuredClone(sourceRow)
            setValueAtPath(row, input.outputField, target)
            append(row)
          }
        } else {
          const row = structuredClone(sourceRow)
          setValueAtPath(row, input.outputField, cardinality === 'all' ? targets : targets[0])
          append(row)
        }
      }
      const outputFormat = input.outputFormat ?? (dataset.format === 'fasta' ? 'json' : dataset.format)
      const parents = [
        { path: dataset.path, sha256: dataset.sha256 },
        { path: mappingDataset.path, sha256: mappingDataset.sha256 }
      ]
      const parameters = processingParameters(input, ['workspaceRoot', 'maxBytes'])
      const outputStem = basename(input.outputFileName, extname(input.outputFileName))
      const [unmatchedArtifact, ambiguousArtifact] = await Promise.all([
        writeDerivedArtifact({
          workspaceRoot,
          operation: 'dataset_id_map_unmatched',
          format: 'json',
          outputFileName: `${outputStem}.unmatched.json`,
          data: jsonBytes(unmatched),
          parents,
          parameters,
          summary: { records: unmatched.length, inputField: input.inputField },
          records: unmatched.length
        }),
        writeDerivedArtifact({
          workspaceRoot,
          operation: 'dataset_id_map_ambiguous',
          format: 'json',
          outputFileName: `${outputStem}.ambiguous.json`,
          data: jsonBytes(ambiguous),
          parents,
          parameters,
          summary: { records: ambiguous.length, cardinality },
          records: ambiguous.length
        })
      ])
      if (onUnmapped === 'fail' && unmatched.length > 0) {
        throw new Error(`Dataset ID mapping found ${unmatched.length} unmatched records. Report: ${unmatchedArtifact.path}`)
      }
      const counts = {
        inputRecords: dataset.rows.length,
        mappingRecords: mappingDataset.rows.length,
        outputRecords: rows.length,
        mappedRecords,
        unmatchedRecords: unmatched.length,
        ambiguousRecords: ambiguous.length,
        invalidMappingRecords
      }
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_id_map',
        format: outputFormat,
        outputFileName: input.outputFileName,
        data: serializeDataset(rows, outputFormat, [...uniqueFields(dataset.rows), input.outputField]),
        parents,
        parameters,
        summary: {
          ...counts,
          inputField: input.inputField,
          mappingFromField: input.mappingFromField,
          mappingToField: input.mappingToField,
          outputField: input.outputField,
          cardinality,
          onUnmapped
        },
        records: rows.length
      })
      return { artifact, unmatchedArtifact, ambiguousArtifact, counts }
    },

    async join(raw: DatasetJoinInput) {
      const input = datasetJoinInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_join')
      const [left, right] = await Promise.all([
        loadDataset(workspaceRoot, {
          inputArtifact: input.leftArtifact,
          format: input.leftFormat,
          recordPath: input.leftRecordPath,
          maxBytes: input.maxBytes
        }),
        loadDataset(workspaceRoot, {
          inputArtifact: input.rightArtifact,
          format: input.rightFormat,
          recordPath: input.rightRecordPath,
          maxBytes: input.maxBytes
        })
      ])
      const joinType = input.joinType ?? 'inner'
      const rightPrefix = input.rightPrefix ?? 'right_'
      const rightIndex = new Map<string, Array<{ row: DatasetRow; index: number }>>()
      for (const [index, row] of right.rows.entries()) {
        const key = joinKey(row, input.keys.map((mapping) => mapping.right))
        if (key === null) continue
        const matches = rightIndex.get(key) ?? []
        matches.push({ row, index })
        rightIndex.set(key, matches)
      }
      const leftFields = uniqueFields(left.rows)
      const rightFields = uniqueFields(right.rows)
      const matchedRight = new Set<number>()
      const outputRows: DatasetRow[] = []
      const unmatchedLeft: DatasetRow[] = []
      const maxOutputRecords = input.maxOutputRecords ?? 1_000_000
      const appendOutput = (row: DatasetRow) => {
        if (outputRows.length >= maxOutputRecords) {
          throw new Error(`Dataset join exceeded maxOutputRecords=${maxOutputRecords}; refine or deduplicate join keys before retrying.`)
        }
        outputRows.push(row)
      }
      for (const leftRow of left.rows) {
        const key = joinKey(leftRow, input.keys.map((mapping) => mapping.left))
        const matches = key === null ? [] : rightIndex.get(key) ?? []
        if (matches.length === 0) {
          unmatchedLeft.push(leftRow)
          if (joinType === 'left' || joinType === 'full') {
            appendOutput(mergeJoinedRows(leftRow, undefined, leftFields, rightFields, rightPrefix))
          }
          continue
        }
        for (const match of matches) {
          matchedRight.add(match.index)
          appendOutput(mergeJoinedRows(leftRow, match.row, leftFields, rightFields, rightPrefix))
        }
      }
      const unmatchedRight = right.rows.filter((_, index) => !matchedRight.has(index))
      if (joinType === 'right' || joinType === 'full') {
        for (const row of unmatchedRight) {
          appendOutput(mergeJoinedRows(undefined, row, leftFields, rightFields, rightPrefix))
        }
      }
      const outputFormat = input.outputFormat ?? (left.format === 'fasta' ? 'json' : left.format)
      const parents = [
        { path: left.path, sha256: left.sha256 },
        { path: right.path, sha256: right.sha256 }
      ]
      const parameters = processingParameters(input, ['workspaceRoot', 'maxBytes'])
      const counts = {
        leftRecords: left.rows.length,
        rightRecords: right.rows.length,
        outputRecords: outputRows.length,
        matchedLeftRecords: left.rows.length - unmatchedLeft.length,
        matchedRightRecords: right.rows.length - unmatchedRight.length,
        unmatchedLeftRecords: unmatchedLeft.length,
        unmatchedRightRecords: unmatchedRight.length
      }
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_join',
        format: outputFormat,
        outputFileName: input.outputFileName,
        data: serializeDataset(outputRows, outputFormat, [
          ...leftFields,
          ...rightFields.map((field) => `${rightPrefix}${field}`)
        ]),
        parents,
        parameters,
        summary: { ...counts, joinType, keys: input.keys, rightPrefix, outputFormat },
        records: outputRows.length
      })
      const outputStem = basename(input.outputFileName, extname(input.outputFileName))
      const [unmatchedLeftArtifact, unmatchedRightArtifact] = await Promise.all([
        writeDerivedArtifact({
          workspaceRoot,
          operation: 'dataset_join_unmatched_left',
          format: 'json',
          outputFileName: `${outputStem}.unmatched-left.json`,
          data: jsonBytes(unmatchedLeft),
          parents: [parents[0]],
          parameters,
          summary: { records: unmatchedLeft.length, side: 'left', keys: input.keys.map((mapping) => mapping.left) },
          records: unmatchedLeft.length
        }),
        writeDerivedArtifact({
          workspaceRoot,
          operation: 'dataset_join_unmatched_right',
          format: 'json',
          outputFileName: `${outputStem}.unmatched-right.json`,
          data: jsonBytes(unmatchedRight),
          parents: [parents[1]],
          parameters,
          summary: { records: unmatchedRight.length, side: 'right', keys: input.keys.map((mapping) => mapping.right) },
          records: unmatchedRight.length
        })
      ])
      return {
        artifact,
        unmatchedArtifacts: { left: unmatchedLeftArtifact, right: unmatchedRightArtifact },
        counts
      }
    },

    async validate(raw: DatasetValidateInput) {
      const input = datasetValidateInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      const dataset = await loadDataset(workspaceRoot, input)
      const report = validateRows(dataset, input)
      const artifact = await writeDerivedArtifact({
        workspaceRoot,
        operation: 'dataset_validate',
        format: 'report',
        outputFileName: input.outputFileName ?? `${basename(dataset.path)}.validation.json`,
        data: jsonBytes(report),
        parents: [{ path: dataset.path, sha256: dataset.sha256 }],
        parameters: processingParameters(input, ['workspaceRoot', 'outputFileName']),
        summary: report
      })
      if (input.failOnInvalid && !report.valid) {
        throw new Error(`Dataset validation failed with ${report.errorCount} errors. Report: ${artifact.path}`)
      }
      return { validation: report, artifact }
    },

    async publish(raw: DatasetPublishInput) {
      const input = datasetPublishInputSchema.parse(raw)
      const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot, defaultWorkspaceRoot)
      const plan = await requireConfirmedPlan(workspaceRoot, input.planId, 'dataset_publish')
      const outputDirectory = join(
        workspaceRoot,
        '.sciforge',
        'datasets',
        'published',
        input.outputDirectoryName ?? input.name,
        input.planId
      )
      await mkdir(outputDirectory, { recursive: true })
      const artifacts = []
      for (const candidate of input.artifacts) {
        const sourcePath = await resolveInputArtifact(workspaceRoot, candidate)
        const sourceBytes = await readFile(sourcePath)
        const sha256 = hash(sourceBytes)
        const targetName = `${sha256.slice(0, 12)}-${basename(sourcePath)}`
        const targetPath = join(outputDirectory, targetName)
        await copyIdempotent(sourcePath, targetPath, sha256)
        const sidecar = await readArtifactManifest(sourcePath)
        const publishedFormat = sidecar && isConcreteFormat(sidecar.format) ? sidecar.format : undefined
        const publishedProfile = publishedFormat
          ? profileRows({
              path: sourcePath,
              format: publishedFormat,
              rows: parseDataset(sourceBytes, publishedFormat),
              bytes: sourceBytes.byteLength,
              sha256
            })
          : undefined
        artifacts.push({
          sourcePath,
          path: targetPath,
          fileName: targetName,
          sha256,
          bytes: sourceBytes.byteLength,
          origins: sidecar?.origins ?? [],
          ...(sidecar ? {
            operation: sidecar.operation,
            format: sidecar.format,
            records: sidecar.records,
            summary: sidecar.summary,
            schema: sidecar.schema,
            parentArtifacts: sidecar.parents
          } : {}),
          ...(publishedProfile ? {
            records: publishedProfile.records,
            schemaFields: publishedProfile.fields
          } : {})
        })
      }
      const schema = mergedPublishedSchema(artifacts)
      const quality = publishedQualitySummary(artifacts)
      if ((input.requireValidation ?? true) && quality.validationReportCount === 0) {
        throw new Error('Dataset publication requires at least one dataset_validate report artifact.')
      }
      if (!input.allowInvalid && quality.status === 'failed') {
        throw new Error('Dataset publication is blocked because an included validation report failed.')
      }
      const publication = {
        version: 1,
        name: input.name,
        description: input.description,
        planId: input.planId,
        planPath: plan.path,
        artifacts,
        schema,
        quality,
        provenance: {
          parents: artifacts.map((artifact) => ({ path: artifact.sourcePath, sha256: artifact.sha256 })),
          origins: deduplicateOrigins(artifacts.flatMap((artifact) => artifact.origins ?? [])),
          preparationPlan: plan.plan
        },
        createdAt: new Date().toISOString()
      }
      const manifestPath = join(outputDirectory, 'manifest.json')
      const schemaPath = join(outputDirectory, 'schema.json')
      const qualityReportPath = join(outputDirectory, 'quality-report.json')
      await writeIdempotentJson(manifestPath, publication)
      await writeIdempotentJson(schemaPath, schema)
      await writeIdempotentJson(qualityReportPath, quality)
      return {
        publication: {
          name: input.name,
          path: outputDirectory,
          manifestPath,
          schemaPath,
          qualityReportPath,
          artifactCount: artifacts.length,
          sha256: hash(jsonBytes(publication))
        },
        artifacts,
        quality
      }
    }
  }
}

async function resolveWorkspaceRoot(explicit: string | undefined, fallback: string | undefined): Promise<string> {
  const candidate = resolve(explicit?.trim() || fallback?.trim() || process.cwd())
  return realpath(candidate)
}

async function resolveInputArtifact(workspaceRoot: string, value: string): Promise<string> {
  const candidate = resolve(isAbsolute(value) ? value : join(workspaceRoot, value))
  const resolvedPath = await realpath(candidate)
  assertContained(workspaceRoot, resolvedPath)
  const info = await stat(resolvedPath)
  if (!info.isFile()) throw new Error(`Dataset artifact is not a file: ${resolvedPath}`)
  return resolvedPath
}

function assertContained(workspaceRoot: string, candidate: string): void {
  const child = relative(workspaceRoot, candidate)
  if (child === '' || (!child.startsWith('..') && !isAbsolute(child))) return
  throw new Error('Dataset processing inputs and outputs must stay inside the selected workspace.')
}

async function loadDataset(
  workspaceRoot: string,
  input: { inputArtifact: string; format?: string; recordPath?: string; maxBytes?: number }
): Promise<LoadedDataset> {
  const path = await resolveInputArtifact(workspaceRoot, input.inputArtifact)
  const info = await stat(path)
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_PROCESSING_BYTES
  if (info.size > maxBytes) throw new Error(`Dataset artifact exceeds the ${maxBytes}-byte processing limit.`)
  const bytes = await readFile(path)
  const format = resolveFormat(path, bytes, input.format)
  const rows = parseDataset(bytes, format, input.recordPath)
  return { path, format, rows, bytes: bytes.byteLength, sha256: hash(bytes) }
}

function resolveFormat(path: string, bytes: Buffer, requested: string | undefined): DatasetProcessingFormat {
  if (requested && requested !== 'auto') return requested as DatasetProcessingFormat
  const extension = extname(path).toLowerCase()
  if (extension === '.json') return 'json'
  if (extension === '.jsonl' || extension === '.ndjson') return 'jsonl'
  if (extension === '.csv') return 'csv'
  if (extension === '.tsv' || extension === '.tab') return 'tsv'
  if (['.fa', '.faa', '.fna', '.fasta'].includes(extension)) return 'fasta'
  const sample = bytes.subarray(0, 4096).toString('utf8').trimStart()
  if (sample.startsWith('>')) return 'fasta'
  if (sample.startsWith('[') || sample.startsWith('{')) return 'json'
  throw new Error(`Could not infer dataset format for ${path}; set format explicitly.`)
}

function parseDataset(bytes: Buffer, format: DatasetProcessingFormat, recordPath?: string): DatasetRow[] {
  const text = bytes.toString('utf8')
  if (format === 'json') {
    const parsed = JSON.parse(text) as unknown
    const selected = recordPath ? valueAtPath(parsed, recordPath) : parsed
    const records = Array.isArray(selected) ? selected : [selected]
    return records.map((record, index) => normalizeRecord(record, index))
  }
  if (format === 'jsonl') {
    return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) =>
      normalizeRecord(JSON.parse(line) as unknown, index)
    )
  }
  if (format === 'csv' || format === 'tsv') return parseDelimited(text, format === 'csv' ? ',' : '\t')
  return parseFasta(text)
}

function normalizeRecord(value: unknown, index: number): DatasetRow {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as DatasetRow
  return { index, value }
}

function parseDelimited(text: string, delimiter: string): DatasetRow[] {
  const matrix: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"' && field.length === 0) quoted = true
    else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length > 0)) matrix.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((value) => value.length > 0)) matrix.push(row)
  }
  const headers = matrix.shift()?.map((header, index) => header.trim() || `column_${index + 1}`) ?? []
  if (new Set(headers).size !== headers.length) throw new Error('Delimited dataset contains duplicate column names.')
  return matrix.map((values) => Object.fromEntries(headers.map((header, index) => [header, inferScalar(values[index] ?? '')])))
}

function inferScalar(value: string): unknown {
  const normalized = value.trim()
  if (normalized === '') return null
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    const number = Number(normalized)
    if (Number.isFinite(number)) return number
  }
  if (/^(?:true|false)$/i.test(normalized)) return normalized.toLowerCase() === 'true'
  return value
}

function parseFasta(text: string): DatasetRow[] {
  const records: DatasetRow[] = []
  let header = ''
  let sequence = ''
  const flush = () => {
    if (!header) return
    const [id = '', ...descriptionParts] = header.split(/\s+/)
    records.push({ header, id, description: descriptionParts.join(' '), sequence, length: sequence.length })
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    if (line.startsWith('>')) {
      flush()
      header = line.slice(1).trim()
      sequence = ''
    } else {
      if (!header) throw new Error('FASTA sequence data appeared before the first header.')
      if (!/^[A-Za-z*.-]+$/.test(line)) throw new Error(`Invalid FASTA sequence line: ${line.slice(0, 80)}`)
      sequence += line
    }
  }
  flush()
  if (records.length === 0) throw new Error('FASTA dataset contains no records.')
  return records
}

function serializeDataset(rows: DatasetRow[], format: DatasetProcessingFormat, knownFields?: string[]): Buffer {
  if (format === 'json') return jsonBytes(rows)
  if (format === 'jsonl') return Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`)
  if (format === 'csv' || format === 'tsv') return Buffer.from(serializeDelimited(rows, format === 'csv' ? ',' : '\t', knownFields))
  return Buffer.from(serializeFasta(rows))
}

function serializeDelimited(rows: DatasetRow[], delimiter: string, knownFields: string[] = []): string {
  const headers = [...new Set([...knownFields, ...rows.flatMap((row) => Object.keys(row))])]
  const lines = [headers.map((header) => escapeDelimited(header, delimiter)).join(delimiter)]
  for (const row of rows) {
    lines.push(headers.map((header) => escapeDelimited(row[header], delimiter)).join(delimiter))
  }
  return `${lines.join('\n')}\n`
}

function escapeDelimited(value: unknown, delimiter: string): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function serializeFasta(rows: DatasetRow[]): string {
  return `${rows.map((row, index) => {
    const header = String(row.header ?? row.id ?? `record_${index + 1}`).trim()
    const sequence = String(row.sequence ?? '').replace(/\s+/g, '')
    if (!header || !sequence || !/^[A-Za-z*.-]+$/.test(sequence)) {
      throw new Error(`Record ${index + 1} cannot be serialized as FASTA; header/id and sequence are required.`)
    }
    const lines = sequence.match(/.{1,80}/g) ?? []
    return `>${header}\n${lines.join('\n')}`
  }).join('\n')}\n`
}

function profileRows(dataset: LoadedDataset): {
  format: DatasetProcessingFormat
  bytes: number
  sha256: string
  records: number
  fields: Array<{
    name: string
    types: Record<string, number>
    missing: number
    missingFraction: number
    unique: number
    sample: unknown[]
  }>
} {
  const fields = [...new Set(dataset.rows.flatMap((row) => Object.keys(row)))]
  return {
    format: dataset.format,
    bytes: dataset.bytes,
    sha256: dataset.sha256,
    records: dataset.rows.length,
    fields: fields.map((field) => {
      const values = dataset.rows.map((row) => valueAtPath(row, field))
      const present = values.filter((value) => value !== undefined && value !== null && value !== '')
      const typeCounts = countBy(present.map(valueType))
      return {
        name: field,
        types: typeCounts,
        missing: values.length - present.length,
        missingFraction: values.length ? (values.length - present.length) / values.length : 0,
        unique: new Set(present.map(canonicalJson)).size,
        sample: present.slice(0, 5)
      }
    })
  }
}

function validateRows(dataset: LoadedDataset, input: DatasetValidateInput) {
  const errors: Array<Record<string, unknown>> = []
  const warnings: Array<Record<string, unknown>> = []
  if (input.minRecords !== undefined && dataset.rows.length < input.minRecords) {
    errors.push({ rule: 'minRecords', expected: input.minRecords, actual: dataset.rows.length })
  }
  for (const rule of input.rules) {
    const seen = new Set<string>()
    for (let index = 0; index < dataset.rows.length; index += 1) {
      const value = valueAtPath(dataset.rows[index], rule.field)
      const missing = value === undefined || value === null || value === ''
      if (missing && rule.required) errors.push({ record: index + 1, field: rule.field, rule: 'required' })
      if (missing) continue
      if (rule.type && valueType(value) !== rule.type) {
        errors.push({ record: index + 1, field: rule.field, rule: 'type', expected: rule.type, actual: valueType(value) })
      }
      if (rule.min !== undefined && Number(value) < rule.min) errors.push({ record: index + 1, field: rule.field, rule: 'min', expected: rule.min, actual: value })
      if (rule.max !== undefined && Number(value) > rule.max) errors.push({ record: index + 1, field: rule.field, rule: 'max', expected: rule.max, actual: value })
      if (rule.allowedValues && !rule.allowedValues.some((allowed) => canonicalJson(allowed) === canonicalJson(value))) {
        errors.push({ record: index + 1, field: rule.field, rule: 'allowedValues', actual: value })
      }
      if (rule.unique) {
        const key = canonicalJson(value)
        if (seen.has(key)) errors.push({ record: index + 1, field: rule.field, rule: 'unique', actual: value })
        seen.add(key)
      }
    }
    if (input.maxMissingFraction !== undefined) {
      const missing = dataset.rows.filter((row) => {
        const value = valueAtPath(row, rule.field)
        return value === undefined || value === null || value === ''
      }).length
      const fraction = dataset.rows.length ? missing / dataset.rows.length : 0
      if (fraction > input.maxMissingFraction) {
        errors.push({ field: rule.field, rule: 'maxMissingFraction', expected: input.maxMissingFraction, actual: fraction })
      }
    }
  }
  if (dataset.format === 'fasta') {
    for (let index = 0; index < dataset.rows.length; index += 1) {
      const sequence = String(dataset.rows[index].sequence ?? '')
      if (!sequence) errors.push({ record: index + 1, field: 'sequence', rule: 'required' })
      else if (!/^[A-Za-z*.-]+$/.test(sequence)) errors.push({ record: index + 1, field: 'sequence', rule: 'fastaAlphabet' })
    }
  }
  if (errors.length > 1000) warnings.push({ message: `${errors.length - 1000} additional validation errors omitted.` })
  return {
    valid: errors.length === 0,
    format: dataset.format,
    records: dataset.rows.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.slice(0, 1000),
    warnings
  }
}

function applyTransformOperation(
  row: DatasetRow,
  operation: DatasetTransformInput['operations'][number],
  recordIndex: number
): void {
  const current = valueAtPath(row, operation.field)
  const target = operation.target ?? operation.field
  if (operation.operation === 'set_default') {
    if (current === undefined || current === null || current === '') setValueAtPath(row, target, operation.value)
    else if (target !== operation.field) setValueAtPath(row, target, current)
    return
  }
  if (current === undefined || current === null) return
  try {
    let transformed: unknown
    switch (operation.operation) {
      case 'trim': transformed = requireString(current, operation.operation).trim(); break
      case 'lowercase': transformed = requireString(current, operation.operation).toLowerCase(); break
      case 'uppercase': transformed = requireString(current, operation.operation).toUpperCase(); break
      case 'normalize_whitespace': transformed = requireString(current, operation.operation).trim().replace(/\s+/g, ' '); break
      case 'replace_literal': {
        const text = requireString(current, operation.operation)
        transformed = operation.replaceAll
          ? text.split(operation.search).join(operation.replacement)
          : text.replace(operation.search, operation.replacement)
        break
      }
      case 'to_number': {
        const number = typeof current === 'number' ? current : Number(String(current).trim())
        if (!Number.isFinite(number)) throw new Error(`cannot convert '${String(current)}' to a finite number`)
        transformed = number
        break
      }
      case 'to_boolean': {
        const trueValues = operation.trueValues ?? ['true', '1', 'yes', 'y']
        const falseValues = operation.falseValues ?? ['false', '0', 'no', 'n']
        if (trueValues.some((value) => comparableScalar(value) === comparableScalar(current))) transformed = true
        else if (falseValues.some((value) => comparableScalar(value) === comparableScalar(current))) transformed = false
        else throw new Error(`cannot convert '${String(current)}' to boolean`)
        break
      }
      case 'map_values': {
        const comparable = comparableScalar(current, operation.caseSensitive ?? false)
        const mapping = operation.mappings.find((candidate) => (
          comparableScalar(candidate.from, operation.caseSensitive ?? false) === comparable
        ))
        if (mapping) transformed = mapping.to
        else if ((operation.onUnmapped ?? 'keep') === 'null') transformed = null
        else if (operation.onUnmapped === 'fail') throw new Error(`has no configured value mapping for '${String(current)}'`)
        else transformed = current
        break
      }
    }
    setValueAtPath(row, target, transformed)
  } catch (error) {
    const onError = 'onError' in operation ? operation.onError ?? 'fail' : 'fail'
    if (onError === 'null') setValueAtPath(row, target, null)
    else if (onError === 'keep') setValueAtPath(row, target, current)
    else throw new Error(`Transform '${operation.operation}' failed for field '${operation.field}' at record ${recordIndex + 1}: ${errorMessage(error)}`)
  }
}

function requireString(value: unknown, operation: string): string {
  if (typeof value !== 'string') throw new Error(`${operation} requires a string value`)
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function comparableScalar(value: unknown, caseSensitive = false): string {
  if (typeof value === 'string') return `string:${caseSensitive ? value : value.toLocaleLowerCase('en-US')}`
  return canonicalJson(value)
}

function setValueAtPath(row: DatasetRow, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    throw new Error(`Unsafe transform target field '${path}'.`)
  }
  let current: DatasetRow = row
  for (const segment of segments.slice(0, -1)) {
    const child = current[segment]
    if (child === undefined || child === null) current[segment] = {}
    else if (typeof child !== 'object' || Array.isArray(child)) {
      throw new Error(`Transform target '${path}' crosses non-object field '${segment}'.`)
    }
    current = current[segment] as DatasetRow
  }
  current[segments.at(-1)!] = value
}

function joinKey(row: DatasetRow, fields: string[]): string | null {
  const values = fields.map((field) => valueAtPath(row, field))
  return values.some((value) => value === undefined || value === null || value === '') ? null : canonicalJson(values)
}

function uniqueFields(rows: DatasetRow[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))]
}

function mergeJoinedRows(
  left: DatasetRow | undefined,
  right: DatasetRow | undefined,
  leftFields: string[],
  rightFields: string[],
  rightPrefix: string
): DatasetRow {
  return Object.fromEntries([
    ...leftFields.map((field) => [field, left?.[field] ?? null] as const),
    ...rightFields.map((field) => [`${rightPrefix}${field}`, right?.[field] ?? null] as const)
  ])
}

function conditionMatches(row: DatasetRow, condition: DatasetFilterInput['conditions'][number]): boolean {
  const actual = valueAtPath(row, condition.field)
  const expected = condition.value
  const normalize = (value: unknown) => condition.caseSensitive || typeof value !== 'string' ? value : value.toLowerCase()
  const left = normalize(actual)
  const right = normalize(expected)
  switch (condition.operator) {
    case 'exists': return expected === false ? actual === undefined || actual === null : actual !== undefined && actual !== null
    case 'equals': return canonicalJson(left) === canonicalJson(right)
    case 'not_equals': return canonicalJson(left) !== canonicalJson(right)
    case 'contains': return Array.isArray(actual)
      ? actual.some((value) => canonicalJson(normalize(value)) === canonicalJson(right))
      : String(left ?? '').includes(String(right ?? ''))
    case 'starts_with': return String(left ?? '').startsWith(String(right ?? ''))
    case 'ends_with': return String(left ?? '').endsWith(String(right ?? ''))
    case 'in': return Array.isArray(expected) && expected.some((value) => canonicalJson(left) === canonicalJson(normalize(value)))
    case 'not_in': return Array.isArray(expected) && !expected.some((value) => canonicalJson(left) === canonicalJson(normalize(value)))
    case 'gt': return Number(actual) > Number(expected)
    case 'gte': return Number(actual) >= Number(expected)
    case 'lt': return Number(actual) < Number(expected)
    case 'lte': return Number(actual) <= Number(expected)
    case 'between': return Array.isArray(expected) && expected.length === 2 && Number(actual) >= Number(expected[0]) && Number(actual) <= Number(expected[1])
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)]
    if (typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)
}

type UniProtMappingEntry = { from: string; to: unknown }

async function runUniProtIdMapping(input: {
  fetchImpl: typeof fetch
  sleepImpl: (milliseconds: number) => Promise<void>
  ids: string[]
  fromDatabase: string
  toDatabase: string
  taxId?: number
  timeoutMs: number
  pollIntervalMs: number
  maxPollAttempts: number
  maxRetries: number
  maxBytes: number
}): Promise<{
  jobId: string
  resultsUrl: string
  results: UniProtMappingEntry[]
  failedIds: string[]
}> {
  const form = new URLSearchParams({
    ids: input.ids.join(','),
    from: input.fromDatabase,
    to: input.toDatabase,
    ...(input.taxId ? { taxId: String(input.taxId) } : {})
  })
  const submitted = await providerRequest(input, 'https://rest.uniprot.org/idmapping/run', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  })
  const submission = await providerJson(submitted, input.maxBytes) as Record<string, unknown>
  const jobId = typeof submission.jobId === 'string' ? submission.jobId : ''
  if (!/^[A-Za-z0-9]+$/.test(jobId)) throw new Error('UniProt ID Mapping API did not return a valid jobId.')

  let statusReady = false
  let statusRedirect: string | undefined
  for (let attempt = 0; attempt < input.maxPollAttempts; attempt += 1) {
    const status = await providerRequest(input, `https://rest.uniprot.org/idmapping/status/${jobId}`, {
      headers: { accept: 'application/json' },
      redirect: 'manual'
    })
    const location = status.headers.get('location')
    if (status.status === 303 && location) {
      statusRedirect = validatedUniProtUrl(location).toString()
      statusReady = true
      break
    }
    const payload = await providerJson(status, Math.min(input.maxBytes, 4 * 1024 * 1024)) as Record<string, unknown>
    const jobStatus = typeof payload.jobStatus === 'string' ? payload.jobStatus.toUpperCase() : ''
    if (jobStatus === 'FINISHED' || Array.isArray(payload.results) || Array.isArray(payload.failedIds)) {
      statusReady = true
      break
    }
    if (jobStatus && !['NEW', 'RUNNING', 'PENDING'].includes(jobStatus)) {
      throw new Error(`UniProt ID Mapping job ${jobId} failed with status '${jobStatus}'.`)
    }
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      throw new Error(`UniProt ID Mapping job ${jobId} failed: ${payload.messages.map(String).join('; ')}`)
    }
    await input.sleepImpl(input.pollIntervalMs)
  }
  if (!statusReady) {
    throw new Error(`UniProt ID Mapping job ${jobId} did not finish after ${input.maxPollAttempts} polls.`)
  }

  const detailsResponse = await providerRequest(input, `https://rest.uniprot.org/idmapping/details/${jobId}`, {
    headers: { accept: 'application/json' },
    redirect: 'manual'
  })
  const details = await providerJson(detailsResponse, Math.min(input.maxBytes, 4 * 1024 * 1024)) as Record<string, unknown>
  const redirectUrl = typeof details.redirectURL === 'string' ? details.redirectURL : statusRedirect
  const resultsUrl = uniprotStreamResultsUrl(redirectUrl, jobId)
  const resultResponse = await providerRequest(input, resultsUrl, {
    headers: { accept: 'application/json' },
    redirect: 'manual'
  })
  const payload = await providerJson(resultResponse, input.maxBytes) as Record<string, unknown>
  const results = Array.isArray(payload.results)
    ? payload.results.flatMap((entry): UniProtMappingEntry[] => {
        if (!entry || typeof entry !== 'object') return []
        const record = entry as Record<string, unknown>
        return typeof record.from === 'string' && record.to !== undefined
          ? [{ from: record.from, to: record.to }]
          : []
      })
    : []
  const failedIds = Array.isArray(payload.failedIds) ? payload.failedIds.map(String) : []
  return { jobId, resultsUrl, results, failedIds }
}

async function providerRequest(
  input: {
    fetchImpl: typeof fetch
    sleepImpl: (milliseconds: number) => Promise<void>
    timeoutMs: number
    maxRetries: number
  },
  value: string,
  init: RequestInit
): Promise<Response> {
  const url = validatedUniProtUrl(value)
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    let response: Response
    try {
      response = await input.fetchImpl(url, { ...init, signal: AbortSignal.timeout(input.timeoutMs) })
    } catch (error) {
      if (attempt >= input.maxRetries) throw new Error(`UniProt ID Mapping request failed: ${errorMessage(error)}`)
      await input.sleepImpl(Math.min(2_000, 250 * 2 ** attempt))
      continue
    }
    if (response.ok || response.status === 303) return response
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt >= input.maxRetries) {
      const detail = await response.text().catch(() => '')
      throw new Error(`UniProt ID Mapping request failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}.`)
    }
    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader)
    await input.sleepImpl(Number.isFinite(retryAfterSeconds)
      ? Math.min(10_000, retryAfterSeconds * 1_000)
      : Math.min(2_000, 250 * 2 ** attempt))
  }
  throw new Error('UniProt ID Mapping request exhausted retries.')
}

async function providerJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`UniProt ID Mapping response exceeds the ${maxBytes}-byte limit.`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`UniProt ID Mapping response exceeds the ${maxBytes}-byte limit.`)
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error) {
    throw new Error(`UniProt ID Mapping response is not valid JSON: ${errorMessage(error)}`)
  }
}

function validatedUniProtUrl(value: string | URL): URL {
  const url = new URL(value, 'https://rest.uniprot.org/')
  if (url.protocol !== 'https:' || url.hostname !== 'rest.uniprot.org' || !url.pathname.startsWith('/idmapping/')) {
    throw new Error('UniProt ID Mapping redirect left the fixed rest.uniprot.org/idmapping origin.')
  }
  return url
}

function uniprotStreamResultsUrl(redirectUrl: string | undefined, jobId: string): string {
  const url = validatedUniProtUrl(redirectUrl ?? `https://rest.uniprot.org/idmapping/results/${jobId}`)
  if (url.pathname.includes('/idmapping/results/')) {
    url.pathname = url.pathname.replace('/idmapping/results/', '/idmapping/stream/')
  } else if (url.pathname.includes('/results/')) {
    url.pathname = url.pathname.replace('/results/', '/results/stream/')
  } else if (!url.pathname.includes('/stream/')) {
    throw new Error('UniProt ID Mapping details returned an unsupported results URL.')
  }
  url.search = ''
  url.searchParams.set('format', 'json')
  return url.toString()
}

function providerMappingTarget(value: unknown): unknown | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ['id', 'primaryAccession', 'uniProtkbId']) {
    const candidate = record[key]
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate
  }
  return undefined
}

async function requireConfirmedPlan(workspaceRoot: string, planId: string, operation?: string) {
  const path = join(workspaceRoot, '.sciforge', 'datasets', 'plans', `${safeId(planId)}.json`)
  const plan = JSON.parse(await readFile(path, 'utf8')) as {
    confirmedByUser?: boolean
    status?: string
    operations?: Array<{ tool?: string }>
  }
  if (!plan.confirmedByUser || plan.status !== 'confirmed') {
    throw new Error(`Preparation plan '${planId}' is not confirmed by the user.`)
  }
  const authorized = operation === 'dataset_id_map'
    ? plan.operations?.some((candidate) => ['dataset_id_map', 'dataset_id_map_provider'].includes(candidate.tool ?? ''))
    : plan.operations?.some((candidate) => candidate.tool === operation)
  if (operation && !authorized) {
    throw new Error(`Preparation plan '${planId}' does not authorize operation '${operation}'.`)
  }
  return { path, plan }
}

async function collectParentOrigins(parents: Array<{ path: string; sha256: string }>): Promise<DatasetOrigin[]> {
  const origins: DatasetOrigin[] = []
  for (const parent of parents) {
    const manifest = await readArtifactManifest(parent.path)
    if (manifest?.origins) origins.push(...manifest.origins)
  }
  return deduplicateOrigins(origins)
}

function deduplicateOrigins(origins: DatasetOrigin[]): DatasetOrigin[] {
  const seen = new Set<string>()
  return origins.filter((origin) => {
    const key = canonicalJson(origin)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function inferArtifactSchema(
  data: Buffer,
  format: DatasetProcessingFormat | 'report'
): Record<string, unknown> {
  let rows: DatasetRow[]
  if (format === 'report') {
    const parsed = JSON.parse(data.toString('utf8')) as unknown
    rows = Array.isArray(parsed)
      ? parsed.filter((value): value is DatasetRow => typeof value === 'object' && value !== null && !Array.isArray(value))
      : typeof parsed === 'object' && parsed !== null ? [parsed as DatasetRow] : []
  } else {
    rows = parseDataset(data, format)
  }
  const fields = uniqueFields(rows).map((name) => {
    const values = rows.map((row) => valueAtPath(row, name))
    const present = values.filter((value) => value !== undefined && value !== null && value !== '')
    return {
      name,
      types: countBy(present.map(valueType)),
      nullable: present.length !== values.length
    }
  })
  return { version: 1, format, fields }
}

async function writeDerivedArtifact(input: {
  workspaceRoot: string
  operation: string
  format: DatasetProcessingFormat | 'report'
  outputFileName: string
  data: Buffer
  parents: Array<{ path: string; sha256: string }>
  parameters: Record<string, unknown>
  summary: Record<string, unknown>
  records?: number
  origins?: DatasetOrigin[]
}): Promise<ArtifactManifest & { reused: boolean }> {
  const outputName = safeFileName(input.outputFileName)
  const operationHash = fingerprint({
    artifactContractVersion: 2,
    operation: input.operation,
    format: input.format,
    outputName,
    parents: input.parents,
    parameters: input.parameters
  }).slice(0, 16)
  const directory = join(input.workspaceRoot, '.sciforge', 'datasets', 'processed', input.operation)
  const path = join(directory, `${operationHash}-${outputName}`)
  const manifestPath = `${path}.manifest.json`
  await mkdir(directory, { recursive: true })
  const sha256 = hash(input.data)
  let reused = false
  try {
    const existing = await readFile(path)
    if (hash(existing) !== sha256) throw new Error(`Deterministic artifact path collision: ${path}`)
    reused = true
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    await atomicWrite(path, input.data)
  }
  const manifest: ArtifactManifest = {
    version: 2,
    artifactId: `sha256:${sha256}`,
    operation: input.operation,
    format: input.format,
    path,
    manifestPath,
    sha256,
    bytes: input.data.byteLength,
    ...(input.records !== undefined ? { records: input.records } : {}),
    parents: input.parents,
    parameters: input.parameters,
    summary: input.summary,
    schema: inferArtifactSchema(input.data, input.format),
    origins: deduplicateOrigins([
      ...await collectParentOrigins(input.parents),
      ...(input.origins ?? [])
    ]),
    createdAt: new Date().toISOString()
  }
  await writeIdempotentJson(manifestPath, manifest)
  return { ...manifest, reused }
}

async function describeStandaloneArtifact(
  path: string,
  format: 'plan' | 'publication',
  operation: string,
  parameters: Record<string, unknown>,
  summary: Record<string, unknown>
): Promise<ArtifactManifest> {
  const bytes = await readFile(path)
  const manifestPath = `${path}.manifest.json`
  const manifest: ArtifactManifest = {
    version: 1,
    artifactId: `sha256:${hash(bytes)}`,
    operation,
    format,
    path,
    manifestPath,
    sha256: hash(bytes),
    bytes: bytes.byteLength,
    parents: [],
    parameters,
    summary,
    createdAt: new Date().toISOString()
  }
  await writeIdempotentJson(manifestPath, manifest)
  return manifest
}

async function readArtifactManifest(artifactPath: string): Promise<ArtifactManifest | null> {
  try {
    return JSON.parse(await readFile(`${artifactPath}.manifest.json`, 'utf8')) as ArtifactManifest
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function writeIdempotentJson(path: string, value: unknown): Promise<void> {
  const bytes = jsonBytes(value)
  await mkdir(resolve(path, '..'), { recursive: true })
  try {
    const existing = await readFile(path)
    const stableExisting = stableJsonWithoutTimestamps(JSON.parse(existing.toString('utf8')) as unknown)
    const stableNext = stableJsonWithoutTimestamps(value)
    if (canonicalJson(stableExisting) !== canonicalJson(stableNext)) {
      throw new Error(`Refusing to overwrite a different dataset artifact: ${path}`)
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    await atomicWrite(path, bytes)
  }
}

async function atomicWrite(path: string, bytes: Buffer): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, bytes, { flag: 'wx' })
  try {
    await link(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function copyIdempotent(source: string, target: string, expectedHash: string): Promise<void> {
  try {
    const existing = await readFile(target)
    if (hash(existing) !== expectedHash) throw new Error(`Published artifact collision: ${target}`)
  } catch (error) {
    if (!isMissingFileError(error)) throw error
    await copyFile(source, target, constants.COPYFILE_EXCL)
  }
}

function mergedPublishedSchema(artifacts: Array<{
  operation?: string
  format?: string
  records?: number
  summary?: Record<string, unknown>
  schema?: Record<string, unknown>
  schemaFields?: unknown[]
}>) {
  return {
    version: 1,
    artifacts: artifacts.map((artifact) => ({
      operation: artifact.operation ?? 'external',
      format: artifact.format ?? 'unknown',
      records: artifact.records,
      fields: artifact.schemaFields
        ?? (Array.isArray(artifact.schema?.fields) ? artifact.schema.fields : undefined)
        ?? (Array.isArray(artifact.summary?.fields) ? artifact.summary.fields : undefined)
    }))
  }
}

function isConcreteFormat(value: string): value is DatasetProcessingFormat {
  return ['json', 'jsonl', 'csv', 'tsv', 'fasta'].includes(value)
}

function publishedQualitySummary(artifacts: Array<{
  operation?: string
  records?: number
  summary?: Record<string, unknown>
}>) {
  const validationReports = artifacts.filter((artifact) => artifact.operation === 'dataset_validate')
  const validations = validationReports.map((artifact) => ({
    valid: artifact.summary?.valid === true,
    errorCount: Number(artifact.summary?.errorCount ?? 0),
    warningCount: Number(artifact.summary?.warningCount ?? 0),
    records: Number(artifact.summary?.records ?? artifact.records ?? 0)
  }))
  return {
    artifactCount: artifacts.length,
    validationReportCount: validationReports.length,
    recordCounts: artifacts.flatMap((artifact) => artifact.records === undefined ? [] : [artifact.records]),
    validations,
    status: validations.length === 0
      ? 'validation-not-included'
      : validations.every((validation) => validation.valid) ? 'passed' : 'failed'
  }
}

function processingParameters(input: object, omitted: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !omitted.includes(key)))
}

function safeFileName(value: string): string {
  const normalized = value.trim()
  if (!normalized || basename(normalized) !== normalized || normalized === '.' || normalized === '..') {
    throw new Error('Dataset outputFileName must be one safe file name without path separators.')
  }
  return normalized
}

function safeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) throw new Error(`Invalid dataset identifier: ${value}`)
  return value
}

function providerDatabaseSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safeId(slug)
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

function fingerprint(value: unknown): string {
  return hash(Buffer.from(canonicalJson(value)))
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}

function stableJsonWithoutTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonWithoutTimestamps)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'createdAt')
    .map(([key, entry]) => [key, stableJsonWithoutTimestamps(entry)]))
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function valueType(value: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
