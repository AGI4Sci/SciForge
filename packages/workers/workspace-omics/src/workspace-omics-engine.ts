import {
  WORKSPACE_OMICS_ACTIONS,
  WORKSPACE_OMICS_CONTRACT_VERSION,
  WORKSPACE_OMICS_MAX_AXIS_KEYS,
  WORKSPACE_OMICS_MAX_EMBEDDINGS,
  WORKSPACE_OMICS_FORMAT_CAPABILITIES,
  WORKSPACE_OMICS_MAX_METADATA_ENTRIES,
  WORKSPACE_OMICS_MAX_SELECTION_ITEMS,
  WORKSPACE_OMICS_MAX_SHAPE_AXES,
  WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS,
  WORKSPACE_OMICS_MAX_WARNINGS,
  WORKSPACE_OMICS_PLUGIN_ID,
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  workspaceOmicsDatasetSelectionResultSchema,
  workspaceOmicsPreviewResultSchema,
  type NormalizedWorkspaceOmicsDatasetSelectionInput,
  type NormalizedWorkspaceOmicsPreviewInput,
  type WorkspaceOmicsAxisRangeRequest,
  type WorkspaceOmicsDatasetSummary,
  type WorkspaceOmicsDatasetSelectionResult,
  type WorkspaceOmicsMetadataEntry,
  type WorkspaceOmicsMetadataSummary,
  type WorkspaceOmicsMatrixSummary,
  type WorkspaceOmicsObservation,
  type WorkspaceOmicsPlaceholder,
  type WorkspaceOmicsPreviewResult,
  type WorkspaceOmicsResolvedFormat,
  type WorkspaceOmicsSelection,
  type WorkspaceOmicsSelectionAxis,
  type WorkspaceOmicsSelectionMissingRequests,
  type WorkspaceOmicsSelectionRange
} from './contract.js'

type MatrixMarketParseResult = {
  matrix?: WorkspaceOmicsMatrixSummary
  metadata: WorkspaceOmicsMetadataSummary
  warnings: string[]
}

type ObservationBuildInput = {
  input: NormalizedWorkspaceOmicsPreviewInput
  format: WorkspaceOmicsResolvedFormat
  matrices: WorkspaceOmicsMatrixSummary[]
  metadata: WorkspaceOmicsMetadataSummary
  dataset?: WorkspaceOmicsDatasetSummary
  placeholder?: WorkspaceOmicsPlaceholder
  warnings: string[]
}

