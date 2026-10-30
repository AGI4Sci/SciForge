import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
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
import { GIT_CHECKPOINTS_CAPABILITY_IDS } from './contract.js'
import { GIT_CHECKPOINTS_DOMAIN_MODULE_ID } from './definition.js'
import { GitCheckpointService } from './service.js'

const execFileAsync = promisify(execFile)

export const GIT_CHECKPOINTS_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND
export const GIT_CHECKPOINTS_LIST_EVAL_CASE_ID = 'git-checkpoints-list'
export const GIT_CHECKPOINTS_CREATE_EVAL_CASE_ID = 'git-checkpoints-create-local-fixture'
export const GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID = 'git-checkpoints-preview-local-fixture'
export const GIT_CHECKPOINTS_RESTORE_EVAL_CASE_ID = 'git-checkpoints-restore-local-fixture'

const EVAL_TIMESTAMP = '2026-09-17T00:00:00.000Z'
const EVAL_TIMESTAMP_MS = new Date(EVAL_TIMESTAMP).getTime()
const EVAL_CHECKPOINT_FILE = 'checkpoint.txt'
const EVAL_SNAPSHOT_CONTENT = 'snapshot-state\n'
const EVAL_WORKING_CONTENT = 'working-tree-state\n'

export const GIT_CHECKPOINTS_PREVIEW_CHECKPOINT_ID = `manual_${EVAL_TIMESTAMP_MS}_eval-preview`
export const GIT_CHECKPOINTS_RESTORE_CHECKPOINT_ID = `manual_${EVAL_TIMESTAMP_MS}_eval-restore`

const GIT_CHECKPOINTS_EVAL_CASE_IDS = new Set([
  GIT_CHECKPOINTS_LIST_EVAL_CASE_ID,
  GIT_CHECKPOINTS_CREATE_EVAL_CASE_ID,
  GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID,
  GIT_CHECKPOINTS_RESTORE_EVAL_CASE_ID
])
const GIT_CHECKPOINTS_ROUTING_PROFILES: Readonly<Record<string, string>> = Object.freeze({
  'core.checkpoint.create': GIT_CHECKPOINTS_CREATE_EVAL_CASE_ID,
  'core.checkpoint.restore': GIT_CHECKPOINTS_RESTORE_EVAL_CASE_ID
})

export const GIT_CHECKPOINTS_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: GIT_CHECKPOINTS_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: Object.values(GIT_CHECKPOINTS_CAPABILITY_IDS),
  evaluationActionIds: Object.values(GIT_CHECKPOINTS_CAPABILITY_IDS),
  prepare: prepareGitCheckpointsEvaluationFixture,
  inspect: inspectGitCheckpointsEvaluation
})

