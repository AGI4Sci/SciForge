import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  DomainTurnArtifactEvent,
  DomainTurnFilePatchReceiptV1
} from '@sciforge/domain-sdk/host'
import {
  RESEARCH_CHECKPOINT_SOURCE_URL_POLICY,
  RESEARCH_CHECKPOINT_TEXT_SANITIZATION_POLICY,
  researchCheckpointManifestV1Schema,
  type ArtifactVersionRefV1,
  type ResearchCheckpointArtifactDependencyV1,
  type ResearchCheckpointBreakpointV1,
  type ResearchCheckpointDeclaredFileV1,
  type ResearchCheckpointManifestV1,
  type ResearchCheckpointSourceV1,
  type ResearchCheckpointUntrackedOperationV1,
  type ResearchRecordingStatusV1
} from '../contract.js'
import { sha256, workspaceBindingDigest } from './crypto.js'

export type CheckpointFilePlan = Readonly<{
  path: string
  role: ResearchCheckpointDeclaredFileV1['role']
  declaredDigest?: string
  mediaType?: string
  artifactId?: string
  expectedCurrentVersionId: string | null
  expectedCurrentOrdinal?: number
  accessPolicy?: ArtifactVersionRefV1['accessPolicy']
  /** True only when the required before-turn barrier durably froze bindings. */
  preTurnBindingCaptured?: boolean
  expectedCurrentRef?: ArtifactVersionRefV1
  patchReceipts?: readonly DomainTurnFilePatchReceiptV1[]
  terminalEffect?: Readonly<{
    kind: 'created' | 'modified' | 'deleted'
    byteLength: number
    contentDigest?: string
    mediaType?: string
  }>
  terminalSnapshot?: Readonly<{
    contentDigest: string
    byteLength: number
    mediaType?: string
    /** Compacted after the atomic receipt is durably adopted. */
    dataBase64?: string
  }>
}>

export type ExtractedCheckpoint = Readonly<{
  manifest: ResearchCheckpointManifestV1
  filePlans: readonly CheckpointFilePlan[]
  computeRunCandidates: readonly string[]
  clientDirectiveId?: string
}>

export type ResearchCheckpointTextSanitizer = (value: string) => string

export type ResearchCheckpointExtractionOptions = Readonly<{
  /** Host settings-aware sanitizer. Opaque values never cross into this package. */
  sanitizeText?: ResearchCheckpointTextSanitizer
}>

