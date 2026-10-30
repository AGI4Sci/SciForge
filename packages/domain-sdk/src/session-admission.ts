import { z } from 'zod'
import { domainPackageJsonValueSchema } from './contract.js'
import type { PrincipalContextSnapshot, PrincipalSnapshot } from './principal.js'

const identity = z.string().trim().min(1).max(512)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const sessionAdmissionRefSchema = z.object({ runtimeId: identity, threadId: identity }).strict()
export type SessionAdmissionRef = z.infer<typeof sessionAdmissionRefSchema>
export const sessionInputReceiptSchema = z.object({
  clientDirectiveId: identity,
  revision: z.number().int().nonnegative(),
  payloadDigest: digest,
  mode: z.enum(['queue', 'direct', 'steer']),
  delivery: z.enum(['accepted', 'delivering', 'delivered', 'rejected', 'uncertain', 'abandoned']),
  turnId: identity.optional(),
  execution: z.enum(['not_started', 'active', 'output_pending', 'completed', 'failed', 'cancelled'])
}).strict()
export type SessionInputReceipt = z.infer<typeof sessionInputReceiptSchema>
export const sessionSubmissionFenceSchema = z.object({
  operationId: identity, targetDigest: digest, acquiredAt: z.string().datetime()
}).strict()
export const sessionAdmissionSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  receipts: z.array(sessionInputReceiptSchema),
  submission: sessionSubmissionFenceSchema.nullable(),
  recovery: z.enum(['ready', 'required'])
}).strict()
export type SessionAdmissionSnapshot = z.infer<typeof sessionAdmissionSnapshotSchema>
export const sessionSubmissionAcquireSchema = sessionAdmissionRefSchema.extend({
  operationId: identity, expectedRevision: z.number().int().nonnegative(), targetDigest: digest
})
export type SessionSubmissionAcquire = z.infer<typeof sessionSubmissionAcquireSchema>
export const sessionSubmissionReleaseSchema = sessionSubmissionAcquireSchema.omit({ expectedRevision: true })
export type SessionSubmissionRelease = z.infer<typeof sessionSubmissionReleaseSchema>

/** Durable payload for the existing renderer queue, never a second Host runnable queue. */
export const sessionQueuedInputSchema = sessionAdmissionRefSchema.extend({
  clientDirectiveId: identity,
  text: z.string().min(1).max(100_000),
  payload: z.record(z.string(), domainPackageJsonValueSchema),
  expectedRevision: z.number().int().nonnegative().optional()
})
export type SessionQueuedInput = z.infer<typeof sessionQueuedInputSchema>
export const sessionQueuedMutationSchema = sessionAdmissionRefSchema.extend({
  clientDirectiveId: identity, expectedRevision: z.number().int().nonnegative(),
  /** Explicit user discard may clear an uncertain failed-send receipt. */
  force: z.boolean().optional()
})
export type SessionQueuedMutation = z.infer<typeof sessionQueuedMutationSchema>
export type SessionQueuedInputSnapshot = Readonly<{
  receipt: SessionInputReceipt
  payload: Readonly<Record<string, z.infer<typeof domainPackageJsonValueSchema>>>
}>

export type SessionAdmissionEvent = SessionAdmissionRef & Readonly<{
  kind: 'read' | 'queue' | 'direct' | 'steer' | 'submission' | 'release'
  revision: number
  clientDirectiveId?: string
  operationId?: string
  targetDigest?: string
  principal?: PrincipalSnapshot
  principalContext?: PrincipalContextSnapshot
}>
export type SessionOutputEvent = SessionAdmissionRef & Readonly<{
  turnId: string
  revision: number
  state: 'completed' | 'failed' | 'cancelled'
  principalContext?: PrincipalContextSnapshot
  principal?: PrincipalSnapshot
}>
export type SessionAdmissionErrorCode = 'submission_locked' | 'session_input_pending'
  | 'admission_revision_conflict' | 'input_revision_conflict' | 'input_immutable'
  | 'admission_recovery_required' | 'submission_identity_conflict'
export class SessionAdmissionError extends Error {
  constructor(readonly code: SessionAdmissionErrorCode, message: string) {
    super(message)
    this.name = 'SessionAdmissionError'
  }
}

/** Only the native composer supplies text; packages resolve their own current confirmation target. */
export const sessionHumanInputSchema = sessionAdmissionRefSchema.extend({ text: z.string().min(1).max(100_000) })
export type SessionHumanInput = z.infer<typeof sessionHumanInputSchema>
export type SessionHumanDecision = Readonly<{
  actionId: string
  input: Readonly<{ target: z.infer<typeof domainPackageJsonValueSchema> }>
}>
export type SessionHumanInputEvent = SessionHumanInput & Readonly<{
  principalContext: PrincipalContextSnapshot
  principal?: PrincipalSnapshot
}>
export type SessionHumanDecisionResult = Readonly<{ handled: false }> | Readonly<{ handled: true; actionId: string }>

/** A package can pin its current binding across asynchronous authorization and final commit. */
export type SessionAdmissionLease = Readonly<{ assertCurrent(): void }>

/** The owner pins its exact Session binding while Host holds the original principal/input lease. */
export type SessionHumanDecisionLease = SessionAdmissionLease & Readonly<{ decision: SessionHumanDecision }>
export const sessionInputRecoverySchema = z.object({
  version: z.literal(1),
  inputs: z.array(sessionQueuedInputSchema.omit({ expectedRevision: true }).extend({
    disposition: z.enum(['unconfirmed', 'uncertain'])
  })).max(10000)
}).strict()
export type SessionInputRecovery = z.infer<typeof sessionInputRecoverySchema>
