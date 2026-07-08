import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_SEQUENCE_ACTIONS,
  WORKSPACE_SEQUENCE_CONTRACT_VERSION,
  WORKSPACE_SEQUENCE_MAX_ID_CHARS,
  WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES,
  WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS,
  WORKSPACE_SEQUENCE_MAX_REGION_ITEMS,
  WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_SEQUENCE_MAX_WARNINGS,
  WORKSPACE_SEQUENCE_PLUGIN_ID,
  workspaceSequencePreviewResultSchema,
  workspaceSequenceRegionSelectionInputSchema,
  workspaceSequenceRegionSelectionResultSchema,
  workspaceSequenceSearchInputSchema,
  workspaceSequenceSearchResultSchema,
  type NormalizedWorkspaceSequencePreviewInput,
  type NormalizedWorkspaceSequenceRegionSelectionInput,
  type NormalizedWorkspaceSequenceSearchInput,
  type WorkspaceSequenceAlphabet,
  type WorkspaceSequenceFeatureSummary,
  type WorkspaceSequenceIndexedRange,
  type WorkspaceSequenceObservation,
  type WorkspaceSequencePreviewResult,
  type WorkspaceSequenceRecordSummary,
  type WorkspaceSequenceReferenceSummary,
  type WorkspaceSequenceRegionSelectionInput,
  type WorkspaceSequenceRegionSelectionResult,
  type WorkspaceSequenceRegionSummary,
  type WorkspaceSequenceResolvedFormat,
  type WorkspaceSequenceSearchInput,
  type WorkspaceSequenceSearchMatch,
  type WorkspaceSequenceSearchResult,
  type WorkspaceSequenceSearchScope,
  type WorkspaceSequenceSelection,
  type WorkspaceSequenceVariantSummary,
  type WorkspaceSequenceVariantType
} from './contract.js'

type MutableReferenceSummary = {
  id: string
  sequenceLength?: number
  featureCount: number
  intervalCount: number
  variantCount: number
  indexedRange?: WorkspaceSequenceIndexedRange
  regionStart?: number
  regionEnd?: number
  rangeCount: number
}

type ParsedSequenceText = {
  sequenceCount: number
  totalLength: number
  lengths: number[]
  alphabet: WorkspaceSequenceAlphabet
  readCount?: number
  featureCount?: number
  intervalCount?: number
  variantCount?: number
  sampleCount?: number
  records: WorkspaceSequenceRecordSummary[]
  references: WorkspaceSequenceReferenceSummary[]
  features: WorkspaceSequenceFeatureSummary[]
  variants: WorkspaceSequenceVariantSummary[]
  indexedRanges: WorkspaceSequenceIndexedRange[]
  regionSummary: WorkspaceSequenceRegionSummary[]
  truncatedRecords: boolean
  truncatedReferences: boolean
  warnings: string[]
}

type SequenceStatsAccumulator = {
  sequenceCount: number
  totalLength: number
  lengths: number[]
  letterCounts: Map<string, number>
  records: WorkspaceSequenceRecordSummary[]
  truncatedRecords: boolean
}

type AddedSequenceRecord = {
  id: string
  length: number
  indexedRange: WorkspaceSequenceIndexedRange
}

type ObservationBuildInput = ParsedSequenceText & {
  input: NormalizedWorkspaceSequencePreviewInput
  format: WorkspaceSequenceResolvedFormat
  minLength?: number
  maxLength?: number
  averageLength?: number
}

type ConcreteSearchScope = Exclude<WorkspaceSequenceSearchScope, 'all'>
type SelectableSearchMatch = WorkspaceSequenceSearchMatch & {
  start: number
  end: number
}

const SUPPORTED_EXTENSIONS: Record<string, WorkspaceSequenceResolvedFormat> = {
  '.fasta': 'fasta',
  '.fa': 'fasta',
  '.fastq': 'fastq',
  '.fq': 'fastq',
  '.gb': 'genbank',
  '.gbk': 'genbank',
  '.gff': 'gff',
  '.gff3': 'gff',
  '.gtf': 'gtf',
  '.bed': 'bed',
  '.vcf': 'vcf'
}

const DNA_CHARS = new Set('ACGTRYSWKMBDHVN'.split(''))
const RNA_CHARS = new Set('ACGURYSWKMBDHVN'.split(''))
const PROTEIN_CHARS = new Set('ABCDEFGHIKLMNPQRSTVWXYZ*'.split(''))
const PROTEIN_ONLY_CHARS = new Set('EFILPQZJO'.split(''))
const ALL_SEARCH_SCOPES: ConcreteSearchScope[] = ['records', 'references', 'features', 'variants', 'ranges']

export function createWorkspaceSequencePreview(
  input: NormalizedWorkspaceSequencePreviewInput
): WorkspaceSequencePreviewResult {
  const format = resolveSequenceFormat(input)
  const parsed = parseSequenceText(input.text, format, input.maxRecords, input.maxReferences)
  const stats = summarizeLengths(parsed.lengths)
  const warnings = boundedWarnings([
    ...parsed.warnings,
    ...(parsed.truncatedRecords ? [`Preview includes ${parsed.records.length} bounded examples from ${parsed.sequenceCount || parsed.featureCount || parsed.variantCount || parsed.intervalCount || 0} parsed items.`] : []),
    ...(parsed.truncatedReferences ? [`Reference summary includes ${parsed.references.length} references; additional references were omitted.`] : [])
  ])

  return workspaceSequencePreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_SEQUENCE_CONTRACT_VERSION,
    format,
    sequenceCount: parsed.sequenceCount,
    totalLength: parsed.totalLength,
    ...(stats.minLength !== undefined ? { minLength: stats.minLength } : {}),
    ...(stats.maxLength !== undefined ? { maxLength: stats.maxLength } : {}),
    ...(stats.averageLength !== undefined ? { averageLength: stats.averageLength } : {}),
    alphabet: parsed.alphabet,
    ...(parsed.readCount !== undefined ? { readCount: parsed.readCount } : {}),
    ...(parsed.featureCount !== undefined ? { featureCount: parsed.featureCount } : {}),
    ...(parsed.intervalCount !== undefined ? { intervalCount: parsed.intervalCount } : {}),
    ...(parsed.variantCount !== undefined ? { variantCount: parsed.variantCount } : {}),
    ...(parsed.sampleCount !== undefined ? { sampleCount: parsed.sampleCount } : {}),
    records: parsed.records,
    references: parsed.references,
    features: parsed.features,
    variants: parsed.variants,
    indexedRanges: parsed.indexedRanges,
    regionSummary: parsed.regionSummary,
    truncatedRecords: parsed.truncatedRecords,
    truncatedReferences: parsed.truncatedReferences,
    warnings,
    ...(input.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            ...parsed,
            warnings,
            ...stats,
            input,
            format
          })
        }
      : {})
  })
}

export function resolveSequenceFormat(input: NormalizedWorkspaceSequencePreviewInput): WorkspaceSequenceResolvedFormat {
  if (input.format !== 'auto') return input.format

  const extension = extensionForPath(input.path)
  const formatFromPath = extension ? SUPPORTED_EXTENSIONS[extension] : undefined
  if (formatFromPath) return formatFromPath

  return detectSequenceFormat(input.text)
}