export const RESEARCH_CHECKPOINT_REDACTION_MARKER = '[REDACTED]' as const

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/giu
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Bot)\s+[A-Za-z0-9._~+/=-]+/giu
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu
const PROVIDER_KEY_PATTERN = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|(?:gh[opusr]|github_pat)_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/gu
const SECRET_HEADER_PATTERN = /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:\s*)[^\r\n]*/gimu
const SECRET_ASSIGNMENT_PATTERN = /(["']?)(authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|token|client[-_ ]?secret|password|passwd|passphrase|credential|private[-_ ]?key|secret)\1(\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,}&]+)/giu
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/giu
const SENSITIVE_QUERY_NAME = /(?:^|[-_.])(api[-_]?key|access[-_]?token|auth|authorization|code|credential|key|password|passwd|secret|session|signature|sig|token)(?:$|[-_.])/iu
const SIGNED_PROVIDER_QUERY_NAME = /^(?:awsaccesskeyid|signature|x-amz-.+|x-goog-.+)$/iu

export function sanitizeResearchCheckpointText(
  value: string,
  hostSanitizer?: ResearchCheckpointTextSanitizer
): string {
  const structurallySanitized = structurallySanitizeResearchCheckpointText(value)
  if (!hostSanitizer) return structurallySanitized
  const hostSanitized = hostSanitizer(structurallySanitized)
  if (typeof hostSanitized !== 'string') {
    throw new Error('Research checkpoint Host text sanitizer must return text.')
  }
  // The Host may replace an opaque value with context-bearing text. Re-run
  // structural policy so its output cannot introduce a credential or unsafe URL.
  return structurallySanitizeResearchCheckpointText(hostSanitized)
}

function structurallySanitizeResearchCheckpointText(value: string): string {
  const sanitizedUrls = sanitizeUrlsInText(value)
  return sanitizeUrlsInText(sanitizedUrls
    .replace(PRIVATE_KEY_PATTERN, RESEARCH_CHECKPOINT_REDACTION_MARKER)
    .replace(AUTH_SCHEME_PATTERN, (_match, scheme: string) => (
      `${scheme} ${RESEARCH_CHECKPOINT_REDACTION_MARKER}`
    ))
    .replace(JWT_PATTERN, RESEARCH_CHECKPOINT_REDACTION_MARKER)
    .replace(PROVIDER_KEY_PATTERN, RESEARCH_CHECKPOINT_REDACTION_MARKER)
    .replace(SECRET_HEADER_PATTERN, `$1${RESEARCH_CHECKPOINT_REDACTION_MARKER}`)
    .replace(
      SECRET_ASSIGNMENT_PATTERN,
      (match, quote: string, key: string, separator: string, rawValue: string) => (
        [RESEARCH_CHECKPOINT_REDACTION_MARKER, encodeURIComponent(RESEARCH_CHECKPOINT_REDACTION_MARKER)]
          .includes(rawValue)
          ? match
          : `${quote}${key}${quote}${separator}${RESEARCH_CHECKPOINT_REDACTION_MARKER}`
      )
    ))
}

function sanitizeUrlsInText(value: string): string {
  return value.replace(URL_PATTERN, (rawUrl) => {
    const { uri, punctuation } = trimUrlPunctuation(rawUrl)
    return `${sanitizeResearchCheckpointSourceUri(uri)}${punctuation}`
  })
}

export function sanitizeResearchCheckpointSourceUri(value: string): string {
  try {
    const parsed = new URL(trimUrlPunctuation(value).uri)
    if (!['http:', 'https:'].includes(parsed.protocol)) return RESEARCH_CHECKPOINT_REDACTION_MARKER
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''
    const queryNames = [...parsed.searchParams.keys()]
    const sasSigned = queryNames.some((name) => name.toLowerCase() === 'sig')
    for (const name of queryNames) {
      if (
        sasSigned ||
        SENSITIVE_QUERY_NAME.test(name) ||
        SIGNED_PROVIDER_QUERY_NAME.test(name)
      ) parsed.searchParams.set(name, RESEARCH_CHECKPOINT_REDACTION_MARKER)
    }
    return parsed.toString()
  } catch {
    return RESEARCH_CHECKPOINT_REDACTION_MARKER
  }
}

function trimUrlPunctuation(rawUrl: string): Readonly<{ uri: string; punctuation: string }> {
  const match = /([.,;:!?]+)$/u.exec(rawUrl)
  return match
    ? { uri: rawUrl.slice(0, -match[1]!.length), punctuation: match[1]! }
    : { uri: rawUrl, punctuation: '' }
}

export function sanitizeResearchCheckpointManifest(
  manifest: ResearchCheckpointManifestV1,
  hostSanitizer?: ResearchCheckpointTextSanitizer
): ResearchCheckpointManifestV1 {
  const sanitize = (value: string) => sanitizeResearchCheckpointText(value, hostSanitizer)
  const canonicalText = sanitize(manifest.narrative.canonicalText)
  const sourceIdMapping = new Map<string, string>()
  const sources = manifest.sources.map((source) => {
    const uri = sanitizeResearchCheckpointSourceUri(source.uri)
    const sourceId = `source:${sha256(uri).slice(0, 24)}`
    sourceIdMapping.set(source.sourceId, sourceId)
    return {
      ...source,
      sourceId,
      uri,
      ...(source.title ? { title: sanitize(source.title) } : {})
    }
  })
  return researchCheckpointManifestV1Schema.parse({
    ...manifest,
    title: sanitize(manifest.title),
    changeReason: sanitize(manifest.changeReason),
    narrative: {
      canonicalText,
      contentDigest: sha256(canonicalText)
    },
    sources,
    artifactDependencies: manifest.artifactDependencies.map((dependency) => ({
      ...dependency,
      ...(dependency.label ? { label: sanitize(dependency.label) } : {})
    })),
    untrackedOperations: manifest.untrackedOperations.map((operation) => ({
      ...operation,
      ...(operation.summary ? { summary: sanitize(operation.summary) } : {})
    })),
    breakpoints: manifest.breakpoints.map((breakpoint) => ({
      ...breakpoint,
      message: sanitize(breakpoint.message),
      ...(breakpoint.itemId && sourceIdMapping.has(breakpoint.itemId)
        ? { itemId: sourceIdMapping.get(breakpoint.itemId)! }
        : {})
    })),
    gitCheckpoints: manifest.gitCheckpoints.map((checkpoint) => ({
      ...checkpoint,
      provider: sanitize(checkpoint.provider),
      revision: sanitize(checkpoint.revision)
    })),
    privacy: {
      textSanitization: RESEARCH_CHECKPOINT_TEXT_SANITIZATION_POLICY,
      sourceUrlPolicy: RESEARCH_CHECKPOINT_SOURCE_URL_POLICY,
      opaqueSecretSanitization: hostSanitizer
        ? 'host-settings'
        : manifest.privacy?.opaqueSecretSanitization ?? 'unavailable'
    }
  })
}

export function extractCheckpointFromTurn(
  event: DomainTurnArtifactEvent,
  recording: ResearchRecordingStatusV1,
  workspaceRoot: string,
  fileBindings: ReadonlyMap<string, Readonly<{
    artifactId: string
    currentVersionId: string
  }>>,
  initialChangeReason?: string,
  options: ResearchCheckpointExtractionOptions = {}
): ExtractedCheckpoint {
  const records = event.artifacts.flatMap((value) => record(value) ? [record(value)!] : [])
  const assistantEntries = records.flatMap((item, index) => {
    if (text(item.kind) !== 'assistant_message') return []
    const value = text(item.text)
    return value ? [{ index, value }] : []
  })
  // A turn may persist several assistant publications around tool execution.
  // The final durable assistant publication is the research-facing answer;
  // earlier publications are process transcript and must not become the
  // canonical scientific narrative or an asserted research source.
  let lastToolIndex = -1
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (text(records[index]?.kind) === 'tool') {
      lastToolIndex = index
      break
    }
  }
  const finalAssistantEntries = lastToolIndex >= 0
    ? assistantEntries.filter((entry) => entry.index > lastToolIndex)
    : assistantEntries.slice(-1)
  const assistantText = (finalAssistantEntries.length ? finalAssistantEntries : assistantEntries.slice(-1))
    .map((entry) => entry.value)
    .join('\n\n')
    .trim()
  const userText = records
    .filter((item) => text(item.kind) === 'user_message')
    .map((item) => text(item.text))
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
    .trim()
  const narrative = assistantText || records
    .map((item) => text(item.summary))
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .trim()

  const breakpoints: ResearchCheckpointBreakpointV1[] = []
  if (!narrative) {
    breakpoints.push({
      code: 'narrative-missing',
      blocking: true,
      message: 'The completed turn did not expose a durable assistant narrative.'
    })
  }

  const changeReason = truncate(
    (recording.versionCount === 0 ? initialChangeReason : undefined) || userText || (
      recording.versionCount === 0
        ? 'Started a recorded research iteration.'
        : 'Continued the recorded research iteration.'
    ),
    2_000
  )

  const sources = extractSources(records, narrative)
  for (const source of sources) {
    if (!source.contentDigest && !source.artifactVersionRef) {
      breakpoints.push({
        code: 'source-unpinned',
        blocking: true,
        message: `Source ${source.uri} has no exact content digest or Artifact Version.`,
        itemId: source.sourceId
      })
    }
  }

  // Opaque turn artifacts are model/tool-controlled JSON. Exact refs, Compute
  // state, and Evidence state are deliberately not accepted here. Runtime
  // validates the small Host executor-receipt candidate set through owning
  // public capabilities before adding any exact dependency.
  const artifactDependencies: ResearchCheckpointArtifactDependencyV1[] = []
  const computeRuns: ResearchCheckpointManifestV1['computeRuns'] = []
  const computeRunCandidates = trustedComputeRunCandidates(records)
  const trustedFileEffects = extractHostFileEffects(event, workspaceRoot)
  // A Host patch receipt is only a candidate at extraction time. Keep the
  // matching file-change call quarantined until every path declared by that
  // call has been replayed against its frozen parent and is part of the same
  // atomic output/checkpoint commit.
  const untrackedOperations = extractUntrackedOperations(records)
  for (const operation of untrackedOperations) {
    breakpoints.push({
      code: operation.kind === 'editor-change'
        ? 'editor-change-untracked'
        : 'execution-untracked',
      blocking: true,
      message: operation.kind === 'editor-change'
        ? 'An editor or file-change operation lacks an exact observed file version.'
        : 'An ordinary command or Terminal operation is an observation, not a formal Compute Run.',
      ...(operation.itemId ? { itemId: operation.itemId } : {})
    })
  }

  const extractedFiles = extractFilePlans(records, workspaceRoot)
  const files = new Map(extractedFiles.files.map((item) => [item.path, item]))
  const fileBreakpoints = [...extractedFiles.fileBreakpoints]
  for (const trusted of trustedFileEffects.files) {
    files.set(trusted.path, trusted)
  }
  fileBreakpoints.push(...trustedFileEffects.breakpoints)
  breakpoints.push(...fileBreakpoints)
  const evidence = 'pending' as const
  const hasFormal = computeRuns.length > 0
  const hasUntracked = untrackedOperations.length > 0
  const execution = hasFormal && hasUntracked
    ? 'mixed'
    : hasFormal
      ? 'formal-references-present'
      : hasUntracked
        ? 'observed-untracked'
        : 'not-applicable'
  const blocking = breakpoints.some((item) => item.blocking)
  const manifest = sanitizeResearchCheckpointManifest(researchCheckpointManifestV1Schema.parse({
    contractVersion: 1,
    kind: 'sciforge.research-checkpoint-manifest.v1',
    recording: {
      recordingId: recording.recordingId,
      origin: recording.origin,
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      workspaceBindingDigest: workspaceBindingDigest(workspaceRoot)
    },
    turn: {
      turnId: event.turnId,
      targetWatermark: event.targetWatermark,
      ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
      occurredAt: event.occurredAt
    },
    title: recording.title,
    changeReason,
    narrative: {
      canonicalText: narrative,
      contentDigest: sha256(narrative)
    },
    sources,
    declaredFiles: [
      ...[...files.values()].map((plan) => ({
        path: plan.path,
        role: plan.role,
        capture: plan.terminalSnapshot
          ? 'host-turn-boundary-exact' as const
          : 'observed-after-turn' as const,
        ...(plan.terminalSnapshot ? {
          contentDigest: plan.terminalSnapshot.contentDigest,
          byteLength: plan.terminalSnapshot.byteLength,
          ...(plan.terminalSnapshot.mediaType ? { mediaType: plan.terminalSnapshot.mediaType } : {})
        } : {}),
        ...(plan.declaredDigest ? { contentDigest: plan.declaredDigest } : {}),
        ...(plan.mediaType ? { mediaType: plan.mediaType } : {})
      }))
    ],
    artifactDependencies,
    computeRuns,
    gitCheckpoints: [],
    untrackedOperations,
    breakpoints,
    status: {
      execution,
      provenance: blocking ? 'incomplete' : 'pending',
      control: hasFormal && !hasUntracked ? 'isolated-attested' : hasFormal ? 'partial' : 'untracked',
      reproduction: hasFormal && !blocking ? 'eligible' : 'not-run',
      evidence
    }
  }), options.sanitizeText)
  return Object.freeze({
    manifest,
    filePlans: Object.freeze([...files.values()].sort((left, right) => left.path.localeCompare(right.path))),
    computeRunCandidates: Object.freeze(computeRunCandidates),
    ...(event.clientDirectiveId ? { clientDirectiveId: event.clientDirectiveId } : {})
  })
}

export function withObservedFile(
  manifest: ResearchCheckpointManifestV1,
  input: Readonly<{
    plan: CheckpointFilePlan
    ref?: ArtifactVersionRefV1
    artifactOrdinal?: number
    error?: string
  }>
): ResearchCheckpointManifestV1 {
  const declaredFiles = manifest.declaredFiles.map((file) => {
    if (file.path !== input.plan.path) return file
    if (!input.ref) return file
    return {
      ...file,
      capture: input.plan.terminalSnapshot
        ? 'host-turn-boundary-exact' as const
        : input.plan.declaredDigest === input.ref.contentDigest
        ? 'declared-exact' as const
        : 'observed-after-turn' as const,
      contentDigest: input.ref.contentDigest,
      byteLength: input.ref.byteLength,
      ...(input.ref.mediaType ? { mediaType: input.ref.mediaType } : {}),
      ...(input.artifactOrdinal ? { artifactOrdinal: input.artifactOrdinal } : {}),
      artifactVersionRef: input.ref
    }
  })
  const breakpoints = manifest.breakpoints.filter((item) => !(
    item.code === 'editor-change-untracked' && item.itemId === `file:${input.plan.path}`
  ))
  if (input.error) {
    breakpoints.push({
      code: 'file-observation-failed',
      blocking: true,
      message: truncate(input.error, 4_000),
      itemId: `file:${input.plan.path}`
    })
  } else if (input.ref && input.plan.terminalSnapshot) {
    // Exact bytes are now immutable, but causality/control remain deliberately
    // blocked by `host-file-effect-causality-unverified`.
  } else if (input.ref && !input.plan.declaredDigest) {
    breakpoints.push({
      code: 'file-observed-after-turn',
      blocking: true,
      message: `File ${input.plan.path} was snapshotted after completion, but no trusted turn-time digest was declared.`,
      itemId: `file:${input.plan.path}`
    })
  } else if (input.ref && input.plan.declaredDigest && input.plan.declaredDigest !== input.ref.contentDigest) {
    breakpoints.push({
      code: 'declared-file-digest-mismatch',
      blocking: true,
      message: `Declared digest for ${input.plan.path} did not match the exact post-turn snapshot.`,
      itemId: `file:${input.plan.path}`
    })
  }
  const artifactDependencies = input.ref
    ? dedupeDependencies([
        ...manifest.artifactDependencies,
        { role: fileRole(input.plan.role), label: input.plan.path, ref: input.ref }
      ])
    : manifest.artifactDependencies
  return finalizeManifest({ ...manifest, declaredFiles, artifactDependencies, breakpoints })
}

/**
 * Remove a file-change quarantine only after the complete call/path closure
 * has exact output candidates. This deliberately runs after withObservedFile
 * has attached all predicted refs, immediately before the atomic commit is
 * frozen. A single verified path can therefore never authenticate the rest of
 * a multi-path call.
 */
export function withVerifiedFileChangeAttribution(
  manifest: ResearchCheckpointManifestV1,
  originalManifest: ResearchCheckpointManifestV1,
  allPlans: readonly CheckpointFilePlan[],
  atomicOutputPlans: readonly CheckpointFilePlan[]
): ResearchCheckpointManifestV1 {
  if (atomicOutputPlans.length === 0) return manifest

  const declarations = new Map<string, Set<string>>()
  const invalidDeclarations = new Set<string>()
  for (const breakpoint of originalManifest.breakpoints) {
    const detail = record(breakpoint.detail)
    if (text(detail?.origin) !== 'file-change-declaration') continue
    const callId = text(detail?.callId)
    if (!callId) continue
    const path = text(detail?.path)
    if (
      breakpoint.code === 'editor-change-untracked' &&
      path &&
      breakpoint.itemId === `file:${path}`
    ) {
      const paths = declarations.get(callId) ?? new Set<string>()
      paths.add(path)
      declarations.set(callId, paths)
    } else {
      invalidDeclarations.add(callId)
    }
  }

  const receiptPaths = pathsByCallId(allPlans, false)
  const verifiedPaths = pathsByCallId(atomicOutputPlans, true)
  for (const [callId, paths] of receiptPaths) {
    const declared = declarations.get(callId) ?? new Set<string>()
    for (const path of paths) declared.add(path)
    declarations.set(callId, declared)
  }
  const hostCaptureBlocked = manifest.breakpoints.some((breakpoint) => {
    const detail = record(breakpoint.detail)
    return breakpoint.blocking && text(detail?.origin) === 'host-file-effects'
  })
  const eligible = new Set<string>()
  for (const operation of manifest.untrackedOperations) {
    const callId = operation.kind === 'editor-change' ? operation.itemId : undefined
    if (!callId || invalidDeclarations.has(callId) || hostCaptureBlocked) continue
    const declared = declarations.get(callId)
    const received = receiptPaths.get(callId)
    const verified = verifiedPaths.get(callId)
    if (!declared?.size || !sameStringSet(declared, received) || !sameStringSet(declared, verified)) continue
    if (manifest.breakpoints.some((breakpoint) => (
      breakpoint.blocking &&
      breakpoint.code !== 'editor-change-untracked' &&
      (breakpoint.itemId === callId || (
        breakpoint.itemId?.startsWith('file:') &&
        declared.has(breakpoint.itemId.slice('file:'.length))
      ))
    ))) continue
    eligible.add(callId)
  }
  if (eligible.size === 0) return manifest

  const untrackedOperations = manifest.untrackedOperations.filter((operation) => !(
    operation.kind === 'editor-change' && operation.itemId && eligible.has(operation.itemId)
  ))
  const breakpoints = manifest.breakpoints.filter((breakpoint) => !(
    breakpoint.code === 'editor-change-untracked' &&
    breakpoint.itemId !== undefined &&
    eligible.has(breakpoint.itemId)
  ))
  const blocking = breakpoints.some((breakpoint) => breakpoint.blocking)
  const hasFormal = manifest.computeRuns.length > 0
  const hasUntracked = untrackedOperations.length > 0
  const allFilesExact = manifest.declaredFiles.length > 0 &&
    manifest.declaredFiles.every((file) => Boolean(file.artifactVersionRef))
  // This helper authenticates only the file-change call. It must not use that
  // narrower success to upgrade control or replication facts supplied by the
  // Scientific Compute owner. Likewise, once a formal owner has reported
  // incomplete provenance, clearing an unrelated file quarantine cannot turn
  // that owner conclusion into complete provenance.
  const ownerProvenanceIncomplete = hasFormal && manifest.status.provenance === 'incomplete'
  return researchCheckpointManifestV1Schema.parse({
    ...manifest,
    untrackedOperations,
    breakpoints,
    status: {
      ...manifest.status,
      execution: hasFormal && hasUntracked
        ? 'mixed'
        : hasFormal
          ? 'formal-references-present'
          : hasUntracked
            ? 'observed-untracked'
            : 'not-applicable',
      provenance: blocking || ownerProvenanceIncomplete
        ? 'incomplete'
        : manifest.status.provenance === 'complete' || allFilesExact
          ? 'complete'
          : 'pending',
      control: manifest.status.control,
      reproduction: manifest.status.reproduction
    }
  })
}

export function withGitCheckpoints(
  manifest: ResearchCheckpointManifestV1,
  gitCheckpoints: ResearchCheckpointManifestV1['gitCheckpoints']
): ResearchCheckpointManifestV1 {
  return researchCheckpointManifestV1Schema.parse({ ...manifest, gitCheckpoints })
}

export function finalizeManifest(
  value: Omit<ResearchCheckpointManifestV1, 'status'> &
    Pick<ResearchCheckpointManifestV1, 'status'>
): ResearchCheckpointManifestV1 {
  const blocking = value.breakpoints.some((item) => item.blocking)
  const hasFormal = value.computeRuns.length > 0
  const hasUntracked = value.untrackedOperations.length > 0
  // An empty file set proves only that the narrative bytes were versioned. It
  // is not a complete provenance closure: there is no exact source, file or
  // formal Compute receipt that can justify upgrading `pending` to
  // `complete`. Avoid the vacuous `[].every(...) === true` case so a pure-text
  // chat checkpoint remains honest about its missing execution/source facts.
  const allFilesExact = value.declaredFiles.length > 0 &&
    value.declaredFiles.every((item) => Boolean(item.artifactVersionRef))
  return researchCheckpointManifestV1Schema.parse({
    ...value,
    status: {
      ...value.status,
      provenance: blocking || value.status.provenance === 'incomplete'
        ? 'incomplete'
        : value.status.provenance === 'complete' || allFilesExact
          ? 'complete'
          : 'pending',
      reproduction: hasFormal && !blocking && value.status.reproduction === 'not-run'
        ? 'eligible'
        : value.status.reproduction,
      control: !hasFormal
        ? 'untracked'
        : hasUntracked
          ? 'partial'
          : value.status.control
    }
  })
}

function extractSources(
  records: readonly Record<string, unknown>[],
  narrative: string
): ResearchCheckpointSourceV1[] {
  const values = new Map<string, ResearchCheckpointSourceV1>()
  const candidates = [
    narrative,
    ...records
      .filter((item) => text(item.kind) === 'user_message')
      .flatMap((item) => [text(item.text), text(item.summary)])
      .filter((value): value is string => Boolean(value))
  ]
  for (const candidate of candidates) {
    for (const match of candidate.matchAll(URL_PATTERN)) {
      const uri = trimUrlPunctuation(match[0]!).uri
      if (isDocumentNamespaceUri(uri)) continue
      if (!values.has(uri)) {
        values.set(uri, {
          sourceId: `source:${sha256(uri).slice(0, 24)}`,
          uri
        })
      }
    }
  }
  return [...values.values()].sort((left, right) => left.uri.localeCompare(right.uri))
}

function isDocumentNamespaceUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/u, '')
    return [
      'http://www.w3.org/2000/svg',
      'https://www.w3.org/2000/svg',
      'http://www.w3.org/1999/xlink',
      'https://www.w3.org/1999/xlink',
      'http://www.w3.org/1999/xhtml',
      'https://www.w3.org/1999/xhtml'
    ].includes(normalized)
  } catch {
    return false
  }
}

