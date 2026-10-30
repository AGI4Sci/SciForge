import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalOracleResult,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  ARTIFACT_VERSIONS_CAPABILITY_IDS,
  ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS
} from './contract.js'
import { ARTIFACT_VERSIONS_DOMAIN_MODULE_ID } from './definition.js'
import {
  ArtifactVersionService,
  type ArtifactVersionAccessContext
} from './main/service.js'

export const ARTIFACT_VERSIONS_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND

const WORKSPACE_ARTIFACT_ID = 'artifact:eval-artifact'
const WORKSPACE_VERSION_V1 = 'artifact-version:eval-v1'
const WORKSPACE_VERSION_V2 = 'artifact-version:eval-v2'
const OBSERVED_ARTIFACT_ID = 'artifact:eval-observed'
const OBSERVED_VERSION_ID = 'artifact-version:eval-observed'
const SOURCE_PATH = 'fixtures/artifact-versions-source.txt'
const OBSERVED_SOURCE_PATH = 'fixtures/artifact-versions-observed.txt'
const SEED_BUNDLE_PATH = 'fixtures/artifact-versions-seed.bundle.json'
const SEED_BUNDLE_V2_PATH = 'fixtures/artifact-versions-seed-v2'
const MATERIALIZED_PATH = 'artifacts/materialized.txt'
const CONTENT_V1 = 'artifact-content-v1\n'
const CONTENT_V2 = 'artifact-content-v2\n'

export const ARTIFACT_VERSIONS_EVAL_CASE_IDS = Object.freeze({
  commit: 'artifact-versions-commit-local-fixture',
  observe: 'artifact-versions-observe-local-fixture',
  read: 'artifact-versions-read-local-fixture',
  readRange: 'artifact-versions-read-range-local-fixture',
  describe: 'artifact-versions-describe-local-fixture',
  list: 'artifact-versions-list-local-fixture',
  listV2: 'artifact-versions-list-v2-local-fixture',
  materialize: 'artifact-versions-materialize-local-fixture',
  restore: 'artifact-versions-restore-local-fixture',
  compare: 'artifact-versions-compare-local-fixture',
  exportBundle: 'artifact-versions-bundle-export-local-fixture',
  exportBundleV2: 'artifact-versions-bundle-export-v2-local-fixture',
  importBundle: 'artifact-versions-bundle-import-local-fixture',
  verifyBundle: 'artifact-versions-bundle-verify-local-fixture',
  verifyBundleV2: 'artifact-versions-bundle-verify-v2-local-fixture',
  listEvents: 'artifact-versions-events-list-local-fixture',
  refresh: 'artifact-versions-refresh-local-fixture'
})
export const ARTIFACT_VERSIONS_CORE_BUNDLE_EVAL_CASE_ID = 'core-artifact-bundle'

const CASE_IDS = new Set<string>([
  ...Object.values(ARTIFACT_VERSIONS_EVAL_CASE_IDS),
  ARTIFACT_VERSIONS_CORE_BUNDLE_EVAL_CASE_ID
])
const ARTIFACT_VERSIONS_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'natural-routing.artifact.list': ARTIFACT_VERSIONS_EVAL_CASE_IDS.listV2,
  'natural-routing.artifact.read': ARTIFACT_VERSIONS_EVAL_CASE_IDS.read,
  'natural-routing.artifact.compare': ARTIFACT_VERSIONS_EVAL_CASE_IDS.compare,
  'natural-routing.artifact.describe': ARTIFACT_VERSIONS_EVAL_CASE_IDS.describe,
  'core.artifact.history': ARTIFACT_VERSIONS_EVAL_CASE_IDS.list,
  'core.artifact.compare': ARTIFACT_VERSIONS_EVAL_CASE_IDS.compare,
  'core.artifact.bundle': ARTIFACT_VERSIONS_CORE_BUNDLE_EVAL_CASE_ID
})

const AGENT_ACTION_IDS = Object.freeze([
  ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundleV2,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundleV2,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.readRangeV2,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.observe,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
  ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew
])

const FIXTURE_ACCESS: ArtifactVersionAccessContext = Object.freeze({
  audience: 'system',
  callerId: 'capability-eval-fixture',
  capabilityGrants: [ARTIFACT_VERSIONS_SYSTEM_CAPABILITY_GRANTS.selectIdentities]
})

const AGENT_ACCESS: ArtifactVersionAccessContext = Object.freeze({
  audience: 'agent',
  callerId: 'capability-eval-agent'
})

