import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk'
import {
  canonicalizeReproValue,
  canonicalizeReproSpecForDigest,
  sciforgeReproSpecSchema,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'
import type {
  WorkflowActivityReceiptV2,
  WorkflowApprovalRecordV2,
  WorkflowArtifactReferenceV2,
  WorkflowExecutionSnapshotV1,
  WorkflowFingerprint,
  WorkflowNodeRunResultV1,
  WorkflowRunComparatorV1,
  WorkflowRunComparisonV1,
  WorkflowRunContextV2,
  WorkflowRunDeterminismV2,
  WorkflowRunDifferenceV1,
  WorkflowRunManifestV2,
  WorkflowRunV1,
  WorkflowV1
} from './contract.js'

export const EXACT_OUTPUT_COMPARATOR: WorkflowRunComparatorV1 = Object.freeze({
  kind: 'exact-digest'
})

const CREATE_LOOP_EXECUTOR_VERSION = 'sciforge.create-loop.executor.v1' as const
const EMPTY_REPRO_DIGEST = `sha256:${'0'.repeat(64)}`
const SECRET_REFERENCE_PREFIX = '__SCIFORGE_SECRET_REF__:'
const SECRET_REDACTION_TEXT = '[REDACTED]'
const MINIMUM_SUBSTRING_SECRET_LENGTH = 4
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key'
])
const EXPLICIT_CREDENTIAL_FIELD_NAMES = new Set([
  'apikey',
  'apisecret',
  'accesstoken',
  'clientsecret',
  'credential',
  'credentials',
  'idtoken',
  'password',
  'passwd',
  'passphrase',
  'privatekey',
  'refreshtoken',
  'secret',
  'token'
])
const STOCHASTIC_NODE_TYPES = new Set([
  'llm',
  'ai-agent',
  'generate-image',
  'parameter-extractor',
  'question-classifier'
])
const EXTERNAL_STATE_NODE_TYPES = new Set([
  'http-request',
  'research-search',
  'paper-download'
])
const UNAVAILABLE_TOOL_NODE_TYPES = new Set([
  'generate-image',
  'research-search',
  'paper-download'
])
const TOOL_NODE_TYPES = new Set([
  ...STOCHASTIC_NODE_TYPES,
  ...EXTERNAL_STATE_NODE_TYPES,
  'code',
  'custom'
])

type BaselineNode = Readonly<{
  nodeId: string
  componentFingerprint: WorkflowFingerprint
  inputFingerprint: WorkflowFingerprint
  outputFingerprint: WorkflowFingerprint
  receiptFingerprints: readonly WorkflowFingerprint[]
  artifactFingerprints: readonly WorkflowFingerprint[]
}>

type CreateLoopExecutorPayloadV1 = Readonly<{
  schemaVersion: typeof CREATE_LOOP_EXECUTOR_VERSION
  workflow: WorkflowExecutionSnapshotV1
  /** Trigger identity is part of the executable topology. Older one-trigger specs may omit it. */
  triggerNodeId?: string
  input: DomainPackageJsonValue
  context: WorkflowRunContextV2
  baseline: Readonly<{
    runId: string
    workflowFingerprint: WorkflowFingerprint
    inputFingerprint: WorkflowFingerprint
    specFingerprint: WorkflowFingerprint
    contextFingerprint: WorkflowFingerprint
    outputFingerprint: WorkflowFingerprint
    outputJson: string
    approvalFingerprint: WorkflowFingerprint
    nodeResults: readonly BaselineNode[]
  }>
}>

export type ParsedCreateLoopReproSpec = Readonly<{
  spec: SciForgeReproSpecV1
  activity: SciForgeReproSpecV1['activities'][number]
  executor: Extract<
    SciForgeReproSpecV1['activities'][number]['executor'],
    { kind: 'create-loop' }
  >
  payload: CreateLoopExecutorPayloadV1
}>

export type WorkflowExecutionSnapshotCaptureV1 = Readonly<{
  workflow: WorkflowExecutionSnapshotV1
  secretSlots: SciForgeReproSpecV1['secretSlots']
}>

export function workflowFingerprint(value: unknown): WorkflowFingerprint {
  const json = toJsonValue(value)
  return `sha256:${sha256Hex(canonicalizeReproValue(json))}`
}

/** Hash receipt diagnostics semantically so JSON key order cannot create a false rerun difference. */
export function workflowActivityReceiptFingerprint(
  receipt: WorkflowActivityReceiptV2
): WorkflowFingerprint {
  return workflowFingerprint({
    ...receipt,
    ...(receipt.detail === undefined ? {} : { detail: parseJsonOrText(receipt.detail) })
  })
}

export function captureWorkflowExecutionSnapshot(
  workflow: WorkflowV1 | WorkflowExecutionSnapshotV1
): WorkflowExecutionSnapshotCaptureV1 {
  const slots = new Map<string, SciForgeReproSpecV1['secretSlots'][number]>()
  const env = workflow.env.map((entry, index) => {
    if (entry.type !== 'secret') return { ...entry }
    const path = `workflow.env.${credentialPathSegment(entry.key || String(index))}.value`
    return {
      ...entry,
      value: secretPlaceholder(registerSecretSlot(slots, path))
    }
  })
  const nodes = workflow.nodes.map((node, index) => {
    const cloned = structuredClone(node)
    const path = `workflow.nodes.${credentialPathSegment(node.id || String(index))}.config`
    return {
      ...cloned,
      config: redactStaticCredentials(cloned.config, path, slots)
    } as WorkflowExecutionSnapshotV1['nodes'][number]
  })
  return {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      env,
      nodes,
      connections: structuredClone(workflow.connections)
    },
    secretSlots: [...slots.values()].sort((left, right) => compareUtf16(left.id, right.id))
  }
}

export function createWorkflowExecutionSnapshot(
  workflow: WorkflowV1 | WorkflowExecutionSnapshotV1
): WorkflowExecutionSnapshotV1 {
  return captureWorkflowExecutionSnapshot(workflow).workflow
}