const MATRIX_MARKET_HEADER_PATTERN = /^%%MatrixMarket\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/i
const JSON_OBJECT_OR_ARRAY_PATTERN = /^[\s\ufeff]*(?:\{|\[)/
const KEY_VALUE_PATTERN = /^\s*["']?([A-Za-z0-9_.:/ -]{1,256})["']?\s*[:=]\s*(.+?)\s*,?\s*$/
const BINARY_PLACEHOLDER_FORMATS = new Set<WorkspaceOmicsResolvedFormat>(['h5ad', 'loom', 'hdf5', 'zarr'])
const OBS_AXIS_KEYS = new Set(['obs', 'observations', 'obskeys', 'obscolumns', 'obsmetadata'])
const VAR_AXIS_KEYS = new Set(['var', 'vars', 'variables', 'varkeys', 'varcolumns', 'varmetadata'])
const EMBEDDING_CONTAINER_KEYS = new Set(['obsm', 'embeddings', 'embeddingnames', 'obsmkeys', 'reductions', 'reduceddims'])
const AXIS_SUMMARY_VALUE_KEYS = new Set(['keycount', 'keys', 'columns', 'fields', 'names', 'count', 'n'])

export function createWorkspaceOmicsPreview(
  input: NormalizedWorkspaceOmicsPreviewInput
): WorkspaceOmicsPreviewResult {
  const format = resolveOmicsFormat(input)
  const warnings: string[] = []
  let matrices: WorkspaceOmicsMatrixSummary[] = []
  let metadata: WorkspaceOmicsMetadataSummary = emptyMetadata()
  let dataset: WorkspaceOmicsDatasetSummary | undefined

  if (format === 'matrix-market') {
    const parsed = parseMatrixMarket(input.text)
    matrices = parsed.matrix ? [parsed.matrix] : []
    metadata = parsed.metadata
    warnings.push(...parsed.warnings)
  } else {
    metadata = extractJsonLikeMetadata(input.text)
    dataset = inferDatasetFromMetadata(input.text, metadata)
    const metadataMatrix = inferMatrixFromMetadata(metadata, format, dataset)
    matrices = metadataMatrix ? [metadataMatrix] : []
  }

  const placeholder = createPlaceholder(format)
  if (placeholder) {
    warnings.push(`${formatLabel(format)} matrix payload parsing is not enabled in this lightweight worker.`)
  }

  if (format === 'json' && metadata.source === 'none') {
    warnings.push('Input was treated as metadata JSON, but no bounded metadata entries were extracted.')
  }

  if (format === 'unknown') {
    warnings.push('Omics matrix format could not be inferred; only generic metadata fallback was attempted.')
  }

  const boundedWarningList = boundedWarnings(warnings)

  return workspaceOmicsPreviewResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_OMICS_CONTRACT_VERSION,
    format,
    capabilities: copyCapabilities(),
    matrices,
    metadata,
    ...(dataset ? { dataset } : {}),
    ...(placeholder ? { placeholder } : {}),
    warnings: boundedWarningList,
    ...(input.includeObservation
      ? {
          observation: buildWorkspaceObservation({
            input,
            format,
            matrices,
            metadata,
            dataset,
            placeholder,
            warnings: boundedWarningList
          })
        }
      : {})
  })
}

export function selectWorkspaceOmicsDataset(
  input: NormalizedWorkspaceOmicsDatasetSelectionInput
): WorkspaceOmicsDatasetSelectionResult {
  const warnings: string[] = []
  const missing: WorkspaceOmicsSelectionMissingRequests = {
    matrixIds: [],
    matrixNames: [],
    obsKeys: [],
    varKeys: [],
    embeddings: [],
    ranges: []
  }
  const selectedMatrixIds: string[] = []

  for (const matrixId of uniqueRequestedNames(input.matrixIds)) {
    const matrix = findMatrixById(input.preview.matrices, matrixId)
    if (matrix) {
      addUniqueSelectionName(selectedMatrixIds, matrix.id)
    } else {
      missing.matrixIds.push(matrixId)
    }
  }

  for (const matrixName of uniqueRequestedNames(input.matrixNames)) {
    const matrix = findMatrixByName(input.preview.matrices, matrixName)
    if (matrix) {
      addUniqueSelectionName(selectedMatrixIds, matrix.id)
    } else {
      missing.matrixNames.push(matrixName)
    }
  }

  addMissingNameWarnings(warnings, 'matrix ids', missing.matrixIds)
  addMissingNameWarnings(warnings, 'matrix names', missing.matrixNames)

  const obsSelection = selectNamedDatasetItems({
    requested: input.obsKeys,
    available: input.preview.dataset?.obsKeys,
    label: 'obs keys',
    unavailableLabel: 'obs key list',
    warnings
  })
  const varSelection = selectNamedDatasetItems({
    requested: input.varKeys,
    available: input.preview.dataset?.varKeys,
    label: 'var keys',
    unavailableLabel: 'var key list',
    warnings
  })
  const embeddingSelection = selectNamedDatasetItems({
    requested: input.embeddingNames,
    available: input.preview.dataset?.embeddingNames,
    label: 'embeddings',
    unavailableLabel: 'embedding list',
    warnings
  })

  missing.obsKeys.push(...obsSelection.missing)
  missing.varKeys.push(...varSelection.missing)
  missing.embeddings.push(...embeddingSelection.missing)

  const ranges = selectAxisRanges({
    preview: input.preview,
    requests: input.ranges,
    selectedMatrixIds,
    missingRanges: missing.ranges,
    warnings
  })

  const selection: WorkspaceOmicsSelection = {
    kind: 'omics',
    ...(selectedMatrixIds.length > 0 ? { matrixIds: selectedMatrixIds } : {}),
    ...(obsSelection.selected.length > 0 ? { obsKeys: obsSelection.selected } : {}),
    ...(varSelection.selected.length > 0 ? { varKeys: varSelection.selected } : {}),
    ...(embeddingSelection.selected.length > 0 ? { embeddings: embeddingSelection.selected } : {}),
    ...(ranges.length > 0 ? { ranges } : {})
  }
  const boundedWarningList = boundedWarnings(warnings)

  return workspaceOmicsDatasetSelectionResultSchema.parse({
    ok: true,
    contractVersion: WORKSPACE_OMICS_CONTRACT_VERSION,
    selection,
    missing,
    visibleText: buildDatasetSelectionVisibleText({
      selection,
      missing,
      warnings: boundedWarningList
    }),
    warnings: boundedWarningList
  })
}

export function parseMatrixMarket(text: string): MatrixMarketParseResult {
  const warnings: string[] = []
  const entries: WorkspaceOmicsMetadataEntry[] = []
  const lines = text.split(/\r?\n/)
  let headerIndex = -1
  let headerLine = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripBom(lines[index] ?? '').trim()
    if (!line) continue
    headerIndex = index
    headerLine = line
    break
  }

  if (!headerLine) {
    return {
      metadata: emptyMetadata(),
      warnings: ['Matrix Market text is empty; no dimensions were parsed.']
    }
  }

  const headerMatch = MATRIX_MARKET_HEADER_PATTERN.exec(headerLine)
  if (!headerMatch) {
    return {
      metadata: emptyMetadata(),
      warnings: ['Matrix Market header was not recognized; expected %%MatrixMarket matrix coordinate|array field symmetry.']
    }
  }

  const objectType = normalizeToken(headerMatch[1])
  const storage = normalizeToken(headerMatch[2])
  const field = normalizeToken(headerMatch[3])
  const symmetry = normalizeToken(headerMatch[4])

  entries.push(
    metadataEntry('matrixMarket.object', objectType),
    metadataEntry('matrixMarket.storage', storage),
    metadataEntry('matrixMarket.field', field),
    metadataEntry('matrixMarket.symmetry', symmetry)
  )

  if (objectType !== 'matrix') {
    warnings.push(`Matrix Market object type "${objectType}" is not matrix; parsed dimensions best-effort.`)
  }

  if (storage !== 'coordinate' && storage !== 'array') {
    warnings.push(`Matrix Market storage "${storage}" is not supported for dimension parsing.`)
  }

  let dimensionsLine = ''
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = stripBom(lines[index] ?? '').trim()
    if (!line) continue
    if (line.startsWith('%')) {
      const comment = line.replace(/^%+/, '').trim()
      if (comment) {
        entries.push(metadataEntry(`comment.${entries.filter((entry) => entry.key.startsWith('comment.')).length + 1}`, comment))
      }
      continue
    }

    dimensionsLine = line
    break
  }

  if (!dimensionsLine) {
    return {
      metadata: boundedMetadata('matrix-market-comments', entries),
      warnings: [...warnings, 'Matrix Market dimensions line was not found.']
    }
  }

  const dimensions = dimensionsLine.split(/\s+/).map((part) => Number.parseInt(part, 10))
  const rowCount = dimensions[0]
  const columnCount = dimensions[1]
  const entryCount = dimensions[2]

  if (!isNonNegativeInteger(rowCount) || !isNonNegativeInteger(columnCount)) {
    return {
      metadata: boundedMetadata('matrix-market-comments', entries),
      warnings: [...warnings, `Matrix Market dimensions line "${dimensionsLine}" did not include valid row and column counts.`]
    }
  }

  entries.push(
    metadataEntry('matrixMarket.rows', rowCount),
    metadataEntry('matrixMarket.columns', columnCount)
  )

  const matrix: WorkspaceOmicsMatrixSummary = {
    id: 'matrix-1',
    name: 'Matrix Market matrix',
    source: 'matrix-market',
    format: 'matrix-market',
    shape: [rowCount, columnCount],
    rowCount,
    columnCount,
    ...(storage === 'coordinate' ? { storage: 'coordinate' } : {}),
    ...(storage === 'array' ? { storage: 'array' } : {}),
    field,
    symmetry
  }

  if (storage === 'coordinate') {
    if (isNonNegativeInteger(entryCount)) {
      matrix.nonZeroCount = entryCount
      matrix.density = densityFor(rowCount, columnCount, entryCount)
      entries.push(metadataEntry('matrixMarket.nnz', entryCount))
    } else {
      warnings.push(`Matrix Market coordinate dimensions line "${dimensionsLine}" did not include a valid nnz count.`)
    }
  }

  if (storage === 'array') {
    entries.push(metadataEntry('matrixMarket.valueCount', rowCount * columnCount))
  }

  return {
    matrix,
    metadata: boundedMetadata('matrix-market-comments', entries),
    warnings
  }
}

