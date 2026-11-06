import { mkdtemp, mkdir, symlink, link, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = await mkdtemp(join(tmpdir(), 'sciforge-preflight-'))
try {
  const command = process.platform === 'win32' ? 'python' : 'python3'
  const python = spawnSync(command, ['-c', 'import sys; assert sys.version_info >= (3,10); print(sys.version)'], { encoding: 'utf8', timeout: 10000 })
  if (python.status !== 0 || python.error) throw new Error(`Python >=3.10 unavailable: ${python.error ?? python.stderr}`)
  await mkdir(join(root, 'dir')); await writeFile(join(root, 'file'), 'fixture')
  await symlink(join(root, 'dir'), join(root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(join(root, 'file'), join(root, 'symlink'), 'file')
  await link(join(root, 'file'), join(root, 'hardlink'))
  if (!(await lstat(join(root, 'junction'))).isSymbolicLink() || !(await lstat(join(root, 'symlink'))).isSymbolicLink()) throw new Error('Links were not created')
  console.log(JSON.stringify({ platform: process.platform, node: process.version, python: python.stdout.trim(), directoryLink: true, fileSymlink: true, hardlink: true, isolatedFixture: root }))
} catch (e) { console.error(`ENVIRONMENT FAILED (not skipped): ${e.message}; isolated fixture: ${root}`); process.exitCode = 1 }
