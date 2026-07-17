import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createWorkspaceIntelService } from './service.js'
import type { VisualInspectionRequest } from './visual-inspection.js'

test('lists, trees, reads, and builds bounded references for guarded workspace files', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-service-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(join(workspaceRoot, 'README.md'), '# Hello\n\nRead me.\n', 'utf8')
  await writeFile(join(workspaceRoot, 'src', 'index.ts'), 'export const answer = 42\n', 'utf8')
  await writeFile(join(workspaceRoot, '.hidden'), 'hidden\n', 'utf8')

  const service = createWorkspaceIntelService()
  const listing = await service.listWorkspace({ workspaceRoot })
  assert.equal(listing.ok, true)
  if (!listing.ok) return
  assert.deepEqual(listing.entries.map((entry) => entry.relativePath), ['src', 'README.md'])
  assert.equal(listing.entries.some((entry) => entry.relativePath === '.hidden'), false)

  const tree = await service.tree({ workspaceRoot, depth: 2 })
  assert.equal(tree.ok, true)
  if (!tree.ok) return
  assert.equal(tree.tree.kind, 'directory')
  assert.ok(tree.tree.children?.some((entry) => entry.relativePath === 'src'))

  const read = await service.readFile({ workspaceRoot, path: 'src/index.ts' })
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.relativePath, 'src/index.ts')
  assert.match(read.content, /answer = 42/)

  const preview = await service.referencePreview({ workspaceRoot, path: 'README.md', maxChars: 20 })
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(preview.preview.kind, 'text')
  assert.match(preview.preview.contentSummary, /Hello/)

  const references = await service.referenceList({ workspaceRoot, recursive: true, limit: 10 })
  assert.equal(references.ok, true)
  if (!references.ok) return
  assert.ok(references.references.some((reference) => reference.relativePath === 'src/index.ts'))
})

test('rejects path traversal and symlink escapes', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-guard-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })
  await writeFile(join(outsideRoot, 'secret.txt'), 'secret\n', 'utf8')
  await symlink(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'linked-secret.txt'))

  const service = createWorkspaceIntelService()
  const traversal = await service.readFile({ workspaceRoot, path: '../outside/secret.txt' })
  assert.equal(traversal.ok, false)
  if (traversal.ok) return
  assert.equal(traversal.error.code, 'path_outside_workspace')

  const symlinkRead = await service.readFile({ workspaceRoot, path: 'linked-secret.txt' })
  assert.equal(symlinkRead.ok, false)
  if (symlinkRead.ok) return
  assert.equal(symlinkRead.error.code, 'path_outside_workspace')

  const listing = await service.listWorkspace({ workspaceRoot })
  assert.equal(listing.ok, true)
  if (!listing.ok) return
  assert.equal(listing.entries[0]?.kind, 'symlink')
  assert.equal(listing.entries[0]?.targetInsideWorkspace, false)
  assert.equal(listing.entries[0]?.relativePath, 'linked-secret.txt')
})

test('handles binary and oversized files without unbounded reads', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-binary-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'binary.bin'), Buffer.from([0x66, 0x00, 0x67, 0x68]))
  await writeFile(join(workspaceRoot, 'huge.txt'), 'a'.repeat(70_000), 'utf8')

  const service = createWorkspaceIntelService()
  const binary = await service.readFile({ workspaceRoot, path: 'binary.bin' })
  assert.equal(binary.ok, false)
  if (binary.ok) return
  assert.equal(binary.error.code, 'binary_file')

  const binaryPreview = await service.referencePreview({ workspaceRoot, path: 'binary.bin' })
  assert.equal(binaryPreview.ok, true)
  if (!binaryPreview.ok) return
  assert.equal(binaryPreview.preview.kind, 'binary')
  assert.equal(binaryPreview.preview.content, undefined)

  const huge = await service.readFile({ workspaceRoot, path: 'huge.txt', maxBytes: 1024 })
  assert.equal(huge.ok, true)
  if (!huge.ok) return
  assert.equal(huge.content.length, 1024)
  assert.equal(huge.truncated, true)
  assert.equal(huge.nextOffset, 1024)
})

