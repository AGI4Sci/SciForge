import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { ZulipHttpClient, type ZulipProviderDiagnostic } from './http-client.js'
import { isZulipProviderError } from './errors.js'
import { zulipUserResponseSchema } from './schemas.js'

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('ZulipHttpClient', () => {
  it('rejects cleartext non-loopback realms before reading a credential', () => {
    let credentialReads = 0
    assert.throws(() => new ZulipHttpClient({
      realmUrl: 'http://chat.example.invalid',
      botEmail: 'service-bot@example.invalid',
      resolveCredential: async () => {
        credentialReads += 1
        return { apiKey: randomUUID() }
      }
    }), /HTTPS/)
    assert.equal(credentialReads, 0)
  })

  it('retries safe 429 responses without exposing the process-only credential', async () => {
    let attempts = 0
    let credentialReads = 0
    const credentialSentinels: string[] = []
    const delays: number[] = []
    const diagnostics: ZulipProviderDiagnostic[] = []
    const client = new ZulipHttpClient({
      realmUrl: 'https://chat.example.invalid/zulip',
      botEmail: 'service-bot@example.invalid',
      resolveCredential: async () => {
        credentialReads += 1
        const apiKey = randomUUID()
        credentialSentinels.push(apiKey)
        return { apiKey }
      },
      sleep: async (milliseconds) => { delays.push(milliseconds) },
      logger: (diagnostic) => { diagnostics.push(diagnostic) },
      fetch: async (_input, init) => {
        attempts += 1
        const authorization = new Headers(init?.headers).get('authorization')
        assert.ok(authorization?.startsWith('Basic '))
        if (attempts === 1) return json({ result: 'error', msg: 'later' }, 429, { 'retry-after': '0.01' })
        return json({
          result: 'success',
          msg: '',
          user_id: 9,
          email: 'service-bot@example.invalid',
          full_name: 'Service Bot',
          is_bot: true
        })
      }
    })
    const user = await client.request('api/v1/users/me', {
      schema: zulipUserResponseSchema,
      retry: 'safe'
    })
    assert.equal(user.user_id, 9)
    assert.equal(attempts, 2)
    assert.equal(credentialReads, 2)
    assert.deepEqual(delays, [10])
    const serialized = JSON.stringify(diagnostics)
    assert.doesNotMatch(serialized, /Basic/)
    for (const sentinel of credentialSentinels) assert.equal(serialized.includes(sentinel), false)
  })

  it('classifies Zulip 400 STREAM_DOES_NOT_EXIST as not found', async () => {
    const client = new ZulipHttpClient({
      realmUrl: 'https://chat.example.invalid/zulip',
      botEmail: 'service-bot@example.invalid',
      resolveCredential: async () => ({ apiKey: randomUUID() }),
      fetch: async () => json({
        result: 'error',
        msg: 'Channel does not exist',
        code: 'STREAM_DOES_NOT_EXIST'
      }, 400)
    })

    await assert.rejects(client.request('api/v1/get_stream_id', {
      schema: zulipUserResponseSchema,
      retry: 'safe'
    }), (error: unknown) => isZulipProviderError(error) && error.code === 'not_found')
  })
})