function trustedComputeRunCandidates(
  records: readonly Record<string, unknown>[]
): string[] {
  const values = new Set<string>()
  for (const item of records) {
    if (
      text(item.kind) !== 'tool' ||
      text(item.toolKind ?? item.tool_kind) !== 'tool_call' ||
      !['success', 'completed'].includes(text(item.status) ?? '')
    ) continue
    const meta = record(item.meta)
    if (
      text(item.summary) !== 'sciforge_invoke' ||
      text(meta?.toolName) !== 'sciforge_invoke' ||
      text(meta?.factSource) !== 'executor_result' ||
      text(meta?.evidenceStrength) !== 'executor_receipt' ||
      meta?.success !== true
    ) continue
    const structured = record(meta.structuredContent)
    const output = record(structured?.output)
    const value = output?.ok === true ? record(output.value) : null
    const runId = text(value?.runId)
    if (runId?.startsWith('compute-run:')) values.add(runId)
  }
  return [...values].sort()
}

function extractUntrackedOperations(
  records: readonly Record<string, unknown>[]
): ResearchCheckpointUntrackedOperationV1[] {
  const output: ResearchCheckpointUntrackedOperationV1[] = []
  for (const item of records) {
    const toolKind = text(item.toolKind ?? item.tool_kind)
    const itemId = text(item.id ?? item.itemId)
    if (toolKind === 'command_execution') {
      const surface = `${text(item.summary) ?? ''} ${text(item.detail) ?? ''} ${JSON.stringify(item.meta ?? {})}`
      output.push({
        kind: /terminal|pty/iu.test(surface) ? 'terminal' : 'ambient-command',
        ...(itemId ? { itemId } : {}),
        ...(text(item.summary ?? item.detail) ? {
          summary: truncate(text(item.summary ?? item.detail)!, 4_000)
        } : {})
      })
    } else if (toolKind === 'file_change') {
      output.push({
        kind: 'editor-change',
        ...(itemId ? { itemId } : {}),
        summary: truncate(text(item.summary) ?? 'Workspace file change', 4_000)
      })
    }
  }
  return output
}

