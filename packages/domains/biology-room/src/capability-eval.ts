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
import { BIOLOGY_ROOM_CAPABILITY_IDS } from './contract.js'
import { BIOLOGY_ROOM_DOMAIN_MODULE_ID } from './definition.js'
import { BiologyRoomService } from './service.js'

export const BIOLOGY_ROOM_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND

const ROOM_ID = 'eval-room'
const TITLE = 'Biology Evaluation Room'
const SEQUENCE_PATH = 'fixtures/eval-sequence.fa'
const SEQUENCE_CONTENT = '>seq1\nACGTACGT\n'
const SECOND_SEQUENCE_PATH = 'fixtures/eval-sequence-2.fa'
const SECOND_SEQUENCE_CONTENT = '>seq2\nTTGGCCAA\n'
const REFRESHED_SEQUENCE_CONTENT = '>seq1\nACGTTCGT\n'

export const BIOLOGY_ROOM_EVAL_CASE_IDS = Object.freeze({
  list: 'biology-room-list-local-fixture',
  create: 'biology-room-create-local-fixture',
  openOrCreate: 'biology-room-open-or-create-local-fixture',
  load: 'biology-room-load-local-fixture',
  open: 'biology-room-open-local-fixture',
  apply: 'biology-room-apply-local-fixture',
  refresh: 'biology-room-refresh-local-fixture',
  history: 'biology-room-history-local-fixture'
})

const CASE_IDS = new Set<string>(Object.values(BIOLOGY_ROOM_EVAL_CASE_IDS))
const BIOLOGY_ROOM_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'core.biology-room.open': BIOLOGY_ROOM_EVAL_CASE_IDS.openOrCreate
})
const EVALUATION_ACTION_IDS = Object.freeze([
  BIOLOGY_ROOM_CAPABILITY_IDS.list,
  BIOLOGY_ROOM_CAPABILITY_IDS.create,
  BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate,
  BIOLOGY_ROOM_CAPABILITY_IDS.load,
  BIOLOGY_ROOM_CAPABILITY_IDS.open,
  BIOLOGY_ROOM_CAPABILITY_IDS.apply,
  BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
  BIOLOGY_ROOM_CAPABILITY_IDS.history
])

export const BIOLOGY_ROOM_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: BIOLOGY_ROOM_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: Object.values(BIOLOGY_ROOM_CAPABILITY_IDS),
  evaluationActionIds: EVALUATION_ACTION_IDS,
  prepare: prepareBiologyRoomEvaluationFixture,
  inspect: inspectBiologyRoomEvaluation
})

async function prepareBiologyRoomEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = biologyRoomEvaluationCaseId(context)
  if (!CASE_IDS.has(caseId)) return undefined
  await mkdir(join(context.workspaceDirectory, 'fixtures'), { recursive: true })
  await writeFile(join(context.workspaceDirectory, SEQUENCE_PATH), SEQUENCE_CONTENT, 'utf8')
  await writeFile(join(context.workspaceDirectory, SECOND_SEQUENCE_PATH), SECOND_SEQUENCE_CONTENT, 'utf8')

  if (
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.list ||
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.load ||
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.open ||
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.apply ||
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.refresh ||
    caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.history
  ) {
    await createSeedRoom(context.workspaceDirectory)
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.refresh) {
    await writeFile(join(context.workspaceDirectory, SEQUENCE_PATH), REFRESHED_SEQUENCE_CONTENT, 'utf8')
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.history) {
    await new BiologyRoomService().apply({
      workspaceRoot: context.workspaceDirectory,
      roomId: ROOM_ID,
      baseRevision: 1,
      operations: [{ type: 'addAsset', asset: { id: 'sequence-2', path: SECOND_SEQUENCE_PATH } }]
    })
  }

  return {
    fixtureId: `biology-room.${caseId}.v1`,
    paths: [SEQUENCE_PATH, SECOND_SEQUENCE_PATH, `.sciforge/biology/rooms/${ROOM_ID}/room.json`],
    metadata: { roomId: ROOM_ID, sequencePath: SEQUENCE_PATH }
  }
}

async function createSeedRoom(workspaceRoot: string): Promise<void> {
  await new BiologyRoomService().create({
    workspaceRoot,
    roomId: ROOM_ID,
    title: TITLE,
    assets: [{ id: 'sequence-1', path: SEQUENCE_PATH }]
  })
}

