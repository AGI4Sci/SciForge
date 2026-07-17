import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  datasetDeduplicateInputSchema,
  datasetFilterInputSchema,
  datasetPreparePlanInputSchema,
  datasetProfileInputSchema,
  datasetPublishInputSchema,
  datasetSelectColumnsInputSchema,
  datasetValidateInputSchema,
  type DatasetDeduplicateInput,
  type DatasetFilterInput,
  type DatasetPreparePlanInput,
  type DatasetProcessingFormat,
  type DatasetProfileInput,
  type DatasetPublishInput,
  type DatasetSelectColumnsInput,
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

type ArtifactManifest = {
  version: 1
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
  createdAt: string
}

const DEFAULT_MAX_PROCESSING_BYTES = 64 * 1024 * 1024

export type DatasetProcessingService = ReturnType<typeof createDatasetProcessingService>

export function createDatasetProcessingService(options: { workspaceRoot?: string } = {}) {
  const defaultWorkspaceRoot = options.workspaceRoot?.trim()

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
          ...(sidecar ? {
            operation: sidecar.operation,
            format: sidecar.format,
            records: sidecar.records,
            summary: sidecar.summary,
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

function serializeDataset(rows: DatasetRow[], format: DatasetProcessingFormat): Buffer {
  if (format === 'json') return jsonBytes(rows)
  if (format === 'jsonl') return Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`)
  if (format === 'csv' || format === 'tsv') return Buffer.from(serializeDelimited(rows, format === 'csv' ? ',' : '\t'))
  return Buffer.from(serializeFasta(rows))
}

function serializeDelimited(rows: DatasetRow[], delimiter: string): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
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
  if (operation && !plan.operations?.some((candidate) => candidate.tool === operation)) {
    throw new Error(`Preparation plan '${planId}' does not authorize operation '${operation}'.`)
  }
  return { path, plan }
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
}): Promise<ArtifactManifest & { reused: boolean }> {
  const outputName = safeFileName(input.outputFileName)
  const operationHash = fingerprint({
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
    version: 1,
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
  schemaFields?: unknown[]
}>) {
  return {
    version: 1,
    artifacts: artifacts.map((artifact) => ({
      operation: artifact.operation ?? 'external',
      format: artifact.format ?? 'unknown',
      records: artifact.records,
      fields: artifact.schemaFields ?? (Array.isArray(artifact.summary?.fields) ? artifact.summary.fields : undefined)
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