function extractFilePlans(
  records: readonly Record<string, unknown>[],
  workspaceRoot: string
): Readonly<{
  files: CheckpointFilePlan[]
  fileBreakpoints: ResearchCheckpointBreakpointV1[]
}> {
  const fileBreakpoints: ResearchCheckpointBreakpointV1[] = []
  for (const item of records) {
    if (text(item.toolKind ?? item.tool_kind) !== 'file_change') continue
    const itemId = text(item.id ?? item.itemId)
    const rawPaths = new Set<string>()
    const generatedPaths = new Set<string>()
    collectTopLevelFilePath(item, rawPaths)
    const detail = text(item.detail)
    if (detail) {
      collectJsonFileChangePaths(detail, rawPaths, generatedPaths)
      collectDiffPaths(detail, rawPaths)
    }
    if (rawPaths.size === 0) {
      fileBreakpoints.push({
        code: 'file-path-missing',
        blocking: true,
        message: 'A file-change operation did not declare a workspace path.',
        ...(itemId ? {
          itemId,
          detail: { origin: 'file-change-declaration', callId: itemId }
        } : {})
      })
      continue
    }
    // A generic tool payload cannot declare a trustworthy file digest. Exact
    // producer descriptors are linked separately after owner capability
    // validation. Generic file changes are therefore post-turn observations.
    for (const rawPath of rawPaths) {
      const normalized = workspaceRelativePath(workspaceRoot, rawPath)
      if (!normalized) {
        fileBreakpoints.push({
          code: 'file-outside-workspace',
          blocking: true,
          message: 'A declared file path is outside the authoritative workspace and was not observed.',
          ...(itemId ? {
            itemId,
            detail: { origin: 'file-change-declaration', callId: itemId }
          } : {})
        })
        continue
      }
      fileBreakpoints.push({
        code: 'editor-change-untracked',
        blocking: true,
        message: 'The declared file has no Host-authenticated write receipt and was not advanced as a formal output Artifact.',
        itemId: `file:${normalized}`,
        ...(itemId ? {
          detail: { origin: 'file-change-declaration', callId: itemId, path: normalized }
        } : {})
      })
    }
  }
  return {
    files: [],
    fileBreakpoints
  }
}