function redactStaticCredentials(
  value: unknown,
  path: string,
  slots: Map<string, SciForgeReproSpecV1['secretSlots'][number]>
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactStaticCredentials(entry, `${path}.${index}`, slots))
  }
  if (!isRecord(value)) return value

  const declaredName = typeof value.key === 'string'
    ? value.key
    : typeof value.name === 'string'
      ? value.name
      : ''
  const redactValueFields = isSensitiveHeaderName(declaredName) ||
    isExplicitCredentialFieldName(declaredName)
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${credentialPathSegment(key)}`
    const declaredSecretValue = redactValueFields && (key === 'value' || key === 'defaultValue')
    if (declaredSecretValue || isExplicitCredentialFieldName(key) || isSensitiveHeaderName(key)) {
      result[key] = secretPlaceholder(registerSecretSlot(slots, childPath))
    } else {
      result[key] = redactStaticCredentials(entry, childPath, slots)
    }
  }
  return result
}

function isSensitiveHeaderName(value: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(value.trim().toLowerCase())
}

function isExplicitCredentialFieldName(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return EXPLICIT_CREDENTIAL_FIELD_NAMES.has(normalized)
}

function credentialPathSegment(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/gu, '_') || '_'
}

function registerSecretSlot(
  slots: Map<string, SciForgeReproSpecV1['secretSlots'][number]>,
  path: string
): string {
  const readable = credentialPathSegment(path)
  const id = readable.length <= 480
    ? `secret:${readable}`
    : `secret:${readable.slice(0, 400)}:${sha256Hex(path)}`
  if (!slots.has(id)) {
    slots.set(id, {
      id,
      name: path.length <= 1_024 ? path : `${path.slice(0, 950)}…`,
      required: true
    })
  }
  return id
}

function secretPlaceholder(slotId: string): string {
  return `${SECRET_REFERENCE_PREFIX}${slotId}`
}

/**
 * Redacts only structurally identified credential fields. Arbitrary strings are deliberately not
 * pattern-matched, which keeps ordinary scientific token/count fields reproducible.
 */
export function redactWorkflowStructuredSecrets(
  value: unknown,
  path = 'run.value'
): DomainPackageJsonValue {
  const slots = new Map<string, SciForgeReproSpecV1['secretSlots'][number]>()
  return toJsonValue(redactStaticCredentials(value, path, slots))
}

/**
 * Finds concrete credential values that the runtime has already received. Besides structurally
 * named credential fields, bearer credentials and URL userinfo are recognized wherever they are
 * embedded so an echoed tool message cannot move them into an otherwise innocuous field.
 */
export function collectWorkflowSecretValues(...values: readonly unknown[]): string[] {
  const secrets = new Set<string>()
  const visit = (value: unknown, sensitive: boolean, depth: number): void => {
    if (depth > 40 || value === null || value === undefined) return
    if (typeof value === 'string') {
      if (sensitive) addSecretValue(secrets, value)
      addEmbeddedCredentialValues(secrets, value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, sensitive, depth + 1))
      return
    }
    if (!isRecord(value)) return

    const declaredName = typeof value.key === 'string'
      ? value.key
      : typeof value.name === 'string'
        ? value.name
        : ''
    const declaredSecret = isSensitiveHeaderName(declaredName) ||
      isExplicitCredentialFieldName(declaredName)
    const secretRecord = value.type === 'secret'
    for (const [key, entry] of Object.entries(value)) {
      const childSensitive = sensitive ||
        (secretRecord && key === 'value') ||
        (declaredSecret && (key === 'value' || key === 'defaultValue')) ||
        isExplicitCredentialFieldName(key) ||
        isSensitiveHeaderName(key)
      visit(entry, childSensitive, depth + 1)
    }
  }
  values.forEach((value) => visit(value, false, 0))
  return [...secrets].sort((left, right) => right.length - left.length || compareUtf16(left, right))
}

/** Recursively removes runtime-known credentials without depending on their destination field. */
export function redactWorkflowKnownSecretValues<T>(
  value: T,
  secretValues: readonly string[]
): T {
  const normalizedSecrets = normalizeSecretValues(secretValues)
  const visit = (current: unknown, depth: number): unknown => {
    if (depth > 60 || current === null || current === undefined) return current
    if (typeof current === 'string') return redactKnownSecretsFromString(current, normalizedSecrets)
    if (Array.isArray(current)) return current.map((entry) => visit(entry, depth + 1))
    if (!isRecord(current)) return current
    return Object.fromEntries(
      Object.entries(current).map(([key, entry]) => [key, visit(entry, depth + 1)])
    )
  }
  return visit(value, 0) as T
}

/** Produces the history-safe node receipts used by state, export, and terminal artifacts. */
export function redactWorkflowNodeResults(
  results: readonly WorkflowNodeRunResultV1[],
  knownSecretValues: readonly string[] = []
): WorkflowNodeRunResultV1[] {
  const discoveredSecrets = collectWorkflowSecretValues(
    ...results,
    ...results.flatMap((result) => [
      result.inputJson ? parseJsonOrText(result.inputJson) : null,
      result.outputJson ? parseJsonOrText(result.outputJson) : null
    ])
  )
  const secretValues = normalizeSecretValues([...knownSecretValues, ...discoveredSecrets])
  return results.map((result, index) => {
    const safeResult = redactWorkflowKnownSecretValues(structuredClone(result), secretValues)
    const basePath = `run.nodes.${credentialPathSegment(result.nodeId || String(index))}`
    const inputValue = result.inputJson === undefined || result.inputJson === ''
      ? null
      : parseJsonOrText(result.inputJson)
    const outputValue = result.outputJson === '' ? null : parseJsonOrText(result.outputJson)
    const safeInput = redactWorkflowKnownSecretValues(
      redactWorkflowStructuredSecrets(inputValue, `${basePath}.input`),
      secretValues
    )
    const safeOutput = redactWorkflowKnownSecretValues(
      redactWorkflowStructuredSecrets(outputValue, `${basePath}.output`),
      secretValues
    )
    const inputFingerprint = workflowFingerprint(safeInput)
    const outputFingerprint = workflowFingerprint(safeOutput)
    return {
      ...safeResult,
      ...(result.inputJson === undefined ? {} : { inputJson: canonicalizeReproValue(safeInput) }),
      outputJson: result.outputJson === '' ? '' : canonicalizeReproValue(safeOutput),
      inputFingerprint,
      outputFingerprint,
      attempts: safeResult.attempts.map((attempt) => {
        const receipt = attempt.receipt.outputFingerprint === undefined
          ? structuredClone(attempt.receipt)
          : { ...structuredClone(attempt.receipt), outputFingerprint }
        return {
          ...structuredClone(attempt),
          inputFingerprint,
          receipt,
          receiptFingerprint: workflowActivityReceiptFingerprint(receipt)
        }
      })
    }
  })
}

function normalizeSecretValues(values: readonly string[]): string[] {
  const secrets = new Set<string>()
  values.forEach((value) => addSecretValue(secrets, value))
  return [...secrets].sort((left, right) => right.length - left.length || compareUtf16(left, right))
}

function addSecretValue(secrets: Set<string>, rawValue: string): void {
  const value = rawValue.trim()
  if (!value || value === SECRET_REDACTION_TEXT || value.startsWith(SECRET_REFERENCE_PREFIX)) return
  secrets.add(value)
  addEmbeddedCredentialValues(secrets, value)
}

function addEmbeddedCredentialValues(secrets: Set<string>, value: string): void {
  for (const match of value.matchAll(/\bBearer\s+([^\s"'<>]+)/giu)) {
    const token = match[1]?.replace(/[),.;]+$/u, '') ?? ''
    if (token) secrets.add(token)
    if (match[0]) secrets.add(match[0])
  }
  for (const match of value.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/@\s]+)@/gu)) {
    const userinfo = match[1] ?? ''
    if (!userinfo) continue
    secrets.add(userinfo)
    const separator = userinfo.indexOf(':')
    const username = separator >= 0 ? userinfo.slice(0, separator) : userinfo
    const password = separator >= 0 ? userinfo.slice(separator + 1) : ''
    for (const part of [username, password, safeDecodeURIComponent(username), safeDecodeURIComponent(password)]) {
      if (part) secrets.add(part)
    }
  }
}

function redactKnownSecretsFromString(value: string, secretValues: readonly string[]): string {
  let redacted = value
  for (const secret of secretValues) {
    if (redacted === secret) return SECRET_REDACTION_TEXT
    if (secret.length >= MINIMUM_SUBSTRING_SECRET_LENGTH) {
      redacted = redacted.replaceAll(secret, SECRET_REDACTION_TEXT)
    } else if (redacted.includes(secret)) {
      // Replacing every occurrence of a one-character secret can silently corrupt structured data.
      // Drop the whole containing string instead: confidentiality remains fail-closed.
      return SECRET_REDACTION_TEXT
    }
  }
  return redacted
    .replace(/\bBearer\s+[^\s"'<>]+/giu, `Bearer ${SECRET_REDACTION_TEXT}`)
    .replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/gu, `$1${SECRET_REDACTION_TEXT}@`)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function createWorkflowRunContext(
  workflow: WorkflowExecutionSnapshotV1,
  workspaceRoot: string,
  owner: { moduleId: string; moduleVersion: string } | undefined,
  runtime: Readonly<{
    nodeVersion: string
    platform: string
    architecture: string
  }> = {
    nodeVersion: 'unknown',
    platform: 'unknown',
    architecture: 'unknown'
  }
): WorkflowRunContextV2 {
  const safeWorkflow = createWorkflowExecutionSnapshot(workflow)
  return {
    workspaceRoot: workspaceRoot.trim(),
    packageOwner: owner?.moduleId || 'sciforge.create-loop',
    packageVersion: owner?.moduleVersion || 'unknown',
    nodeVersion: runtime.nodeVersion,
    platform: runtime.platform,
    architecture: runtime.architecture,
    environment: safeWorkflow.env
      .map((entry) => ({
        key: entry.key,
        type: entry.type,
        required: entry.type === 'secret',
        ...(entry.type === 'secret' ? {} : { valueFingerprint: workflowFingerprint(entry.value) })
      }))
      .sort((left, right) => compareUtf16(left.key, right.key))
  }
}

export function analyzeWorkflowDeterminism(
  workflow: WorkflowExecutionSnapshotV1,
  extraReasonCodes: readonly string[] = []
): WorkflowRunDeterminismV2 {
  const stochasticNodes = workflow.nodes.filter((node) => STOCHASTIC_NODE_TYPES.has(node.type))
  const unseededNodeIds = stochasticNodes
    .filter((node) => explicitSeed(node.config) === undefined)
    .map((node) => node.id)
    .sort()
  const externalNodeIds = workflow.nodes
    .filter((node) => EXTERNAL_STATE_NODE_TYPES.has(node.type))
    .map((node) => node.id)
    .sort()
  const reasonCodes = [
    ...(unseededNodeIds.length > 0 ? ['unseeded_stochastic_activity'] : []),
    ...(externalNodeIds.length > 0 ? ['external_state_activity'] : []),
    ...extraReasonCodes
  ]
  return {
    control: reasonCodes.length === 0 ? 'controlled' : 'uncontrolled',
    reasonCodes: unique(reasonCodes),
    stochasticNodeIds: stochasticNodes.map((node) => node.id).sort()
  }
}

export function createWorkflowRunManifest(input: {
  source: WorkflowRunManifestV2['source']
  workflow: WorkflowExecutionSnapshotV1
  triggerNodeId?: string
  runInput: unknown
  context: WorkflowRunContextV2
  output: unknown
  nodeResults: readonly WorkflowNodeRunResultV1[]
  approvals: readonly WorkflowApprovalRecordV2[]
  comparator?: WorkflowRunComparatorV1
  rerunOfRunId?: string
  rerunSpecDigest?: WorkflowFingerprint
  comparison?: WorkflowRunComparisonV1
}): WorkflowRunManifestV2 {
  const comparator = input.comparator ?? EXACT_OUTPUT_COMPARATOR
  const workflow = createWorkflowExecutionSnapshot(input.workflow)
  const triggerNodeId = resolveWorkflowTriggerNodeId(workflow, input.triggerNodeId)
  assertWorkflowGraphIntegrity(workflow, triggerNodeId)
  const dynamicSecretSlots = new Map<string, SciForgeReproSpecV1['secretSlots'][number]>()
  const runInput = toJsonValue(redactStaticCredentials(
    input.runInput,
    'run.input',
    dynamicSecretSlots
  ))
  const workflowDigest = workflowFingerprint(workflow)
  const inputDigest = workflowFingerprint(runInput)
  const contextDigest = workflowFingerprint(input.context)
  const approvals = input.approvals.map((record) => structuredClone(record))
  const approvalDigest = approvalFingerprint(approvals)
  const specDigest = workflowFingerprint({
    workflowFingerprint: workflowDigest,
    inputFingerprint: inputDigest,
    contextFingerprint: contextDigest,
    approvalRequirements: approvalRequirements(workflow, triggerNodeId),
    comparator
  })
  const output = toJsonValue(redactStaticCredentials(
    input.output,
    'run.output',
    dynamicSecretSlots
  ))
  return {
    schema: 'sciforge.create-loop.run.v2',
    source: input.source,
    workflow,
    input: runInput,
    context: structuredClone(input.context),
    comparator: structuredClone(comparator),
    determinism: analyzeWorkflowDeterminism(workflow),
    workflowFingerprint: workflowDigest,
    inputFingerprint: inputDigest,
    specFingerprint: specDigest,
    contextFingerprint: contextDigest,
    outputFingerprint: workflowFingerprint(output),
    outputJson: canonicalizeReproValue(output),
    approvalFingerprint: approvalDigest,
    artifactRefs: mergeArtifactReferences(input.nodeResults.flatMap((result) => result.artifactRefs)),
    approvals,
    ...(input.rerunOfRunId ? { rerunOfRunId: input.rerunOfRunId } : {}),
    ...(input.rerunSpecDigest ? { rerunSpecDigest: input.rerunSpecDigest } : {}),
    ...(input.comparison ? { comparison: structuredClone(input.comparison) } : {})
  }
}

/** Exports the one canonical SDK rerun document. Legacy/incomplete runs remain exportable but blocked. */
export function createWorkflowReproSpec(
  run: WorkflowRunV1,
  comparator: WorkflowRunComparatorV1 = EXACT_OUTPUT_COMPARATOR
): SciForgeReproSpecV1 {
  if (!run.manifest) return createBlockedLegacySpec(run)

  const manifest = run.manifest
  const captured = captureWorkflowExecutionSnapshot(manifest.workflow)
  const workflow = captured.workflow
  const triggerNodeId = resolveWorkflowTriggerNodeId(workflow, run.trigger)
  assertWorkflowGraphIntegrity(workflow, triggerNodeId)
  const workflowDigest = workflowFingerprint(workflow)
  const activityId = `workflow-run:${run.id}`
  const approvals = approvalRequirements(workflow, triggerNodeId)
  const secretSlots = mergeSecretSlots(
    captured.secretSlots,
    discoverSecretSlots([manifest, run.nodeResults, run.message])
  )
  const breakpoints = executableBreakpoints(
    { ...manifest, workflow, workflowFingerprint: workflowDigest },
    activityId,
    secretSlots,
    run.status
  )
  const outputReferences = createOutputReferences(manifest, comparator, run.id)
  const parameterSet = {
    id: `parameters:${run.id}`,
    values: cloneJson(manifest.input),
    digest: manifest.inputFingerprint,
    ...singleRandomSeed(workflow)
  }
  const activitySpecFingerprint = workflowFingerprint({
    workflowFingerprint: workflowDigest,
    inputFingerprint: manifest.inputFingerprint,
    contextFingerprint: manifest.contextFingerprint,
    approvalRequirements: approvals,
    comparator
  })
  const payload: CreateLoopExecutorPayloadV1 = {
    schemaVersion: CREATE_LOOP_EXECUTOR_VERSION,
    workflow: structuredClone(workflow),
    triggerNodeId,
    input: cloneJson(manifest.input),
    context: structuredClone(manifest.context),
    baseline: {
      runId: run.id,
      workflowFingerprint: workflowDigest,
      inputFingerprint: manifest.inputFingerprint,
      specFingerprint: activitySpecFingerprint,
      contextFingerprint: manifest.contextFingerprint,
      outputFingerprint: manifest.outputFingerprint,
      outputJson: manifest.outputJson,
      approvalFingerprint: manifest.approvalFingerprint,
      nodeResults: run.nodeResults.map((result) => ({
        nodeId: result.nodeId,
        componentFingerprint: result.componentFingerprint,
        inputFingerprint: result.inputFingerprint,
        outputFingerprint: result.outputFingerprint,
        receiptFingerprints: result.attempts.map((attempt) =>
          workflowActivityReceiptFingerprint(attempt.receipt)
        ),
        artifactFingerprints: result.artifactRefs.map(artifactReferenceFingerprint)
      }))
    }
  }
  const executorWorkflow = toJsonValue(payload)
  const executionReady = !breakpoints.some((breakpoint) => breakpoint.blocking)
  const unsigned = {
    schemaVersion: 'sciforge.rerun.v1' as const,
    specId: `create-loop:${workflow.id}:${run.id}`,
    source: {
      snapshotDigest: workflowFingerprint({
        ...manifest,
        workflow,
        workflowFingerprint: workflowDigest,
        specFingerprint: activitySpecFingerprint
      }),
      activityId
    },
    target: { kind: 'activity' as const, id: activityId },
    executionReady,
    reproducibility: !executionReady
      ? 'incomplete' as const
      : breakpoints.length > 0
        ? 'uncontrolled' as const
        : 'controlled' as const,
    activities: [{
      id: activityId,
      type: 'workflow_run' as const,
      name: workflow.name,
      executor: {
        kind: 'create-loop' as const,
        workflow: executorWorkflow,
        workflowDigest: workflowFingerprint(executorWorkflow),
        target: { kind: 'workflow' as const, id: workflow.id }
      },
      inputs: [{
        id: `input:${run.id}`,
        role: 'input',
        kind: 'embedded-json',
        name: 'Workflow input',
        contentDigest: manifest.inputFingerprint,
        required: true
      }],
      code: createCodeReferences(workflow),
      environments: [{
        id: `environment:${run.id}`,
        name: 'Create Loop runtime',
        platform: manifest.context.platform,
        architecture: manifest.context.architecture,
        runtimeVersions: {
          node: manifest.context.nodeVersion,
          [manifest.context.packageOwner]: manifest.context.packageVersion
        },
        lockDigests: [],
        contentDigest: manifest.contextFingerprint,
        attributes: toJsonValue({ environment: manifest.context.environment })
      }],
      parameterSets: [parameterSet],
      tools: createToolReferences(workflow, manifest.context.packageVersion),
      approvals,
      outputs: outputReferences,
      stochastic: manifest.determinism.stochasticNodeIds.length > 0,
      inputFingerprint: manifest.inputFingerprint,
      specFingerprint: activitySpecFingerprint,
      executionContextFingerprint: manifest.contextFingerprint,
      baselineOutputFingerprint: manifest.outputFingerprint
    }],
    dependencies: [],
    secretSlots,
    breakpoints,
    createdAt: validTimestamp(run.finishedAt || run.startedAt)
  }
  return finalizeReproSpec(unsigned)
}

export function parseCreateLoopReproSpec(
  value: unknown,
  requestedActivityId?: string
): ParsedCreateLoopReproSpec {
  let input = value
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      throw new Error('Rerun specification is not valid JSON.')
    }
  }
  const result = sciforgeReproSpecSchema.safeParse(input)
  if (!result.success) {
    throw new Error(`Invalid sciforge.rerun.v1 specification: ${result.error.message}`)
  }
  const spec = result.data
  const observedDigest = fingerprintCanonicalText(canonicalizeReproSpecForDigest(spec))
  if (observedDigest !== spec.specDigest) {
    throw new Error(
      `Rerun specification digest mismatch: expected ${spec.specDigest}, observed ${observedDigest}.`
    )
  }
  if (spec.secretSlots.some((slot) => slot.required)) {
    throw new Error(
      'Rerun specification requires secret injection, but no safe secret resolver is available.'
    )
  }
  if (!spec.executionReady) {
    throw new Error('Rerun specification is blocked by missing executable metadata.')
  }
  const executableActivities = spec.activities.filter(
    (candidate) => candidate.executor.kind === 'create-loop'
  )
  const selectedId = requestedActivityId?.trim() ||
    (spec.target.kind === 'activity' ? spec.target.id : undefined)
  const activity = selectedId
    ? spec.activities.find((candidate) => candidate.id === selectedId)
    : executableActivities.length === 1
      ? executableActivities[0]
      : undefined
  if (!activity) {
    if (spec.target.kind === 'conclusion' && executableActivities.length > 1) {
      throw new Error(
        'Conclusion rerun contains multiple executable activities; provide activityId to select one.'
      )
    }
    throw new Error('Rerun target activity is missing.')
  }
  if (activity.executor.kind !== 'create-loop') {
    throw new Error('Rerun target is not executable by Create Loop.')
  }
  if (workflowFingerprint(activity.executor.workflow) !== activity.executor.workflowDigest) {
    throw new Error('Create Loop executor payload digest does not match the rerun specification.')
  }
  const payload = parseExecutorPayload(activity.executor.workflow)
  assertWorkflowGraphIntegrity(payload.workflow, payload.triggerNodeId)
  validateExecutorFingerprints(activity, payload, spec.target.kind === 'conclusion')
  validateExecutorTargetAndApprovals(activity, payload)
  return {
    spec: structuredClone(spec),
    activity: structuredClone(activity),
    executor: structuredClone(activity.executor),
    payload
  }
}

/**
 * A spec digest proves internal consistency, not provenance. Execution must additionally bind the
 * document to the immutable run retained by this Create Loop instance.
 */
export function assertCreateLoopReproSpecTrustedByRun(
  parsed: ParsedCreateLoopReproSpec,
  trustedRun: WorkflowRunV1
): void {
  if (!trustedRun.manifest || trustedRun.id !== parsed.payload.baseline.runId) {
    throw new Error(
      'Rerun execution is blocked because its source is not a locally trusted Create Loop run.'
    )
  }
  const trustedSpec = createWorkflowReproSpec(
    trustedRun,
    outputComparator(parsed.activity, parsed.payload.baseline.outputFingerprint)
  )
  if (parsed.spec.target.kind !== 'activity' ||
    parsed.spec.source.snapshotDigest !== trustedSpec.source.snapshotDigest ||
    parsed.spec.specDigest !== trustedSpec.specDigest) {
    throw new Error(
      'Rerun execution is blocked because the specification is not the locally trusted export.'
    )
  }
}

function validateExecutorTargetAndApprovals(
  activity: SciForgeReproSpecV1['activities'][number],
  payload: CreateLoopExecutorPayloadV1
): void {
  if (activity.executor.kind !== 'create-loop') {
    throw new Error('Rerun target is not executable by Create Loop.')
  }
  const expectedApprovals = approvalRequirements(payload.workflow, payload.triggerNodeId)
  const normalizeApprovals = (
    approvals: SciForgeReproSpecV1['activities'][number]['approvals']
  ): DomainPackageJsonValue => toJsonValue(
    [...approvals]
      // historicalDecision* explains the baseline but is never reusable
      // authorization. Compare only the executable requirement projected
      // from workflow topology, while keeping those historical fields in the
      // canonical spec for provenance and comparison.
      .map((approval) => ({
        id: approval.id,
        kind: approval.kind,
        subjectId: approval.subjectId,
        mode: approval.mode,
        freshDecisionRequired: approval.freshDecisionRequired,
        ...(approval.policyDigest ? { policyDigest: approval.policyDigest } : {})
      }))
      .sort((left, right) => compareUtf16(
        `${left.id}\0${left.subjectId}`,
        `${right.id}\0${right.subjectId}`
      ))
  )
  if (canonicalizeReproValue(normalizeApprovals(activity.approvals)) !==
    canonicalizeReproValue(normalizeApprovals(expectedApprovals))) {
    throw new Error(
      'Create Loop approval requirements are inconsistent with the workflow topology.'
    )
  }

  const target = activity.executor.target
  if (target.kind === 'workflow') {
    if (target.id !== payload.workflow.id) {
      throw new Error('Create Loop workflow target does not match the executor workflow.')
    }
    return
  }
  if (!payload.workflow.nodes.some((node) => node.id === target.id)) {
    throw new Error('Create Loop node target does not exist in the executor workflow.')
  }
  if (expectedApprovals.length > 0) {
    throw new Error(
      'Create Loop node target cannot bypass workflow human-approval requirements; use the workflow target.'
    )
  }
}

function validateExecutorFingerprints(
  activity: SciForgeReproSpecV1['activities'][number],
  payload: CreateLoopExecutorPayloadV1,
  portableConclusionWrapper: boolean
): void {
  const workflowDigest = workflowFingerprint(payload.workflow)
  assertRepeatedFingerprint(
    'workflow',
    workflowDigest,
    payload.baseline.workflowFingerprint
  )

  const inputDigest = workflowFingerprint(payload.input)
  assertRepeatedFingerprint(
    'input',
    inputDigest,
    payload.baseline.inputFingerprint,
    ...(portableConclusionWrapper ? [] : [activity.inputFingerprint])
  )

  if (!portableConclusionWrapper && !activity.executionContextFingerprint) {
    throw new Error('Create Loop execution context fingerprint is missing.')
  }
  const contextDigest = workflowFingerprint(payload.context)
  assertRepeatedFingerprint(
    'execution context',
    contextDigest,
    payload.baseline.contextFingerprint,
    ...(portableConclusionWrapper ? [] : [activity.executionContextFingerprint])
  )

  if (!portableConclusionWrapper && !activity.baselineOutputFingerprint) {
    throw new Error('Create Loop baseline output fingerprint is missing.')
  }
  const outputDigest = workflowFingerprint(parseJsonOrText(payload.baseline.outputJson))
  assertRepeatedFingerprint(
    'baseline output',
    outputDigest,
    payload.baseline.outputFingerprint,
    ...(portableConclusionWrapper ? [] : [activity.baselineOutputFingerprint])
  )
  if (!portableConclusionWrapper) {
    for (const output of activity.outputs.filter((candidate) => isPrimaryExpectedOutput(
      candidate,
      payload.baseline.outputFingerprint
    ))) {
      assertRepeatedFingerprint(
        'primary output baseline',
        outputDigest,
        output.baselineDigest,
        output.contentDigest
      )
    }
  }

  const specDigest = workflowFingerprint({
    workflowFingerprint: workflowDigest,
    inputFingerprint: inputDigest,
    contextFingerprint: contextDigest,
    approvalRequirements: approvalRequirements(payload.workflow, payload.triggerNodeId),
    comparator: outputComparator(activity, payload.baseline.outputFingerprint)
  })
  assertRepeatedFingerprint(
    'activity specification',
    specDigest,
    payload.baseline.specFingerprint,
    ...(portableConclusionWrapper ? [] : [activity.specFingerprint])
  )
}

function assertRepeatedFingerprint(
  component: string,
  expected: WorkflowFingerprint,
  ...observed: readonly (WorkflowFingerprint | undefined)[]
): void {
  if (observed.every((fingerprint) => fingerprint === expected)) return
  throw new Error(`Create Loop ${component} fingerprints are inconsistent.`)
}

export function compareWorkflowRunToSpec(
  parsed: ParsedCreateLoopReproSpec,
  candidate: WorkflowRunV1
): WorkflowRunComparisonV1 {
  if (!candidate.manifest) {
    const candidateFailed = candidate.status !== 'success'
    return {
      classification: 'unverifiable',
      matches: false,
      sameInput: false,
      sameSpec: false,
      sameExecutionContext: false,
      resultMatch: false,
      comparisonVerifiable: false,
      // Without a manifest we cannot establish that input, specification, and
      // execution context were held fixed. A failed run is observable, but it
      // is not evidence that the baseline failed to replicate.
      replicationStatus: 'inconclusive',
      comparator: structuredClone(outputComparator(
        parsed.activity,
        parsed.payload.baseline.outputFingerprint
      )),
      reasonCodes: candidateFailed
        ? ['candidate_manifest_missing', 'candidate_run_failed']
        : ['candidate_manifest_missing'],
      differences: [
        { component: 'spec', reasonCode: 'candidate_manifest_missing' },
        ...(candidateFailed
          ? [{ component: 'output' as const, reasonCode: 'candidate_run_failed' }]
          : [])
      ]
    }
  }
  const { activity, payload, spec } = parsed
  const manifest = candidate.manifest
  const manifestIntegrity = inspectCandidateManifestIntegrity(
    manifest,
    payload.baseline.runId,
    spec.specDigest,
    payload.triggerNodeId,
    candidate.nodeResults
  )
  const sameInput = manifestIntegrity.inputValid &&
    activity.inputFingerprint === manifestIntegrity.inputFingerprint
  const sameSpec = manifestIntegrity.workflowValid && manifestIntegrity.specValid &&
    payload.baseline.workflowFingerprint === manifestIntegrity.workflowFingerprint &&
    activity.specFingerprint === manifestIntegrity.specFingerprint
  const sameExecutionContext = manifestIntegrity.contextValid &&
    activity.executionContextFingerprint === manifestIntegrity.contextFingerprint
  const differences: WorkflowRunDifferenceV1[] = spec.breakpoints
    .filter((breakpoint) => (
      breakpoint.code === 'artifact_digest_missing' ||
      breakpoint.code === 'artifact_digest_unverified' ||
      breakpoint.code === 'baseline_output_missing'
    ))
    .map((breakpoint) => ({
      component: breakpoint.component === 'artifact' ? 'artifact' as const : 'output' as const,
      ...(breakpoint.nodeId ? { nodeId: breakpoint.nodeId } : {}),
      reasonCode: breakpoint.code
    }))
  addDifference(differences, 'workflow', payload.baseline.workflowFingerprint, manifestIntegrity.workflowFingerprint, 'workflow_fingerprint_changed')
  addDifference(differences, 'input', activity.inputFingerprint, manifestIntegrity.inputFingerprint, 'input_fingerprint_changed')
  addDifference(differences, 'context', activity.executionContextFingerprint, manifestIntegrity.contextFingerprint, 'context_fingerprint_changed')
  addDifference(differences, 'spec', activity.specFingerprint, manifestIntegrity.specFingerprint, 'spec_fingerprint_changed')

  let hardFailure = candidate.status !== 'success' || !manifestIntegrity.valid
  if (candidate.status !== 'success') {
    differences.push({ component: 'output', reasonCode: 'candidate_run_failed' })
  }
  if (!manifestIntegrity.valid) {
    differences.push({ component: 'spec', reasonCode: 'candidate_manifest_integrity_invalid' })
  }

  const baselineWorkflowNodeIds = payload.workflow.nodes.map((node) => node.id).sort(compareUtf16)
  const candidateWorkflowNodeIds = manifest.workflow.nodes.map((node) => node.id).sort(compareUtf16)
  if (!sameArray(baselineWorkflowNodeIds, candidateWorkflowNodeIds)) {
    hardFailure = true
    differences.push({ component: 'node', reasonCode: 'workflow_node_set_changed' })
  }

  const baselineNodes = new Map(payload.baseline.nodeResults.map((result) => [result.nodeId, result]))
  const candidateNodes = new Map(candidate.nodeResults.map((result) => [result.nodeId, result]))
  if (candidateNodes.size !== candidate.nodeResults.length) {
    hardFailure = true
    differences.push({ component: 'node', reasonCode: 'candidate_node_result_duplicate' })
  }
  for (const nodeId of [...new Set([...baselineNodes.keys(), ...candidateNodes.keys()])].sort()) {
    const baseline = baselineNodes.get(nodeId)
    const observed = candidateNodes.get(nodeId)
    if (!baseline || !observed) {
      differences.push({ component: 'node', nodeId, reasonCode: baseline ? 'node_missing' : 'node_added' })
      hardFailure = true
      continue
    }
    if (observed.status !== 'success') {
      hardFailure = true
      differences.push({ component: 'node', nodeId, reasonCode: 'required_node_failed' })
    }
    addDifference(differences, 'node', baseline.componentFingerprint, observed.componentFingerprint, 'node_component_changed', nodeId)
    addDifference(differences, 'node', baseline.inputFingerprint, observed.inputFingerprint, 'node_input_changed', nodeId)
    if (!sameArray(
      baseline.receiptFingerprints,
      observed.attempts.map((attempt) => workflowActivityReceiptFingerprint(attempt.receipt))
    )) {
      differences.push({ component: 'node', nodeId, reasonCode: 'node_receipt_changed' })
    }
    if (!sameArray(baseline.artifactFingerprints, observed.artifactRefs.map(artifactReferenceFingerprint))) {
      differences.push({ component: 'artifact', nodeId, reasonCode: 'artifact_reference_changed' })
    }
    addDifference(differences, 'node', baseline.outputFingerprint, observed.outputFingerprint, 'node_output_changed', nodeId)
  }
  addDifference(
    differences,
    'approval',
    payload.baseline.approvalFingerprint,
    manifestIntegrity.approvalFingerprint,
    'approval_decision_changed'
  )

  const comparator = outputComparator(activity, payload.baseline.outputFingerprint)
  const requiredPrimaryOutputs = activity.outputs.filter((output) => (
    output.required && isPrimaryExpectedOutput(output, payload.baseline.outputFingerprint)
  ))
  const primaryOutputs = requiredPrimaryOutputs.length > 0
    ? requiredPrimaryOutputs
    : [{ comparator }]
  const primaryOutputMatches = primaryOutputs.every((output) => compareOutput(
    payload.baseline.outputJson,
    manifest.outputJson,
    output.comparator
  ))
  const primaryOutputVerifiable = primaryOutputs.every((output) => (
    outputComparisonVerifiable(
      payload.baseline.outputJson,
      manifest.outputJson,
      output.comparator
    )
  ))
  if (!primaryOutputMatches) {
    differences.push({
      component: 'output',
      baselineFingerprint: payload.baseline.outputFingerprint,
      candidateFingerprint: manifestIntegrity.outputFingerprint,
      reasonCode: comparator.kind === 'exact-digest'
        ? 'output_fingerprint_changed'
        : 'explicit_comparator_mismatch'
    })
  }

  let requiredOutputUnverifiable = false
  const candidateArtifacts = mergeArtifactReferences([
    ...manifest.artifactRefs,
    ...candidate.nodeResults.flatMap((result) => result.artifactRefs)
  ])
  for (const output of activity.outputs.filter((expected) => (
    expected.required && !isPrimaryExpectedOutput(expected, payload.baseline.outputFingerprint)
  ))) {
    const locators = [output.locator, output.artifactId, output.artifactVersionId]
      .filter((value): value is string => Boolean(value))
    const observed = locators.length > 0
      ? candidateArtifacts.find((artifact) => locators.includes(artifact.ref))
      : undefined
    const component = output.role === 'artifact' || output.role === 'evidence'
      ? 'artifact' as const
      : 'output' as const
    if (!observed) {
      hardFailure = true
      differences.push({
        component,
        nodeId: output.id,
        reasonCode: 'required_output_missing'
      })
      continue
    }
    requiredOutputUnverifiable = true
    differences.push({
      component,
      nodeId: output.id,
      ...(output.baselineDigest ? { baselineFingerprint: output.baselineDigest } : {}),
      reasonCode: 'required_output_unverifiable'
    })
  }

  const classification = classifyDifferences(differences)
  const uncontrolled = spec.reproducibility === 'uncontrolled' ||
    manifest.determinism.control === 'uncontrolled'
  const explanationChanged = differences.some((difference) => (
    difference.component === 'workflow' ||
    difference.component === 'input' ||
    difference.component === 'spec' ||
    difference.component === 'context' ||
    difference.component === 'approval'
  ))
  requiredOutputUnverifiable ||= differences.some((difference) => (
    difference.reasonCode === 'baseline_output_missing' || (
      (difference.reasonCode === 'artifact_digest_missing' ||
        difference.reasonCode === 'artifact_digest_unverified') &&
      activity.outputs.some((output) => (
        output.required && output.role !== 'primary-output' && output.baselineDigest === undefined
      ))
    )
  ))
  // Scientific replication failure is reserved for a completed, structurally
  // comparable run with a verifiable comparator mismatch. Runtime failure,
  // missing/extra nodes, or missing required outputs remain observable but do
  // not prove that the result itself failed to replicate.
  const comparisonVerifiable = primaryOutputVerifiable &&
    !requiredOutputUnverifiable && !hardFailure
  const resultMatch = comparisonVerifiable && primaryOutputMatches
  const replicationStatus = explanationChanged
      ? 'inconclusive' as const
      : !comparisonVerifiable
        ? 'inconclusive' as const
        : primaryOutputMatches
          ? 'matched' as const
          : uncontrolled
            ? 'inconclusive' as const
            : 'failed' as const
  const reasonCodes = unique([
    ...differences.map((difference) => difference.reasonCode),
    ...manifest.determinism.reasonCodes,
    ...(requiredOutputUnverifiable ? ['required_output_unverifiable'] : []),
    ...(!primaryOutputVerifiable ? ['output_comparison_unverifiable'] : []),
    ...(comparator.kind !== 'exact-digest' && primaryOutputMatches &&
      payload.baseline.outputFingerprint !== manifest.outputFingerprint
      ? ['explicit_comparator_match']
      : []),
    ...(uncontrolled && !primaryOutputMatches
      ? ['uncontrolled_mismatch_not_replication_failure']
      : [])
  ])
  return {
    classification,
    matches: replicationStatus === 'matched',
    sameInput,
    sameSpec,
    sameExecutionContext,
    resultMatch,
    comparisonVerifiable,
    replicationStatus,
    comparator: structuredClone(comparator),
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['all_fingerprints_match'],
    differences
  }
}

type CandidateManifestIntegrity = Readonly<{
  valid: boolean
  workflowValid: boolean
  inputValid: boolean
  specValid: boolean
  contextValid: boolean
  outputValid: boolean
  approvalValid: boolean
  workflowFingerprint: WorkflowFingerprint
  inputFingerprint: WorkflowFingerprint
  specFingerprint: WorkflowFingerprint
  contextFingerprint: WorkflowFingerprint
  outputFingerprint: WorkflowFingerprint
  approvalFingerprint: WorkflowFingerprint
}>

/**
 * Rebuild every comparison fingerprint from the candidate bodies before a
 * replication claim is made. A persisted manifest is evidence input, not a
 * trust root: stale or copied digests must not turn modified data into a match.
 */
function inspectCandidateManifestIntegrity(
  manifest: WorkflowRunManifestV2,
  expectedBaselineRunId: string,
  expectedRerunSpecDigest: WorkflowFingerprint,
  triggerNodeId: string | undefined,
  nodeResults: readonly WorkflowNodeRunResultV1[]
): CandidateManifestIntegrity {
  const workflowDigest = workflowFingerprint(manifest.workflow)
  const inputDigest = workflowFingerprint(manifest.input)
  const contextDigest = workflowFingerprint(manifest.context)
  const outputDigest = workflowFingerprint(parseJsonOrText(manifest.outputJson))
  const approvalDigest = approvalFingerprint(manifest.approvals)

  let graphValid = true
  let specDigest: WorkflowFingerprint = EMPTY_REPRO_DIGEST
  try {
    assertWorkflowGraphIntegrity(manifest.workflow, triggerNodeId)
    specDigest = workflowFingerprint({
      workflowFingerprint: workflowDigest,
      inputFingerprint: inputDigest,
      contextFingerprint: contextDigest,
      approvalRequirements: approvalRequirements(manifest.workflow, triggerNodeId),
      comparator: manifest.comparator
    })
  } catch {
    graphValid = false
  }

  const workflowValid = graphValid && manifest.workflowFingerprint === workflowDigest
  const inputValid = manifest.inputFingerprint === inputDigest
  const specValid = graphValid && manifest.specFingerprint === specDigest
  const contextValid = manifest.contextFingerprint === contextDigest
  const outputValid = manifest.outputFingerprint === outputDigest
  const approvalValid = manifest.approvalFingerprint === approvalDigest
  const determinismValid = canonicalizeReproValue(toJsonValue(manifest.determinism)) ===
    canonicalizeReproValue(toJsonValue(analyzeWorkflowDeterminism(manifest.workflow)))
  // The pure comparator is also used to preview an ordinary completed run.
  // When rerun binding metadata is present, however, it must be complete and
  // exact; a partial or stale binding is an integrity failure.
  const hasRerunBinding = manifest.source === 'rerun' ||
    manifest.rerunOfRunId !== undefined || manifest.rerunSpecDigest !== undefined
  const rerunBindingValid = !hasRerunBinding || (
    manifest.source === 'rerun' &&
    manifest.rerunOfRunId === expectedBaselineRunId &&
    manifest.rerunSpecDigest === expectedRerunSpecDigest
  )
  const nodesValid = candidateNodeResultsAreIntegrityBound(manifest.workflow, nodeResults)
  const artifactRefsValid = canonicalizeReproValue(toJsonValue(
    mergeArtifactReferences(manifest.artifactRefs)
  )) === canonicalizeReproValue(toJsonValue(
    mergeArtifactReferences(nodeResults.flatMap((result) => result.artifactRefs))
  ))

  return {
    valid: workflowValid && inputValid && specValid && contextValid && outputValid &&
      approvalValid && determinismValid && rerunBindingValid && nodesValid && artifactRefsValid,
    workflowValid,
    inputValid,
    specValid,
    contextValid,
    outputValid,
    approvalValid,
    workflowFingerprint: workflowDigest,
    inputFingerprint: inputDigest,
    specFingerprint: specDigest,
    contextFingerprint: contextDigest,
    outputFingerprint: outputDigest,
    approvalFingerprint: approvalDigest
  }
}

function candidateNodeResultsAreIntegrityBound(
  workflow: WorkflowExecutionSnapshotV1,
  nodeResults: readonly WorkflowNodeRunResultV1[]
): boolean {
  const workflowNodes = new Map(workflow.nodes.map((node) => [node.id, node]))
  if (workflowNodes.size !== workflow.nodes.length) return false
  if (new Set(nodeResults.map((result) => result.nodeId)).size !== nodeResults.length) return false

  return nodeResults.every((result) => {
    const node = workflowNodes.get(result.nodeId)
    if (!node) return false
    const componentDigest = activityFingerprint(node)
    const inputDigest = workflowFingerprint(
      result.inputJson === undefined || result.inputJson === ''
        ? null
        : parseJsonOrText(result.inputJson)
    )
    const outputDigest = workflowFingerprint(
      result.outputJson === '' ? null : parseJsonOrText(result.outputJson)
    )
    if (result.componentFingerprint !== componentDigest ||
      result.inputFingerprint !== inputDigest ||
      result.outputFingerprint !== outputDigest) return false

    if (!result.attempts.every((attempt) => (
      attempt.activityFingerprint === componentDigest &&
      attempt.inputFingerprint === inputDigest &&
      (
        attempt.receiptFingerprint === workflowActivityReceiptFingerprint(attempt.receipt) ||
        attempt.receiptFingerprint === workflowFingerprint(attempt.receipt)
      ) &&
      (attempt.receipt.outputFingerprint === undefined ||
        attempt.receipt.outputFingerprint === outputDigest)
    ))) return false

    // A fallback result legitimately follows an error receipt and therefore
    // can have artifacts that are not present on the terminal failed attempt.
    // Run-level artifactRefs are still required to equal the node aggregate.
    return true
  })
}

export function discoverWorkflowArtifactReferences(value: unknown): WorkflowArtifactReferenceV2[] {
  const discovered: WorkflowArtifactReferenceV2[] = []
  const visit = (current: unknown, depth: number): void => {
    if (depth > 20 || current === null || current === undefined) return
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (typeof current !== 'object') return
    const record = current as Record<string, unknown>
    const digest = firstDigest(record.digest, record.sha256, record.outputHash, record.contentDigest)
    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === 'string' && isArtifactReferenceKey(key) && entry.trim()) {
        discovered.push({
          ref: entry.trim(),
          kind: artifactKind(key, entry),
          ...(digest ? { digest } : {}),
          ...(typeof record.mediaType === 'string' && record.mediaType.trim()
            ? { mediaType: record.mediaType.trim() }
            : {})
        })
      }
      visit(entry, depth + 1)
    }
  }
  visit(value, 0)
  return mergeArtifactReferences(discovered)
}

export function activityFingerprint(node: unknown): WorkflowFingerprint {
  return workflowFingerprint(node)
}

export function artifactReferenceFingerprint(reference: WorkflowArtifactReferenceV2): WorkflowFingerprint {
  // A producer-declared digest is reference metadata until a content verifier hashes the locator.
  return workflowFingerprint(reference)
}

export function approvalFingerprint(records: readonly WorkflowApprovalRecordV2[]): WorkflowFingerprint {
  return workflowFingerprint(records.map((record) => ({
    nodeId: record.nodeId,
    status: record.status,
    decision: record.decision,
    actor: record.actor,
    rationale: record.rationale
  })))
}

export function toJsonValue(value: unknown): DomainPackageJsonValue {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as unknown
  return domainPackageJsonValueSchema.parse(normalized)
}

function createBlockedLegacySpec(run: WorkflowRunV1): SciForgeReproSpecV1 {
  const activityId = `workflow-run:${run.id}`
  const snapshotDigest = workflowFingerprint({ runId: run.id, nodeResults: run.nodeResults })
  const activity = {
    id: activityId,
    type: 'workflow_run' as const,
    name: `Legacy workflow run ${run.id}`,
    executor: {
      kind: 'unavailable' as const,
      reason: 'The historical run predates immutable execution manifests.'
    },
    inputs: [],
    code: [],
    environments: [],
    parameterSets: [],
    tools: [],
    approvals: [],
    outputs: [],
    stochastic: false,
    inputFingerprint: workflowFingerprint({ unavailable: 'input', runId: run.id }),
    specFingerprint: workflowFingerprint({ unavailable: 'spec', runId: run.id })
  }
  const unsigned = {
    schemaVersion: 'sciforge.rerun.v1' as const,
    specId: `create-loop:legacy:${run.id}`,
    source: { snapshotDigest, activityId },
    target: { kind: 'activity' as const, id: activityId },
    executionReady: false,
    reproducibility: 'incomplete' as const,
    activities: [activity],
    dependencies: [],
    secretSlots: [],
    breakpoints: [{
      code: 'create_loop_manifest_missing',
      component: 'executor' as const,
      message: 'Immutable workflow, input, environment, and approval metadata are unavailable.',
      activityId,
      blocking: true
    }],
    createdAt: validTimestamp(run.finishedAt || run.startedAt)
  }
  return finalizeReproSpec(unsigned)
}

function executableBreakpoints(
  manifest: WorkflowRunManifestV2,
  activityId: string,
  secretSlots: SciForgeReproSpecV1['secretSlots'],
  runStatus: WorkflowRunV1['status']
): SciForgeReproSpecV1['breakpoints'] {
  const breakpoints: SciForgeReproSpecV1['breakpoints'] = []
  if (runStatus !== 'success') {
    breakpoints.push({
      code: 'baseline_run_not_successful',
      component: 'output',
      message: 'A failed or incomplete baseline run cannot authorize an executable rerun.',
      activityId,
      blocking: true
    })
  }
  for (const slot of secretSlots.filter((candidate) => candidate.required)) {
    breakpoints.push({
      code: 'secret_binding_resolver_unavailable',
      component: 'environment',
      message: `Required secret slot ${slot.name} cannot be injected by the current runtime.`,
      activityId,
      blocking: true
    })
  }
  if (manifest.context.packageVersion === 'unknown' || !manifest.context.packageVersion.trim()) {
    breakpoints.push({
      code: 'package_version_missing',
      component: 'environment',
      message: 'Create Loop package version is missing.',
      activityId,
      blocking: true
    })
  }
  for (const node of manifest.workflow.nodes) {
    if (STOCHASTIC_NODE_TYPES.has(node.type) && explicitSeed(node.config) === undefined) {
      breakpoints.push({
        code: 'unseeded_stochastic_activity',
        component: 'randomness',
        message: `Stochastic node ${node.id} has no explicit random seed; mismatches are inconclusive.`,
        activityId,
        nodeId: node.id,
        blocking: false
      })
    }
    if (EXTERNAL_STATE_NODE_TYPES.has(node.type)) {
      breakpoints.push({
        code: 'external_state_activity',
        component: 'tool',
        message: `Node ${node.id} reads mutable external state; a result difference is explainable.`,
        activityId,
        nodeId: node.id,
        blocking: false
      })
    }
    if (node.type === 'custom') {
      breakpoints.push({
        code: 'custom_module_source_missing',
        component: 'code',
        message: `Custom module source for node ${node.id} is not embedded in the workflow snapshot.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
    if (node.type === 'subworkflow' || node.type === 'loop') {
      breakpoints.push({
        code: 'referenced_workflow_snapshot_missing',
        component: 'executor',
        message: `Referenced workflow for node ${node.id} is not embedded in the execution snapshot.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
    if (node.type === 'code' && !node.config.code.trim()) {
      breakpoints.push({
        code: 'inline_code_missing',
        component: 'code',
        message: `Code node ${node.id} has no executable source.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
    if (node.type === 'code' && node.config.language !== 'javascript') {
      breakpoints.push({
        code: 'script_runtime_version_missing',
        component: 'environment',
        message: `${node.config.language} runtime version for node ${node.id} was not captured.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
    if (isModelNodeWithoutVersion(node)) {
      breakpoints.push({
        code: 'model_version_missing',
        component: 'tool',
        message: `Model node ${node.id} relies on a mutable Host default.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
    if (UNAVAILABLE_TOOL_NODE_TYPES.has(node.type)) {
      breakpoints.push({
        code: 'tool_executor_unavailable',
        component: 'tool',
        message: `Node ${node.id} requires a tool executor that Create Loop does not currently provide.`,
        activityId,
        nodeId: node.id,
        blocking: true
      })
    }
  }
  manifest.artifactRefs.forEach((reference, index) => {
    if (reference.digest) return
    breakpoints.push({
      code: 'artifact_digest_missing',
      component: 'artifact',
      message: `Artifact ${reference.ref} has no content digest and cannot be compared exactly.`,
      activityId,
      nodeId: `artifact:${index}`,
      blocking: false
    })
  })
  if (!manifest.outputJson) {
    breakpoints.push({
      code: 'baseline_output_missing',
      component: 'output',
      message: 'The run can execute, but its output cannot be compared to a baseline.',
      activityId,
      blocking: false
    })
  }
  return breakpoints
}

function createCodeReferences(
  workflow: WorkflowExecutionSnapshotV1
): SciForgeReproSpecV1['activities'][number]['code'] {
  return workflow.nodes.flatMap((node) => {
    if (node.type !== 'code') return []
    return [{
      id: `code:${node.id}`,
      role: 'code',
      kind: 'inline-source',
      name: node.name,
      contentDigest: workflowFingerprint(node.config.code),
      language: node.config.language,
      entrypoint: `workflow.nodes.${node.id}`,
      required: true
    }]
  })
}

function createToolReferences(
  workflow: WorkflowExecutionSnapshotV1,
  executorVersion: string
): SciForgeReproSpecV1['activities'][number]['tools'] {
  return workflow.nodes
    .filter((node) => TOOL_NODE_TYPES.has(node.type))
    .map((node) => {
      const seed = explicitSeed(node.config)
      return {
        id: `tool:${node.id}`,
        name: node.name || node.type,
        providerId: node.type,
        actionId: node.id,
        version: executorVersion,
        arguments: toJsonValue(node.config),
        argumentsDigest: workflowFingerprint(node.config),
        stochastic: STOCHASTIC_NODE_TYPES.has(node.type),
        supportsSeed: seed !== undefined
      }
    })
}

export function assertWorkflowGraphIntegrity(
  workflow: WorkflowExecutionSnapshotV1,
  triggerNodeId?: string,
  requireTrigger = true
): void {
  const nodeIds = new Set<string>()
  for (const node of workflow.nodes) {
    if (!node.id.trim()) throw new Error('Create Loop workflow contains an empty node id.')
    if (nodeIds.has(node.id)) {
      throw new Error(`Create Loop workflow contains duplicate node id ${node.id}.`)
    }
    nodeIds.add(node.id)
  }
  const connectionIds = new Set<string>()
  for (const connection of workflow.connections) {
    if (!connection.id.trim() || connectionIds.has(connection.id)) {
      throw new Error(`Create Loop workflow contains duplicate or empty connection id ${connection.id}.`)
    }
    connectionIds.add(connection.id)
    if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) {
      throw new Error(
        `Create Loop workflow connection ${connection.id} references a missing node.`
      )
    }
  }
  if (requireTrigger) resolveWorkflowTriggerNodeId(workflow, triggerNodeId)
}

function resolveWorkflowTriggerNodeId(
  workflow: WorkflowExecutionSnapshotV1,
  requested?: string
): string {
  const triggerNodes = workflow.nodes.filter((node) => node.type.endsWith('-trigger'))
  const normalized = requested?.trim() ?? ''
  const explicit = normalized === 'manual'
    ? triggerNodes.find((node) => node.type === 'manual-trigger')
    : normalized
      ? triggerNodes.find((node) => node.id === normalized)
      : undefined
  if (explicit) {
    if (explicit.disabled) throw new Error('Create Loop rerun trigger is disabled.')
    return explicit.id
  }
  if (normalized) {
    throw new Error('Create Loop rerun trigger does not identify an executable trigger node.')
  }
  const enabledTriggers = triggerNodes.filter((node) => !node.disabled)
  if (enabledTriggers.length !== 1) {
    throw new Error(
      'Create Loop executor must identify one trigger when the workflow has multiple triggers.'
    )
  }
  return enabledTriggers[0]!.id
}

function workflowReachableNodeIds(
  workflow: WorkflowExecutionSnapshotV1,
  triggerNodeId: string
): Set<string> {
  const reachable = new Set<string>()
  const queue = [triggerNodeId]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    for (const connection of workflow.connections) {
      if (connection.source === nodeId && !reachable.has(connection.target)) {
        queue.push(connection.target)
      }
    }
  }
  return reachable
}

function approvalRequirements(
  workflow: WorkflowExecutionSnapshotV1,
  requestedTriggerNodeId?: string
): SciForgeReproSpecV1['activities'][number]['approvals'] {
  const triggerNodeId = resolveWorkflowTriggerNodeId(workflow, requestedTriggerNodeId)
  const reachable = workflowReachableNodeIds(workflow, triggerNodeId)
  return workflow.nodes
    .filter((node): node is Extract<WorkflowExecutionSnapshotV1['nodes'][number], {
      type: 'human-approval'
    }> => node.type === 'human-approval' && !node.disabled && reachable.has(node.id))
    .map((node) => ({
      id: `approval:${node.id}`,
      kind: 'workflow-human-approval' as const,
      subjectId: node.id,
      mode: 'human-decision',
      freshDecisionRequired: true as const,
      policyDigest: workflowFingerprint({
        title: node.config.title,
        instruction: node.config.instruction,
        timeoutMs: node.config.timeoutMs,
        onTimeout: node.config.onTimeout
      })
    }))
}

function createOutputReferences(
  manifest: WorkflowRunManifestV2,
  comparator: WorkflowRunComparatorV1,
  runId: string
): SciForgeReproSpecV1['activities'][number]['outputs'] {
  const primary = {
    id: `output:${runId}`,
    role: 'primary-output',
    kind: 'embedded-json',
    name: 'Workflow output',
    contentDigest: manifest.outputFingerprint,
    required: true,
    comparator: structuredClone(comparator),
    baselineDigest: manifest.outputFingerprint
  }
  const artifacts = manifest.artifactRefs.map((reference, index) => ({
    id: `artifact:${runId}:${index}`,
    role: 'artifact',
    kind: reference.kind,
    locator: reference.ref,
    ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
    required: false,
    comparator: { kind: 'exact-digest' as const }
  }))
  return [primary, ...artifacts]
}

function isPrimaryExpectedOutput(
  output: SciForgeReproSpecV1['activities'][number]['outputs'][number],
  _baselineOutputFingerprint?: WorkflowFingerprint
): boolean {
  return output.role === 'primary-output' || output.role === 'output'
}

function outputComparator(
  activity: SciForgeReproSpecV1['activities'][number],
  baselineOutputFingerprint?: WorkflowFingerprint
): WorkflowRunComparatorV1 {
  return activity.outputs.find((output) => isPrimaryExpectedOutput(
    output,
    baselineOutputFingerprint
  ))?.comparator ??
    EXACT_OUTPUT_COMPARATOR
}

function compareOutput(
  baselineJson: string,
  candidateJson: string,
  comparator: WorkflowRunComparatorV1
): boolean {
  const baseline = parseJsonOrText(baselineJson)
  const candidate = parseJsonOrText(candidateJson)
  if (comparator.kind === 'exact-digest') {
    return workflowFingerprint(baseline) === workflowFingerprint(candidate)
  }
  if (comparator.kind === 'numeric') {
    if (typeof baseline !== 'number' || typeof candidate !== 'number') return false
    return numbersEquivalent(
      baseline,
      candidate,
      comparator.absoluteTolerance,
      comparator.relativeTolerance ?? 0
    )
  }
  if (comparator.kind === 'table') {
    return tablesEquivalent(baseline, candidate, comparator)
  }
  return valuesEquivalent(
    baseline,
    candidate,
    comparator.absoluteTolerance ?? 0,
    comparator.relativeTolerance ?? 0
  )
}

function outputComparisonVerifiable(
  baselineJson: string,
  candidateJson: string,
  comparator: WorkflowRunComparatorV1
): boolean {
  const baseline = parseJsonOrText(baselineJson)
  const candidate = parseJsonOrText(candidateJson)
  if (comparator.kind === 'numeric') {
    return typeof baseline === 'number' && Number.isFinite(baseline) &&
      typeof candidate === 'number' && Number.isFinite(candidate)
  }
  if (comparator.kind === 'table') {
    return Array.isArray(baseline) && Array.isArray(candidate)
  }
  return true
}

function tablesEquivalent(
  left: unknown,
  right: unknown,
  comparator: Extract<WorkflowRunComparatorV1, { kind: 'table' }>
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  const project = (row: unknown): unknown => {
    if (!isRecord(row) || comparator.valueColumns.length === 0) return row
    const columns = [...new Set([...comparator.keyColumns, ...comparator.valueColumns])]
    return Object.fromEntries(columns.map((column) => [column, row[column]]))
  }
  const key = (row: unknown): string => {
    if (!isRecord(row)) return canonicalizeReproValue(toJsonValue(row))
    return comparator.keyColumns.map((column) => String(row[column] ?? '')).join('\0')
  }
  const leftRows = [...left].sort((a, b) => compareUtf16(key(a), key(b))).map(project)
  const rightRows = [...right].sort((a, b) => compareUtf16(key(a), key(b))).map(project)
  return valuesEquivalent(
    leftRows,
    rightRows,
    comparator.absoluteTolerance ?? 0,
    comparator.relativeTolerance ?? 0
  )
}

function valuesEquivalent(
  left: unknown,
  right: unknown,
  absoluteTolerance: number,
  relativeTolerance: number
): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return numbersEquivalent(left, right, absoluteTolerance, relativeTolerance)
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => (
      valuesEquivalent(entry, right[index], absoluteTolerance, relativeTolerance)
    ))
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return sameArray(leftKeys, rightKeys) && leftKeys.every((key) => (
      valuesEquivalent(left[key], right[key], absoluteTolerance, relativeTolerance)
    ))
  }
  return Object.is(left, right)
}

