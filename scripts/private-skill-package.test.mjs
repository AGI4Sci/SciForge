import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import JSZip from 'jszip'

import {
  installPrivateSkillPackage,
  verifyPrivateSkillPackage
} from './private-skill-package.mjs'
import {
  createWorkspaceIntelService
} from '../packages/workers/workspace-intel/src/index.ts'

test('installs a private root skill idempotently into the canonical project skill root', async () => {
  await withFixture(async ({ archivePath, workspaceRoot }) => {
    const verified = await verifyPrivateSkillPackage({ archivePath })
    assert.equal(verified.skillName, 'opencontent-base')
    assert.equal(verified.version, '1.0.1')
    assert.equal(verified.fileCount, 3)

    const installed = await installPrivateSkillPackage({ archivePath, workspaceRoot })
    assert.equal(installed.status, 'installed')
    assert.equal(
      await readFile(join(installed.installPath, 'SKILL.md'), 'utf8'),
      skillDocument()
    )
    const listed = await createWorkspaceIntelService({
      workspaceRoot,
      skillRoots: [join(workspaceRoot, '.codex', 'skills')]
    }).listSkills({ workspaceRoot })
    assert.equal(listed.ok, true)
    if (listed.ok) {
      assert.ok(listed.skills.some((skill) =>
        skill.id === 'opencontent-base'
      ))
    }

    const repeated = await installPrivateSkillPackage({ archivePath, workspaceRoot })
    assert.equal(repeated.status, 'already-installed')
    assert.equal(repeated.archiveSha256, verified.archiveSha256)
  })
})

test('accepts one containing directory and verifies a sender-provided digest', async () => {
  await withFixture(async ({ root, workspaceRoot }) => {
    const archivePath = join(root, 'nested.zip')
    const bytes = await archiveBytes({ prefix: 'opencontent-base/' })
    await writeFile(archivePath, bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const installed = await installPrivateSkillPackage({
      archivePath,
      expectedSha256: digest,
      workspaceRoot
    })
    assert.equal(installed.status, 'installed')
  })
})

test('rejects digest drift, traversal, bundled credentials, and conflicting installs', async () => {
  await withFixture(async ({ archivePath, root, workspaceRoot }) => {
    await assert.rejects(
      verifyPrivateSkillPackage({ archivePath, expectedSha256: '0'.repeat(64) }),
      /SHA-256 does not match/u
    )

    const credentialArchive = join(root, 'credential.zip')
    await writeFile(credentialArchive, await archiveBytes({
      extra: { '.env': 'OPENCONTENT_APIKEY=must-not-travel' }
    }))
    await assert.rejects(
      verifyPrivateSkillPackage({ archivePath: credentialArchive }),
      /must not contain runtime credentials/u
    )

    const keyArchive = join(root, 'private-key.zip')
    await writeFile(keyArchive, await archiveBytes({
      extra: { 'credentials/client.key': 'not-a-real-key' }
    }))
    await assert.rejects(
      verifyPrivateSkillPackage({ archivePath: keyArchive }),
      /must not contain runtime credentials/u
    )

    const traversalArchive = join(root, 'traversal.zip')
    const traversal = new JSZip()
    traversal.file('SKILL.md', skillDocument())
    traversal.file('../outside.txt', 'outside')
    await writeFile(traversalArchive, await traversal.generateAsync({
      type: 'nodebuffer',
      platform: 'UNIX'
    }))
    await assert.rejects(
      verifyPrivateSkillPackage({ archivePath: traversalArchive }),
      /Unsafe private skill package (?:entry|path)/u
    )

    const installed = await installPrivateSkillPackage({ archivePath, workspaceRoot })
    await writeFile(join(installed.installPath, 'SKILL.md'), 'changed', 'utf8')
    await assert.rejects(
      installPrivateSkillPackage({ archivePath, workspaceRoot }),
      /Installed skill file changed/u
    )
    assert.equal(await readFile(join(installed.installPath, 'SKILL.md'), 'utf8'), 'changed')
  })
})

async function withFixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-private-skill-'))
  try {
    const workspaceRoot = join(root, 'workspace')
    const archivePath = join(root, 'opencontent-base.zip')
    await mkdir(workspaceRoot)
    await writeFile(archivePath, await archiveBytes())
    await action({ archivePath, root, workspaceRoot })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function archiveBytes({ prefix = '', extra = {} } = {}) {
  const zip = new JSZip()
  zip.file(`${prefix}SKILL.md`, skillDocument())
  zip.file(`${prefix}.env.example`, 'OPENCONTENT_SITE=https://example.invalid\n')
  zip.file(`${prefix}cli/bin/oc.js`, '#!/usr/bin/env node\n', {
    unixPermissions: 0o100755
  })
  for (const [path, content] of Object.entries(extra)) zip.file(`${prefix}${path}`, content)
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

function skillDocument() {
  return [
    '---',
    'name: opencontent-base',
    'description: Optional OpenContent Agent commands.',
    'version: 1.0.1',
    '---',
    '',
    '# OpenContent Base',
    ''
  ].join('\n')
}