function extractHostFileEffects(
  event: DomainTurnArtifactEvent,
  workspaceRoot: string
): Readonly<{
  files: CheckpointFilePlan[]
  breakpoints: ResearchCheckpointBreakpointV1[]
}> {
  const receipt = event.fileEffects
  if (!receipt) return { files: [], breakpoints: [] }
  const files: CheckpointFilePlan[] = []
  const patchReceipts = new Map<string, DomainTurnFilePatchReceiptV1[]>()
  for (const item of event.filePatchReceipts ?? []) {
    const normalized = workspaceRelativePath(workspaceRoot, item.path)
    if (!normalized || normalized !== item.path) continue
    const values = patchReceipts.get(normalized) ?? []
    values.push(item)
    patchReceipts.set(normalized, values)
  }
  for (const values of patchReceipts.values()) {
    values.sort((left, right) => (
      left.executorSequence - right.executorSequence ||
      left.callId.localeCompare(right.callId) ||
      left.patchDigest.localeCompare(right.patchDigest)
    ))
  }
  const breakpoints: ResearchCheckpointBreakpointV1[] = receipt.issues.map((issue) => ({
    code: issue.code,
    blocking: true,
    message: truncate(issue.message, 4_000),
    ...(issue.path ? { itemId: `file:${issue.path}` } : {}),
    detail: { origin: 'host-file-effects', ...(issue.path ? { path: issue.path } : {}) }
  }))
  for (const effect of receipt.effects) {
    const normalized = workspaceRelativePath(workspaceRoot, effect.path)
    if (!normalized || normalized !== effect.path) {
      breakpoints.push({
        code: 'host-file-effect-path-invalid',
        blocking: true,
        message: 'A Host file-effect path did not resolve to the exact authoritative workspace path.',
        detail: { origin: 'host-file-effects' }
      })
      continue
    }
    if (effect.kind !== 'deleted') {
      const ambientBytes = Buffer.from(effect.dataBase64, 'base64')
      if (ambientBytes.byteLength !== effect.byteLength || sha256(ambientBytes) !== effect.contentDigest) {
        breakpoints.push({
          code: 'host-file-effect-content-invalid',
          blocking: true,
          message: `Host terminal identity for ${normalized} failed its byte length or digest check.`,
          itemId: `file:${normalized}`,
          detail: { origin: 'host-file-effects', path: normalized }
        })
        continue
      }
    }
    const receipts = patchReceipts.get(normalized) ?? []
    if (receipts.length === 0) {
      breakpoints.push({
        code: 'ambient-file-change-unattributed',
        blocking: true,
        message: `File ${normalized} changed during the turn window, but no authenticated executor patch chain claimed it; it remains quarantined.`,
        itemId: `file:${normalized}`,
        detail: {
          origin: 'host-file-effects',
          effectKind: effect.kind,
          byteLength: effect.byteLength,
          ...(effect.kind === 'deleted' ? {} : { contentDigest: effect.contentDigest }),
          terminalCapturedAt: receipt.terminalCapturedAt
        }
      })
      continue
    }
    files.push({
      path: normalized,
      role: effect.kind === 'created' ? 'generated' : 'modified',
      ...(effect.kind === 'deleted' ? {} : {
        declaredDigest: effect.contentDigest,
        ...(effect.mediaType ? { mediaType: effect.mediaType } : {})
      }),
      expectedCurrentVersionId: null,
      patchReceipts: receipts,
      terminalEffect: {
        kind: effect.kind,
        byteLength: effect.byteLength,
        ...(effect.kind === 'deleted' ? {} : {
          contentDigest: effect.contentDigest,
          ...(effect.mediaType ? { mediaType: effect.mediaType } : {})
        })
      }
    })
  }
  for (const [path, receipts] of patchReceipts) {
    if (receipt.effects.some((effect) => effect.path === path)) continue
    breakpoints.push({
      code: 'host-file-patch-receipt-unmatched',
      blocking: true,
      message: `Authenticated patch receipt ${receipts[0]?.callId ?? 'unknown'} has no matching terminal file effect and was not committed.`,
      itemId: `file:${path}`,
      detail: { origin: 'host-file-effects', path }
    })
  }
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    breakpoints
  }
}