export function extractJsonLikeMetadata(text: string): WorkspaceOmicsMetadataSummary {
  const trimmed = stripBom(text).trim()
  if (!trimmed) return emptyMetadata()

  if (JSON_OBJECT_OR_ARRAY_PATTERN.test(trimmed)) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const entries: WorkspaceOmicsMetadataEntry[] = []
      collectJsonEntries(parsed, '', entries, 0)
      return boundedMetadata('json', entries)
    } catch {
      return extractKeyValueMetadata(trimmed)
    }
  }

  return extractKeyValueMetadata(trimmed)
}

function extractKeyValueMetadata(text: string): WorkspaceOmicsMetadataSummary {
  const entries: WorkspaceOmicsMetadataEntry[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line === '{' || line === '}' || line === '[' || line === ']') continue
    const match = KEY_VALUE_PATTERN.exec(line)
    if (!match) continue
    const key = normalizeMetadataKey(match[1] ?? '')
    const value = cleanMetadataValue(match[2] ?? '')
    if (!key || !value) continue
    entries.push(metadataEntry(key, parseScalarValue(value)))
    if (entries.length >= WORKSPACE_OMICS_MAX_METADATA_ENTRIES) break
  }

  return boundedMetadata(entries.length > 0 ? 'key-value' : 'none', entries)
}

function collectJsonEntries(
  value: unknown,
  prefix: string,
  entries: WorkspaceOmicsMetadataEntry[],
  depth: number
): void {
  if (entries.length >= WORKSPACE_OMICS_MAX_METADATA_ENTRIES) return

  if (prefix && (depth >= 3 || !isPlainObject(value))) {
    entries.push(metadataEntry(prefix, value))
    return
  }

  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nextKey = prefix ? `${prefix}.${key}` : key
      collectJsonEntries(nestedValue, nextKey, entries, depth + 1)
      if (entries.length >= WORKSPACE_OMICS_MAX_METADATA_ENTRIES) return
    }
    return
  }

  if (prefix) {
    entries.push(metadataEntry(prefix, value))
  }
}

function inferDatasetFromMetadata(
  text: string,
  metadata: WorkspaceOmicsMetadataSummary
): WorkspaceOmicsDatasetSummary | undefined {
  const entryValues = new Map(metadata.entries.map((entry) => [entry.key.toLowerCase(), entry.value]))
  const entrySummary = inferDatasetFromValues(entryValues)

  const parsed = parseJsonMetadataValue(text)
  if (parsed === undefined) return entrySummary

  const jsonValues = new Map<string, string>()
  collectJsonSummaryValues(parsed, '', jsonValues, 0)
  const jsonSummary = mergeDatasetSummaries(
    inferDatasetFromValues(jsonValues),
    {
      obsKeys: collectAxisKeysFromJson(parsed, OBS_AXIS_KEYS),
      varKeys: collectAxisKeysFromJson(parsed, VAR_AXIS_KEYS),
      embeddingNames: collectEmbeddingNamesFromJson(parsed)
    }
  )

  return mergeDatasetSummaries(jsonSummary, entrySummary)
}

function inferDatasetFromValues(values: Map<string, string>): WorkspaceOmicsDatasetSummary | undefined {
  const shape = firstShape(values)
  const nObs = firstInteger(values, [
    'n_obs',
    'nobs',
    'n_observations',
    'observation_count',
    'obs_count',
    'cell_count',
    'rows',
    'row_count',
    'nrows'
  ]) ?? shape?.[0]
  const nVars = firstInteger(values, [
    'n_vars',
    'nvars',
    'n_variables',
    'variable_count',
    'var_count',
    'gene_count',
    'columns',
    'column_count',
    'ncols'
  ]) ?? shape?.[1]
  const nnz = firstInteger(values, ['nnz', 'nonzero', 'non_zero_count', 'nonzeros', 'x.nnz', 'matrix.nnz'])
  const obsKeys = collectAxisKeysFromValues(values, OBS_AXIS_KEYS)
  const varKeys = collectAxisKeysFromValues(values, VAR_AXIS_KEYS)
  const embeddingNames = collectEmbeddingNamesFromValues(values)
  const obsKeyCount = firstInteger(values, [
    'obs_key_count',
    'obs_keys_count',
    'obs_column_count',
    'obs_columns_count',
    'n_obs_keys'
  ]) ?? (obsKeys.length > 0 ? obsKeys.length : undefined)
  const varKeyCount = firstInteger(values, [
    'var_key_count',
    'var_keys_count',
    'var_column_count',
    'var_columns_count',
    'n_var_keys'
  ]) ?? (varKeys.length > 0 ? varKeys.length : undefined)

  return compactDatasetSummary({
    nObs,
    nVars,
    shape,
    nnz,
    obsKeyCount,
    varKeyCount,
    obsKeys,
    varKeys,
    embeddingNames
  })
}

function mergeDatasetSummaries(
  primary: WorkspaceOmicsDatasetSummary | undefined,
  fallback: WorkspaceOmicsDatasetSummary | undefined
): WorkspaceOmicsDatasetSummary | undefined {
  if (!primary) return fallback
  if (!fallback) return primary

  return compactDatasetSummary({
    nObs: primary.nObs ?? fallback.nObs,
    nVars: primary.nVars ?? fallback.nVars,
    shape: primary.shape ?? fallback.shape,
    nnz: primary.nnz ?? fallback.nnz,
    obsKeyCount: primary.obsKeyCount ?? fallback.obsKeyCount,
    varKeyCount: primary.varKeyCount ?? fallback.varKeyCount,
    obsKeys: boundedUniqueNames([...(primary.obsKeys ?? []), ...(fallback.obsKeys ?? [])], WORKSPACE_OMICS_MAX_AXIS_KEYS),
    varKeys: boundedUniqueNames([...(primary.varKeys ?? []), ...(fallback.varKeys ?? [])], WORKSPACE_OMICS_MAX_AXIS_KEYS),
    embeddingNames: boundedUniqueNames(
      [...(primary.embeddingNames ?? []), ...(fallback.embeddingNames ?? [])],
      WORKSPACE_OMICS_MAX_EMBEDDINGS
    )
  })
}

