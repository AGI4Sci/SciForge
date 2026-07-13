import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createWorkspaceIntelService } from './service.js'

test('lists, trees, reads, previews, and references guarded workspace files', async (t) => {
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

  const preview = await service.preview({ workspaceRoot, path: 'README.md', maxChars: 20 })
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(preview.kind, 'text')
  assert.match(preview.contentSummary, /Hello/)

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

  const binaryPreview = await service.preview({ workspaceRoot, path: 'binary.bin' })
  assert.equal(binaryPreview.ok, true)
  if (!binaryPreview.ok) return
  assert.equal(binaryPreview.kind, 'binary')
  assert.equal(binaryPreview.content, undefined)

  const huge = await service.readFile({ workspaceRoot, path: 'huge.txt', maxBytes: 1024 })
  assert.equal(huge.ok, true)
  if (!huge.ok) return
  assert.equal(huge.content.length, 1024)
  assert.equal(huge.truncated, true)
  assert.equal(huge.nextOffset, 1024)
})

test('requests a managed visual capture and returns the verified PNG resource', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-capture-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const visibleContextPath = join(tempRoot, 'visible-context', 'snapshot.json')
  const captureDirectory = join(tempRoot, 'visible-context', 'captures')
  const requestDirectory = join(tempRoot, 'visible-context', 'capture-requests')
  const capturePath = join(captureDirectory, 'latest.png')
  await mkdir(captureDirectory, { recursive: true })
  await writeFile(capturePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  const service = createWorkspaceIntelService({
    visibleContextPath,
    visualCaptureTimeoutMs: 1_000,
    visualCapturePollIntervalMs: 5,
    visualInspector: async ({ imagePath, prompt, truthLockedElements }) => ({
      status: 'inspected',
      provider: 'model-router-vision',
      model: 'sciforge-model-router',
      inspectedAt: '2026-07-13T00:00:00.000Z',
      captureSha256: 'a'.repeat(64),
      observationSha256: 'b'.repeat(64),
      attestation: `sha256:${'c'.repeat(64)}`,
      prompt: prompt ?? '',
      summary: `Inspected ${imagePath}`,
      visibleFacts: truthLockedElements ?? [],
      layoutIssues: ['Description column is too narrow.'],
      recommendedActions: ['Widen the second column.'],
      confidence: 0.9
    })
  })
  const capturePromise = service.visualCapture({
    scope: 'target',
    componentId: 'right-sidebar.file-preview',
    targetId: 'current-page',
    inspectionPrompt: 'Inspect the final table layout.',
    truthLockedElements: ['Capability is the first column.']
  })
  const requestName = await waitForFileName(requestDirectory, '.request.json')
  const request = JSON.parse(await readFile(join(requestDirectory, requestName), 'utf8')) as {
    requestId: string
    scope: string
    componentId: string
    targetId: string
  }
  assert.equal(request.scope, 'target')
  assert.equal(request.componentId, 'right-sidebar.file-preview')
  assert.equal(request.targetId, 'current-page')
  await writeFile(join(requestDirectory, `${request.requestId}.response.json`), JSON.stringify({
    schemaVersion: 1,
    requestId: request.requestId,
    completedAt: new Date().toISOString(),
    ok: true,
    capture: {
      kind: 'visualSnapshot',
      role: 'target',
      path: capturePath,
      mimeType: 'image/png',
      capturedAt: new Date().toISOString(),
      width: 1200,
      height: 800,
      scaleFactor: 2,
      windowId: 'window-1',
      revision: 4,
      componentId: request.componentId,
      targetId: request.targetId,
      target: {
        id: request.targetId,
        kind: 'document-page',
        bounds: { x: 10, y: 20, width: 600, height: 400 },
        page: 10,
        active: true
      }
    }
  }), 'utf8')

  const result = await capturePromise
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.resource.path, capturePath)
  assert.equal(result.resource.target?.page, 10)
  assert.equal(result.inspection?.prompt, 'Inspect the final table layout.')
  assert.deepEqual(result.inspection?.visibleFacts, ['Capability is the first column.'])
  assert.match(result.inspection?.attestation ?? '', /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(await readdir(requestDirectory), [])
})