function numbersEquivalent(
  left: number,
  right: number,
  absoluteTolerance: number,
  relativeTolerance: number
): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  const difference = Math.abs(left - right)
  return difference <= absoluteTolerance ||
    difference <= relativeTolerance * Math.max(Math.abs(left), Math.abs(right))
}

function parseExecutorPayload(value: DomainPackageJsonValue): CreateLoopExecutorPayloadV1 {
  if (!isRecord(value)) {
    throw new Error('Create Loop executor metadata is missing or has an unsupported version.')
  }
  const record = value as Record<string, DomainPackageJsonValue>
  if (record.schemaVersion !== CREATE_LOOP_EXECUTOR_VERSION) {
    throw new Error('Create Loop executor metadata is missing or has an unsupported version.')
  }
  const workflow = record.workflow
  const baseline = record.baseline
  const context = record.context
  if (!isWorkflowSnapshot(workflow) || !isRunContext(context) || !isRecord(baseline)) {
    throw new Error('Create Loop executor metadata is incomplete.')
  }
  const baselineRecord = baseline as Record<string, DomainPackageJsonValue>
  if (!Object.hasOwn(record, 'input') || !isFingerprint(baselineRecord.workflowFingerprint) ||
    !isFingerprint(baselineRecord.inputFingerprint) || !isFingerprint(baselineRecord.specFingerprint) ||
    !isFingerprint(baselineRecord.contextFingerprint) || !isFingerprint(baselineRecord.outputFingerprint) ||
    !isFingerprint(baselineRecord.approvalFingerprint) || typeof baselineRecord.runId !== 'string' ||
    typeof baselineRecord.outputJson !== 'string' || !Array.isArray(baselineRecord.nodeResults)) {
    throw new Error('Create Loop executor baseline metadata is incomplete.')
  }
  if (record.triggerNodeId !== undefined && typeof record.triggerNodeId !== 'string') {
    throw new Error('Create Loop executor trigger identity is invalid.')
  }
  const nodeResults = baselineRecord.nodeResults.map(parseBaselineNode)
  if (new Set(nodeResults.map((result) => result.nodeId)).size !== nodeResults.length) {
    throw new Error('Create Loop executor baseline contains duplicate node results.')
  }
  const triggerNodeId = resolveWorkflowTriggerNodeId(
    workflow,
    typeof record.triggerNodeId === 'string' ? record.triggerNodeId : undefined
  )
  return {
    schemaVersion: CREATE_LOOP_EXECUTOR_VERSION,
    workflow: structuredClone(workflow),
    triggerNodeId,
    input: cloneJson(domainPackageJsonValueSchema.parse(record.input)),
    context: structuredClone(context),
    baseline: {
      runId: baselineRecord.runId,
      workflowFingerprint: baselineRecord.workflowFingerprint,
      inputFingerprint: baselineRecord.inputFingerprint,
      specFingerprint: baselineRecord.specFingerprint,
      contextFingerprint: baselineRecord.contextFingerprint,
      outputFingerprint: baselineRecord.outputFingerprint,
      outputJson: baselineRecord.outputJson,
      approvalFingerprint: baselineRecord.approvalFingerprint,
      nodeResults
    }
  }
}

