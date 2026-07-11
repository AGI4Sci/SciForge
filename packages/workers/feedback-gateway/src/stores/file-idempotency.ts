import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { storedFeedbackSubmissionSchema, type StoredFeedbackSubmission } from '../contract.js'
import { IdempotencyConflictError, type FeedbackIdempotencyStore } from '../service.js'

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

export class FileFeedbackIdempotencyStore implements FeedbackIdempotencyStore {
  constructor(private readonly directory: string) {
    if (!directory.trim()) throw new Error('Idempotency directory is required.')
  }

  async get(idempotencyKey: string): Promise<StoredFeedbackSubmission | null> {
    try {
      const raw = await readFile(this.pathFor(idempotencyKey), 'utf8')
      const value = storedFeedbackSubmissionSchema.parse(JSON.parse(raw))
      if (value.idempotencyKey !== idempotencyKey) throw new Error('Idempotency record key mismatch.')
      return value
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null
      throw error
    }
  }

  async put(unparsed: StoredFeedbackSubmission): Promise<void> {
    const value = storedFeedbackSubmissionSchema.parse(unparsed)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const destination = this.pathFor(value.idempotencyKey)
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try {
      try {
        await link(temporary, destination)
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error
        const existing = await this.get(value.idempotencyKey)
        if (!existing || existing.requestDigest !== value.requestDigest) throw new IdempotencyConflictError()
      }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private pathFor(idempotencyKey: string): string {
    const digest = createHash('sha256').update(idempotencyKey).digest('hex')
    return join(this.directory, `${digest}.json`)
  }
}