test('inspects multiple guarded workspace images with content-derived MIME and anchored evidence', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-image-inspect-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const jpegPath = join(workspaceRoot, 'sample.png')
  const webpPath = join(workspaceRoot, 'render.webp')
  await mkdir(workspaceRoot, { recursive: true })
  await Promise.all([
    writeFile(jpegPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb])),
    writeFile(webpPath, Buffer.from('RIFF0000WEBP', 'ascii'))
  ])
  let inspectedRequest: VisualInspectionRequest | undefined
  const service = createWorkspaceIntelService({
    workspaceRoot,
    visualInspector: async (request) => {
      inspectedRequest = request
      return visualEvidence(request)
    }
  })

  const result = await service.inspectWorkspaceImages({
    task: 'Compare the sample and rendered output.',
    artifacts: [{
      id: 'sample',
      path: 'sample.png',
      regions: [{ id: 'subject', x: 0.1, y: 0.1, width: 0.4, height: 0.5 }]
    }, {
      id: 'render',
      path: 'render.webp'
    }],
    truthLocks: ['Do not infer hidden labels.'],
    outputIntent: { kind: 'comparison' }
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.artifacts.map(({ id, mimeType }) => ({ id, mimeType })), [
    { id: 'sample', mimeType: 'image/jpeg' },
    { id: 'render', mimeType: 'image/webp' }
  ])
  assert.deepEqual(inspectedRequest?.artifacts.map(({ id, mimeType }) => ({ id, mimeType })), [
    { id: 'sample', mimeType: 'image/jpeg' },
    { id: 'render', mimeType: 'image/webp' }
  ])
  assert.equal(result.evidence.task, 'Compare the sample and rendered output.')
  assert.equal(result.evidence.claims[0]?.artifactId, 'sample')
})

test('lists and reads project skills by id', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-skills-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const skillRoot = join(workspaceRoot, '.codex', 'skills', 'demo-skill')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), [
    '---',
    'name: demo-skill',
    'description: Demonstrate skill discovery.',
    '---',
    '',
    '# Demo',
    '',
    'Use this skill for tests.'
  ].join('\n'), 'utf8')

  const service = createWorkspaceIntelService()
  const list = await service.listSkills({ workspaceRoot })
  assert.equal(list.ok, true)
  if (!list.ok) return
  assert.equal(list.validationErrors.length, 0)
  assert.equal(list.skills[0]?.id, 'demo-skill')
  assert.equal(list.skills[0]?.name, 'Demo Skill')
  assert.equal(list.skills[0]?.scope, 'project')
  assert.equal(list.skills[0]?.entryRelativePath, '.codex/skills/demo-skill/SKILL.md')

  const read = await service.readSkill({ workspaceRoot, skillId: 'demo-skill' })
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.match(read.content, /Use this skill/)
})

test('global skill defaults discover neutral roots without falling back to ~/.kun', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-global-skills-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const homeRoot = join(tempRoot, 'home')
  const workspaceRoot = join(tempRoot, 'workspace')
  const neutralSkillRoot = join(homeRoot, '.agents', 'skills', 'neutral-helper')
  const kunHomeSkillRoot = join(homeRoot, '.kun', 'kun-home-helper')
  const kunNestedSkillRoot = join(homeRoot, '.kun', 'skills', 'kun-skills-helper')
  await mkdir(workspaceRoot, { recursive: true })
  await writeSkill(neutralSkillRoot, 'neutral-helper', 'Neutral helper.')
  await writeSkill(kunHomeSkillRoot, 'kun-home-helper', 'Legacy Kun home helper.')
  await writeSkill(kunNestedSkillRoot, 'kun-skills-helper', 'Legacy Kun skills helper.')

  await withHome(homeRoot, async () => {
    const service = createWorkspaceIntelService({ includeGlobalSkillRoots: true })
    const list = await service.listSkills({ workspaceRoot })

    assert.equal(list.ok, true)
    if (!list.ok) return
    const skillIds = list.skills.map((skill) => skill.id)
    assert.ok(skillIds.includes('neutral-helper'))
    assert.equal(skillIds.some((skillId) => skillId.startsWith('kun-')), false)
    assert.equal(list.skills.find((skill) => skill.id === 'neutral-helper')?.scope, 'configured')
  })
})

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
    description
  ].join('\n'), 'utf8')
}

function visualEvidence(request: VisualInspectionRequest) {
  return {
    status: 'inspected' as const,
    provider: 'model-router' as const,
    model: 'sciforge-model-router',
    inspectedAt: '2026-07-13T00:00:00.000Z',
    task: request.task,
    artifacts: request.artifacts.map(({ id, mimeType }, index) => ({
      id,
      mimeType,
      sha256: String(index + 1).repeat(64)
    })),
    requestSha256: 'a'.repeat(64),
    evidenceSha256: 'b'.repeat(64),
    attestation: `sha256:${'c'.repeat(64)}`,
    summary: 'The requested visual evidence is available.',
    claims: request.artifacts.map(({ id }) => ({
      kind: 'observation' as const,
      text: `Artifact ${id} is visible.`,
      artifactId: id,
      confidence: 0.9
    })),
    uncertainties: []
  }
}

async function withHome<T>(homeRoot: string, action: () => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME
  const originalUserProfile = process.env.USERPROFILE
  process.env.HOME = homeRoot
  process.env.USERPROFILE = homeRoot
  try {
    return await action()
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }
  }
}