function parseBaselineNode(value: unknown): BaselineNode {
  if (!isRecord(value) || typeof value.nodeId !== 'string' ||
    !isFingerprint(value.componentFingerprint) || !isFingerprint(value.inputFingerprint) ||
    !isFingerprint(value.outputFingerprint) || !Array.isArray(value.receiptFingerprints) ||
    !Array.isArray(value.artifactFingerprints) ||
    !value.receiptFingerprints.every(isFingerprint) ||
    !value.artifactFingerprints.every(isFingerprint)) {
    throw new Error('Create Loop executor node baseline is incomplete.')
  }
  return {
    nodeId: value.nodeId,
    componentFingerprint: value.componentFingerprint,
    inputFingerprint: value.inputFingerprint,
    outputFingerprint: value.outputFingerprint,
    receiptFingerprints: [...value.receiptFingerprints],
    artifactFingerprints: [...value.artifactFingerprints]
  }
}

function isWorkflowSnapshot(value: unknown): value is WorkflowExecutionSnapshotV1 {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    Array.isArray(value.env) && Array.isArray(value.nodes) && Array.isArray(value.connections)
}

function isRunContext(value: unknown): value is WorkflowRunContextV2 {
  return isRecord(value) && typeof value.workspaceRoot === 'string' &&
    typeof value.packageOwner === 'string' && typeof value.packageVersion === 'string' &&
    typeof value.nodeVersion === 'string' && typeof value.platform === 'string' &&
    typeof value.architecture === 'string' && Array.isArray(value.environment)
}