function compactDatasetSummary(summary: {
  nObs?: number
  nVars?: number
  shape?: number[]
  nnz?: number
  obsKeyCount?: number
  varKeyCount?: number
  obsKeys?: string[]
  varKeys?: string[]
  embeddingNames?: string[]
}): WorkspaceOmicsDatasetSummary | undefined {
  const shape = normalizeShape(summary.shape)
  const obsKeys = boundedUniqueNames(summary.obsKeys ?? [], WORKSPACE_OMICS_MAX_AXIS_KEYS)
  const varKeys = boundedUniqueNames(summary.varKeys ?? [], WORKSPACE_OMICS_MAX_AXIS_KEYS)
  const embeddingNames = boundedUniqueNames(summary.embeddingNames ?? [], WORKSPACE_OMICS_MAX_EMBEDDINGS)
  const nObs = summary.nObs ?? shape?.[0]
  const nVars = summary.nVars ?? shape?.[1]
  const obsKeyCount = summary.obsKeyCount ?? (obsKeys.length > 0 ? obsKeys.length : undefined)
  const varKeyCount = summary.varKeyCount ?? (varKeys.length > 0 ? varKeys.length : undefined)
  const inferredShape = shape ?? (nObs !== undefined && nVars !== undefined ? [nObs, nVars] : undefined)

  if (
    nObs === undefined &&
    nVars === undefined &&
    inferredShape === undefined &&
    summary.nnz === undefined &&
    obsKeyCount === undefined &&
    varKeyCount === undefined &&
    embeddingNames.length === 0
  ) {
    return undefined
  }

  return {
    ...(nObs !== undefined ? { nObs } : {}),
    ...(nVars !== undefined ? { nVars } : {}),
    ...(inferredShape !== undefined ? { shape: inferredShape } : {}),
    ...(summary.nnz !== undefined ? { nnz: summary.nnz } : {}),
    ...(obsKeyCount !== undefined ? { obsKeyCount } : {}),
    ...(varKeyCount !== undefined ? { varKeyCount } : {}),
    ...(obsKeys.length > 0 ? { obsKeys } : {}),
    ...(varKeys.length > 0 ? { varKeys } : {}),
    ...(embeddingNames.length > 0 ? { embeddingNames } : {})
  }
}

function parseJsonMetadataValue(text: string): unknown | undefined {
  const trimmed = stripBom(text).trim()
  if (!JSON_OBJECT_OR_ARRAY_PATTERN.test(trimmed)) return undefined

  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function collectJsonSummaryValues(value: unknown, prefix: string, values: Map<string, string>, depth: number): void {
  if (depth > 6) return

  if (prefix && !isPlainObject(value)) {
    values.set(prefix, stringifyMetadataValue(value))
    return
  }

  if (!isPlainObject(value)) return

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key
    collectJsonSummaryValues(nestedValue, nextKey, values, depth + 1)
  }
}

function collectAxisKeysFromJson(value: unknown, axisKeys: Set<string>): string[] {
  const names: string[] = []

  visitJsonContainers(value, (key, nestedValue) => {
    if (axisKeys.has(comparableKey(key))) {
      names.push(...axisKeysFromContainer(nestedValue))
    }
  })

  return boundedUniqueNames(names, WORKSPACE_OMICS_MAX_AXIS_KEYS)
}

function collectEmbeddingNamesFromJson(value: unknown): string[] {
  const names: string[] = []

  visitJsonContainers(value, (key, nestedValue) => {
    if (EMBEDDING_CONTAINER_KEYS.has(comparableKey(key))) {
      const fromContainer = namesFromUnknown(nestedValue)
      names.push(...(fromContainer.length > 0 ? fromContainer : [key]))
    }

    if (isEmbeddingName(key)) {
      names.push(key)
    }
  })

  return boundedUniqueNames(names, WORKSPACE_OMICS_MAX_EMBEDDINGS)
}

function visitJsonContainers(
  value: unknown,
  visit: (key: string, nestedValue: unknown) => void,
  depth = 0
): void {
  if (depth > 6 || (!isPlainObject(value) && !Array.isArray(value))) return

  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      visitJsonContainers(nestedValue, visit, depth + 1)
    }
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    visit(key, nestedValue)
    visitJsonContainers(nestedValue, visit, depth + 1)
  }
}

function collectAxisKeysFromValues(values: Map<string, string>, axisKeys: Set<string>): string[] {
  const names: string[] = []

  for (const [key, value] of values) {
    const parts = metadataKeyParts(key)
    const axisIndex = parts.findIndex((part) => axisKeys.has(comparableKey(part)))
    if (axisIndex < 0) continue

    const nextPart = parts[axisIndex + 1]
    if (nextPart && !AXIS_SUMMARY_VALUE_KEYS.has(comparableKey(nextPart)) && !isNumericText(nextPart)) {
      names.push(nextPart)
    }

    const lastPart = parts.at(-1)
    if (lastPart && axisKeys.has(comparableKey(lastPart))) {
      names.push(...namesFromUnknown(value))
    }

    if (lastPart && AXIS_SUMMARY_VALUE_KEYS.has(comparableKey(lastPart))) {
      names.push(...namesFromUnknown(value))
    }
  }

  return boundedUniqueNames(names, WORKSPACE_OMICS_MAX_AXIS_KEYS)
}

function collectEmbeddingNamesFromValues(values: Map<string, string>): string[] {
  const names: string[] = []

  for (const [key, value] of values) {
    const parts = metadataKeyParts(key)
    const containerIndex = parts.findIndex((part) => EMBEDDING_CONTAINER_KEYS.has(comparableKey(part)))
    if (containerIndex >= 0) {
      const nextPart = parts[containerIndex + 1]
      if (nextPart && !AXIS_SUMMARY_VALUE_KEYS.has(comparableKey(nextPart)) && !isNumericText(nextPart)) {
        names.push(nextPart)
      } else {
        const fromValue = namesFromUnknown(value)
        names.push(...(fromValue.length > 0 ? fromValue : [parts[containerIndex] ?? key]))
      }
    }

    const lastPart = parts.at(-1)
    if (lastPart && isEmbeddingName(lastPart)) {
      names.push(lastPart)
    }
  }

  return boundedUniqueNames(names, WORKSPACE_OMICS_MAX_EMBEDDINGS)
}

