import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { auditPublishablePackageVersions } from './publishable-package-version-audit.mjs'

test('requires changed publishable content to advance its package version', async (context) => {
  const root = await createRepository(context)
  await writeFile(path.join(root, 'packages/workers/example/src/index.ts'), 'export const value = 2\n')

  const stale = auditPublishablePackageVersions(root, 'release-base')
  assert.deepEqual(stale.findings, [
    'packages/workers/example: published content changed but version 1.0.0 does not advance 1.0.0.'
  ])

  await writePackage(path.join(root, 'packages/workers/example'), {
    name: '@fixture/example',
    version: '1.0.1',
    files: ['src']
  })
  assert.deepEqual(auditPublishablePackageVersions(root, 'release-base').findings, [])
})

test('requires every domain manifest version to match its package version', async (context) => {
  const root = await createRepository(context)
  const domainRoot = path.join(root, 'packages/domains/example')
  await mkdir(domainRoot, { recursive: true })
  await writePackage(domainRoot, {
    name: '@fixture/domain-example',
    version: '1.0.0',
    files: ['sciforge.domain.json']
  })
  await writeFile(path.join(domainRoot, 'sciforge.domain.json'), JSON.stringify({
    packageName: '@fixture/domain-example',
    module: { version: '1.0.1' }
  }))

  assert.deepEqual(auditPublishablePackageVersions(root, 'release-base').findings, [
    'packages/domains/example: manifest module.version 1.0.1 must equal package.json version 1.0.0.'
  ])
})

async function createRepository(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-package-version-audit-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init')
  git(root, 'config', 'user.email', 'fixture@example.com')
  git(root, 'config', 'user.name', 'Fixture')
  const packageRoot = path.join(root, 'packages/workers/example')
  await mkdir(path.join(packageRoot, 'src'), { recursive: true })
  await writePackage(packageRoot, {
    name: '@fixture/example',
    version: '1.0.0',
    files: ['src']
  })
  await writeFile(path.join(packageRoot, 'src/index.ts'), 'export const value = 1\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'release base')
  git(root, 'tag', 'release-base')
  return root
}

async function writePackage(packageRoot, value) {
  await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(value, null, 2)}\n`)
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}
