import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { appendManagedLogLine, configureLogger, logError } from './logger'

const tempDirs: string[] = []

afterEach(async () => {
  configureLogger({ dir: '', enabled: true, retentionDays: 2 })
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('logger', () => {
  it('redacts IM and authorization secrets before writing managed logs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sciforge-logs-'))
    tempDirs.push(dir)
    configureLogger({ dir, enabled: true, retentionDays: 7 })

    await appendManagedLogLine(
      'sciforge',
      'botToken=discord-bot-token appSecret: feishu-app-secret webhookSecret=local-webhook-secret Authorization: Bot discord-bot-token'
    )

    const files = await readdir(dir)
    const content = await readFile(join(dir, files[0]), 'utf8')
    expect(content).not.toContain('discord-bot-token')
    expect(content).not.toContain('feishu-app-secret')
    expect(content).not.toContain('local-webhook-secret')
    expect(content).toContain('<redacted>')
  })

  it('redacts an opaque active credential by exact value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sciforge-managed-secret-logs-'))
    tempDirs.push(dir)
    const canary = 'opaque-provider-canary-without-a-secret-looking-prefix'
    configureLogger({
      dir,
      enabled: true,
      retentionDays: 7,
      sensitiveValues: () => [canary]
    })

    await appendManagedLogLine('sciforge', `provider failed with ${canary}`)

    const files = await readdir(dir)
    const content = await readFile(join(dir, files[0]), 'utf8')
    expect(content).not.toContain(canary)
    expect(content).toContain('<redacted>')
  })

  it('retains nested Error diagnostics, consumer identity and redaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sciforge-error-logs-'))
    tempDirs.push(dir)
    const canary = 'opaque-active-credential-canary'
    configureLogger({ dir, sensitiveValues: () => [canary] })
    const cause = Object.assign(new TypeError(`digest mismatch ${canary}`), {
      token: 'structured-secret',
      code: 'digest-mismatch'
    })
    const failure = new Error('Artifact consumer fixture.artifacts (@fixture/domain@1.0.0) failed.', { cause })
    const aggregate = new AggregateError([failure], 'fan-out failed')
    Object.assign(cause, { cycle: aggregate })
    logError('handoff', 'delivery failed', { failures: [aggregate] })
    // The sentinel queues behind the fire-and-forget public log call.
    await appendManagedLogLine('sciforge', 'diagnostics-flushed')
    const files = await readdir(dir)
    const content = await readFile(join(dir, files[0]), 'utf8')
    expect(content).toContain('AggregateError')
    expect(content).toContain('fixture.artifacts')
    expect(content).toContain('TypeError')
    expect(content).toContain('digest mismatch')
    expect(content).toContain('digest-mismatch')
    expect(content).toContain('[Circular]')
    expect(content).not.toContain(canary)
    expect(content).not.toContain('structured-secret')
  })

  it('serializes concurrent writes while initializing the directory once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sciforge-concurrent-logs-'))
    tempDirs.push(dir)
    configureLogger({ dir, enabled: true, retentionDays: 7 })

    await Promise.all(
      Array.from({ length: 100 }, (_, index) => appendManagedLogLine(
        'sciforge',
        `concurrent-entry-${index}`
      ))
    )

    const files = await readdir(dir)
    const content = await readFile(join(dir, files[0]), 'utf8')
    expect(content.split('\n').filter(Boolean)).toHaveLength(100)
  })
})