function selectNamedDatasetItems(input: {
  requested: string[]
  available: string[] | undefined
  label: string
  unavailableLabel: string
  warnings: string[]
}): { selected: string[], missing: string[] } {
  const requested = uniqueRequestedNames(input.requested)
  if (requested.length === 0) return { selected: [], missing: [] }

  const selected: string[] = []
  const missing: string[] = []
  const availableNames = boundedUniqueNames(input.available ?? [], WORKSPACE_OMICS_MAX_SELECTION_ITEMS)
  if (availableNames.length === 0) {
    input.warnings.push(`Missing ${input.label}: ${requested.join(', ')}. Preview metadata did not include the ${input.unavailableLabel}.`)
    return { selected, missing: requested }
  }

  for (const requestedName of requested) {
    const availableName = availableNames.find((name) => comparableName(name) === comparableName(requestedName))
    if (availableName) {
      addUniqueSelectionName(selected, availableName)
    } else {
      missing.push(requestedName)
    }
  }

  addMissingNameWarnings(input.warnings, input.label, missing)
  return { selected, missing }
}

function selectAxisRanges(input: {
  preview: WorkspaceOmicsPreviewResult
  requests: WorkspaceOmicsAxisRangeRequest[]
  selectedMatrixIds: string[]
  missingRanges: WorkspaceOmicsAxisRangeRequest[]
  warnings: string[]
}): WorkspaceOmicsSelectionRange[] {
  const ranges: WorkspaceOmicsSelectionRange[] = []

  for (const request of input.requests) {
    const matrix = matrixForRangeRequest({
      request,
      matrices: input.preview.matrices,
      selectedMatrixIds: input.selectedMatrixIds,
      missingRanges: input.missingRanges,
      warnings: input.warnings
    })
    if (!matrix) continue

    addUniqueSelectionName(input.selectedMatrixIds, matrix.id)
    const normalizedStart = Math.min(request.start, request.end)
    const normalizedEnd = Math.max(request.start, request.end)
    const axisLength = axisLengthFor(matrix, input.preview.dataset, request.axis)
    let start = normalizedStart
    let end = normalizedEnd
    let clipped = false

    if (axisLength !== undefined) {
      start = clampCount(normalizedStart, 0, axisLength)
      end = clampCount(normalizedEnd, 0, axisLength)
      clipped = start !== normalizedStart || end !== normalizedEnd
      if (clipped) {
        input.warnings.push(
          `Axis range ${rangeRequestLabel(request)} was clipped to ${request.axis} length ${axisLength}.`
        )
      }
    } else {
      input.warnings.push(
        `Axis range ${rangeRequestLabel(request)} could not be validated because ${request.axis} length is unavailable in preview metadata.`
      )
    }

    ranges.push({
      matrixId: matrix.id,
      ...(matrix.name ? { matrixName: matrix.name } : {}),
      axis: request.axis,
      start,
      end,
      ...(axisLength !== undefined ? { axisLength } : {}),
      ...(clipped ? { clipped } : {})
    })
  }

  return ranges
}

function matrixForRangeRequest(input: {
  request: WorkspaceOmicsAxisRangeRequest
  matrices: WorkspaceOmicsMatrixSummary[]
  selectedMatrixIds: string[]
  missingRanges: WorkspaceOmicsAxisRangeRequest[]
  warnings: string[]
}): WorkspaceOmicsMatrixSummary | undefined {
  if (input.request.matrixId) {
    const matrix = findMatrixById(input.matrices, input.request.matrixId)
    if (matrix) return matrix

    input.missingRanges.push(input.request)
    input.warnings.push(`Missing matrix id for axis range: ${input.request.matrixId}.`)
    return undefined
  }

  if (input.request.matrixName) {
    const matrix = findMatrixByName(input.matrices, input.request.matrixName)
    if (matrix) return matrix

    input.missingRanges.push(input.request)
    input.warnings.push(`Missing matrix name for axis range: ${input.request.matrixName}.`)
    return undefined
  }

  const selectedMatrices = input.selectedMatrixIds
    .map((matrixId) => findMatrixById(input.matrices, matrixId))
    .filter((matrix): matrix is WorkspaceOmicsMatrixSummary => matrix !== undefined)

  if (selectedMatrices.length === 1) return selectedMatrices[0]
  if (input.matrices.length === 1) return input.matrices[0]

  input.missingRanges.push(input.request)
  input.warnings.push(
    input.matrices.length === 0
      ? `Axis range ${rangeRequestLabel(input.request)} could not be attached because no matrix summaries are available.`
      : `Axis range ${rangeRequestLabel(input.request)} is ambiguous; include matrixId or matrixName.`
  )
  return undefined
}

function axisLengthFor(
  matrix: WorkspaceOmicsMatrixSummary,
  dataset: WorkspaceOmicsDatasetSummary | undefined,
  axis: WorkspaceOmicsSelectionAxis
): number | undefined {
  if (axis === 'obs' || axis === 'row') {
    return matrix.rowCount ?? matrix.shape?.[0] ?? dataset?.nObs ?? dataset?.shape?.[0]
  }

  return matrix.columnCount ?? matrix.shape?.[1] ?? dataset?.nVars ?? dataset?.shape?.[1]
}

function findMatrixById(matrices: WorkspaceOmicsMatrixSummary[], matrixId: string): WorkspaceOmicsMatrixSummary | undefined {
  return matrices.find((matrix) => comparableName(matrix.id) === comparableName(matrixId))
}

function findMatrixByName(matrices: WorkspaceOmicsMatrixSummary[], matrixName: string): WorkspaceOmicsMatrixSummary | undefined {
  return matrices.find((matrix) => matrix.name !== undefined && comparableName(matrix.name) === comparableName(matrixName))
}

function uniqueRequestedNames(values: string[]): string[] {
  return boundedUniqueNames(values, WORKSPACE_OMICS_MAX_SELECTION_ITEMS)
}

function addUniqueSelectionName(values: string[], value: string): void {
  if (values.length >= WORKSPACE_OMICS_MAX_SELECTION_ITEMS) return
  if (values.some((existing) => comparableName(existing) === comparableName(value))) return
  values.push(value)
}