async function prepareGitCheckpointsEvaluationFixture(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  const caseId = gitCheckpointsEvaluationCaseId(context)
  if (!GIT_CHECKPOINTS_EVAL_CASE_IDS.has(caseId)) return undefined
  const userDataDirectory = context.userDataDirectory ?? join(context.workspaceDirectory, '.sciforge-git-checkpoints-eval')
  await initializeGitWorkspace(context.workspaceDirectory)

  const paths = [
    EVAL_CHECKPOINT_FILE,
    relative(context.workspaceDirectory, join(userDataDirectory, 'domain-data', 'git-checkpoints'))
  ]
  const metadata: Record<string, DomainPackageJsonValue> = {
    workspaceRoot: context.workspaceDirectory,
    expectedRuntimeId: 'eval-runtime',
    expectedThreadId: 'eval-thread'
  }

  if (caseId === GIT_CHECKPOINTS_LIST_EVAL_CASE_ID) {
    const seeded = await seedCheckpoint({
      userDataDirectory,
      workspaceRoot: context.workspaceDirectory,
      createId: 'eval-list',
      snapshotId: await gitOutput(context.workspaceDirectory, ['rev-parse', 'HEAD'])
    })
    metadata.expectedCheckpointId = seeded.checkpointId
  }

  if (caseId === GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID ||
      caseId === GIT_CHECKPOINTS_RESTORE_EVAL_CASE_ID) {
    const snapshotId = await createGitSnapshot(context.workspaceDirectory)
    const checkpointId = caseId === GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID
      ? GIT_CHECKPOINTS_PREVIEW_CHECKPOINT_ID
      : GIT_CHECKPOINTS_RESTORE_CHECKPOINT_ID
    const seeded = await seedCheckpoint({
      userDataDirectory,
      workspaceRoot: context.workspaceDirectory,
      createId: checkpointId.slice(checkpointId.lastIndexOf('_') + 1),
      snapshotId
    })
    if (seeded.checkpointId !== checkpointId) {
      throw new Error(`Git checkpoint fixture ID drifted: ${seeded.checkpointId}`)
    }
    await writeFile(join(context.workspaceDirectory, EVAL_CHECKPOINT_FILE), EVAL_WORKING_CONTENT, 'utf8')
    metadata.expectedCheckpointId = checkpointId
    metadata.expectedSnapshotId = snapshotId
  }

  return {
    fixtureId: `git-checkpoints.${caseId}.v1`,
    paths,
    metadata
  }
}

