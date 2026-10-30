import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CURRENT_PROTOCOL_VERSION,
  REDACTED_VALUE,
  compatibleProtocolVersionSchema,
  createCollaborationError,
  humanEndpointIdSchema,
  idempotencyKeySchema,
  isCredentialFieldName,
  isProtocolVersionCompatible,
  redactedJsonSchema,
  redactCredentials,
  revisionSchema,
  userIdSchema,
  type CollaborationError,
  type UserId
} from './index.js'
import {
  INVALID_TEST_ONLY_CREDENTIAL_FIXTURE,
  invalidTestOnlyValue,
  redactedCredentialFixture
} from './testing.js'

describe('identity, revision, and version rules', () => {
  it('accepts opaque typed IDs and rejects derived or cross-kind IDs', () => {
    const userId = userIdSchema.parse('usr_Abcdef123456')
    expectTypeOf(userId).toEqualTypeOf<UserId>()
    expect(userIdSchema.safeParse('测试用户').success).toBe(false)
    expect(userIdSchema.safeParse('usr_short').success).toBe(false)
    expect(userIdSchema.safeParse('hep_Abcdef123456').success).toBe(false)
    expect(humanEndpointIdSchema.safeParse(userId).success).toBe(false)
  })

  it('requires positive safe revisions and sufficiently scoped idempotency keys', () => {
    expect(revisionSchema.parse(1)).toBe(1)
    expect(revisionSchema.safeParse(0).success).toBe(false)
    expect(revisionSchema.safeParse(1.5).success).toBe(false)
    expect(idempotencyKeySchema.parse('idem_agent_operation_01')).toBe('idem_agent_operation_01')
    expect(idempotencyKeySchema.safeParse('retry').success).toBe(false)
  })

  it('freezes current protocol compatibility to the same major and known minor', () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe('1.0')
    expect(isProtocolVersionCompatible('1.0')).toBe(true)
    expect(isProtocolVersionCompatible('1.1')).toBe(false)
    expect(isProtocolVersionCompatible('2.0')).toBe(false)
    expect(isProtocolVersionCompatible('invalid')).toBe(false)
    expect(compatibleProtocolVersionSchema.safeParse('1.1').success).toBe(false)
  })
})

describe('credential redaction', () => {
  it('recognizes credential-bearing field names without overmatching ordinary fields', () => {
    expect(isCredentialFieldName('deviceToken')).toBe(true)
    expect(isCredentialFieldName('api_key')).toBe(true)
    expect(isCredentialFieldName('challenge')).toBe(true)
    expect(isCredentialFieldName('tokenCount')).toBe(false)
    expect(isCredentialFieldName('secretaryName')).toBe(false)
  })

  it('recursively redacts all obvious invalid fixture credentials', () => {
    expect(redactedCredentialFixture).toEqual({
      authorization: REDACTED_VALUE,
      nested: {
        deviceToken: REDACTED_VALUE,
        apiKey: REDACTED_VALUE,
        privateKey: REDACTED_VALUE
      },
      safe: 'diagnostic-safe-value'
    })
    const marker = ['INVALID', 'TEST', 'ONLY'].join('_')
    expect(JSON.stringify(redactedCredentialFixture)).not.toContain(marker)
    expect(JSON.stringify(INVALID_TEST_ONLY_CREDENTIAL_FIXTURE)).toContain(marker)
  })

  it('redacts embedded authorization, URL password, and private-key-shaped text', () => {
    const redacted = redactCredentials({
      message: ['request used Bearer', invalidTestOnlyValue('BEARER_VALUE')].join(' '),
      url: `https://user:${invalidTestOnlyValue('PASSWORD')}@example.invalid/path`,
      detail: [
        ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' '),
        invalidTestOnlyValue('KEY_MATERIAL'),
        ['-----END', 'PRIVATE', 'KEY-----'].join(' ')
      ].join('\n')
    })
    expect(JSON.stringify(redacted)).not.toContain(['INVALID', 'TEST', 'ONLY'].join('_'))
  })

  it('rejects unredacted diagnostic JSON and accepts sanitized output', () => {
    expect(redactedJsonSchema.safeParse(INVALID_TEST_ONLY_CREDENTIAL_FIXTURE).success).toBe(false)
    expect(redactedJsonSchema.safeParse(redactedCredentialFixture).success).toBe(true)
  })
})

describe('typed errors', () => {
  it('constructs an error with frozen category, status, and retryability', () => {
    const error = createCollaborationError('revision_conflict', 'Revision has changed.', {
      expectedRevision: 1,
      currentRevision: 2,
      details: { deviceToken: REDACTED_VALUE }
    })
    expectTypeOf(error).toEqualTypeOf<CollaborationError>()
    expect(error).toMatchObject({
      category: 'conflict',
      httpStatus: 409,
      retryable: true
    })
  })

  it('rejects callers that rewrite frozen error semantics or add unknown fields', () => {
    const valid = createCollaborationError('permission_denied', 'Not authorized.')
    expect(() => ({ ...valid, retryable: true })).not.toThrow()
    const schema = (async () => import('./errors.js'))
    return schema().then(({ collaborationErrorSchema }) => {
      expect(collaborationErrorSchema.safeParse({ ...valid, retryable: true }).success).toBe(false)
      expect(collaborationErrorSchema.safeParse({ ...valid, debugStack: 'hidden' }).success).toBe(false)
    })
  })

  it('represents provider identity ownership collisions as a stable non-retryable conflict', () => {
    expect(createCollaborationError('identity_conflict', 'Provider identity is already bound.')).toMatchObject({
      code: 'identity_conflict',
      category: 'conflict',
      httpStatus: 409,
      retryable: false
    })
  })
})