test('fails closed when capture succeeds but semantic visual inspection is unavailable', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-inspection-unavailable-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const visibleContextPath = join(tempRoot, 'visible-context', 'snapshot.json')
  const capturePath = join(tempRoot, 'visible-context', 'captures', 'latest.png')
  const requestDirectory = join(tempRoot, 'visible-context', 'capture-requests')
  await mkdir(join(tempRoot, 'visible-context', 'captures'), { recursive: true })
  await writeFile(capturePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const service = createWorkspaceIntelService({
    visibleContextPath,
    visualCaptureTimeoutMs: 1_000,
    visualCapturePollIntervalMs: 5
  })

  const capturePromise = service.visualCapture({ scope: 'window' })
  const requestName = await waitForFileName(requestDirectory, '.request.json')
  const request = JSON.parse(await readFile(join(requestDirectory, requestName), 'utf8')) as { requestId: string }
  await writeFile(join(requestDirectory, `${request.requestId}.response.json`), JSON.stringify({
    schemaVersion: 1,
    requestId: request.requestId,
    completedAt: new Date().toISOString(),
    ok: true,
    capture: {
      kind: 'visualSnapshot',
      role: 'window',
      path: capturePath,
      mimeType: 'image/png',
      capturedAt: new Date().toISOString(),
      width: 1280,
      height: 720,
      scaleFactor: 2,
      windowId: 'window-1',
      revision: 1
    }
  }), 'utf8')

  const result = await capturePromise

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'visual_inspection_unavailable')
  assert.match(result.error.message, /semantic visual inspection is unavailable/iu)
})

test('allows explicit capture-only diagnostics without treating them as semantic review', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-capture-only-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const visibleContextPath = join(tempRoot, 'visible-context', 'snapshot.json')
  const capturePath = join(tempRoot, 'visible-context', 'captures', 'latest.png')
  const requestDirectory = join(tempRoot, 'visible-context', 'capture-requests')
  await mkdir(join(tempRoot, 'visible-context', 'captures'), { recursive: true })
  await writeFile(capturePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const service = createWorkspaceIntelService({
    visibleContextPath,
    visualCaptureTimeoutMs: 1_000,
    visualCapturePollIntervalMs: 5
  })

  const capturePromise = service.visualCapture({ scope: 'window', requireSemanticInspection: false })
  const requestName = await waitForFileName(requestDirectory, '.request.json')
  const request = JSON.parse(await readFile(join(requestDirectory, requestName), 'utf8')) as { requestId: string }
  await writeFile(join(requestDirectory, `${request.requestId}.response.json`), JSON.stringify({
    schemaVersion: 1,
    requestId: request.requestId,
    completedAt: new Date().toISOString(),
    ok: true,
    capture: {
      kind: 'visualSnapshot',
      role: 'window',
      path: capturePath,
      mimeType: 'image/png',
      capturedAt: new Date().toISOString(),
      width: 1280,
      height: 720,
      scaleFactor: 2,
      windowId: 'window-1',
      revision: 1
    }
  }), 'utf8')

  const result = await capturePromise

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.inspection, undefined)
})

test('bounds visual capture waits and reports an actionable timeout', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-visual-timeout-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const requestDirectory = join(tempRoot, 'visible-context', 'capture-requests')
  const service = createWorkspaceIntelService({
    visibleContextPath: join(tempRoot, 'visible-context', 'snapshot.json'),
    visualCaptureTimeoutMs: 100,
    visualCapturePollIntervalMs: 5
  })

  const result = await service.visualCapture({ scope: 'window' })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'visual_capture_timeout')
  assert.equal(result.error.retryable, true)
  assert.deepEqual(await readdir(requestDirectory), [])
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

async function waitForFileName(directory: string, suffix: string): Promise<string> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const names = await readdir(directory).catch(() => [])
    const match = names.find((name) => name.endsWith(suffix))
    if (match) return match
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Timed out waiting for ${suffix} in ${directory}`)
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
