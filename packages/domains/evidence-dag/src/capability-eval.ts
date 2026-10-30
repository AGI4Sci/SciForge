import {
  DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND,
  type DomainCapabilityEvalContribution,
  type DomainCapabilityEvalObservedInvocation,
  type DomainCapabilityEvalRunContext
} from '@sciforge/domain-sdk/capability-eval'
import { EVIDENCE_DAG_CAPABILITY_IDS } from './contract.js'
import { EVIDENCE_DAG_DOMAIN_MODULE_ID } from './definition.js'

export const EVIDENCE_DAG_CAPABILITY_EVAL_KIND = MAIN_CAPABILITY_EVAL_CONTRIBUTION_KIND

const EVIDENCE_DAG_EVALUATION_ACTION_IDS = Object.freeze([
  EVIDENCE_DAG_CAPABILITY_IDS.view,
  EVIDENCE_DAG_CAPABILITY_IDS.exportSnapshotProducts
])

/**
 * This contribution currently records canonical invocation evidence only.
 * Snapshot fixtures and independent product readback remain a separate C-batch
 * task and are intentionally not claimed here.
 */
export const EVIDENCE_DAG_CAPABILITY_EVAL_CONTRIBUTION: DomainCapabilityEvalContribution = Object.freeze({
  moduleId: EVIDENCE_DAG_DOMAIN_MODULE_ID,
  contractVersion: DOMAIN_CAPABILITY_EVAL_CONTRACT_VERSION,
  actionIds: EVIDENCE_DAG_EVALUATION_ACTION_IDS,
  evaluationActionIds: EVIDENCE_DAG_EVALUATION_ACTION_IDS,
  inspect: async (input: Readonly<{
    context: DomainCapabilityEvalRunContext
    invocations: readonly DomainCapabilityEvalObservedInvocation[]
  }>) => inspectEvidenceDagInvocations(input)
})

async function inspectEvidenceDagInvocations(input: Readonly<{
  context: DomainCapabilityEvalRunContext
  invocations: readonly DomainCapabilityEvalObservedInvocation[]
}>): Promise<{
  taskSuccess?: boolean
  evidence: readonly string[]
  verifiedActions: readonly string[]
} | undefined> {
  const expectedAction = input.context.caseId === 'core-evidence-export'
    ? EVIDENCE_DAG_CAPABILITY_IDS.exportSnapshotProducts
    : input.context.caseId === 'core-evidence-view'
      ? EVIDENCE_DAG_CAPABILITY_IDS.view
      : undefined
  if (!expectedAction) return undefined
  const invocation = [...input.invocations].reverse().find((candidate) => candidate.actionId === expectedAction)
  if (!invocation) return undefined
  if (!invocation.success) {
    return {
      taskSuccess: false,
      evidence: [`${expectedAction} produced a terminal failure recorded by the capability broker.`],
      verifiedActions: []
    }
  }
  return {
    taskSuccess: true,
    evidence: [`${expectedAction} completed through the canonical capability broker invocation.`],
    verifiedActions: [expectedAction]
  }
}