function explicitSeed(config: unknown): string | number | undefined {
  if (!isRecord(config)) return undefined
  for (const key of ['seed', 'randomSeed']) {
    const value = config[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function isModelNodeWithoutVersion(node: WorkflowExecutionSnapshotV1['nodes'][number]): boolean {
  return (node.type === 'llm' || node.type === 'ai-agent' ||
    node.type === 'parameter-extractor' || node.type === 'question-classifier') &&
    !node.config.model.trim()
}

function singleRandomSeed(workflow: WorkflowExecutionSnapshotV1): { randomSeed?: string | number } {
  const seeds = uniqueValues(workflow.nodes.map((node) => explicitSeed(node.config)))
  if (seeds.length === 0) return {}
  return seeds.length === 1
    ? { randomSeed: seeds[0] }
    : { randomSeed: canonicalizeReproValue(toJsonValue(seeds)) }
}

function classifyDifferences(
  differences: readonly WorkflowRunDifferenceV1[]
): WorkflowRunComparisonV1['classification'] {
  if (differences.length === 0) return 'match'
  if (differences.some((difference) => difference.component === 'input')) return 'input_changed'
  if (differences.some((difference) => difference.component === 'workflow' || difference.component === 'spec')) return 'spec_changed'
  if (differences.some((difference) => difference.component === 'context')) return 'context_changed'
  if (differences.some((difference) => difference.component === 'output')) return 'output_changed'
  if (differences.some((difference) => (
    difference.component === 'node' || difference.component === 'artifact' || difference.component === 'approval'
  ))) return 'component_changed'
  return 'unverifiable'
}

function addDifference(
  differences: WorkflowRunDifferenceV1[],
  component: WorkflowRunDifferenceV1['component'],
  baseline: WorkflowFingerprint | undefined,
  candidate: WorkflowFingerprint,
  reasonCode: string,
  nodeId?: string
): void {
  if (baseline === candidate) return
  differences.push({
    component,
    ...(nodeId ? { nodeId } : {}),
    ...(baseline ? { baselineFingerprint: baseline } : {}),
    candidateFingerprint: candidate,
    reasonCode
  })
}

function mergeArtifactReferences(
  references: readonly WorkflowArtifactReferenceV2[]
): WorkflowArtifactReferenceV2[] {
  const byKey = new Map<string, WorkflowArtifactReferenceV2>()
  for (const reference of references) {
    const key = `${reference.kind}\0${reference.ref}\0${reference.digest ?? ''}`
    if (!byKey.has(key)) byKey.set(key, structuredClone(reference))
  }
  return [...byKey.values()].sort((left, right) => (
    compareUtf16(`${left.kind}:${left.ref}`, `${right.kind}:${right.ref}`)
  ))
}

function discoverSecretSlots(values: readonly unknown[]): SciForgeReproSpecV1['secretSlots'] {
  const slots = new Map<string, SciForgeReproSpecV1['secretSlots'][number]>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 30 || value === null || value === undefined) return
    if (typeof value === 'string') {
      if (value.includes(SECRET_REDACTION_TEXT)) {
        const id = 'secret:runtime-known-value'
        if (!slots.has(id)) {
          slots.set(id, {
            id,
            name: 'runtime-known-value',
            required: true
          })
        }
      }
      if (value.startsWith(SECRET_REFERENCE_PREFIX)) {
        const id = value.slice(SECRET_REFERENCE_PREFIX.length)
        if (id && !slots.has(id)) {
          slots.set(id, {
            id,
            name: id.startsWith('secret:') ? id.slice('secret:'.length) : id,
            required: true
          })
        }
        return
      }
      if ((value.startsWith('{') || value.startsWith('[')) && depth < 5) {
        try {
          visit(JSON.parse(value), depth + 1)
        } catch {
          // Ordinary text is not a serialized structured value.
        }
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1))
      return
    }
    if (!isRecord(value)) return
    Object.values(value).forEach((entry) => visit(entry, depth + 1))
  }
  values.forEach((value) => visit(value, 0))
  return [...slots.values()].sort((left, right) => compareUtf16(left.id, right.id))
}

