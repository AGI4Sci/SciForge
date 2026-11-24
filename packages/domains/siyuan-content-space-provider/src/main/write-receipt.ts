import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SiYuanError } from './client.js'

/** Durable uncertainty fence shared by body and comment mutations. Confirmed
 * writes can be intentionally repeated after a revert; pending writes cannot. */
export async function withWriteReceipt<T>(userDataDir: string, identity: unknown, operation: () => Promise<T>): Promise<T> {
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  const directory = join(userDataDir, 'siyuan-document-edits')
  const file = join(directory, `${key}.json`)
  await mkdir(directory, { recursive: true })
  let confirmed = false
  try {
    const receipt = JSON.parse(await readFile(file, 'utf8')) as { status?: string }
    if (receipt.status !== 'confirmed') throw new SiYuanError('outcome_unknown')
    confirmed = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(file, JSON.stringify({ status: 'pending' }), { flag: confirmed ? 'w' : 'wx', mode: 0o600 })
  let result: T
  try { result = await operation() }
  catch (error) {
    if (error instanceof SiYuanError && error.code === 'unauthorized') await rm(file, { force: true })
    if (error instanceof SiYuanError) throw error
    throw new SiYuanError('outcome_unknown')
  }
  try { await writeFile(file, JSON.stringify({ status: 'confirmed' }), { mode: 0o600 }) }
  catch { throw new SiYuanError('outcome_unknown') }
  return result
}
