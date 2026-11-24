import { describe, expect, it } from 'vitest'
import * as contracts from './index.js'

const anchor = {
  filePath: 'src/example.ts', side: 'new', line: 4, endLine: 5,
  hunkHeader: '@@ -4,2 +4,2 @@', code: 'return value',
  baseRevision: 'abc123', contentDigest: 'a'.repeat(64)
}
const publish = {
  protocolVersion: '1.0', type: 'project.code_conversation.publish',
  requestId: 'req_code_conversation_01', idempotencyKey: 'idem_code_conversation_01',
  projectId: 'prj_code_conversation_01', conversationId: 'conversation_1',
  anchor, messages: [{ messageId: 'message_1', kind: 'user', body: 'Explain this code' }]
}

describe('project code conversation protocol', () => {
  it('measures complete JSON command bytes including UTF-8 and JSON escaping without narrowing v10 semantic schemas', () => {
    const command = contracts.codeConversationCommandSchema.parse({ ...publish,
      messages: [{ ...publish.messages[0], body: '界\\\n"' }] })
    expect(contracts.codeConversationCommandByteLength(command)).toBe(Buffer.byteLength(JSON.stringify(command), 'utf8'))
    expect(contracts.MAX_CODE_CONVERSATION_COMMAND_BYTES).toBe(65_536)
    const oversized = contracts.codeConversationCommandSchema.parse({ ...publish,
      messages: Array.from({ length: 32 }, (_, index) => ({ messageId: `m${index}`, kind: 'user', body: '界'.repeat(20_000) })) })
    expect(contracts.codeConversationCommandByteLength(oversized)).toBeGreaterThan(contracts.MAX_CODE_CONVERSATION_COMMAND_BYTES)
  })

  it('accepts publication on the canonical authenticated command path', () => {
    expect(contracts.restRequestSchema.safeParse(publish).success).toBe(true)
  })

  it.each(['/Users/person/secret.ts', '../secret.ts', 'src/../../secret', 'C:\\secret.ts', 'src\\secret.ts', 'src//secret.ts', 'src/./secret.ts', 'src/a\u0000.ts', 'src/a\n.ts', 'src/a\u007f.ts'])('rejects nonportable path %s', (filePath) => {
    expect(contracts.restRequestSchema.safeParse({ ...publish, anchor: { ...anchor, filePath } }).success).toBe(false)
  })

  it('rejects private state and forged authors', () => {
    for (const field of ['workspaceKey', 'capture', 'draft', 'authorUserId']) {
      expect(contracts.restRequestSchema.safeParse({ ...publish, [field]: 'private' }).success).toBe(false)
    }
    expect(contracts.restRequestSchema.safeParse({ ...publish, messages: [{ ...publish.messages[0], authorUserId: 'usr_other' }] }).success).toBe(false)
  })

  it('bounds messages, rejects duplicate identities and reversed code ranges', () => {
    expect(contracts.restRequestSchema.safeParse({ ...publish, messages: Array(33).fill(publish.messages[0]) }).success).toBe(false)
    expect(contracts.restRequestSchema.safeParse({ ...publish, messages: [publish.messages[0], publish.messages[0]] }).success).toBe(false)
    expect(contracts.restRequestSchema.safeParse({ ...publish, anchor: { ...anchor, endLine: 3 } }).success).toBe(false)
  })

  it('creates forks by server-owned references rather than client supplied history', () => {
    const fork = { protocolVersion: '1.0', type: 'project.code_conversation.fork', requestId: publish.requestId,
      idempotencyKey: publish.idempotencyKey, projectId: publish.projectId,
      conversationId: 'child', parentConversationId: 'parent', parentMessageId: 'message_1',
      message: { messageId: 'message_child', kind: 'user', body: 'Another approach?' } }
    expect(contracts.restRequestSchema.safeParse(fork).success).toBe(true)
    expect(contracts.restRequestSchema.safeParse({ ...fork, history: [] }).success).toBe(false)
    expect(contracts.restRequestSchema.safeParse({ ...fork, parentConversationId: 'child' }).success).toBe(false)
  })

  it('requires observed revision and message boundary for status changes', () => {
    const status = { protocolVersion: '1.0', type: 'project.code_conversation.set_status', requestId: publish.requestId,
      idempotencyKey: publish.idempotencyKey, projectId: publish.projectId, conversationId: 'conversation_1',
      status: 'resolved', expectedRevision: 2, observedMessageId: 'message_1' }
    expect(contracts.restRequestSchema.safeParse(status).success).toBe(true)
    const { observedMessageId: _, ...stale } = status
    expect(contracts.restRequestSchema.safeParse(stale).success).toBe(false)
  })

  it('bounds event pages and accepts cursor zero for initial synchronization', () => {
    const pull = { protocolVersion: '1.0', type: 'project.code_conversation.pull', requestId: publish.requestId,
      projectId: publish.projectId, afterSequence: 0, limit: 20 }
    expect(contracts.restRequestSchema.safeParse(pull).success).toBe(true)
    expect(contracts.restRequestSchema.safeParse({ ...pull, limit: 101 }).success).toBe(false)
  })
})