function mergeSecretSlots(
  ...groups: readonly SciForgeReproSpecV1['secretSlots'][]
): SciForgeReproSpecV1['secretSlots'] {
  const slots = new Map<string, SciForgeReproSpecV1['secretSlots'][number]>()
  for (const slot of groups.flat()) {
    if (!slots.has(slot.id)) slots.set(slot.id, structuredClone(slot))
  }
  return [...slots.values()].sort((left, right) => compareUtf16(left.id, right.id))
}

function isArtifactReferenceKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  return normalized === 'artifact' || normalized === 'artifactref' ||
    normalized.endsWith('artifactpath') || normalized.endsWith('manifestpath') ||
    normalized.endsWith('outputpath') || normalized.endsWith('fileuri') ||
    normalized.endsWith('artifacturi')
}

function artifactKind(key: string, value: string): WorkflowArtifactReferenceV2['kind'] {
  if (/^https?:\/\//iu.test(value)) return 'uri'
  if (key.toLowerCase().includes('manifest')) return 'manifest'
  if (key.toLowerCase().includes('artifact')) return 'artifact'
  return 'file'
}

function firstDigest(...values: unknown[]): WorkflowFingerprint | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase().replace(/^sha256:/u, '')
    if (/^[0-9a-f]{64}$/u.test(normalized)) return `sha256:${normalized}`
  }
  return undefined
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function finalizeReproSpec(unsigned: unknown): SciForgeReproSpecV1 {
  if (!isRecord(unsigned)) throw new Error('Cannot build an invalid rerun specification.')
  const provisional = sciforgeReproSpecSchema.parse({
    ...unsigned,
    specDigest: EMPTY_REPRO_DIGEST
  })
  return sciforgeReproSpecSchema.parse({
    ...provisional,
    specDigest: fingerprintCanonicalText(canonicalizeReproSpecForDigest(provisional))
  })
}