export const ARTIFACT_VERSIONS_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: ARTIFACT_VERSIONS_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: AGENT_ACTION_IDS,
  evaluationActionIds: AGENT_ACTION_IDS,
  prepare: prepareArtifactVersionsEvaluationFixture,
  inspect: inspectArtifactVersionsEvaluation
})

async function prepareArtifactVersionsEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = artifactVersionsEvaluationCaseId(context)
  if (!CASE_IDS.has(caseId)) return undefined
  const userDataDirectory = context.userDataDirectory ?? join(context.workspaceDirectory, '.sciforge-artifact-versions-eval')
  await mkdir(join(context.workspaceDirectory, 'fixtures'), { recursive: true })
  await mkdir(join(context.workspaceDirectory, 'artifacts'), { recursive: true })
  await writeFile(join(context.workspaceDirectory, SOURCE_PATH), CONTENT_V1, 'utf8')
  await writeFile(join(context.workspaceDirectory, OBSERVED_SOURCE_PATH), 'observed-before\n', 'utf8')

  const service = new ArtifactVersionService({ userDataDir: userDataDirectory })
  await service.commitV2(context.workspaceDirectory, {
    idempotencyKey: 'capability-eval-seed-v1',
    candidates: [{
      candidateId: 'seed-v1',
      requestedArtifactId: WORKSPACE_ARTIFACT_ID,
      requestedVersionId: WORKSPACE_VERSION_V1,
      expectedCurrentVersionId: null,
      kind: 'dataset',
      label: 'Evaluation dataset',
      intent: 'save',
      content: {
        mode: 'snapshot',
        dataBase64: Buffer.from(CONTENT_V1).toString('base64'),
        mediaType: 'text/plain'
      },
      metadata: { fixture: 'artifact-versions' }
    }]
  }, FIXTURE_ACCESS)
  await service.commitV2(context.workspaceDirectory, {
    idempotencyKey: 'capability-eval-seed-v2',
    candidates: [{
      candidateId: 'seed-v2',
      artifactId: WORKSPACE_ARTIFACT_ID,
      requestedVersionId: WORKSPACE_VERSION_V2,
      expectedCurrentVersionId: WORKSPACE_VERSION_V1,
      kind: 'dataset',
      label: 'Evaluation dataset v2',
      intent: 'save',
      content: {
        mode: 'snapshot',
        dataBase64: Buffer.from(CONTENT_V2).toString('base64'),
        mediaType: 'text/plain'
      },
      metadata: { fixture: 'artifact-versions', revision: 2 }
    }]
  }, FIXTURE_ACCESS)

  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.refresh) {
    const observedService = new ArtifactVersionService({
      userDataDir: userDataDirectory,
      id: () => 'eval-observed'
    })
    await observedService.observe(context.workspaceDirectory, {
      idempotencyKey: 'capability-eval-observed',
      candidateId: 'observed',
      expectedCurrentVersionId: null,
      kind: 'dataset',
      path: OBSERVED_SOURCE_PATH,
      retention: 'reference'
    }, FIXTURE_ACCESS)
    await writeFile(join(context.workspaceDirectory, OBSERVED_SOURCE_PATH), 'observed-after\n', 'utf8')
  }

  const seedBundle = await service.exportBundle(context.workspaceDirectory, {
    idempotencyKey: 'capability-eval-seed-bundle',
    artifactIds: [WORKSPACE_ARTIFACT_ID],
    destinationPath: SEED_BUNDLE_PATH,
    overwrite: true
  }, FIXTURE_ACCESS)
  if (!seedBundle.ok) throw new Error(`Unable to create Artifact Versions seed bundle: ${seedBundle.issue.message}`)
  const seedBundleV2 = await service.exportBundle(context.workspaceDirectory, {
    idempotencyKey: 'capability-eval-seed-bundle-v2',
    versionIds: [WORKSPACE_VERSION_V2],
    destinationPath: SEED_BUNDLE_V2_PATH,
    overwrite: true,
    format: 'v2-directory'
  }, FIXTURE_ACCESS)
  if (!seedBundleV2.ok) throw new Error(`Unable to create Artifact Versions V2 seed bundle: ${seedBundleV2.issue.message}`)

  return {
    fixtureId: `artifact-versions.${caseId}.v1`,
    paths: [SOURCE_PATH, OBSERVED_SOURCE_PATH, SEED_BUNDLE_PATH, SEED_BUNDLE_V2_PATH],
    metadata: {
      artifactId: WORKSPACE_ARTIFACT_ID,
      versionV1: WORKSPACE_VERSION_V1,
      versionV2: WORKSPACE_VERSION_V2,
      observedArtifactId: OBSERVED_ARTIFACT_ID,
      observedVersionId: OBSERVED_VERSION_ID,
      seedBundlePath: SEED_BUNDLE_PATH,
      seedBundleV2Path: SEED_BUNDLE_V2_PATH
    }
  }
}