function pathsByCallId(
  plans: readonly CheckpointFilePlan[],
  requireVerifiedSnapshot: boolean
): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>()
  for (const plan of plans) {
    if (
      plan.terminalEffect?.kind === 'deleted' ||
      (requireVerifiedSnapshot && plan.terminalSnapshot?.dataBase64 === undefined)
    ) continue
    for (const receipt of plan.patchReceipts ?? []) {
      const paths = values.get(receipt.callId) ?? new Set<string>()
      paths.add(plan.path)
      values.set(receipt.callId, paths)
    }
  }
  return values
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string> | undefined): boolean {
  return Boolean(right && left.size === right.size && [...left].every((value) => right.has(value)))
}

const MAX_FILE_CHANGE_DETAIL_BYTES = 1_048_576
const MAX_FILE_CHANGE_JSON_DEPTH = 8
const MAX_FILE_CHANGE_JSON_NODES = 20_000
const MAX_FILE_CHANGE_ITEMS = 10_000
const MAX_FILE_CHANGE_PATH_LENGTH = 8_192

/**
 * Codex app-server deliberately serializes a completed fileChange item's
 * `changes` array into the normalized tool `detail` string. This parser only
 * accepts that narrow Host shape. It does not recursively interpret arbitrary
 * tool JSON as producer metadata.
 */
