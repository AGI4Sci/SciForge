import { describe, expect, it } from 'vitest'
import { redactSecrets, redactSecretText } from './secret-redaction'

describe('secret redaction', () => {
  it('redacts secret-like object keys recursively', () => {
    expect(redactSecrets({
      apiKey: 'sk-test',
      nested: { Authorization: 'Bearer token-value' },
      safe: 'visible'
    })).toEqual({
      apiKey: '<redacted>',
      nested: { Authorization: '<redacted>' },
      safe: 'visible'
    })
  })

  it('redacts inline bearer and token text', () => {
    expect(redactSecretText('Authorization: Bearer abc123 token=secret-value')).toBe(
      'Authorization: Bearer <redacted> token=<redacted>'
    )
  })

  it('redacts bot tokens and IM app/webhook secrets in objects and JSON text', () => {
    const redacted = redactSecrets({
      discord: { botToken: 'discord-bot-token' },
      feishu: { appSecret: 'feishu-app-secret' },
      webhookSecret: 'local-webhook-secret',
      note: 'Authorization: Bot discord-bot-token'
    })

    expect(redacted).toEqual({
      discord: { botToken: '<redacted>' },
      feishu: { appSecret: '<redacted>' },
      webhookSecret: '<redacted>',
      note: 'Authorization: Bot <redacted>'
    })
    expect(redactSecretText(
      '{"botToken":"discord-bot-token","appSecret":"feishu-app-secret","webhookSecret":"local-webhook-secret"}'
    )).toBe(
      '{"botToken": "<redacted>","appSecret": "<redacted>","webhookSecret": "<redacted>"}'
    )
  })

  it('handles circular objects while redacting nested secrets', () => {
    const value: { nested: { appSecret: string }; self?: unknown } = {
      nested: { appSecret: 'secret-value' }
    }
    value.self = value

    expect(redactSecrets(value)).toEqual({
      nested: { appSecret: '<redacted>' },
      self: '[Circular]'
    })
  })

  it('redacts private-key fields, passphrases, and PEM blocks', () => {
    expect(redactSecrets({
      privateKey: 'raw-key',
      passphrase: 'open-sesame',
      script: [
        'export AWS_ACCESS_KEY_ID=AKIAEXAMPLE',
        'cat <<EOF',
        '-----BEGIN PRIVATE KEY-----',
        'abc123',
        '-----END PRIVATE KEY-----',
        'EOF'
      ].join('\n')
    })).toEqual({
      privateKey: '<redacted>',
      passphrase: '<redacted>',
      script: 'export AWS_ACCESS_KEY_ID=<redacted>\ncat <<EOF\n<redacted>\nEOF'
    })
  })
})