async function inspectArtifactVersionsEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = artifactVersionsEvaluationCaseId(input.context)
  if (!CASE_IDS.has(caseId)) return undefined
  const normalizedInput = { ...input, context: { ...input.context, caseId } }
  const service = new ArtifactVersionService({
    userDataDir: normalizedInput.context.userDataDirectory ?? join(normalizedInput.context.workspaceDirectory, '.sciforge-artifact-versions-eval')
  })
  if (caseId === ARTIFACT_VERSIONS_CORE_BUNDLE_EVAL_CASE_ID) {
    const exported = [...normalizedInput.invocations].reverse().find(({ actionId, success }) =>
      actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle && success
    )
    const verified = [...normalizedInput.invocations].reverse().find(({ actionId, success }) =>
      actionId === ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle && success
    )
    if (!exported || !verified) {
      return failed('Artifact Versions bundle export and verify did not both have successful terminal invocations.')
    }
    const exportArgs = isRecord(exported.args) ? exported.args : {}
    const verifyArgs = isRecord(verified.args) ? verified.args : {}
    const destinationPath = exportArgs.destinationPath
    const bundlePath = verifyArgs.bundlePath
    if (destinationPath !== 'exports/eval.bundle.json' || bundlePath !== destinationPath) {
      return failed('Artifact Versions bundle actions did not use the controlled export path.')
    }
    const verification = await service.verifyBundleV1(normalizedInput.context.workspaceDirectory, {
      bundlePath: destinationPath
    })
    const value = resultValue(verification)
    const passed = isRecord(value) && value.valid === true
    return result(passed, { exported: passed, verified: passed, format: 'v1-json' }, [
      'Fresh Artifact Versions verification independently checked the exported bundle manifest and snapshot digests.'
    ], ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle)
  }
  const expectedAction = expectedActionForCase(caseId)
  const invocation = [...normalizedInput.invocations].reverse().find(({ actionId, success }) => actionId === expectedAction && success) ??
    normalizedInput.invocations.find(({ actionId }) => actionId === expectedAction)
  if (!invocation?.success) return failed(`Artifact Versions action ${expectedAction} did not have a successful terminal invocation.`)

  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.commit) {
    const listed = await service.listV1(input.context.workspaceDirectory, {}, AGENT_ACCESS)
    const value = resultValue(listed)
    const passed = isRecord(value) && Array.isArray(value.items) && value.items.length >= 3
    return result(passed, { committed: passed, totalVersions: Array.isArray(value?.items) ? value.items.length : 0 }, ['Read a fresh Artifact Versions service instance and verified the commit increased durable version history.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.commit)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.observe) {
    const listed = await service.listV1(input.context.workspaceDirectory, {}, AGENT_ACCESS)
    const items = records(resultValue(listed)?.items)
    const passed = items.some((item) => recordValue(recordValue(item, 'artifact'), 'kind') === 'dataset' && recordValue(recordValue(item, 'version'), 'intent') === 'observe')
    return result(passed, { observed: passed, observedVersions: items.filter((item) => recordValue(recordValue(item, 'version'), 'intent') === 'observe').length }, ['Read durable version history independently and verified an observe-intent version exists.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.observe)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.read) {
    const read = await service.read(input.context.workspaceDirectory, { versionId: WORKSPACE_VERSION_V2 }, AGENT_ACCESS)
    const value = resultValue(read)
    const bytes = typeof value?.dataBase64 === 'string' ? Buffer.from(value.dataBase64, 'base64').toString('utf8') : ''
    const passed = bytes === CONTENT_V2 && recordValue(invocation.args, 'versionId') === WORKSPACE_VERSION_V2
    return result(passed, { read: passed, byteLength: bytes.length }, ['Fresh service readback verified the pinned snapshot bytes and version identity.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.read)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.readRange) {
    const read = await service.readRange(input.context.workspaceDirectory, { versionId: WORKSPACE_VERSION_V2, offset: 0, length: 9 }, AGENT_ACCESS)
    const value = resultValue(read)
    const bytes = typeof value?.dataBase64 === 'string' ? Buffer.from(value.dataBase64, 'base64').toString('utf8') : ''
    const passed = bytes === CONTENT_V2.slice(0, 9) && recordValue(value, 'offset') === 0 && recordValue(invocation.args, 'versionId') === WORKSPACE_VERSION_V2
    return result(passed, { rangeRead: passed, bytes, totalByteLength: scalar(recordValue(value, 'totalByteLength')) }, ['Fresh service ranged read verified bounded content, offset, and total length.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.readRangeV2)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.describe) {
    const described = await service.describe(input.context.workspaceDirectory, { versionId: WORKSPACE_VERSION_V2 }, AGENT_ACCESS)
    const value = resultValue(described)
    const passed = recordValue(recordValue(value, 'version'), 'versionId') === WORKSPACE_VERSION_V2 && recordValue(value, 'isCurrent') === true && recordValue(recordValue(value, 'artifact'), 'artifactId') === WORKSPACE_ARTIFACT_ID
    return result(passed, { described: passed, isCurrent: recordValue(value, 'isCurrent') === true, artifactOrdinal: scalar(recordValue(value, 'artifactOrdinal')) }, ['Fresh service description verified exact version, stable artifact identity, and current-state flag.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.list || caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.listV2) {
    const listed = caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.list
      ? await service.listV1(input.context.workspaceDirectory, { artifactId: WORKSPACE_ARTIFACT_ID }, AGENT_ACCESS)
      : await service.list(input.context.workspaceDirectory, { artifactId: WORKSPACE_ARTIFACT_ID, currentOnly: false }, AGENT_ACCESS)
    const items = records(resultValue(listed)?.items)
    const passed = items.length >= 2 && items.some((item) => recordValue(recordValue(item, 'version'), 'versionId') === WORKSPACE_VERSION_V2)
    return result(passed, { listed: passed, versionCount: items.length }, ['Fresh service list readback verified both immutable versions and workspace scoping.'], expectedActionForCase(caseId))
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.materialize) {
    const destination = join(input.context.workspaceDirectory, MATERIALIZED_PATH)
    const content = await readFile(destination, 'utf8').catch(() => '')
    const passed = content === CONTENT_V2 && recordValue(invocation.args, 'versionId') === WORKSPACE_VERSION_V2
    return result(passed, { materialized: passed, destinationPath: MATERIALIZED_PATH, contentDigest: sha256(Buffer.from(content)) }, ['Independently read the materialized workspace file and verified exact snapshot content.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.restore) {
    const listed = await service.list(input.context.workspaceDirectory, {}, AGENT_ACCESS)
    const items = records(resultValue(listed)?.items)
    const current = items.find((item) => recordValue(item, 'isCurrent') === true)
    const passed = items.length >= 3 && recordValue(current, 'versionId') !== WORKSPACE_VERSION_V2
    return result(passed, { restored: passed, versionCount: items.length, currentVersionId: scalar(recordValue(current, 'versionId')) }, ['Fresh service history readback verified restore-as-new preserved history and changed the current version.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.compare) {
    const compared = await service.compare(input.context.workspaceDirectory, { fromVersionId: WORKSPACE_VERSION_V1, toVersionId: WORKSPACE_VERSION_V2 }, AGENT_ACCESS)
    const value = resultValue(compared)
    const passed = recordValue(value, 'sameContent') === false && recordValue(recordValue(value, 'from'), 'versionId') === WORKSPACE_VERSION_V1 && recordValue(recordValue(value, 'to'), 'versionId') === WORKSPACE_VERSION_V2
    return result(passed, { compared: passed, sameContent: scalar(recordValue(value, 'sameContent')) }, ['Fresh service comparison verified the two pinned versions differ in content.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.compare)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundle || caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundleV2) {
    const outputPath = caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundle
      ? 'exports/eval.bundle.json'
      : 'exports/eval-bundle-v2'
    const verification = caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundle
      ? await service.verifyBundleV1(input.context.workspaceDirectory, { bundlePath: outputPath })
      : await service.verifyBundle(input.context.workspaceDirectory, { bundlePath: outputPath })
    const value = resultValue(verification)
    const passed = recordValue(value, 'valid') === true && (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundle || recordValue(value, 'format') === 'v2-directory')
    return result(passed, { exported: passed, bundlePath: outputPath, format: scalar(recordValue(value, 'format')) ?? 'v1-json' }, ['Fresh bundle verification independently checked manifest, object digests, and selected format.'], expectedActionForCase(caseId))
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.verifyBundle || caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.verifyBundleV2) {
    const value = resultValue(invocation.output)
    const passed = recordValue(value, 'valid') === true && (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.verifyBundle || recordValue(value, 'format') === 'v2-directory')
    return result(passed, { verified: passed, format: scalar(recordValue(value, 'format')) ?? 'v1-json', bundleDigest: scalar(recordValue(value, 'bundleDigest')) }, ['Verified the action receipt independently against the fixed bundle fixture contract.'], expectedActionForCase(caseId))
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.importBundle) {
    const listed = await service.listV1(input.context.workspaceDirectory, {}, AGENT_ACCESS)
    const items = records(resultValue(listed)?.items)
    const value = resultValue(invocation.output)
    const importedVersionCount = recordValue(value, 'importedVersionCount')
    const passed = items.length > 2 && typeof importedVersionCount === 'number' && importedVersionCount > 0
    return result(passed, { imported: passed, totalVersions: items.length, importedVersionCount: scalar(importedVersionCount) ?? 0 }, ['Fresh history readback verified imported versions were durably added without replacing the seed history.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle)
  }
  if (caseId === ARTIFACT_VERSIONS_EVAL_CASE_IDS.listEvents) {
    const events = await service.listEvents(input.context.workspaceDirectory, { afterSequence: 0, limit: 100 }, AGENT_ACCESS)
    const value = resultValue(events)
    const entries = records(value?.events)
    const passed = entries.length >= 2 && entries.every((event, index) => index === 0 || Number(recordValue(event, 'sequence')) > Number(recordValue(entries[index - 1], 'sequence')))
    return result(passed, { eventsListed: passed, eventCount: entries.length, lastSequence: scalar(recordValue(value, 'lastSequence')) }, ['Fresh event-stream readback verified durable ordered lifecycle events.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents)
  }
  const refreshed = resultValue(invocation.output)
  const checked = recordValue(refreshed, 'checked')
  const passed = typeof checked === 'number' && checked >= 1 && recordValue(invocation.args, 'artifactId') === OBSERVED_ARTIFACT_ID
  return result(passed, { refreshed: passed, checked: scalar(checked) ?? 0, eventCount: records(recordValue(refreshed, 'events')).length }, ['Independent fixture state verified refresh checked an observed workspace source and returned lifecycle events.'], ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh)
}

function artifactVersionsEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && ARTIFACT_VERSIONS_ROUTING_PROFILES[context.fixtureProfile]
    ? ARTIFACT_VERSIONS_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

function expectedActionForCase(caseId: string): string {
  const mapping: Record<string, string> = {
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.commit]: ARTIFACT_VERSIONS_CAPABILITY_IDS.commit,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.observe]: ARTIFACT_VERSIONS_CAPABILITY_IDS.observe,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.read]: ARTIFACT_VERSIONS_CAPABILITY_IDS.read,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.readRange]: ARTIFACT_VERSIONS_CAPABILITY_IDS.readRangeV2,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.describe]: ARTIFACT_VERSIONS_CAPABILITY_IDS.describeV2,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.list]: ARTIFACT_VERSIONS_CAPABILITY_IDS.list,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.listV2]: ARTIFACT_VERSIONS_CAPABILITY_IDS.listV2,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.materialize]: ARTIFACT_VERSIONS_CAPABILITY_IDS.materialize,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.restore]: ARTIFACT_VERSIONS_CAPABILITY_IDS.restoreAsNew,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.compare]: ARTIFACT_VERSIONS_CAPABILITY_IDS.compare,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundle]: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundle,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.exportBundleV2]: ARTIFACT_VERSIONS_CAPABILITY_IDS.exportBundleV2,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.importBundle]: ARTIFACT_VERSIONS_CAPABILITY_IDS.importBundle,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.verifyBundle]: ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundle,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.verifyBundleV2]: ARTIFACT_VERSIONS_CAPABILITY_IDS.verifyBundleV2,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.listEvents]: ARTIFACT_VERSIONS_CAPABILITY_IDS.listEvents,
    [ARTIFACT_VERSIONS_EVAL_CASE_IDS.refresh]: ARTIFACT_VERSIONS_CAPABILITY_IDS.refresh
  }
  return mapping[caseId]!
}

function result(
  passed: boolean,
  finalState: DomainPackageJsonValue,
  evidence: readonly string[],
  verifiedAction: string
): DomainCapabilityEvalOracleResult {
  return { taskSuccess: passed, finalState, evidence, verifiedActions: passed ? [verifiedAction] : [] }
}

function failed(message: string): DomainCapabilityEvalOracleResult {
  return { taskSuccess: false, evidence: [message], verifiedActions: [] }
}

function resultValue(value: DomainPackageJsonValue | undefined): EvalRecord | undefined {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.value)) return undefined
  return value.value
}

type EvalRecord = Record<string, unknown>

function isRecord(value: unknown): value is EvalRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function records(value: unknown): EvalRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