function collectJsonFileChangePaths(
  detail: string,
  output: Set<string>,
  generated: Set<string>
): void {
  if (Buffer.byteLength(detail, 'utf8') > MAX_FILE_CHANGE_DETAIL_BYTES) return
  const trimmed = detail.trim()
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return
  }
  if (!jsonWithinBounds(parsed)) return
  const root = record(parsed)
  const changes = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.changes)
      ? root.changes
      : null
  if (!changes || changes.length > MAX_FILE_CHANGE_ITEMS) return
  for (const candidate of changes) {
    const change = record(candidate)
    if (!change) continue
    const path = directFileChangePath(change)
    if (!path) continue
    output.add(path)
    const kind = text(change.kind ?? change.type ?? change.status)?.toLowerCase()
    if (kind && /^(?:add|added|create|created|new)$/u.test(kind)) generated.add(path)
  }
}

function directFileChangePath(change: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'filePath', 'relativePath'] as const) {
    const value = text(change[key])
    if (
      value &&
      value !== '/dev/null' &&
      value.length <= MAX_FILE_CHANGE_PATH_LENGTH &&
      !value.includes('\0')
    ) return value
  }
  return undefined
}

function jsonWithinBounds(value: unknown): boolean {
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > MAX_FILE_CHANGE_JSON_NODES || current.depth > MAX_FILE_CHANGE_JSON_DEPTH) {
      return false
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_FILE_CHANGE_JSON_NODES) return false
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
      continue
    }
    const object = record(current.value)
    if (!object) continue
    const values = Object.values(object)
    if (values.length > MAX_FILE_CHANGE_JSON_NODES) return false
    for (const child of values) pending.push({ value: child, depth: current.depth + 1 })
  }
  return true
}

