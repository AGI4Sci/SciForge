import { createHash, randomUUID } from 'node:crypto'

import {
  restRequestSchema,
  type AgentInboxMessage
} from '@sciforge/collaboration-contracts'
import type {
  DomainMainRemoteCapabilityApprovalHost,
  DomainRemoteCapabilityApproval
} from '@sciforge/domain-sdk/remote-approval'

import { DurableCloudOutbox } from './outbox.js'
import { CollaborationLocalStore } from './store.js'

export type RemoteApprovalCoordinatorOptions = Readonly<{
  store: CollaborationLocalStore
  outbox: Pick<DurableCloudOutbox, 'enqueue'>
  host: DomainMainRemoteCapabilityApprovalHost
  localAgentId: () => string | undefined
  now?: () => Date
}>

export class RemoteApprovalCoordinator {
  private readonly now: () => Date

  constructor(private readonly options: RemoteApprovalCoordinatorOptions) {
    this.now = options.now ?? (() => new Date())
  }

  subscribe(): () => void {
    return this.options.host.subscribe((approval) => this.acceptPending(approval))
  }

  async handleInbox(message: AgentInboxMessage): Promise<void> {
    if (message.payload.type !== 'capability.approval.decision') return
    const payload = message.payload
    const record = this.options.store.snapshot().remoteApprovals.find((candidate) => (
      candidate.remoteApprovalId === payload.remoteApprovalId
      && candidate.desktopApprovalId === payload.desktopApprovalId
    ))
    if (!record) throw new Error('Remote approval decision has no exact local request.')
    if (
      record.projectionId !== payload.projectionId
      || record.runtimeId !== payload.runtimeId
      || record.threadId !== payload.threadId
      || record.turnId !== payload.turnId
      || record.capabilityRequestId !== payload.capabilityRequestId
    ) throw new Error('Remote approval decision identity does not match the canonical pending request.')

    if (record.decisionId && (
      record.decisionId !== payload.decisionId || record.decision !== payload.decision
    )) throw new Error('Remote approval decision conflicts with the persisted decision.')
    if (!record.decisionId) {
      await this.options.store.transact((draft) => {
        const current = requireRecord(draft.remoteApprovals, record.desktopApprovalId)
        current.decisionId = payload.decisionId
        current.decision = payload.decision
        current.state = 'deciding'
        current.updatedAt = this.now().toISOString()
      })
    }
    let outcome = record.outcome
    if (!outcome) {
      outcome = await this.options.host.decide({
        approvalId: payload.desktopApprovalId,
        runtimeId: payload.runtimeId,
        threadId: payload.threadId,
        turnId: payload.turnId,
        capabilityRequestId: payload.capabilityRequestId,
        decisionId: payload.decisionId,
        decision: payload.decision
      })
      await this.options.store.transact((draft) => {
        const current = requireRecord(draft.remoteApprovals, record.desktopApprovalId)
        current.outcome = outcome
        current.state = 'reporting'
        current.updatedAt = this.now().toISOString()
      })
    }
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: requestId(),
      type: 'capability.approval.result',
      idempotencyKey: `idem_remote_result_${digest(payload.decisionId).slice(0, 40)}`,
      remoteApprovalId: payload.remoteApprovalId,
      decisionId: payload.decisionId,
      outcome
    })
    await this.options.outbox.enqueue('capability.approval.result', request)
  }

  private async acceptPending(approval: DomainRemoteCapabilityApproval): Promise<void> {
    if (approval.state !== 'pending') {
      await this.withdrawIfPublished(approval)
      return
    }
    const agentId = this.options.localAgentId()
    if (!agentId) return
    const matching = this.options.store.snapshot().projections.filter((candidate) => (
      candidate.runtimeId === approval.runtimeId
      && candidate.threadId === approval.threadId
      && candidate.projection.agentId === agentId
      && candidate.projection.status === 'active'
    ))
    if (matching.length !== 1) return
    const projection = matching[0]!
    const existing = this.options.store.snapshot().remoteApprovals.find((candidate) => (
      candidate.desktopApprovalId === approval.approvalId
    ))
    if (existing) return
    const createdAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      draft.remoteApprovals.push({
        desktopApprovalId: approval.approvalId,
        projectionId: projection.projection.projectionId,
        runtimeId: approval.runtimeId,
        threadId: approval.threadId,
        turnId: approval.turnId,
        capabilityRequestId: approval.capabilityRequestId,
        safeSummary: approval.safeSummary,
        effect: approval.effect,
        remoteEligible: approval.remoteEligible,
        expiresAt: approval.expiresAt,
        state: 'creating',
        createdAt,
        updatedAt: createdAt
      })
    })
    const request = restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: requestId(),
      type: 'capability.approval.create',
      idempotencyKey: `idem_remote_create_${digest(approval.approvalId).slice(0, 40)}`,
      projectionId: projection.projection.projectionId,
      runtimeId: approval.runtimeId,
      threadId: approval.threadId,
      turnId: approval.turnId,
      capabilityRequestId: approval.capabilityRequestId,
      desktopApprovalId: approval.approvalId,
      safeSummary: approval.safeSummary,
      effect: approval.effect,
      remoteEligible: approval.remoteEligible,
      expiresAt: approval.expiresAt
    })
    await this.options.outbox.enqueue('capability.approval.create', request)
  }

  private async withdrawIfPublished(approval: DomainRemoteCapabilityApproval): Promise<void> {
    const record = this.options.store.snapshot().remoteApprovals.find((candidate) => (
      candidate.desktopApprovalId === approval.approvalId
    ))
    if (!record?.remoteApprovalId || record.decisionId || record.state === 'completed') return
    const request = restRequestSchema.parse({
      protocolVersion: '1.0', requestId: requestId(), type: 'capability.approval.withdraw',
      idempotencyKey: `idem_remote_withdraw_${digest(approval.approvalId).slice(0, 40)}`,
      remoteApprovalId: record.remoteApprovalId, desktopApprovalId: approval.approvalId
    })
    await this.options.outbox.enqueue('capability.approval.withdraw', request)
  }
}

function requireRecord<T extends { desktopApprovalId: string }>(records: T[], id: string): T {
  const record = records.find((candidate) => candidate.desktopApprovalId === id)
  if (!record) throw new Error('Local remote approval record was not found.')
  return record
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function requestId(): `req_${string}` {
  return `req_${randomUUID().replaceAll('-', '')}`
}