function addMissingNameWarnings(warnings: string[], label: string, missing: string[]): void {
  if (missing.length === 0) return
  warnings.push(`Missing ${label}: ${missing.join(', ')}.`)
}

function rangeRequestLabel(request: WorkspaceOmicsAxisRangeRequest): string {
  const target = request.matrixId
    ? ` on matrix id ${request.matrixId}`
    : request.matrixName
      ? ` on matrix name ${request.matrixName}`
      : ''
  return `${request.axis} ${request.start}-${request.end}${target}`
}

function clampCount(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function comparableName(value: string): string {
  return cleanMetadataValue(value).toLowerCase()
}

function axisKeysFromContainer(value: unknown): string[] {
  if (isPlainObject(value)) {
    for (const summaryKey of ['keys', 'columns', 'fields', 'names']) {
      if (summaryKey in value) {
        const names = namesFromUnknown(value[summaryKey])
        if (names.length > 0) return names
      }
    }

    return Object.keys(value).filter((key) => {
      const comparable = comparableKey(key)
      return !AXIS_SUMMARY_VALUE_KEYS.has(comparable) && !isNumericText(key)
    })
  }

  return namesFromUnknown(value)
}

function namesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => namesFromUnknown(item))
  }

  if (isPlainObject(value)) {
    for (const summaryKey of ['name', 'key', 'id', 'label']) {
      const nestedValue = value[summaryKey]
      if (typeof nestedValue === 'string') return [nestedValue]
    }

    for (const summaryKey of ['names', 'keys', 'columns', 'fields']) {
      if (summaryKey in value) {
        return namesFromUnknown(value[summaryKey])
      }
    }

    return Object.keys(value)
  }

  if (typeof value !== 'string') return []

  const trimmed = cleanMetadataValue(value)
  if (!trimmed || /^(?:true|false|null)$/i.test(trimmed) || isNumericText(trimmed)) return []

  const parsed = parseJsonMetadataValue(trimmed)
  if (parsed !== undefined) return namesFromUnknown(parsed)

  return trimmed
    .split(/[,;\s/]+/)
    .map((name) => cleanMetadataValue(name))
    .filter((name) => name.length > 0 && !isNumericText(name))
}

function normalizeShape(value: number[] | undefined): number[] | undefined {
  if (!value || value.length < 2) return undefined
  const shape = value.filter(isNonNegativeInteger).slice(0, WORKSPACE_OMICS_MAX_SHAPE_AXES)
  return shape.length >= 2 ? shape : undefined
}

function boundedUniqueNames(values: string[], maxLength: number): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const name = cleanMetadataValue(value).slice(0, 256)
    if (!name || isNumericText(name)) continue

    const comparable = name.toLowerCase()
    if (seen.has(comparable)) continue

    seen.add(comparable)
    names.push(name)
    if (names.length >= maxLength) break
  }

  return names
}

function metadataKeyParts(key: string): string[] {
  return key
    .split(/[./[\]\s]+/)
    .map((part) => cleanMetadataValue(part))
    .filter(Boolean)
}

function comparableKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isEmbeddingName(value: string): boolean {
  return /^X_[A-Za-z0-9_-]+$/.test(value)
}

function isNumericText(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value.trim().replace(/,/g, ''))
}

function inferMatrixFromMetadata(
  metadata: WorkspaceOmicsMetadataSummary,
  format: WorkspaceOmicsResolvedFormat,
  dataset: WorkspaceOmicsDatasetSummary | undefined
): WorkspaceOmicsMatrixSummary | undefined {
  if (metadata.entries.length === 0 && !dataset) return undefined

  const values = new Map(metadata.entries.map((entry) => [entry.key.toLowerCase(), entry.value]))
  const shape = firstShape(values)
  const matrixShape = dataset?.shape ?? shape
  const rowCount = dataset?.nObs ?? firstInteger(values, ['n_obs', 'obs', 'observations', 'rows', 'row_count', 'nrows']) ?? matrixShape?.[0]
  const columnCount = dataset?.nVars ?? firstInteger(values, ['n_vars', 'vars', 'variables', 'columns', 'column_count', 'ncols']) ?? matrixShape?.[1]
  const nonZeroCount = dataset?.nnz ?? firstInteger(values, ['nnz', 'nonzero', 'non_zero_count', 'nonzeros', 'x.nnz', 'matrix.nnz'])

  if (rowCount === undefined && columnCount === undefined && nonZeroCount === undefined && matrixShape === undefined) return undefined

  return {
    id: 'matrix-1',
    name: 'Matrix metadata',
    source: 'metadata',
    format,
    ...(matrixShape !== undefined ? { shape: matrixShape } : {}),
    ...(rowCount !== undefined ? { rowCount } : {}),
    ...(columnCount !== undefined ? { columnCount } : {}),
    ...(nonZeroCount !== undefined ? { nonZeroCount } : {}),
    ...(rowCount !== undefined && columnCount !== undefined && nonZeroCount !== undefined
      ? { density: densityFor(rowCount, columnCount, nonZeroCount) }
      : {})
  }
}

function resolveOmicsFormat(input: NormalizedWorkspaceOmicsPreviewInput): WorkspaceOmicsResolvedFormat {
  if (input.format !== 'auto') {
    return input.format === 'h5' ? 'hdf5' : input.format
  }

  const text = stripBom(input.text).trimStart()
  if (text.startsWith('%%MatrixMarket')) return 'matrix-market'

  const path = input.path?.trim().toLowerCase().replace(/[\\/]+$/, '') ?? ''
  if (path.endsWith('.mtx')) return 'matrix-market'
  if (path.endsWith('.h5ad')) return 'h5ad'
  if (path.endsWith('.loom')) return 'loom'
  if (path.endsWith('.hdf5') || path.endsWith('.h5')) return 'hdf5'
  if (path.endsWith('.zarr')) return 'zarr'
  if (path.endsWith('.json') || path.endsWith('.zattrs') || path.endsWith('.zarray')) return 'json'
  if (JSON_OBJECT_OR_ARRAY_PATTERN.test(text)) return 'json'

  return 'unknown'
}

function createPlaceholder(format: WorkspaceOmicsResolvedFormat): WorkspaceOmicsPlaceholder | undefined {
  if (!BINARY_PLACEHOLDER_FORMATS.has(format)) return undefined

  return {
    format,
    reason: `${formatLabel(format)} payload parsing is intentionally disabled for this lightweight worker.`,
    supportedSummaries: [
      'format detection',
      'text metadata fallback',
      'JSON-like dataset metadata summary',
      'WorkspaceObservation summary'
    ]
  }
}

