import { mkdtemp, writeFile, symlink, lstat, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'sciforge-file-link-capability-'))
try {
  const target = join(root, 'target.txt')
  const link = join(root, 'link.txt')
  await writeFile(target, 'sciforge-symlink-probe')
  await symlink(target, link, 'file')
  if (!(await lstat(link)).isSymbolicLink()
    || await readFile(link, 'utf8') !== 'sciforge-symlink-probe'
    || await realpath(link) !== await realpath(target)) {
    throw new Error('File symlink round trip did not preserve link semantics')
  }
  console.log(JSON.stringify({ platform: process.platform, fileSymlink: 'supported' }))
} catch (error) {
  console.error(JSON.stringify({ platform: process.platform, fileSymlink: 'unavailable',
    code: error.code, message: error.message,
    action: 'Run security tests on a runner with file symlink capability. Do not skip or replace links with hardlinks.' }))
  process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true })
}
