import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const COMPUTER_USE_INVOCATION_META_KEY = 'io.sciforge/computer-use-invocation'
export const COMPUTER_USE_INVOCATION_HEADER = 'X-Sciforge-CUA-Invocation'

export type TrustedComputerUseInvocation = {
  requestId: string
  runtimeId: string
  threadId: string
  turnId?: string
  callId?: string
  actionId: string
  invocationId?: string
  approval: 'none' | 'confirmation' | 'system'
}

export type ComputerUseInvocationProof = {
  version: 1
  proofId: string
  requestId: string
  runtimeId: string
  threadId: string
  turnId: string
  callId: string
  invocationId: string
  tool: string
  argumentDigest: string
  issuedAtMs: number
  expiresAtMs: number
  nonce: string
  approval: 'confirmation'
  signature: string
}

export function parseTrustedComputerUseInvocation(
  meta: Record<string, unknown> | undefined
): TrustedComputerUseInvocation | null {
  const value = meta?.[COMPUTER_USE_INVOCATION_META_KEY]
  if (!isRecord(value)) return null
  const requestId = safeText(value.requestId)
  const runtimeId = safeText(value.runtimeId)
  const threadId = safeText(value.threadId)
  const actionId = safeText(value.actionId)
  const approval = value.approval
  if (!requestId || !runtimeId || !threadId || !actionId) return null
  if (approval !== 'none' && approval !== 'confirmation' && approval !== 'system') return null
  const turnId = optionalText(value.turnId)
  const callId = optionalText(value.callId)
  const invocationId = optionalText(value.invocationId)
  if (turnId === null || callId === null || invocationId === null) return null
  return {
    requestId,
    runtimeId,
    threadId,
    actionId,
    approval,
    ...(turnId ? { turnId } : {}),
    ...(callId ? { callId } : {}),
    ...(invocationId ? { invocationId } : {})
  }
}

export function createComputerUseInvocationProof(input: {
  secret: string
  trusted: TrustedComputerUseInvocation
  tool: string
  arguments: Record<string, unknown>
  requestId?: string
  nowMs?: number
  ttlMs?: number
  proofId?: string
  nonce?: string
}): ComputerUseInvocationProof {
  if (!input.secret) throw new Error('Computer Use invocation secret is required.')
  if (input.trusted.approval !== 'confirmation' || !input.trusted.invocationId) {
    throw new Error('Computer Use mutation requires one confirmed invocation ID.')
  }
  const nowMs = input.nowMs ?? Date.now()
  const ttlMs = input.ttlMs ?? 30_000
  if (!Number.isInteger(nowMs) || !Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > 300_000) {
    throw new Error('Computer Use invocation proof timing is invalid.')
  }
  const unsigned: Omit<ComputerUseInvocationProof, 'signature'> = {
    version: 1,
    proofId: input.proofId ?? `cua-proof-${randomUUID()}`,
    requestId: input.requestId ?? `mcp-cua-${randomUUID()}`,
    runtimeId: input.trusted.runtimeId,
    threadId: input.trusted.threadId,
    turnId: input.trusted.turnId ?? '',
    callId: input.trusted.callId ?? '',
    invocationId: input.trusted.invocationId,
    tool: input.tool,
    argumentDigest: computerUseArgumentDigest(input.arguments),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    nonce: input.nonce ?? randomUUID(),
    approval: 'confirmation'
  }
  return {
    ...unsigned,
    signature: createHmac('sha256', input.secret)
      .update(computerUseProofMessage(unsigned), 'utf8')
      .digest('hex')
  }
}

export function verifyComputerUseInvocationProofSignature(
  proof: ComputerUseInvocationProof,
  secret: string
): boolean {
  if (!secret || !/^[a-f0-9]{64}$/u.test(proof.signature)) return false
  const expected = createHmac('sha256', secret)
    .update(computerUseProofMessage(proof), 'utf8')
    .digest()
  const actual = Buffer.from(proof.signature, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function encodeComputerUseInvocationProof(proof: ComputerUseInvocationProof): string {
  return Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url')
}

export function computerUseArgumentDigest(value: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

export function computerUseProofMessage(
  proof: Omit<ComputerUseInvocationProof, 'signature'> | ComputerUseInvocationProof
): string {
  return [
    proof.version,
    proof.proofId,
    proof.requestId,
    proof.runtimeId,
    proof.threadId,
    proof.turnId,
    proof.callId,
    proof.invocationId,
    proof.tool,
    proof.argumentDigest,
    proof.issuedAtMs,
    proof.expiresAtMs,
    proof.nonce,
    proof.approval
  ].join('\n')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Computer Use proof arguments must contain finite numbers.')
    const encoded = Buffer.allocUnsafe(8)
    encoded.writeDoubleBE(value)
    return `n${encoded.toString('hex')}`
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`
  }
  throw new Error('Computer Use proof arguments must be JSON values.')
}

function safeText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null
}

function optionalText(value: unknown): string | null | undefined {
  return value === undefined ? undefined : safeText(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