function buildWorkspaceObservation(input: ObservationBuildInput): WorkspaceOmicsObservation {
  const annotations = input.warnings.map((warning, index) => ({
    id: `warning-${index + 1}`,
    kind: 'warning',
    summary: warning
  }))

  return {
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    file: {
      path: input.input.path?.trim() || inlinePathFor(input.format),
      ...(input.input.workspaceRoot ? { workspaceRoot: input.input.workspaceRoot } : {}),
      mimeType: input.input.mimeType ?? defaultMimeType(input.format),
      ...(input.input.size !== undefined ? { size: input.input.size } : {}),
      ...(input.input.mtimeMs !== undefined ? { mtimeMs: input.input.mtimeMs } : {})
    },
    view: {
      pluginId: WORKSPACE_OMICS_PLUGIN_ID,
      modality: 'omics',
      mode: 'preview',
      title: titleForPath(input.input.path)
    },
    visibleText: buildVisibleText(input),
    omics: {
      format: input.format,
      matrices: input.matrices,
      metadata: input.metadata,
      ...(input.dataset ? { dataset: input.dataset } : {}),
      capabilities: copyCapabilities(),
      ...(input.placeholder ? { placeholder: input.placeholder } : {})
    },
    ...(annotations.length > 0 ? { annotations } : {}),
    actions: [...WORKSPACE_OMICS_ACTIONS]
  }
}

function buildVisibleText(input: ObservationBuildInput): string {
  const lines = [
    `Omics matrix summary: ${formatLabel(input.format)}.`
  ]

  if (input.matrices.length > 0) {
    lines.push('Matrices:')
    for (const matrix of input.matrices) {
      const dimensions = matrix.rowCount !== undefined && matrix.columnCount !== undefined
        ? `${matrix.rowCount} x ${matrix.columnCount}`
        : 'dimensions unknown'
      const nnz = matrix.nonZeroCount !== undefined ? `, nnz ${matrix.nonZeroCount}` : ''
      lines.push(`- ${matrix.name ?? matrix.id}: ${dimensions}${nnz}.`)
    }
  } else {
    lines.push('No matrix dimensions were parsed.')
  }

  if (input.dataset) {
    const dimensions = input.dataset.nObs !== undefined && input.dataset.nVars !== undefined
      ? `${input.dataset.nObs} observations x ${input.dataset.nVars} variables`
      : input.dataset.shape
        ? `shape ${input.dataset.shape.join(' x ')}`
        : undefined
    const nnz = input.dataset.nnz !== undefined ? `nnz ${input.dataset.nnz}` : undefined
    const axisMetadata = [
      input.dataset.obsKeyCount !== undefined ? `obs keys ${input.dataset.obsKeyCount}` : undefined,
      input.dataset.varKeyCount !== undefined ? `var keys ${input.dataset.varKeyCount}` : undefined
    ].filter(Boolean)

    lines.push('Dataset metadata:')
    if (dimensions) lines.push(`- ${dimensions}.`)
    if (nnz) lines.push(`- ${nnz}.`)
    if (axisMetadata.length > 0) lines.push(`- ${axisMetadata.join(', ')}.`)
    if (input.dataset.embeddingNames && input.dataset.embeddingNames.length > 0) {
      lines.push(`- Embeddings: ${input.dataset.embeddingNames.join(', ')}.`)
    }
  }

  if (input.metadata.entries.length > 0) {
    lines.push(`Metadata (${input.metadata.source}):`)
    for (const entry of input.metadata.entries.slice(0, 20)) {
      lines.push(`- ${entry.key}: ${entry.value}`)
    }
  }

  if (input.placeholder) {
    lines.push(`Placeholder: ${input.placeholder.reason}`)
  }

  if (input.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of input.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  return truncateText(lines.join('\n'), WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS)
}

function buildDatasetSelectionVisibleText(input: {
  selection: WorkspaceOmicsSelection
  missing: WorkspaceOmicsSelectionMissingRequests
  warnings: string[]
}): string {
  const selectedCounts = [
    countLabel(input.selection.matrixIds?.length ?? 0, 'matrix', 'matrices'),
    countLabel(input.selection.obsKeys?.length ?? 0, 'obs key', 'obs keys'),
    countLabel(input.selection.varKeys?.length ?? 0, 'var key', 'var keys'),
    countLabel(input.selection.embeddings?.length ?? 0, 'embedding', 'embeddings'),
    countLabel(input.selection.ranges?.length ?? 0, 'axis range', 'axis ranges')
  ].filter(Boolean)
  const lines = [
    `Omics dataset selection: ${selectedCounts.length > 0 ? selectedCounts.join(', ') : 'no matched requests'}.`
  ]

  if (input.selection.matrixIds?.length) {
    lines.push(`Matrices: ${input.selection.matrixIds.join(', ')}.`)
  }
  if (input.selection.obsKeys?.length) {
    lines.push(`Obs keys: ${input.selection.obsKeys.join(', ')}.`)
  }
  if (input.selection.varKeys?.length) {
    lines.push(`Var keys: ${input.selection.varKeys.join(', ')}.`)
  }
  if (input.selection.embeddings?.length) {
    lines.push(`Embeddings: ${input.selection.embeddings.join(', ')}.`)
  }
  if (input.selection.ranges?.length) {
    lines.push('Axis ranges:')
    for (const range of input.selection.ranges) {
      const length = range.axisLength !== undefined ? ` of ${range.axisLength}` : ''
      const clipped = range.clipped ? ' clipped' : ''
      lines.push(`- ${range.matrixId} ${range.axis} ${range.start}-${range.end}${length}${clipped}.`)
    }
  }

  const missingSummary = missingRequestsSummary(input.missing)
  if (missingSummary.length > 0) {
    lines.push(`Missing requests: ${missingSummary.join('; ')}.`)
  }

  if (input.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of input.warnings) {
      lines.push(`- ${warning}`)
    }
  }

  return truncateText(lines.join('\n'), WORKSPACE_OMICS_MAX_VISIBLE_TEXT_CHARS)
}

