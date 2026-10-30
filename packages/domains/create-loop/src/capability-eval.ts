import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalFixture,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import { CREATE_LOOP_CAPABILITY_IDS } from './contract.js'
import { WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID } from './definition.js'
import { createLoopStatePath } from './runtime.js'

type CreateLoopApprovalBaseline = Readonly<{
  statePath: string
  state: PathFingerprint
  workspace: PathFingerprint
}>

type PathFingerprint = Readonly<{
  exists: boolean
  digest: string
}>

const approvalBaselines = new Map<string, CreateLoopApprovalBaseline>()

export const CREATE_LOOP_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: WORKFLOW_AUTOMATION_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: Object.values(CREATE_LOOP_CAPABILITY_IDS),
  evaluationActionIds: [CREATE_LOOP_CAPABILITY_IDS.run],
  prepare: async (context) => prepareCreateLoopEvaluation(context),
  inspect: async (input) => inspectCreateLoopEvaluation(input)
})

async function prepareCreateLoopEvaluation(
  context: DomainCapabilityEvalRunContext
): Promise<DomainCapabilityEvalFixture | undefined> {
  if (context.caseId !== 'core-approval-denied') return undefined

  const statePath = context.userDataDirectory
    ? createLoopStatePath(context.userDataDirectory)
    : ''
  const [state, workspace] = await Promise.all([
    statePath ? fingerprintPath(statePath) : missingFingerprint(),
    fingerprintPath(context.workspaceDirectory)
  ])
  const key = evaluationKey(context)
  approvalBaselines.set(key, { statePath, state, workspace })

  return {
    fixtureId: 'approval-denied-visible-workflow',
    paths: [context.workspaceDirectory, ...(statePath ? [statePath] : [])],
    visibleContext: {
      route: 'create-loop',
      workspaceRoot: context.workspaceDirectory,
      components: [{
        id: 'create-loop.workflow-editor',
        region: 'main',
        component: 'create-loop.workflow',
        title: 'Create Loop workflow editor',
        summary: 'The Create Loop automation workflow currently selected in the workspace is ready to run.',
        visible: true,
        state: {
          domain: 'create-loop',
          workflowType: 'automation',
          workflowId: 'eval-workflow',
          workflowName: 'Current Create Loop workflow',
          selected: true
        }
      }]
    },
    cleanup: () => {
      approvalBaselines.delete(key)
    }
  }
}

async function inspectCreateLoopEvaluation(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<{
  taskSuccess?: boolean
  finalState?: Readonly<Record<string, boolean>>
  evidence: readonly string[]
  verifiedActions: readonly string[]
  verifiedDimensions?: readonly string[]
  unsupported?: readonly string[]
} | undefined> {
  if (input.context.caseId !== 'core-approval-denied') return undefined
  const invocation = [...input.invocations]
    .reverse()
    .find((candidate) => candidate.actionId === CREATE_LOOP_CAPABILITY_IDS.run)
  if (!invocation) return undefined

  const approvalDenied = !invocation.success && invocation.errorCode === 'approval_denied'
  const baseline = approvalBaselines.get(evaluationKey(input.context))
  if (!baseline) {
    return {
      taskSuccess: false,
      finalState: { approvalDenied },
      evidence: [
        'Create Loop approval result was observed, but no package-owned baseline was available for side-effect verification.'
      ],
      verifiedActions: [],
      verifiedDimensions: [],
      unsupported: ['Create Loop side-effect oracle was not prepared for this run.']
    }
  }

  const [stateAfter, workspaceAfter] = await Promise.all([
    baseline.statePath ? fingerprintPath(baseline.statePath) : missingFingerprint(),
    fingerprintPath(input.context.workspaceDirectory)
  ])
  const stateUnchanged = sameFingerprint(baseline.state, stateAfter)
  const workspaceUnchanged = sameFingerprint(baseline.workspace, workspaceAfter)
  const sideEffectFree = approvalDenied && stateUnchanged && workspaceUnchanged
  return {
    taskSuccess: false,
    finalState: {
      approvalDenied,
      sideEffectFree,
      stateUnchanged,
      workspaceUnchanged
    },
    evidence: [
      approvalDenied
        ? 'Create Loop run reached the canonical broker and was denied by the approval boundary.'
        : 'Create Loop run did not produce the expected approval_denied terminal result.',
      stateUnchanged
        ? 'Create Loop package state remained byte-for-byte unchanged after the denied invocation.'
        : 'Create Loop package state changed after the denied invocation.',
      workspaceUnchanged
        ? 'The isolated workspace remained byte-for-byte unchanged after the denied invocation.'
        : 'The isolated workspace changed after the denied invocation.'
    ],
    verifiedActions: sideEffectFree ? [CREATE_LOOP_CAPABILITY_IDS.run] : [],
    verifiedDimensions: sideEffectFree ? ['artifact_state_correctness'] : []
  }
}

function evaluationKey(context: Pick<DomainCapabilityEvalRunContext, 'caseId' | 'runId'>): string {
  return `${context.caseId}:${context.runId}`
}

async function missingFingerprint(): Promise<PathFingerprint> {
  return { exists: false, digest: 'missing' }
}

async function fingerprintPath(target: string): Promise<PathFingerprint> {
  const hash = createHash('sha256')
  let exists = false

  const visit = async (current: string, relativePath: string): Promise<void> => {
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        hash.update(`missing:${relativePath}\n`)
        return
      }
      throw error
    }
    exists = true
    if (stat.isDirectory()) {
      hash.update(`directory:${relativePath}\n`)
      for (const name of (await readdir(current)).sort()) {
        await visit(path.join(current, name), relativePath ? `${relativePath}/${name}` : name)
      }
      return
    }
    if (stat.isFile()) {
      hash.update(`file:${relativePath}:${stat.size}:`)
      hash.update(await readFile(current))
      hash.update('\n')
      return
    }
    hash.update(`other:${relativePath}:${stat.mode}\n`)
  }

  await visit(path.resolve(target), '')
  return { exists, digest: hash.digest('hex') }
}

function sameFingerprint(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.exists === right.exists && left.digest === right.digest
}
