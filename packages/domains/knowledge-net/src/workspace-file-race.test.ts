import { appendFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'

// Inject a concurrent writer after the size check, through a real OS file handle.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args)
    const originalRead = handle.read.bind(handle)
    handle.read = (async (...readArgs: Parameters<typeof originalRead>) => {
      await actual.appendFile(args[0], 'grew after the original size check')
      return originalRead(...readArgs)
    }) as typeof handle.read
    return handle
  } }
})
import { readWorkspaceFile } from './workspace-file.js'

it('rejects growth after stat and closes the handle instead of reading unbounded bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kn-growth-')))
  const path = join(root, 'growing.bib')
  try {
    await writeFile(path, 'four')
    await expect(readWorkspaceFile(root, 'growing.bib', 4)).rejects.toThrow('larger than 4 bytes')
    await appendFile(path, '!') // Cleanup can use the file after the rejected read.
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