export function detectSequenceFormat(text: string): WorkspaceSequenceResolvedFormat {
  const trimmed = stripBom(text).trimStart()
  if (trimmed.startsWith('>')) return 'fasta'
  if (looksLikeFastq(trimmed)) return 'fastq'
  if (/^LOCUS\s+/m.test(trimmed) || /\nORIGIN\s*\n/i.test(trimmed)) return 'genbank'
  if (/^##fileformat=VCF\b/m.test(trimmed) || /^#CHROM\tPOS\tID\tREF\tALT\b/m.test(trimmed)) return 'vcf'

  const firstDataLine = trimmed.split(/\r?\n/).find((line) => {
    const candidate = line.trim()
    return candidate.length > 0 && !candidate.startsWith('#') && !candidate.startsWith('track ') && !candidate.startsWith('browser ')
  })
  if (!firstDataLine) return 'fasta'

  const tabFields = firstDataLine.split('\t')
  if (tabFields.length >= 9) {
    return /\bgene_id\s+"|transcript_id\s+"/.test(tabFields[8] ?? '') ? 'gtf' : 'gff'
  }
  if (tabFields.length >= 3 && isIntegerText(tabFields[1] ?? '') && isIntegerText(tabFields[2] ?? '')) return 'bed'

  return 'fasta'
}

export function selectWorkspaceSequenceRegion(
  input: WorkspaceSequenceRegionSelectionInput
): WorkspaceSequenceRegionSelectionResult {
  const normalized = workspaceSequenceRegionSelectionInputSchema.parse(input)
  if (normalized.end < normalized.start) {
    throw new RangeError(`Cannot select ${normalized.reference}:${normalized.start}-${normalized.end}; end must be greater than or equal to start.`)
  }

  return workspaceSequenceRegionSelectionResultSchema.parse(buildRegionSelection(normalized))
}

export function searchWorkspaceSequencePreview(
  input: WorkspaceSequenceSearchInput
): WorkspaceSequenceSearchResult {
  const normalized = workspaceSequenceSearchInputSchema.parse(input)
  return workspaceSequenceSearchResultSchema.parse(buildSearchResult(normalized))
}

function parseSequenceText(
  text: string,
  format: WorkspaceSequenceResolvedFormat,
  maxRecords: number,
  maxReferences: number
): ParsedSequenceText {
  switch (format) {
    case 'fasta':
      return parseFasta(text, maxRecords, maxReferences)
    case 'fastq':
      return parseFastq(text, maxRecords, maxReferences)
    case 'genbank':
      return parseGenBank(text, maxRecords, maxReferences)
    case 'gff':
      return parseFeatureTable(text, 'gff', maxRecords, maxReferences)
    case 'gtf':
      return parseFeatureTable(text, 'gtf', maxRecords, maxReferences)
    case 'bed':
      return parseBed(text, maxRecords, maxReferences)
    case 'vcf':
      return parseVcf(text, maxRecords, maxReferences)
  }
}

function parseFasta(text: string, maxRecords: number, maxReferences: number): ParsedSequenceText {
  const stats = createStatsAccumulator()
  const references = new ReferenceAccumulator(maxReferences)
  const warnings: string[] = []
  let currentHeader: string | undefined
  let sequenceChunks: string[] = []
  let anonymousCount = 0

  const flush = (): void => {
    if (currentHeader === undefined && sequenceChunks.length === 0) return
    const header = currentHeader ?? `sequence-${anonymousCount}`
    const record = addSequenceRecord(stats, header, sequenceChunks.join(''), maxRecords, 'sequence')
    references.recordIndexedRange(record.id, record.indexedRange, { sequenceLength: record.length })
    currentHeader = undefined
    sequenceChunks = []
  }

  for (const line of stripBom(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) continue
    if (trimmed.startsWith('>')) {
      flush()
      currentHeader = trimmed.slice(1).trim() || `sequence-${stats.sequenceCount + 1}`
      continue
    }
    if (currentHeader === undefined && sequenceChunks.length === 0) {
      anonymousCount += 1
      warnings.push('FASTA sequence data appeared before a header; created an anonymous sequence record.')
    }
    sequenceChunks.push(trimmed)
  }
  flush()
  const referenceSummaries = references.toSummaries()

  return finalizeSequenceStats(stats, {
    featureCount: undefined,
    intervalCount: undefined,
    variantCount: undefined,
    sampleCount: undefined,
    references: referenceSummaries,
    features: [],
    variants: [],
    indexedRanges: buildIndexedRanges(referenceSummaries, [], []),
    regionSummary: references.toRegionSummaries(),
    truncatedReferences: references.truncated,
    warnings
  })
}

function parseFastq(text: string, maxRecords: number, maxReferences: number): ParsedSequenceText {
  const stats = createStatsAccumulator()
  const references = new ReferenceAccumulator(maxReferences)
  const warnings: string[] = []
  const lines = stripBom(text).split(/\r?\n/)

  for (let index = 0; index < lines.length;) {
    const header = lines[index]?.trim() ?? ''
    if (!header) {
      index += 1
      continue
    }
    if (!header.startsWith('@')) {
      warnings.push(`Skipped FASTQ line ${index + 1}; expected a read header starting with @.`)
      index += 1
      continue
    }

    const sequenceLine = lines[index + 1]
    const plusLine = lines[index + 2]?.trim()
    const qualityLine = lines[index + 3]
    if (sequenceLine === undefined || plusLine === undefined || qualityLine === undefined) {
      warnings.push(`FASTQ read starting at line ${index + 1} is incomplete; parsed preceding reads only.`)
      break
    }
    if (!plusLine.startsWith('+')) {
      warnings.push(`FASTQ read ${header.slice(1).trim() || stats.sequenceCount + 1} has a non-standard plus line.`)
    }

    const normalizedSequence = normalizeSequence(sequenceLine)
    const qualityLength = qualityLine.trim().length
    if (qualityLength !== normalizedSequence.length) {
      warnings.push(`FASTQ read ${header.slice(1).trim() || stats.sequenceCount + 1} has sequence length ${normalizedSequence.length} but quality length ${qualityLength}.`)
    }
    const record = addSequenceRecord(stats, header.slice(1).trim() || `read-${stats.sequenceCount + 1}`, normalizedSequence, maxRecords, 'read')
    references.recordIndexedRange(record.id, record.indexedRange, { sequenceLength: record.length })
    index += 4
  }
  const referenceSummaries = references.toSummaries()

  return finalizeSequenceStats(stats, {
    readCount: stats.sequenceCount,
    featureCount: undefined,
    intervalCount: undefined,
    variantCount: undefined,
    sampleCount: undefined,
    references: referenceSummaries,
    features: [],
    variants: [],
    indexedRanges: buildIndexedRanges(referenceSummaries, [], []),
    regionSummary: references.toRegionSummaries(),
    truncatedReferences: references.truncated,
    warnings
  })
}

function parseGenBank(text: string, maxRecords: number, maxReferences: number): ParsedSequenceText {
  const stats = createStatsAccumulator()
  const references = new ReferenceAccumulator(maxReferences)
  const features: WorkspaceSequenceFeatureSummary[] = []
  const warnings: string[] = []
  let featureCount = 0
  let intervalCount = 0
  let current: {
    id: string
    locusLength?: number
    featureCount: number
    intervalCount: number
    sequenceChunks: string[]
    inFeatures: boolean
    inOrigin: boolean
  } | undefined

  const flush = (): void => {
    if (!current) return
    const sequence = current.sequenceChunks.join('')
    const fallbackLength = current.locusLength ?? 0
    const record = addSequenceRecord(stats, current.id, sequence, maxRecords, 'reference', fallbackLength)
    const reference = references.ensure(current.id)
    references.recordIndexedRange(current.id, record.indexedRange, { sequenceLength: sequence.length || fallbackLength })
    reference.featureCount += current.featureCount
    reference.intervalCount += current.intervalCount
    current = undefined
  }

  for (const line of stripBom(text).split(/\r?\n/)) {
    const locusMatch = /^LOCUS\s+(\S+)(?:\s+(\d+))?/i.exec(line)
    if (locusMatch) {
      flush()
      current = {
        id: truncateId(locusMatch[1] ?? `record-${stats.sequenceCount + 1}`),
        locusLength: parseInteger(locusMatch[2]),
        featureCount: 0,
        intervalCount: 0,
        sequenceChunks: [],
        inFeatures: false,
        inOrigin: false
      }
      continue
    }
    if (!current) continue

    if (/^FEATURES\b/i.test(line)) {
      current.inFeatures = true
      current.inOrigin = false
      continue
    }
    if (/^ORIGIN\b/i.test(line)) {
      current.inFeatures = false
      current.inOrigin = true
      continue
    }
    if (line.trim() === '//') {
      flush()
      continue
    }
    const featureMatch = current.inFeatures ? /^\s{5}([A-Za-z][A-Za-z0-9_'-]*)\s+(.+?)\s*$/.exec(line) : undefined
    if (featureMatch) {
      const type = truncateType(featureMatch[1] ?? 'feature')
      const location = parseGenBankLocation(featureMatch[2] ?? '')
      current.featureCount += 1
      featureCount += 1
      if (location) {
        current.intervalCount += 1
        intervalCount += 1
        const id = truncateId(`${type}-${current.featureCount}`)
        const indexedRange = createIndexedRange({
          kind: 'feature',
          reference: current.id,
          start: location.start,
          end: location.end,
          id,
          type,
          strand: location.strand
        })
        references.recordIndexedRange(current.id, indexedRange)
        if (features.length < maxRecords) {
          features.push({
            id,
            reference: current.id,
            type,
            start: location.start,
            end: location.end,
            ...(location.strand ? { strand: location.strand } : {}),
            indexedRange
          })
        }
      }
      continue
    }
    if (current.inOrigin) {
      const sequence = line.replace(/[^A-Za-z]/g, '')
      if (sequence) current.sequenceChunks.push(sequence)
    }
  }
  flush()

  if (stats.sequenceCount === 0 && text.trim()) {
    warnings.push('No GenBank LOCUS records were found.')
  }

  return finalizeSequenceStats(stats, {
    featureCount,
    intervalCount,
    variantCount: undefined,
    sampleCount: undefined,
    references: references.toSummaries(),
    features,
    variants: [],
    indexedRanges: buildIndexedRanges(references.toSummaries(), features, []),
    regionSummary: references.toRegionSummaries(),
    truncatedReferences: references.truncated,
    warnings
  })
}

function parseFeatureTable(
  text: string,
  format: 'gff' | 'gtf',
  maxRecords: number,
  maxReferences: number
): ParsedSequenceText {
  const references = new ReferenceAccumulator(maxReferences)
  const features: WorkspaceSequenceFeatureSummary[] = []
  const warnings: string[] = []
  let featureCount = 0
  let malformedCount = 0

  for (const line of stripBom(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const fields = line.split('\t')
    if (fields.length < 9) {
      malformedCount += 1
      continue
    }

    const referenceId = truncateId(fields[0] || 'reference')
    const type = fields[2]?.trim() || 'feature'
    const start = parseInteger(fields[3])
    const end = parseInteger(fields[4])
    if (start === undefined || end === undefined) {
      malformedCount += 1
      continue
    }

    const normalizedStart = Math.max(0, start - 1)
    const normalizedEnd = Math.max(normalizedStart, end)
    const strand = normalizeStrand(fields[6])
    const id = format === 'gtf' ? idFromGtfAttributes(fields[8] ?? '') : idFromGffAttributes(fields[8] ?? '')
    featureCount += 1

    const reference = references.ensure(referenceId)
    reference.featureCount += 1
    reference.intervalCount += 1
    const indexedRange = createIndexedRange({
      kind: 'feature',
      reference: referenceId,
      start: normalizedStart,
      end: normalizedEnd,
      id,
      type: truncateType(type),
      strand
    })
    references.recordIndexedRange(referenceId, indexedRange)
    if (features.length < maxRecords) {
      features.push({
        ...(id ? { id } : {}),
        reference: referenceId,
        type: truncateType(type),
        start: normalizedStart,
        end: normalizedEnd,
        ...(strand ? { strand } : {}),
        indexedRange
      })
    }
  }

  if (malformedCount > 0) {
    warnings.push(`Skipped ${malformedCount} malformed ${format.toUpperCase()} feature rows.`)
  }

  const referenceSummaries = references.toSummaries()
  return {
    sequenceCount: references.totalCount,
    totalLength: 0,
    lengths: [],
    alphabet: 'unknown',
    featureCount,
    intervalCount: featureCount,
    records: [],
    references: referenceSummaries,
    features,
    variants: [],
    indexedRanges: buildIndexedRanges(referenceSummaries, features, []),
    regionSummary: references.toRegionSummaries(),
    truncatedRecords: featureCount > features.length,
    truncatedReferences: references.truncated,
    warnings
  }
}

function parseBed(text: string, maxRecords: number, maxReferences: number): ParsedSequenceText {
  const references = new ReferenceAccumulator(maxReferences)
  const features: WorkspaceSequenceFeatureSummary[] = []
  const warnings: string[] = []
  let intervalCount = 0
  let malformedCount = 0

  for (const line of stripBom(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('track ') || trimmed.startsWith('browser ')) continue

    const fields = trimmed.split(/\s+/)
    if (fields.length < 3) {
      malformedCount += 1
      continue
    }

    const referenceId = truncateId(fields[0] || 'reference')
    const start = parseInteger(fields[1])
    const end = parseInteger(fields[2])
    if (start === undefined || end === undefined) {
      malformedCount += 1
      continue
    }

    const normalizedStart = Math.max(0, start)
    const normalizedEnd = Math.max(normalizedStart, end)
    const id = fields[3] ? truncateId(fields[3]) : undefined
    intervalCount += 1

    const reference = references.ensure(referenceId)
    reference.intervalCount += 1
    const indexedRange = createIndexedRange({
      kind: 'interval',
      reference: referenceId,
      start: normalizedStart,
      end: normalizedEnd,
      id,
      type: 'interval'
    })
    references.recordIndexedRange(referenceId, indexedRange)
    if (features.length < maxRecords) {
      features.push({
        ...(id ? { id } : {}),
        reference: referenceId,
        type: 'interval',
        start: normalizedStart,
        end: normalizedEnd,
        indexedRange
      })
    }
  }

  if (malformedCount > 0) {
    warnings.push(`Skipped ${malformedCount} malformed BED interval rows.`)
  }

  return {
    sequenceCount: references.totalCount,
    totalLength: 0,
    lengths: [],
    alphabet: 'unknown',
    intervalCount,
    records: [],
    references: references.toSummaries(),
    features,
    variants: [],
    indexedRanges: buildIndexedRanges(references.toSummaries(), features, []),
    regionSummary: references.toRegionSummaries(),
    truncatedRecords: intervalCount > features.length,
    truncatedReferences: references.truncated,
    warnings
  }
}

function parseVcf(text: string, maxRecords: number, maxReferences: number): ParsedSequenceText {
  const references = new ReferenceAccumulator(maxReferences)
  const variants: WorkspaceSequenceVariantSummary[] = []
  const features: WorkspaceSequenceFeatureSummary[] = []
  const warnings: string[] = []
  let variantCount = 0
  let sampleCount = 0
  let malformedCount = 0

  for (const line of stripBom(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('##contig=')) {
      const contig = parseVcfContig(trimmed)
      if (contig) {
        const reference = references.ensure(contig.id)
        if (contig.length !== undefined) {
          const indexedRange = createIndexedRange({
            kind: 'reference',
            reference: contig.id,
            start: 0,
            end: contig.length,
            id: contig.id,
            type: 'contig'
          })
          reference.sequenceLength = contig.length
          references.recordIndexedRange(contig.id, indexedRange, { sequenceLength: contig.length })
        }
      }
      continue
    }
    if (trimmed.startsWith('#CHROM')) {
      const fields = trimmed.split('\t')
      sampleCount = Math.max(0, fields.length - 9)
      continue
    }
    if (trimmed.startsWith('#')) continue

    const fields = line.split('\t')
    if (fields.length < 8) {
      malformedCount += 1
      continue
    }

    const referenceId = truncateId(fields[0] || 'reference')
    const position = parseInteger(fields[1])
    const ref = (fields[3] ?? '').trim()
    const alts = (fields[4] ?? '').split(',').map((alt) => alt.trim()).filter(Boolean)
    if (position === undefined || !ref || alts.length === 0) {
      malformedCount += 1
      continue
    }

    const zeroBasedPosition = Math.max(0, position - 1)
    const type = inferVariantType(ref, alts)
    const id = fields[2] && fields[2] !== '.' ? truncateId(fields[2]) : undefined
    const variantEnd = Math.max(zeroBasedPosition + 1, zeroBasedPosition + ref.length)
    const indexedRange = createIndexedRange({
      kind: 'variant',
      reference: referenceId,
      start: zeroBasedPosition,
      end: variantEnd,
      id,
      type: `variant:${type}`
    })
    variantCount += 1

    const reference = references.ensure(referenceId)
    reference.variantCount += 1
    references.recordIndexedRange(referenceId, indexedRange)
    if (variants.length < maxRecords) {
      variants.push({
        ...(id ? { id } : {}),
        reference: referenceId,
        position: zeroBasedPosition,
        ref: truncateText(ref, 512),
        alt: alts.map((alt) => truncateText(alt, 512)).slice(0, 128),
        type,
        indexedRange
      })
    }
    if (features.length < maxRecords) {
      features.push({
        ...(id ? { id } : {}),
        reference: referenceId,
        type: `variant:${type}`,
        start: zeroBasedPosition,
        end: variantEnd,
        indexedRange
      })
    }
  }

  if (malformedCount > 0) {
    warnings.push(`Skipped ${malformedCount} malformed VCF variant rows.`)
  }

  const referenceSummaries = references.toSummaries()
  const totalLength = referenceSummaries.reduce((sum, reference) => sum + (reference.sequenceLength ?? 0), 0)
  return {
    sequenceCount: references.totalCount,
    totalLength,
    lengths: referenceSummaries.flatMap((reference) => reference.sequenceLength === undefined ? [] : [reference.sequenceLength]),
    alphabet: 'dna',
    sampleCount,
    variantCount,
    records: [],
    references: referenceSummaries,
    features,
    variants,
    indexedRanges: buildIndexedRanges(referenceSummaries, features, variants),
    regionSummary: references.toRegionSummaries(),
    truncatedRecords: variantCount > variants.length,
    truncatedReferences: references.truncated,
    warnings
  }
}

function createStatsAccumulator(): SequenceStatsAccumulator {
  return {
    sequenceCount: 0,
    totalLength: 0,
    lengths: [],
    letterCounts: new Map<string, number>(),
    records: [],
    truncatedRecords: false
  }
}

function addSequenceRecord(
  stats: SequenceStatsAccumulator,
  header: string,
  rawSequence: string,
  maxRecords: number,
  rangeKind: 'reference' | 'sequence' | 'read' = 'sequence',
  knownLength?: number
): AddedSequenceRecord {
  const sequence = normalizeSequence(rawSequence)
  const length = knownLength ?? sequence.length
  const { id, description } = parseRecordHeader(header, stats.sequenceCount + 1)
  const indexedRange = createIndexedRange({
    kind: rangeKind,
    reference: id,
    start: 0,
    end: length,
    id,
    type: rangeKind
  })
  stats.sequenceCount += 1
  stats.totalLength += length
  stats.lengths.push(length)
  addLetters(stats.letterCounts, sequence)

  if (stats.records.length < maxRecords) {
    const alphabet = detectAlphabet(sequence)
    const gc = gcContent(sequence, alphabet)
    stats.records.push({
      id,
      ...(description ? { description } : {}),
      length,
      alphabet,
      ...(gc !== undefined ? { gcContent: gc } : {}),
      ...(sequence ? { preview: truncateText(sequence, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS) } : {})
    })
  } else {
    stats.truncatedRecords = true
  }

  return { id, length, indexedRange }
}

function finalizeSequenceStats(
  stats: SequenceStatsAccumulator,
  extra: Omit<ParsedSequenceText, 'sequenceCount' | 'totalLength' | 'lengths' | 'alphabet' | 'records' | 'truncatedRecords'>
): ParsedSequenceText {
  return {
    sequenceCount: stats.sequenceCount,
    totalLength: stats.totalLength,
    lengths: stats.lengths,
    alphabet: detectAlphabetFromCounts(stats.letterCounts),
    records: stats.records,
    truncatedRecords: stats.truncatedRecords,
    ...extra
  }
}

class ReferenceAccumulator {
  readonly #map = new Map<string, MutableReferenceSummary>()
  readonly #allIds = new Set<string>()

  constructor(private readonly limit: number) {}

  get totalCount(): number {
    return this.#allIds.size
  }

  get truncated(): boolean {
    return this.#allIds.size > this.#map.size
  }

  ensure(rawId: string): MutableReferenceSummary {
    const id = truncateId(rawId || 'reference')
    this.#allIds.add(id)
    const existing = this.#map.get(id)
    if (existing) return existing

    const summary: MutableReferenceSummary = {
      id,
      featureCount: 0,
      intervalCount: 0,
      variantCount: 0,
      rangeCount: 0
    }
    if (this.#map.size < this.limit) {
      this.#map.set(id, summary)
      return summary
    }
    return summary
  }

  recordIndexedRange(
    rawId: string,
    range: WorkspaceSequenceIndexedRange,
    options: { sequenceLength?: number } = {}
  ): void {
    const reference = this.ensure(rawId)
    if (options.sequenceLength !== undefined) {
      reference.sequenceLength = Math.max(reference.sequenceLength ?? 0, options.sequenceLength)
    }
    if (!this.#map.has(reference.id)) return

    reference.rangeCount += 1
    reference.regionStart = reference.regionStart === undefined
      ? range.start
      : Math.min(reference.regionStart, range.start)
    reference.regionEnd = reference.regionEnd === undefined
      ? range.end
      : Math.max(reference.regionEnd, range.end)
    if (isReferenceLikeRange(range.kind)) {
      reference.indexedRange = range
    }
  }

  values(): MutableReferenceSummary[] {
    return [...this.#map.values()]
  }

  toSummaries(): WorkspaceSequenceReferenceSummary[] {
    return this.values().map((reference) => ({
      id: reference.id,
      ...(reference.sequenceLength !== undefined ? { sequenceLength: reference.sequenceLength } : {}),
      ...(reference.featureCount > 0 ? { featureCount: reference.featureCount } : {}),
      ...(reference.intervalCount > 0 ? { intervalCount: reference.intervalCount } : {}),
      ...(reference.variantCount > 0 ? { variantCount: reference.variantCount } : {}),
      ...(reference.indexedRange
        ? { indexedRange: reference.indexedRange }
        : reference.regionStart !== undefined && reference.regionEnd !== undefined
          ? {
              indexedRange: createIndexedRange({
                kind: 'reference',
                reference: reference.id,
                start: reference.regionStart,
                end: reference.regionEnd,
                id: reference.id,
                type: 'reference'
              })
            }
          : {})
    }))
  }

  toRegionSummaries(): WorkspaceSequenceRegionSummary[] {
    return this.values().flatMap((reference) => {
      const start = reference.regionStart ?? (reference.sequenceLength !== undefined ? 0 : undefined)
      const end = reference.regionEnd ?? reference.sequenceLength
      if (start === undefined || end === undefined) return []
      return [{
        reference: reference.id,
        start,
        end,
        ...(reference.sequenceLength !== undefined ? { sequenceLength: reference.sequenceLength } : {}),
        rangeCount: Math.max(reference.rangeCount, reference.sequenceLength !== undefined ? 1 : 0),
        ...(reference.featureCount > 0 ? { featureCount: reference.featureCount } : {}),
        ...(reference.intervalCount > 0 ? { intervalCount: reference.intervalCount } : {}),
        ...(reference.variantCount > 0 ? { variantCount: reference.variantCount } : {})
      }]
    })
  }
}

function buildRegionSelection(
  input: NormalizedWorkspaceSequenceRegionSelectionInput
): WorkspaceSequenceRegionSelectionResult {
  const preview = input.preview
  const reference = truncateId(input.reference)
  const referenceSummary = preview.references.find((candidate) => candidate.id === reference)
  const baseRegion = preview.regionSummary.find((candidate) => candidate.reference === reference)
  const selectionRange = createIndexedRange({
    kind: 'reference',
    reference,
    start: input.start,
    end: input.end,
    id: reference,
    type: 'selection',
    strand: input.strand
  })

  const matchingFeatures = preview.features.filter((feature) => !isSyntheticVariantFeature(feature) && rangeOverlapsSelection(indexedRangeForFeature(feature), reference, input.start, input.end))
  const matchingVariants = preview.variants.filter((variant) => rangeOverlapsSelection(indexedRangeForVariant(variant), reference, input.start, input.end))
  const features = matchingFeatures.slice(0, input.maxFeatures)
  const variants = matchingVariants.slice(0, input.maxVariants)
  const indexedRanges = boundedUniqueRanges([
    selectionRange,
    ...features.map(indexedRangeForFeature),
    ...variants.map(indexedRangeForVariant)
  ], WORKSPACE_SEQUENCE_MAX_REGION_ITEMS)

  const knownFeatureTotal = preview.featureCount ?? preview.intervalCount
  const previewMayHaveMoreFeatures = knownFeatureTotal !== undefined && preview.features.length < knownFeatureTotal
  const previewMayHaveMoreVariants = preview.variantCount !== undefined && preview.variants.length < preview.variantCount
  const truncatedFeatures = matchingFeatures.length > features.length || previewMayHaveMoreFeatures
  const truncatedVariants = matchingVariants.length > variants.length || previewMayHaveMoreVariants
  const intervalCount = matchingFeatures.filter((feature) => feature.type === 'interval').length
  const warnings = boundedWarnings([
    ...(!referenceSummary && !baseRegion ? [`Reference ${reference} is not present in the bounded preview summary; returned the requested region with no file IO.`] : []),
    ...(referenceSummary?.sequenceLength !== undefined && input.end > referenceSummary.sequenceLength
      ? [`Requested end ${input.end} exceeds reference ${reference} length ${referenceSummary.sequenceLength}.`]
      : []),
    ...(previewMayHaveMoreFeatures ? ['Feature selection was evaluated against bounded preview ranges; omitted features may also overlap the region.'] : []),
    ...(previewMayHaveMoreVariants ? ['Variant selection was evaluated against bounded preview ranges; omitted variants may also overlap the region.'] : [])
  ])

  const selectionFeatures = [
    ...features.map(selectionFeatureFromFeature),
    ...variants.map(selectionFeatureFromVariant)
  ].slice(0, WORKSPACE_SEQUENCE_MAX_REGION_ITEMS)
  const selection: WorkspaceSequenceSelection = {
    kind: 'sequence',
    sequenceId: reference,
    ranges: [{
      start: input.start,
      end: input.end,
      ...(input.strand ? { strand: input.strand } : {})
    }],
    ...(selectionFeatures.length > 0 ? { features: selectionFeatures } : {})
  }
  const region: WorkspaceSequenceRegionSummary = {
    reference,
    start: input.start,
    end: input.end,
    ...(referenceSummary?.sequenceLength !== undefined
      ? { sequenceLength: referenceSummary.sequenceLength }
      : baseRegion?.sequenceLength !== undefined
        ? { sequenceLength: baseRegion.sequenceLength }
        : {}),
    rangeCount: 1 + matchingFeatures.length + matchingVariants.length,
    ...(matchingFeatures.length > 0 ? { featureCount: matchingFeatures.length } : {}),
    ...(intervalCount > 0 ? { intervalCount } : {}),
    ...(matchingVariants.length > 0 ? { variantCount: matchingVariants.length } : {})
  }

  return {
    ok: true,
    contractVersion: WORKSPACE_SEQUENCE_CONTRACT_VERSION,
    reference,
    start: input.start,
    end: input.end,
    region,
    indexedRanges,
    features,
    variants,
    featureCount: matchingFeatures.length,
    variantCount: matchingVariants.length,
    truncatedFeatures,
    truncatedVariants,
    selection,
    visibleText: buildRegionSelectionVisibleText(reference, input.start, input.end, matchingFeatures.length, matchingVariants.length, warnings),
    warnings
  }
}

function buildSearchResult(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchResult {
  const scopes = concreteSearchScopes(input.scope)
  const allMatches = collectSearchMatches(input, scopes)
  const matches = allMatches.slice(0, input.maxResults)
  const selection = buildSearchSelection(matches)
  const resultTruncated = allMatches.length > matches.length
  const previewTruncated = searchMayMissPreviewItems(input.preview, scopes)
  const sequencePreviewTruncated = searchUsesBoundedRecordPreviews(input.preview, scopes)
  const selectionSpansMultipleReferences = selection === undefined && selectableSearchReferences(matches).size > 1
  const truncated = resultTruncated || previewTruncated || sequencePreviewTruncated
  const warnings = boundedWarnings([
    ...(resultTruncated ? [`Search returned ${matches.length} of ${allMatches.length} bounded matches; increase maxResults to inspect more preview matches.`] : []),
    ...(previewTruncated ? ['Search was evaluated against bounded preview summaries; omitted records, references, features, variants, or ranges may also match.'] : []),
    ...(sequencePreviewTruncated ? ['Motif search was evaluated only against bounded record preview snippets; full sequence content was not loaded.'] : []),
    ...(selectionSpansMultipleReferences ? ['Selection was omitted because returned matches span multiple references.'] : [])
  ])

  return {
    ok: true,
    contractVersion: WORKSPACE_SEQUENCE_CONTRACT_VERSION,
    query: input.query,
    scope: input.scope,
    caseSensitive: input.caseSensitive,
    matchCount: allMatches.length,
    matches,
    ...(selection ? { selection } : {}),
    visibleText: buildSearchVisibleText(input.query, input.scope, allMatches.length, matches, truncated, warnings),
    truncated,
    warnings
  }
}

function concreteSearchScopes(scope: WorkspaceSequenceSearchScope): ConcreteSearchScope[] {
  return scope === 'all' ? ALL_SEARCH_SCOPES : [scope]
}

function collectSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput,
  scopes: ConcreteSearchScope[]
): WorkspaceSequenceSearchMatch[] {
  return scopes.flatMap((scope) => {
    switch (scope) {
      case 'records':
        return collectRecordSearchMatches(input)
      case 'references':
        return collectReferenceSearchMatches(input)
      case 'features':
        return collectFeatureSearchMatches(input)
      case 'variants':
        return collectVariantSearchMatches(input)
      case 'ranges':
        return collectRangeSearchMatches(input)
    }
  })
}

function collectRecordSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchMatch[] {
  const matches: WorkspaceSequenceSearchMatch[] = []
  for (const record of input.preview.records) {
    if (textMatchesAny([record.id, record.description], input.query, input.caseSensitive)) {
      const range = referenceLikeRangeForRecord(input.preview, record.id)
      matches.push({
        kind: 'record',
        reference: record.id,
        start: range?.start ?? 0,
        end: range?.end ?? record.length,
        id: record.id,
        type: 'record',
        preview: recordSearchPreview(record)
      })
    }

    if (!record.preview) continue
    for (const start of findQueryOccurrences(record.preview, input.query, input.caseSensitive)) {
      matches.push({
        kind: 'motif',
        reference: record.id,
        start,
        end: start + input.query.length,
        id: record.id,
        type: 'motif',
        preview: motifSearchPreview(record.preview, start, input.query.length)
      })
    }
  }
  return matches
}

function collectReferenceSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchMatch[] {
  const matches: WorkspaceSequenceSearchMatch[] = []
  for (const reference of input.preview.references) {
    if (!textMatchesAny([reference.id], input.query, input.caseSensitive)) continue
    const coordinates = coordinatesForReference(input.preview, reference)
    matches.push({
      kind: 'reference',
      reference: reference.id,
      ...(coordinates.start !== undefined ? { start: coordinates.start } : {}),
      ...(coordinates.end !== undefined ? { end: coordinates.end } : {}),
      id: reference.id,
      type: coordinates.type ?? 'reference',
      preview: referenceSearchPreview(reference)
    })
  }
  return matches
}

function collectFeatureSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchMatch[] {
  const matches: WorkspaceSequenceSearchMatch[] = []
  for (const feature of input.preview.features) {
    if (!textMatchesAny([feature.id, feature.type, feature.reference], input.query, input.caseSensitive)) continue
    const range = indexedRangeForFeature(feature)
    matches.push({
      kind: 'feature',
      reference: feature.reference,
      start: range.start,
      end: range.end,
      ...(feature.id ? { id: feature.id } : {}),
      type: feature.type,
      preview: featureSearchPreview(feature)
    })
  }
  return matches
}

function collectVariantSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchMatch[] {
  const matches: WorkspaceSequenceSearchMatch[] = []
  for (const variant of input.preview.variants) {
    if (!textMatchesAny([variant.id, variant.reference, variant.ref, ...variant.alt, variant.type], input.query, input.caseSensitive)) continue
    const range = indexedRangeForVariant(variant)
    matches.push({
      kind: 'variant',
      reference: variant.reference,
      start: range.start,
      end: range.end,
      ...(variant.id ? { id: variant.id } : {}),
      type: `variant:${variant.type}`,
      preview: variantSearchPreview(variant)
    })
  }
  return matches
}

function collectRangeSearchMatches(
  input: NormalizedWorkspaceSequenceSearchInput
): WorkspaceSequenceSearchMatch[] {
  const matches: WorkspaceSequenceSearchMatch[] = []
  for (const range of input.preview.indexedRanges) {
    if (!textMatchesAny([range.kind, range.reference, range.id, range.type], input.query, input.caseSensitive)) continue
    matches.push({
      kind: 'range',
      reference: range.reference,
      start: range.start,
      end: range.end,
      ...(range.id ? { id: range.id } : {}),
      type: range.type ?? range.kind,
      preview: rangeSearchPreview(range)
    })
  }
  return matches
}

function textMatchesAny(
  values: Array<string | undefined>,
  query: string,
  caseSensitive: boolean
): boolean {
  return values.some((value) => value !== undefined && textIncludesQuery(value, query, caseSensitive))
}

function textIncludesQuery(value: string, query: string, caseSensitive: boolean): boolean {
  if (caseSensitive) return value.includes(query)
  return value.toLowerCase().includes(query.toLowerCase())
}

function findQueryOccurrences(text: string, query: string, caseSensitive: boolean): number[] {
  const occurrences: number[] = []
  const searchableText = caseSensitive ? text : text.toLowerCase()
  const searchableQuery = caseSensitive ? query : query.toLowerCase()
  for (let offset = 0;;) {
    const index = searchableText.indexOf(searchableQuery, offset)
    if (index < 0) break
    occurrences.push(index)
    offset = index + 1
  }
  return occurrences
}

function referenceLikeRangeForRecord(
  preview: WorkspaceSequencePreviewResult,
  recordId: string
): WorkspaceSequenceIndexedRange | undefined {
  return preview.indexedRanges.find((range) => isReferenceLikeRange(range.kind) && range.reference === recordId)
}

function coordinatesForReference(
  preview: WorkspaceSequencePreviewResult,
  reference: WorkspaceSequenceReferenceSummary
): { start?: number, end?: number, type?: string } {
  const range = reference.indexedRange ?? preview.indexedRanges.find((candidate) => isReferenceLikeRange(candidate.kind) && candidate.reference === reference.id)
  const region = preview.regionSummary.find((candidate) => candidate.reference === reference.id)
  return {
    ...(range?.start !== undefined ? { start: range.start } : region?.start !== undefined ? { start: region.start } : {}),
    ...(range?.end !== undefined ? { end: range.end } : reference.sequenceLength !== undefined ? { end: reference.sequenceLength } : region?.end !== undefined ? { end: region.end } : {}),
    ...(range?.type ? { type: range.type } : {})
  }
}

function recordSearchPreview(record: WorkspaceSequenceRecordSummary): string {
  return truncateText([
    `${record.length} ${record.alphabet}`,
    record.description,
    record.preview
  ].filter(Boolean).join('; '), WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function referenceSearchPreview(reference: WorkspaceSequenceReferenceSummary): string {
  const parts = [
    reference.sequenceLength !== undefined ? `length ${reference.sequenceLength}` : undefined,
    reference.featureCount !== undefined ? `${reference.featureCount} features` : undefined,
    reference.intervalCount !== undefined ? `${reference.intervalCount} intervals` : undefined,
    reference.variantCount !== undefined ? `${reference.variantCount} variants` : undefined
  ].filter(Boolean)
  return truncateText(parts.join(', ') || reference.id, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function featureSearchPreview(feature: WorkspaceSequenceFeatureSummary): string {
  return truncateText(`${feature.reference}:${feature.start}-${feature.end} ${feature.type}${feature.id ? ` (${feature.id})` : ''}`, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function variantSearchPreview(variant: WorkspaceSequenceVariantSummary): string {
  return truncateText(`${variant.reference}:${variant.position} ${variant.ref}>${variant.alt.join(',')} ${variant.type}${variant.id ? ` (${variant.id})` : ''}`, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function rangeSearchPreview(range: WorkspaceSequenceIndexedRange): string {
  return truncateText(`${range.reference}:${range.start}-${range.end} ${range.kind}${range.type ? ` ${range.type}` : ''}${range.id ? ` (${range.id})` : ''}`, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function motifSearchPreview(sequence: string, start: number, length: number): string {
  const windowStart = Math.max(0, start - 20)
  const windowEnd = Math.min(sequence.length, start + length + 20)
  return truncateText(`${windowStart > 0 ? '...' : ''}${sequence.slice(windowStart, windowEnd)}${windowEnd < sequence.length ? '...' : ''}`, WORKSPACE_SEQUENCE_MAX_PREVIEW_CHARS)
}

function buildSearchSelection(matches: WorkspaceSequenceSearchMatch[]): WorkspaceSequenceSelection | undefined {
  const selectableMatches = selectableSearchMatches(matches)
  const references = selectableSearchReferences(matches)
  if (selectableMatches.length === 0 || references.size !== 1) return undefined
  const selectionFeatures = selectableMatches
    .filter((match) => match.kind !== 'record' && match.kind !== 'reference')
    .map((match) => ({
      ...(match.id ? { id: match.id } : {}),
      type: match.type ?? match.kind,
      start: match.start,
      end: match.end
    }))

  return {
    kind: 'sequence',
    sequenceId: selectableMatches[0]?.reference,
    ranges: selectableMatches.map((match) => ({
      start: match.start,
      end: match.end
    })),
    ...(selectionFeatures.length > 0 ? { features: selectionFeatures } : {})
  }
}

function selectableSearchMatches(matches: WorkspaceSequenceSearchMatch[]): SelectableSearchMatch[] {
  return matches.filter((match): match is SelectableSearchMatch => match.start !== undefined && match.end !== undefined && match.end >= match.start)
}

function selectableSearchReferences(matches: WorkspaceSequenceSearchMatch[]): Set<string> {
  return new Set(selectableSearchMatches(matches).map((match) => match.reference))
}

function searchMayMissPreviewItems(
  preview: WorkspaceSequencePreviewResult,
  scopes: ConcreteSearchScope[]
): boolean {
  const knownFeatureTotal = preview.featureCount ?? preview.intervalCount
  return (
    (scopes.includes('records') && preview.truncatedRecords) ||
    (scopes.includes('references') && preview.truncatedReferences) ||
    (scopes.includes('features') && knownFeatureTotal !== undefined && preview.features.length < knownFeatureTotal) ||
    (scopes.includes('variants') && preview.variantCount !== undefined && preview.variants.length < preview.variantCount) ||
    (scopes.includes('ranges') && (preview.truncatedRecords || preview.truncatedReferences || preview.indexedRanges.length >= WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES))
  )
}

function searchUsesBoundedRecordPreviews(
  preview: WorkspaceSequencePreviewResult,
  scopes: ConcreteSearchScope[]
): boolean {
  return scopes.includes('records') && preview.records.some((record) => record.preview !== undefined && record.preview.length < record.length)
}

function buildSearchVisibleText(
  query: string,
  scope: WorkspaceSequenceSearchScope,
  matchCount: number,
  matches: WorkspaceSequenceSearchMatch[],
  truncated: boolean,
  warnings: string[]
): string {
  const lines = [
    `Sequence search: "${query}" in ${scope}.`,
    `Bounded matches: ${matchCount}.`
  ]

  if (matches.length > 0) {
    lines.push('Match examples:')
    for (const match of matches.slice(0, 10)) {
      lines.push(`- ${formatSearchMatch(match)}`)
    }
  }
  if (truncated) {
    lines.push('Search results are bounded to the existing preview summary.')
  }
  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.join(' ')}`)
  }

  return truncateText(lines.join('\n'), WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS)
}

function formatSearchMatch(match: WorkspaceSequenceSearchMatch): string {
  const location = match.start !== undefined && match.end !== undefined
    ? `${match.reference}:${match.start}-${match.end}`
    : match.reference
  const identity = match.id ? ` ${match.id}` : ''
  const type = match.type ? ` ${match.type}` : ''
  return `${match.kind} ${location}${identity}${type}${match.preview ? `; ${match.preview}` : ''}`
}

function buildIndexedRanges(
  references: WorkspaceSequenceReferenceSummary[],
  features: WorkspaceSequenceFeatureSummary[],
  variants: WorkspaceSequenceVariantSummary[]
): WorkspaceSequenceIndexedRange[] {
  return boundedUniqueRanges([
    ...references.flatMap((reference) => reference.indexedRange ? [reference.indexedRange] : []),
    ...features.map(indexedRangeForFeature),
    ...variants.map(indexedRangeForVariant)
  ], WORKSPACE_SEQUENCE_MAX_INDEXED_RANGES)
}

function boundedUniqueRanges(ranges: WorkspaceSequenceIndexedRange[], limit: number): WorkspaceSequenceIndexedRange[] {
  const bounded: WorkspaceSequenceIndexedRange[] = []
  const seen = new Set<string>()
  for (const range of ranges) {
    const key = `${range.kind}:${range.reference}:${range.start}:${range.end}:${range.id ?? ''}:${range.type ?? ''}:${range.strand ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    bounded.push(range)
    if (bounded.length >= limit) break
  }
  return bounded
}

function indexedRangeForFeature(feature: WorkspaceSequenceFeatureSummary): WorkspaceSequenceIndexedRange {
  return feature.indexedRange ?? createIndexedRange({
    kind: feature.type === 'interval' ? 'interval' : 'feature',
    reference: feature.reference,
    start: feature.start,
    end: feature.end,
    id: feature.id,
    type: feature.type,
    strand: feature.strand
  })
}

function indexedRangeForVariant(variant: WorkspaceSequenceVariantSummary): WorkspaceSequenceIndexedRange {
  return variant.indexedRange ?? createIndexedRange({
    kind: 'variant',
    reference: variant.reference,
    start: variant.position,
    end: Math.max(variant.position + 1, variant.position + variant.ref.length),
    id: variant.id,
    type: `variant:${variant.type}`
  })
}

function createIndexedRange(input: {
  kind: WorkspaceSequenceIndexedRange['kind']
  reference: string
  start: number
  end: number
  id?: string
  type?: string
  strand?: '+' | '-'
}): WorkspaceSequenceIndexedRange {
  const start = normalizeCoordinate(input.start)
  const end = Math.max(start, normalizeCoordinate(input.end))
  return {
    kind: input.kind,
    reference: truncateId(input.reference),
    start,
    end,
    ...(input.id ? { id: truncateId(input.id) } : {}),
    ...(input.type ? { type: truncateType(input.type) } : {}),
    ...(input.strand ? { strand: input.strand } : {})
  }
}

function normalizeCoordinate(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function rangeOverlapsSelection(
  range: WorkspaceSequenceIndexedRange,
  reference: string,
  start: number,
  end: number
): boolean {
  if (range.reference !== reference) return false
  if (start === end) return range.start <= start && start < range.end
  return range.start < end && start < range.end
}

function selectionFeatureFromFeature(feature: WorkspaceSequenceFeatureSummary): NonNullable<WorkspaceSequenceSelection['features']>[number] {
  return {
    ...(feature.id ? { id: feature.id } : {}),
    type: feature.type,
    start: feature.start,
    end: feature.end
  }
}

function isSyntheticVariantFeature(feature: WorkspaceSequenceFeatureSummary): boolean {
  return feature.type.startsWith('variant:')
}

function selectionFeatureFromVariant(variant: WorkspaceSequenceVariantSummary): NonNullable<WorkspaceSequenceSelection['features']>[number] {
  const range = indexedRangeForVariant(variant)
  return {
    ...(variant.id ? { id: variant.id } : {}),
    type: `variant:${variant.type}`,
    start: range.start,
    end: range.end
  }
}

function buildRegionSelectionVisibleText(
  reference: string,
  start: number,
  end: number,
  featureCount: number,
  variantCount: number,
  warnings: string[]
): string {
  return truncateText([
    `Sequence region selection: ${reference}:${start}-${end}.`,
    `Overlapping bounded features: ${featureCount}.`,
    `Overlapping bounded variants: ${variantCount}.`,
    ...(warnings.length > 0 ? [`Warnings: ${warnings.join(' ')}`] : [])
  ].join('\n'), WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS)
}

function parseGenBankLocation(location: string): { start: number, end: number, strand?: '+' | '-' } | undefined {
  const normalized = location.replace(/\b[A-Za-z_][\w.-]*:/g, '').replace(/[<>]/g, '')
  const spans = [...normalized.matchAll(/(\d+)(?:\.\.(\d+))?/g)].map((match) => {
    const start = Number.parseInt(match[1] ?? '', 10)
    const end = Number.parseInt(match[2] ?? match[1] ?? '', 10)
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : undefined
  }).filter((span): span is { start: number, end: number } => span !== undefined)

  if (spans.length === 0) return undefined
  const start = Math.max(0, Math.min(...spans.map((span) => span.start)) - 1)
  const end = Math.max(start, Math.max(...spans.map((span) => span.end)))
  return {
    start,
    end,
    ...(/\bcomplement\s*\(/i.test(location) ? { strand: '-' as const } : {})
  }
}

function isReferenceLikeRange(kind: WorkspaceSequenceIndexedRange['kind']): boolean {
  return kind === 'reference' || kind === 'sequence' || kind === 'read'
}

function buildWorkspaceObservation(input: ObservationBuildInput): WorkspaceSequenceObservation {
  const title = titleForPath(input.input.path)
  const selection = buildSelection(input)
  const annotations = input.warnings.map((warning, index) => ({
    id: `warning-${index + 1}`,
    kind: 'warning',
    summary: warning
  }))

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.input.path?.trim() || `inline-${input.format}-sequence`,
      ...(input.input.workspaceRoot ? { workspaceRoot: input.input.workspaceRoot } : {}),
      mimeType: input.input.mimeType ?? defaultMimeType(input.format),
      ...(input.input.size !== undefined ? { size: input.input.size } : {}),
      ...(input.input.mtimeMs !== undefined ? { mtimeMs: input.input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_SEQUENCE_PLUGIN_ID,
      modality: 'sequence',
      mode: 'preview',
      title
    },
    ...(selection ? { selection } : {}),
    visibleText: buildVisibleText(input),
    sequence: {
      sequenceCount: input.sequenceCount,
      totalLength: input.totalLength,
      alphabet: input.alphabet,
      references: input.references.map(({ indexedRange: _indexedRange, ...reference }) => reference),
      features: input.features.map(({ indexedRange: _indexedRange, ...feature }) => feature),
      indexedRanges: input.indexedRanges,
      truncatedRecords: input.truncatedRecords,
      truncatedReferences: input.truncatedReferences
    },
    ...(annotations.length > 0 ? { annotations } : {}),
    actions: [...WORKSPACE_SEQUENCE_ACTIONS]
  }
}

function buildSelection(input: ObservationBuildInput): WorkspaceSequenceObservation['selection'] {
  const firstRecord = input.records.find((record) => record.length > 0)
  if (firstRecord) {
    return {
      kind: 'sequence',
      sequenceId: firstRecord.id,
      ranges: [{
        start: 0,
        end: Math.min(firstRecord.length, 1000)
      }]
    }
  }

  const firstFeature = input.features[0]
  if (!firstFeature) return undefined
  return {
    kind: 'sequence',
    sequenceId: firstFeature.reference,
    ranges: [{
      start: firstFeature.start,
      end: firstFeature.end,
      ...(firstFeature.strand ? { strand: firstFeature.strand } : {})
    }],
    features: input.features.slice(0, 100).map((feature) => ({
      ...(feature.id ? { id: feature.id } : {}),
      type: feature.type,
      start: feature.start,
      end: feature.end
    }))
  }
}

function buildVisibleText(input: ObservationBuildInput): string {
  const lines = [
    `Sequence/genomics preview: ${formatLabel(input.format)}.`,
    `Sequences or references: ${input.sequenceCount}.`
  ]

  if (input.totalLength > 0) {
    lines.push(`Total sequence length: ${input.totalLength}.`)
  }
  if (input.minLength !== undefined || input.maxLength !== undefined) {
    lines.push(`Length range: ${input.minLength ?? 0}-${input.maxLength ?? 0}; average ${formatNumber(input.averageLength ?? 0)}.`)
  }
  lines.push(`Alphabet: ${input.alphabet}.`)

  if (input.readCount !== undefined) lines.push(`FASTQ reads: ${input.readCount}.`)
  if (input.featureCount !== undefined) lines.push(`Features: ${input.featureCount}.`)
  if (input.intervalCount !== undefined) lines.push(`Intervals: ${input.intervalCount}.`)
  if (input.variantCount !== undefined) lines.push(`Variants: ${input.variantCount}.`)
  if (input.sampleCount !== undefined) lines.push(`Samples: ${input.sampleCount}.`)
  if (input.indexedRanges.length > 0) lines.push(`Indexed ranges: ${input.indexedRanges.length} bounded examples.`)

  if (input.records.length > 0) {
    lines.push('Sequence examples:')
    for (const record of input.records.slice(0, 10)) {
      lines.push(`- ${record.id}: ${record.length} ${record.alphabet}${record.description ? `; ${record.description}` : ''}`)
    }
  }
  if (input.references.length > 0) {
    lines.push('Reference examples:')
    for (const reference of input.references.slice(0, 10)) {
      const parts = [
        reference.sequenceLength !== undefined ? `length ${reference.sequenceLength}` : undefined,
        reference.featureCount !== undefined ? `${reference.featureCount} features` : undefined,
        reference.intervalCount !== undefined ? `${reference.intervalCount} intervals` : undefined,
        reference.variantCount !== undefined ? `${reference.variantCount} variants` : undefined
      ].filter(Boolean)
      lines.push(`- ${reference.id}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`)
    }
  }
  if (input.regionSummary.length > 0) {
    lines.push('Region examples:')
    for (const region of input.regionSummary.slice(0, 10)) {
      const parts = [
        region.sequenceLength !== undefined ? `length ${region.sequenceLength}` : undefined,
        `${region.rangeCount} indexed ranges`,
        region.featureCount !== undefined ? `${region.featureCount} features` : undefined,
        region.intervalCount !== undefined ? `${region.intervalCount} intervals` : undefined,
        region.variantCount !== undefined ? `${region.variantCount} variants` : undefined
      ].filter(Boolean)
      lines.push(`- ${region.reference}:${region.start}-${region.end}; ${parts.join(', ')}`)
    }
  }
  if (input.features.length > 0) {
    lines.push('Feature examples:')
    for (const feature of input.features.slice(0, 10)) {
      lines.push(`- ${feature.reference}:${feature.start}-${feature.end} ${feature.type}${feature.id ? ` (${feature.id})` : ''}`)
    }
  }
  if (input.variants.length > 0) {
    lines.push('Variant examples:')
    for (const variant of input.variants.slice(0, 10)) {
      lines.push(`- ${variant.reference}:${variant.position} ${variant.ref}>${variant.alt.join(',')} ${variant.type}`)
    }
  }
  if (input.truncatedRecords || input.truncatedReferences) {
    lines.push('Preview is bounded; use the full file for complete sequence/genomics data.')
  }

  return truncateText(lines.join('\n'), WORKSPACE_SEQUENCE_MAX_VISIBLE_TEXT_CHARS)
}

function extensionForPath(path: string | undefined): string {
  const fileName = path?.trim().split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? ''
  const extension = Object.keys(SUPPORTED_EXTENSIONS)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => fileName.endsWith(candidate))
  return extension ?? ''
}

function looksLikeFastq(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 4)
  return lines.length >= 4 && lines[0]?.startsWith('@') === true && lines[2]?.startsWith('+') === true
}

function stripBom(text: string): string {
  return text.startsWith('\ufeff') ? text.slice(1) : text
}

function parseRecordHeader(header: string, fallbackIndex: number): { id: string, description?: string } {
  const normalized = header.replace(/^[@>]/, '').trim()
  if (!normalized) return { id: `sequence-${fallbackIndex}` }
  const [id, ...descriptionParts] = normalized.split(/\s+/)
  const description = descriptionParts.join(' ').trim()
  return {
    id: truncateId(id || `sequence-${fallbackIndex}`),
    ...(description ? { description: truncateText(description, 1000) } : {})
  }
}

function normalizeSequence(sequence: string): string {
  return sequence.replace(/[^A-Za-z*]/g, '').toUpperCase()
}

function addLetters(counts: Map<string, number>, sequence: string): void {
  for (const char of sequence) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
  }
}

function detectAlphabet(sequence: string): WorkspaceSequenceAlphabet {
  const counts = new Map<string, number>()
  addLetters(counts, normalizeSequence(sequence))
  return detectAlphabetFromCounts(counts)
}

function detectAlphabetFromCounts(counts: Map<string, number>): WorkspaceSequenceAlphabet {
  const letters = [...counts.keys()].filter((char) => /[A-Z*]/.test(char))
  if (letters.length === 0) return 'unknown'

  const allDna = letters.every((char) => DNA_CHARS.has(char))
  const allRna = letters.every((char) => RNA_CHARS.has(char))
  const hasU = counts.has('U')
  const hasT = counts.has('T')
  const hasProteinOnly = letters.some((char) => PROTEIN_ONLY_CHARS.has(char))

  if (allRna && hasU && !hasT && !hasProteinOnly) return 'rna'
  if (allDna && !hasU && !hasProteinOnly) return 'dna'
  if (letters.every((char) => PROTEIN_CHARS.has(char))) return 'protein'
  return 'unknown'
}

function gcContent(sequence: string, alphabet: WorkspaceSequenceAlphabet): number | undefined {
  if (alphabet !== 'dna' && alphabet !== 'rna') return undefined
  const normalized = normalizeSequence(sequence)
  const denominator = [...normalized].filter((char) => ['A', 'C', 'G', 'T', 'U'].includes(char)).length
  if (denominator === 0) return undefined
  const gc = [...normalized].filter((char) => char === 'G' || char === 'C').length
  return gc / denominator
}

function summarizeLengths(lengths: number[]): { minLength?: number, maxLength?: number, averageLength?: number } {
  if (lengths.length === 0) return {}
  const total = lengths.reduce((sum, length) => sum + length, 0)
  return {
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
    averageLength: total / lengths.length
  }
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !isIntegerText(value)) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isIntegerText(value: string): boolean {
  return /^\d+$/.test(value.trim())
}

function normalizeStrand(value: string | undefined): '+' | '-' | undefined {
  return value === '+' || value === '-' ? value : undefined
}

function idFromGffAttributes(attributes: string): string | undefined {
  const match = /(?:^|;)ID=([^;]+)/.exec(attributes) ?? /(?:^|;)Name=([^;]+)/.exec(attributes)
  return match?.[1] ? truncateId(decodeURIComponentSafe(match[1])) : undefined
}

function idFromGtfAttributes(attributes: string): string | undefined {
  const match = /\b(?:gene_id|transcript_id)\s+"([^"]+)"/.exec(attributes)
  return match?.[1] ? truncateId(match[1]) : undefined
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseVcfContig(line: string): { id: string, length?: number } | undefined {
  const idMatch = /\bID=([^,>]+)/.exec(line)
  if (!idMatch?.[1]) return undefined
  const lengthMatch = /\blength=(\d+)/i.exec(line)
  return {
    id: truncateId(idMatch[1]),
    ...(lengthMatch?.[1] ? { length: Number.parseInt(lengthMatch[1], 10) } : {})
  }
}

function inferVariantType(ref: string, alts: string[]): WorkspaceSequenceVariantType {
  const types = new Set<WorkspaceSequenceVariantType>()
  for (const alt of alts) {
    if (!alt || alt === '.') {
      types.add('unknown')
    } else if (/^<.+>$/.test(alt) || /[[\]]/.test(alt)) {
      types.add('symbolic')
    } else if (ref.length === 1 && alt.length === 1) {
      types.add('snv')
    } else if (ref.length === alt.length) {
      types.add('mnv')
    } else {
      types.add('indel')
    }
  }
  if (types.size === 0) return 'unknown'
  if (types.size === 1) return [...types][0] ?? 'unknown'
  return 'mixed'
}

function defaultMimeType(format: WorkspaceSequenceResolvedFormat): string {
  switch (format) {
    case 'fasta':
      return 'text/x-fasta'
    case 'fastq':
      return 'text/x-fastq'
    case 'genbank':
      return 'chemical/seq-na-genbank'
    case 'gff':
      return 'application/gff3'
    case 'gtf':
      return 'text/x-gtf'
    case 'bed':
      return 'text/x-bed'
    case 'vcf':
      return 'text/vcf'
  }
}

function formatLabel(format: WorkspaceSequenceResolvedFormat): string {
  switch (format) {
    case 'fasta':
      return 'FASTA'
    case 'fastq':
      return 'FASTQ'
    case 'genbank':
      return 'GenBank'
    case 'gff':
      return 'GFF'
    case 'gtf':
      return 'GTF'
    case 'bed':
      return 'BED'
    case 'vcf':
      return 'VCF'
  }
}

function titleForPath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) return 'Sequence data'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

function boundedWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => truncateText(warning.trim(), 1000)).filter(Boolean).slice(0, WORKSPACE_SEQUENCE_MAX_WARNINGS)
}

function truncateId(value: string): string {
  return truncateText(value.trim() || 'item', WORKSPACE_SEQUENCE_MAX_ID_CHARS)
}

function truncateType(value: string): string {
  return truncateText(value.trim() || 'feature', 128)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}
