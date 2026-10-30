export type DomainRemoteApprovalEffect =
  | 'workspace-write'
  | 'external-write'
  | 'destructive'

export type DomainRemoteCapabilityApproval = Readonly<{
  approvalId: string
  runtimeId: string
  threadId: string
  turnId: string
  capabilityRequestId: string
  actionId: string
  invocationId: string
  safeSummary: string
  effect: DomainRemoteApprovalEffect
  remoteEligible: boolean
  createdAt: string
  expiresAt: string
  state: 'pending' | 'approved' | 'denied' | 'cancelled'
}>

export type DomainRemoteCapabilityApprovalDecision = Readonly<{
  approvalId: string
  runtimeId: string
  threadId: string
  turnId: string
  capabilityRequestId: string
  decisionId: string
  decision: 'allow_once' | 'deny_once'
}>

export type DomainMainRemoteCapabilityApprovalHost = Readonly<{
  subscribe(
    listener: (approval: DomainRemoteCapabilityApproval) => void | Promise<void>
  ): () => void
  decide(
    input: DomainRemoteCapabilityApprovalDecision
  ): Promise<'applied' | 'already_terminal' | 'not_pending' | 'not_eligible'>
}>