async function inspectBiologyRoomEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = biologyRoomEvaluationCaseId(input.context)
  if (!CASE_IDS.has(caseId)) return undefined
  const actionId = actionForCase(caseId)
  const invocation = [...input.invocations].reverse().find((candidate) => candidate.actionId === actionId && candidate.success)
  if (!invocation) return failed(`Biology Room action ${actionId} did not have a successful terminal invocation.`)

  const service = new BiologyRoomService()
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.list) {
    const rooms = await service.list({ workspaceRoot: input.context.workspaceDirectory, limit: 100 })
    const room = rooms.find((candidate) => candidate.roomId === ROOM_ID)
    return result(Boolean(room && room.title === TITLE && room.assetCount === 1), { listed: Boolean(room), roomCount: rooms.length }, actionId, 'Independently listed the persisted Biology Room index and verified the seeded room summary.')
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.open) {
    const observation = await service.observe({
      workspaceRoot: input.context.workspaceDirectory,
      roomId: ROOM_ID,
      assetLimit: 100,
      annotationLimit: 100,
      contigLimit: 500
    }).catch(() => undefined)
    const valid = Boolean(
      observation &&
      observation.roomId === ROOM_ID &&
      observation.title === TITLE &&
      observation.assets.length === 1 &&
      observation.assets[0]?.path === SEQUENCE_PATH
    )
    return result(valid, { observed: valid, assetCount: observation?.assets.length ?? 0 }, actionId, 'Independently observed the persisted Biology Room resource and verified its bounded asset view.')
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.apply) {
    const manifest = await service.load({ workspaceRoot: input.context.workspaceDirectory, roomId: ROOM_ID }).catch(() => undefined)
    const valid = Boolean(
      manifest &&
      manifest.roomId === ROOM_ID &&
      manifest.revision === 2 &&
      manifest.assets.some((asset) => asset.id === 'sequence-2' && asset.path === SECOND_SEQUENCE_PATH)
    )
    return result(valid, { applied: valid, revision: manifest?.revision ?? 0, assetCount: manifest?.assets.length ?? 0 }, actionId, 'Independently loaded the persisted manifest and verified the resource-scoped apply added the fixed second sequence asset.')
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.refresh) {
    const manifest = await service.load({ workspaceRoot: input.context.workspaceDirectory, roomId: ROOM_ID }).catch(() => undefined)
    const refreshedAsset = manifest?.assets.find((asset) => asset.path === SEQUENCE_PATH)
    const actualSha256 = await sha256File(join(input.context.workspaceDirectory, SEQUENCE_PATH)).catch(() => undefined)
    const valid = Boolean(
      manifest &&
      manifest.roomId === ROOM_ID &&
      manifest.revision === 2 &&
      refreshedAsset &&
      actualSha256 &&
      refreshedAsset.sha256 === actualSha256 &&
      refreshedAsset.sha256 !== sha256Text(SEQUENCE_CONTENT)
    )
    return result(valid, { refreshed: valid, revision: manifest?.revision ?? 0, digestMatches: Boolean(actualSha256 && refreshedAsset?.sha256 === actualSha256) }, actionId, 'Independently compared the refreshed FASTA digest with the durable Biology Room manifest and verified a new revision.')
  }
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.history) {
    const history = await service.history({ workspaceRoot: input.context.workspaceDirectory, roomId: ROOM_ID, limit: 100 }).catch(() => undefined)
    const valid = Boolean(
      history &&
      history.roomId === ROOM_ID &&
      history.currentRevision === 2 &&
      history.entries.some((entry) => entry.revision === 1) &&
      history.entries.some((entry) => entry.revision === 2 && entry.event?.operations.some((operation) => operation.type === 'addAsset'))
    )
    return result(valid, { historyRead: valid, currentRevision: history?.currentRevision ?? 0, entryCount: history?.entries.length ?? 0 }, actionId, 'Independently read the bounded Biology Room revision history and verified the create and add-asset events.')
  }

  let roomId = ROOM_ID
  if (caseId === BIOLOGY_ROOM_EVAL_CASE_IDS.openOrCreate) {
    const summaries = await service.list({ workspaceRoot: input.context.workspaceDirectory, limit: 100 })
    for (const summary of summaries) {
      const candidate = await service.load({
        workspaceRoot: input.context.workspaceDirectory,
        roomId: summary.roomId
      }).catch(() => undefined)
      if (candidate?.assets.some((asset) => asset.path === SEQUENCE_PATH)) {
        roomId = candidate.roomId
        break
      }
    }
  }
  const manifest = await service.load({ workspaceRoot: input.context.workspaceDirectory, roomId }).catch(() => undefined)
  const valid = Boolean(manifest && manifest.roomId === roomId && manifest.title === TITLE && manifest.assets.some((asset) => asset.path === SEQUENCE_PATH))
  return result(valid, { roomReady: valid, roomId: manifest?.roomId ?? null, revision: manifest?.revision ?? 0 }, actionId, 'Independently loaded the persisted Biology Room manifest and verified the fixed sequence asset identity.')
}

function biologyRoomEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && BIOLOGY_ROOM_ROUTING_PROFILES[context.fixtureProfile]
    ? BIOLOGY_ROOM_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

function actionForCase(caseId: string): string {
  const mapping: Record<string, string> = {
    [BIOLOGY_ROOM_EVAL_CASE_IDS.list]: BIOLOGY_ROOM_CAPABILITY_IDS.list,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.create]: BIOLOGY_ROOM_CAPABILITY_IDS.create,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.openOrCreate]: BIOLOGY_ROOM_CAPABILITY_IDS.openOrCreate,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.load]: BIOLOGY_ROOM_CAPABILITY_IDS.load,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.open]: BIOLOGY_ROOM_CAPABILITY_IDS.open,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.apply]: BIOLOGY_ROOM_CAPABILITY_IDS.apply,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.refresh]: BIOLOGY_ROOM_CAPABILITY_IDS.refresh,
    [BIOLOGY_ROOM_EVAL_CASE_IDS.history]: BIOLOGY_ROOM_CAPABILITY_IDS.history
  }
  return mapping[caseId]!
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function sha256Text(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function result(
  passed: boolean,
  finalState: DomainPackageJsonValue,
  actionId: string,
  evidence: string
): DomainCapabilityEvalOracleResult {
  return {
    taskSuccess: passed,
    finalState,
    evidence: [evidence],
    verifiedActions: passed ? [actionId] : []
  }
}

function failed(message: string): DomainCapabilityEvalOracleResult {
  return { taskSuccess: false, evidence: [message], verifiedActions: [] }
}