function collectTopLevelFilePath(value: Record<string, unknown>, output: Set<string>): void {
  for (const key of ['filePath', 'relativePath'] as const) {
    const candidate = text(value[key])
    if (
      candidate &&
      candidate !== '/dev/null' &&
      candidate.length <= MAX_FILE_CHANGE_PATH_LENGTH &&
      !candidate.includes('\0')
    ) output.add(candidate)
  }
}

function collectDiffPaths(detail: string, output: Set<string>): void {
  for (const line of detail.split(/\r?\n/u)) {
    const match = /^(?:\+\+\+|---)\s+(?:[ab]\/)?([^\t]+)$/u.exec(line)
    const candidate = match?.[1]?.trim()
    if (
      candidate &&
      candidate !== '/dev/null' &&
      candidate.length <= MAX_FILE_CHANGE_PATH_LENGTH &&
      !candidate.includes('\0')
    ) output.add(candidate)
  }
}

function workspaceRelativePath(workspaceRoot: string, value: string): string | null {
  const cleaned = value.trim().replace(/^file:\/\//iu, '')
  const absolute = isAbsolute(cleaned) ? resolve(cleaned) : resolve(workspaceRoot, cleaned)
  const relativePath = relative(resolve(workspaceRoot), absolute)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null
  }
  return relativePath.split(sep).join('/')
}

function fileRole(role: ResearchCheckpointDeclaredFileV1['role']): ResearchCheckpointArtifactDependencyV1['role'] {
  return role === 'input' ? 'input' : 'output'
}

function dedupeDependencies(
  values: readonly ResearchCheckpointArtifactDependencyV1[]
): ResearchCheckpointArtifactDependencyV1[] {
  const byVersion = new Map<string, ResearchCheckpointArtifactDependencyV1>()
  for (const value of values) byVersion.set(value.ref.versionId, value)
  return [...byVersion.values()].sort((left, right) => left.ref.versionId.localeCompare(right.ref.versionId))
}

function visit(
  values: readonly unknown[],
  callback: (value: Record<string, unknown>, path: string) => void,
  path = '',
  depth = 0,
  seen = new Set<object>()
): void {
  if (depth > 12) return
  values.forEach((value, index) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      visit(value, callback, `${path}[${index}]`, depth + 1, seen)
      return
    }
    const current = value as Record<string, unknown>
    const currentPath = `${path}.${index}`
    callback(current, currentPath)
    for (const [key, candidate] of Object.entries(current)) {
      if (candidate && typeof candidate === 'object') {
        visit([candidate], callback, `${currentPath}.${key}`, depth + 1, seen)
      }
    }
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, length)
}
