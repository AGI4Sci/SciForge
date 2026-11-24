import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SiYuanError } from './client.js'
import { comparableMarkdown } from './markdown.js'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receiptSchema = z.object({ version: z.literal(1), requestHash: z.string(), targetHash: z.string(), state: z.enum(['pending', 'confirmed']) }).strict()

/** Stable step identity survives re-reads and restarts. A lost acknowledgement
 * is reconciled only against the complete expected body, never retried blind. */
export async function documentStep(directory: string, identity: readonly unknown[], request: unknown, current: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, hash(identity) + '.json'), requestHash = hash(request)
  let receipt: z.infer<typeof receiptSchema> | undefined
  try { receipt = receiptSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const persist = async (value: z.infer<typeof receiptSchema>) => {
    await writeFile(file + '.tmp', JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    await rename(file + '.tmp', file)
    receipt = value
  }
  if (receipt) {
    if (receipt.requestHash !== requestHash) throw new SiYuanError('operation_conflict')
    if (receipt.state === 'pending') {
      if (receipt.targetHash !== hash(comparableMarkdown(current))) throw new SiYuanError('outcome_unknown')
      await persist({ ...receipt, state: 'confirmed' })
    }
    return { replay: true as const }
  }
  return { replay: false as const,
    prepare: (target: string) => persist({ version: 1, requestHash, targetHash: hash(comparableMarkdown(target)), state: 'pending' }),
    reject: () => unlink(file),
    confirm: async () => { if (!receipt) throw new SiYuanError('outcome_unknown'); await persist({ ...receipt, state: 'confirmed' }) }
  }
}