async function inspectGitCheckpointsEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  fixture?: DomainCapabilityEvalFixture
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<DomainCapabilityEvalOracleResult | undefined> {
  const caseId = gitCheckpointsEvaluationCaseId(input.context)
  if (!GIT_CHECKPOINTS_EVAL_CASE_IDS.has(caseId)) return undefined
  const userDataDirectory = input.context.userDataDirectory ?? join(input.context.workspaceDirectory, '.sciforge-git-checkpoints-eval')
  const metadata = await readCheckpointMetadata(userDataDirectory)
  if (metadata.length === 0) {
    return { taskSuccess: false, evidence: ['Git Checkpoints metadata directory was not readable.'], verifiedActions: [] }
  }

  if (caseId === GIT_CHECKPOINTS_LIST_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, GIT_CHECKPOINTS_CAPABILITY_IDS.list)
    const matching = metadata.filter((entry) => entry.workspaceRoot === input.context.workspaceDirectory)
    if (!invocation || matching.length === 0) {
      return { taskSuccess: false, evidence: ['The independent checkpoint metadata readback found no checkpoint for the evaluation workspace.'], verifiedActions: [] }
    }
    return success(
      GIT_CHECKPOINTS_CAPABILITY_IDS.list,
      { checkpointCount: matching.length },
      'Independently read package-owned checkpoint metadata and verified the workspace-scoped list.'
    )
  }

  if (caseId === GIT_CHECKPOINTS_CREATE_EVAL_CASE_ID) {
    const invocation = successfulInvocation(input.invocations, GIT_CHECKPOINTS_CAPABILITY_IDS.create)
    const created = metadata.find((entry) => (
      entry.workspaceRoot === input.context.workspaceDirectory &&
      entry.runtimeId === 'eval-runtime' &&
      entry.threadId === 'eval-thread' &&
      entry.phase === 'manual'
    ))
    const createdCheckpointId = stringValue(created, 'checkpointId')
    const createdProvider = stringValue(created, 'provider')
    const createdSnapshotId = stringValue(created, 'snapshotId')
    if (!invocation || !created || !createdCheckpointId || !createdProvider || !createdSnapshotId || !(await gitObjectExists(input.context.workspaceDirectory, createdSnapshotId))) {
      return { taskSuccess: false, evidence: ['The independent checkpoint metadata or Git snapshot object was not created by the create action.'], verifiedActions: [] }
    }
    return success(
      GIT_CHECKPOINTS_CAPABILITY_IDS.create,
      { checkpointId: createdCheckpointId, provider: createdProvider, snapshotId: createdSnapshotId },
      'Independently read metadata.json and verified the created checkpoint points to an existing Git snapshot object.'
    )
  }

  const expectedCheckpointId = caseId === GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID
    ? GIT_CHECKPOINTS_PREVIEW_CHECKPOINT_ID
    : GIT_CHECKPOINTS_RESTORE_CHECKPOINT_ID
  const actionId = caseId === GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID
    ? GIT_CHECKPOINTS_CAPABILITY_IDS.preview
    : GIT_CHECKPOINTS_CAPABILITY_IDS.restore
  const invocation = successfulInvocation(input.invocations, actionId)
  const checkpoint = metadata.find((entry) => entry.checkpointId === expectedCheckpointId)
  const checkpointId = stringValue(checkpoint, 'checkpointId')
  const checkpointStatus = stringValue(checkpoint, 'status')
  if (!invocation || !checkpoint || checkpointId !== expectedCheckpointId || !matchesArgs(invocation.args, { checkpointId: expectedCheckpointId })) {
    return { taskSuccess: false, evidence: [`${actionId} did not target the deterministic package-owned checkpoint.`], verifiedActions: [] }
  }

  if (caseId === GIT_CHECKPOINTS_PREVIEW_EVAL_CASE_ID) {
    const content = await readFile(join(input.context.workspaceDirectory, EVAL_CHECKPOINT_FILE), 'utf8').catch(() => '')
    if (content !== EVAL_WORKING_CONTENT || checkpointStatus !== 'available') {
      return { taskSuccess: false, evidence: ['Preview changed the workspace or the checkpoint metadata unexpectedly.'], verifiedActions: [] }
    }
    return success(
      actionId,
      { checkpointId: expectedCheckpointId, status: checkpointStatus, workspaceUnchanged: true },
      'Independently read checkpoint metadata and workspace content to verify preview had no side effect.'
    )
  }

  const restoredContent = await readFile(join(input.context.workspaceDirectory, EVAL_CHECKPOINT_FILE), 'utf8').catch(() => '')
  const rescueCheckpointId = stringValue(checkpoint, 'rescueCheckpointId')
  const rescue = rescueCheckpointId
    ? metadata.find((entry) => entry.checkpointId === rescueCheckpointId)
    : undefined
  if (checkpointStatus !== 'restored' || !rescue || stringValue(rescue, 'status') !== 'available' || restoredContent !== EVAL_SNAPSHOT_CONTENT) {
    return { taskSuccess: false, evidence: ['Restore did not produce the expected restored file, target status, and rescue checkpoint.'], verifiedActions: [] }
  }
  return success(
    actionId,
    {
      checkpointId: expectedCheckpointId,
      ...(rescueCheckpointId ? { rescueCheckpointId } : {}),
      status: checkpointStatus
    },
    'Independently read metadata and workspace content to verify restore plus rescue-checkpoint creation.'
  )
}

function gitCheckpointsEvaluationCaseId(context: DomainCapabilityEvalRunContext): string {
  return context.fixtureProfile && GIT_CHECKPOINTS_ROUTING_PROFILES[context.fixtureProfile]
    ? GIT_CHECKPOINTS_ROUTING_PROFILES[context.fixtureProfile]
    : context.caseId
}

async function initializeGitWorkspace(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true })
  await gitOutput(workspaceRoot, ['init', '-q'])
  await gitOutput(workspaceRoot, ['config', 'user.email', 'eval@sciforge.local'])
  await gitOutput(workspaceRoot, ['config', 'user.name', 'SciForge Evaluation'])
  await writeFile(join(workspaceRoot, EVAL_CHECKPOINT_FILE), EVAL_SNAPSHOT_CONTENT, 'utf8')
  await gitOutput(workspaceRoot, ['add', EVAL_CHECKPOINT_FILE])
  await gitOutput(workspaceRoot, ['commit', '-qm', 'evaluation baseline'])
}

