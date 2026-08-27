import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { appendManagedLogLine, configureLogger } from './logger'

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
})
