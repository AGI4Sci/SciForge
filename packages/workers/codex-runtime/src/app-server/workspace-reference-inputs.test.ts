import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { codexAppServerTurnInputs } from './workspace-reference-inputs.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ))
})

async function temporaryWorkspace(): Promise<string> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'sciforge-codex-references-')))
  temporaryDirectories.push(workspace)
  await mkdir(join(workspace, 'AI Scientist', '论文目录'), { recursive: true })
  await mkdir(join(workspace, 'figures'), { recursive: true })
  await writeFile(join(workspace, 'AI Scientist', '论文目录', 'notes.md'), 'PRIVATE FILE CONTENT')
  await writeFile(join(workspace, 'AI Scientist', '论文目录', 'report.pdf'), '%PDF fixture')
  await writeFile(join(workspace, 'figures', 'cell.png'), 'png fixture')
  return workspace
}

describe('codexAppServerTurnInputs', () => {
  it('renders workspace locators as model-visible data and images as absolute local inputs', async () => {
    const workspace = await temporaryWorkspace()
    const result = await codexAppServerTurnInputs({
      text: 'Analyze the references',
      workspaceRoot: workspace,
      fileReferences: [
        { relativePath: 'AI Scientist/论文目录', kind: 'directory' },
        { relativePath: 'AI Scientist/论文目录/notes.md', kind: 'text' },
        { relativePath: 'AI Scientist/论文目录/report.pdf', kind: 'pdf' },
        { relativePath: 'figures/cell.png', kind: 'image' },
        { relativePath: 'figures/cell.png', kind: 'image' }
      ]
    })

    assert.deepEqual(result[0], {
      type: 'text',
      text: 'Analyze the references',
      text_elements: []
    })
    assert.equal(result[1]?.type, 'text')
    if (result[1]?.type !== 'text') assert.fail('Expected workspace reference context text.')
    assert.match(result[1].text, /"relativePath":"AI Scientist\/论文目录"/u)
    assert.match(result[1].text, /"kind":"directory"/u)
    assert.match(result[1].text, /"relativePath":"AI Scientist\/论文目录\/notes\.md"/u)
    assert.match(result[1].text, /"kind":"pdf"/u)
    assert.doesNotMatch(result[1].text, /PRIVATE FILE CONTENT/u)
    assert.doesNotMatch(result[1].text, new RegExp(workspace, 'u'))
    assert.deepEqual(result[2], {
      type: 'localImage',
      path: join(workspace, 'figures', 'cell.png')
    })
    assert.equal(result.some((item) => item.type === 'mention'), false)
    assert.equal(result.filter((item) => item.type === 'localImage').length, 1)
  })

  it('fails visibly for invalid, missing, or type-mismatched references', async () => {
    const workspace = await temporaryWorkspace()

    await assert.rejects(
      codexAppServerTurnInputs({
        text: 'Inspect',
        workspaceRoot: workspace,
        fileReferences: [{ relativePath: '../secret.txt', kind: 'file' }]
      }),
      /workspace-relative/u
    )
    await assert.rejects(
      codexAppServerTurnInputs({
        text: 'Inspect',
        workspaceRoot: workspace,
        fileReferences: [{ relativePath: 'file:///tmp/secret.txt', kind: 'file' }]
      }),
      /workspace-relative/u
    )
    await assert.rejects(
      codexAppServerTurnInputs({
        text: 'Inspect',
        workspaceRoot: workspace,
        fileReferences: [{ relativePath: 'missing.md', kind: 'text' }]
      }),
      /does not exist/u
    )
    await assert.rejects(
      codexAppServerTurnInputs({
        text: 'Inspect',
        workspaceRoot: workspace,
        fileReferences: [{ relativePath: 'AI Scientist/论文目录', kind: 'file' }]
      }),
      /type does not match/u
    )
  })

  it('rejects references whose symlink target escapes the workspace', async () => {
    const workspace = await temporaryWorkspace()
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'sciforge-codex-outside-'))
    temporaryDirectories.push(outsideDirectory)
    const outsideFile = join(outsideDirectory, 'secret.txt')
    await writeFile(outsideFile, 'secret')
    await symlink(outsideFile, join(workspace, 'outside-link.txt'))

    await assert.rejects(
      codexAppServerTurnInputs({
        text: 'Inspect',
        workspaceRoot: workspace,
        fileReferences: [{ relativePath: 'outside-link.txt', kind: 'text' }]
      }),
      /outside the workspace/u
    )
  })
})