function missingRequestsSummary(missing: WorkspaceOmicsSelectionMissingRequests): string[] {
  return [
    missing.matrixIds.length > 0 ? `matrix ids ${missing.matrixIds.join(', ')}` : undefined,
    missing.matrixNames.length > 0 ? `matrix names ${missing.matrixNames.join(', ')}` : undefined,
    missing.obsKeys.length > 0 ? `obs keys ${missing.obsKeys.join(', ')}` : undefined,
    missing.varKeys.length > 0 ? `var keys ${missing.varKeys.join(', ')}` : undefined,
    missing.embeddings.length > 0 ? `embeddings ${missing.embeddings.join(', ')}` : undefined,
    missing.ranges.length > 0 ? `${missing.ranges.length} axis range${missing.ranges.length === 1 ? '' : 's'}` : undefined
  ].filter((value): value is string => value !== undefined)
}

function countLabel(count: number, singular: string, plural: string): string | undefined {
  if (count <= 0) return undefined
  return `${count} ${count === 1 ? singular : plural}`
}

function firstShape(values: Map<string, string>): [number, number] | undefined {
  for (const key of ['shape', 'x.shape', 'matrix.shape', 'matrix_shape', 'dimensions', 'dims']) {
    const value = valueForExactKey(values, key)
    if (!value) continue
    const numbers = parseShapeNumbers(value)
    if (numbers.length >= 2) {
      return [numbers[0], numbers[1]]
    }
  }

  return undefined
}

function firstInteger(values: Map<string, string>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = valueForExactKey(values, key)
    const parsed = value ? parseInteger(value) : undefined
    if (parsed !== undefined) return parsed
  }

  const comparableKeys = new Set(keys.map(comparableKey))
  for (const [entryKey, value] of values) {
    const parts = metadataKeyParts(entryKey)
    const lastPart = parts.at(-1)
    if (!lastPart || !comparableKeys.has(comparableKey(lastPart))) continue

    const parsed = parseInteger(value)
    if (parsed !== undefined) return parsed
  }

  return undefined
}

function valueForExactKey(values: Map<string, string>, key: string): string | undefined {
  const direct = values.get(key)
  if (direct !== undefined) return direct

  const comparable = comparableKey(key)
  for (const [entryKey, value] of values) {
    if (comparableKey(entryKey) === comparable) return value
  }

  return undefined
}

function parseShapeNumbers(value: string): number[] {
  const parsed = parseJsonMetadataValue(value)
  if (Array.isArray(parsed)) {
    return parsed.filter(isNonNegativeInteger)
  }

  return value
    .replace(/[\\[\\]()]/g, ' ')
    .split(/[xX,;\s]+/)
    .map((part) => parseInteger(part))
    .filter((part): part is number => part !== undefined)
}

function parseInteger(value: string): number | undefined {
  const normalized = value.replace(/,/g, '').trim()
  const match = /^\d+/.exec(normalized)
  if (!match) return undefined
  const parsed = Number.parseInt(match[0], 10)
  return isNonNegativeInteger(parsed) ? parsed : undefined
}

function densityFor(rowCount: number, columnCount: number, nonZeroCount: number): number | undefined {
  const denominator = rowCount * columnCount
  if (!Number.isFinite(denominator) || denominator <= 0) return undefined
  return Math.min(1, nonZeroCount / denominator)
}

function metadataEntry(key: string, value: unknown): WorkspaceOmicsMetadataEntry {
  return {
    key: normalizeMetadataKey(key),
    value: truncateText(stringifyMetadataValue(value), 10_000),
    valueType: metadataValueType(value)
  }
}

function boundedMetadata(source: WorkspaceOmicsMetadataSummary['source'], entries: WorkspaceOmicsMetadataEntry[]): WorkspaceOmicsMetadataSummary {
  const boundedEntries = entries
    .filter((entry) => entry.key.length > 0)
    .slice(0, WORKSPACE_OMICS_MAX_METADATA_ENTRIES)

  return {
    source: boundedEntries.length > 0 ? source : 'none',
    entries: boundedEntries,
    truncated: entries.length > boundedEntries.length
  }
}

function emptyMetadata(): WorkspaceOmicsMetadataSummary {
  return {
    source: 'none',
    entries: [],
    truncated: false
  }
}

function copyCapabilities() {
  return WORKSPACE_OMICS_FORMAT_CAPABILITIES.map((capability) => ({
    ...capability,
    extensions: [...capability.extensions]
  }))
}

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeMetadataKey(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '_').slice(0, 256)
}

function cleanMetadataValue(value: string): string {
  return value.trim().replace(/,$/, '').replace(/^["']|["']$/g, '')
}

function parseScalarValue(value: string): unknown {
  const trimmed = value.trim()
  if (/^(?:true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true'
  if (/^null$/i.test(trimmed)) return null
  const numeric = Number(trimmed.replace(/,/g, ''))
  if (trimmed !== '' && Number.isFinite(numeric) && /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(trimmed)) {
    return numeric
  }
  return trimmed
}

function stringifyMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function metadataValueType(value: unknown): WorkspaceOmicsMetadataEntry['valueType'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return type
  return 'object'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}

function stripBom(value: string): string {
  return value.startsWith('\ufeff') ? value.slice(1) : value
}

function boundedWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => truncateText(warning.trim(), 1000)).filter(Boolean).slice(0, WORKSPACE_OMICS_MAX_WARNINGS)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

function titleForPath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) return 'Omics matrix'
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
}

function inlinePathFor(format: WorkspaceOmicsResolvedFormat): string {
  return format === 'unknown' ? 'inline-omics-matrix' : `inline-${format}-omics-matrix`
}

function defaultMimeType(format: WorkspaceOmicsResolvedFormat): string {
  switch (format) {
    case 'matrix-market':
      return 'text/plain'
    case 'json':
    case 'zarr':
      return 'application/json'
    case 'h5ad':
    case 'loom':
    case 'hdf5':
      return 'application/x-hdf5'
    case 'unknown':
      return 'application/octet-stream'
  }
}

function formatLabel(format: WorkspaceOmicsResolvedFormat): string {
  switch (format) {
    case 'matrix-market':
      return 'Matrix Market'
    case 'h5ad':
      return 'AnnData H5AD'
    case 'loom':
      return 'Loom'
    case 'hdf5':
      return 'HDF5'
    case 'zarr':
      return 'Zarr'
    case 'json':
      return 'JSON metadata'
    case 'unknown':
      return 'unknown omics'
  }
}