function fingerprintCanonicalText(value: string): WorkflowFingerprint {
  return `sha256:${sha256Hex(value)}`
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
] as const

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
] as const

/** Browser-safe synchronous SHA-256 for canonical JSON fingerprints. */
function sha256Hex(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const byteLength = bytes.length
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[byteLength] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = byteLength * 8
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const hash: number[] = [...SHA256_INITIAL]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!
      const previous2 = words[index - 2]!
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index] = (
        words[index - 16]! + sigma0 + words[index - 7]! + sigma1
      ) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash as [
      number, number, number, number, number, number, number, number
    ]
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    hash[0] = (hash[0]! + a) >>> 0
    hash[1] = (hash[1]! + b) >>> 0
    hash[2] = (hash[2]! + c) >>> 0
    hash[3] = (hash[3]! + d) >>> 0
    hash[4] = (hash[4]! + e) >>> 0
    hash[5] = (hash[5]! + f) >>> 0
    hash[6] = (hash[6]! + g) >>> 0
    hash[7] = (hash[7]! + h) >>> 0
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('')
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count))
}

function validTimestamp(value: string): string {
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? new Date(0).toISOString() : timestamp.toISOString()
}

function cloneJson<T extends DomainPackageJsonValue>(value: T): T {
  return JSON.parse(canonicalizeReproValue(value)) as T
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFingerprint(value: unknown): value is WorkflowFingerprint {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function uniqueValues<T>(values: readonly (T | undefined)[]): T[] {
  return [...new Set(values.filter((value): value is T => value !== undefined))]
}