async function createGitSnapshot(workspaceRoot: string): Promise<string> {
  const head = await gitOutput(workspaceRoot, ['rev-parse', 'HEAD'])
  const tree = await gitOutput(workspaceRoot, ['rev-parse', 'HEAD^{tree}'])
  const snapshotId = await gitOutput(workspaceRoot, [
    'commit-tree',
    tree,
    '-p',
    head,
    '-m',
    'evaluation fixture snapshot'
  ], {
    GIT_AUTHOR_NAME: 'SciForge',
    GIT_AUTHOR_EMAIL: 'sciforge@localhost',
    GIT_COMMITTER_NAME: 'SciForge',
    GIT_COMMITTER_EMAIL: 'sciforge@localhost'
  })
  await gitOutput(workspaceRoot, ['update-ref', 'refs/sciforge/snapshots/evaluation', snapshotId])
  return snapshotId
}

async function seedCheckpoint(input: Readonly<{
  userDataDirectory: string
  workspaceRoot: string
  createId: string
  snapshotId: string
}>): Promise<{ checkpointId: string }> {
  const service = new GitCheckpointService({
    userDataDir: input.userDataDirectory,
    now: () => new Date(EVAL_TIMESTAMP),
    createId: () => input.createId,
    vcs: {
      capture: async () => ({
        snapshotId: input.snapshotId,
        provider: 'git',
        revision: await gitOutput(input.workspaceRoot, ['rev-parse', 'HEAD']),
        changeSummary: 'Deterministic evaluation checkpoint.'
      }),
      preview: async () => ({ patch: '', truncated: false }),
      restore: async () => undefined
    }
  })
  const result = await service.create({
    runtimeId: 'eval-runtime',
    threadId: 'eval-thread',
    workspaceRoot: input.workspaceRoot,
    phase: 'manual'
  })
  if (!result.ok) throw new Error(`Failed to seed Git checkpoint fixture: ${result.message}`)
  return { checkpointId: result.value.checkpointId }
}

async function readCheckpointMetadata(userDataDirectory: string): Promise<Array<Record<string, unknown>>> {
  const root = join(userDataDirectory, 'domain-data', 'git-checkpoints')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const metadata: Array<Record<string, unknown>> = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = JSON.parse(await readFile(join(root, entry.name, 'metadata.json'), 'utf8')) as unknown
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) metadata.push(raw as Record<string, unknown>)
      } catch {
        // The independent inspector ignores malformed unrelated entries but never treats them as success.
      }
    }
    return metadata
  } catch {
    return []
  }
}

async function gitOutput(
  cwd: string,
  args: readonly string[],
  environment: Record<string, string> = {}
): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    env: { ...process.env, ...environment },
    maxBuffer: 8 * 1024 * 1024
  })
  return String(result.stdout).trim()
}

async function gitObjectExists(workspaceRoot: string, snapshotId: string): Promise<boolean> {
  try {
    await gitOutput(workspaceRoot, ['cat-file', '-e', `${snapshotId}^{commit}`])
    return true
  } catch {
    return false
  }
}

function successfulInvocation(
  invocations: readonly DomainCapabilityEvalObservedInvocation[],
  actionId: string
): DomainCapabilityEvalObservedInvocation | undefined {
  return [...invocations].reverse().find((invocation) => invocation.actionId === actionId && invocation.success)
}

function matchesArgs(args: DomainPackageJsonValue, expected: Record<string, unknown>): boolean {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false
  return Object.entries(expected).every(([key, value]) => JSON.stringify((args as Record<string, unknown>)[key]) === JSON.stringify(value))
}

function stringValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function success(
  actionId: string,
  finalState: DomainPackageJsonValue,
  evidence: string
): DomainCapabilityEvalOracleResult {
  return {
    taskSuccess: true,
    finalState,
    evidence: [evidence],
    verifiedActions: [actionId]
  }
}
