import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KDENSE_SCIENTIFIC_SKILLS_SOURCE,
  SCIENTIFIC_SKILLS_PROVENANCE_FILE,
  installScientificSkills,
  isValidScientificSkillsInstallRoot,
  resolveScientificSkillsWorkspaceInstallTarget
} from './scientific-skills-installer'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scientific-skills-installer-'))
  tempRoots.push(root)
  return root
}

async function writeSkillInstall(root: string, skillId = 'matplotlib'): Promise<void> {
  const skillDir = join(root, 'skills', skillId)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${skillId}`,
    'description: Scientific plotting.',
    'allowed-tools: Read',
    '---',
    `# ${skillId}`,
    '',
    'Plan figures only.'
  ].join('\n'), 'utf8')
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('scientific skills installer', () => {
  it('resolves the workspace-scoped install target and rejects empty workspace roots', async () => {
    const workspace = await tempDir()

    expect(resolveScientificSkillsWorkspaceInstallTarget(workspace)).toBe(
      join(workspace, '.agents', 'skills', 'scientific-agent-skills')
    )
    expect(() => resolveScientificSkillsWorkspaceInstallTarget('')).toThrow('Workspace root is required')
  })

  it('detects valid and invalid existing install roots', async () => {
    const workspace = await tempDir()
    const target = resolveScientificSkillsWorkspaceInstallTarget(workspace)
    await mkdir(target, { recursive: true })

    expect(await isValidScientificSkillsInstallRoot(target)).toBe(false)
    await writeSkillInstall(target)
    expect(await isValidScientificSkillsInstallRoot(target)).toBe(true)

    const result = await installScientificSkills({ workspaceRoot: workspace })
    expect(result).toMatchObject({
      ok: true,
      status: 'already_installed',
      targetPath: target
    })
  })

  it('refuses to overwrite an invalid existing target', async () => {
    const workspace = await tempDir()
    const target = resolveScientificSkillsWorkspaceInstallTarget(workspace)
    await mkdir(target, { recursive: true })

    await expect(installScientificSkills({ workspaceRoot: workspace })).resolves.toMatchObject({
      ok: false,
      status: 'invalid_existing_target',
      targetPath: target
    })
  })

  it('installs through the git backend via staging, verification, and provenance', async () => {
    const workspace = await tempDir()
    const target = resolveScientificSkillsWorkspaceInstallTarget(workspace)
    const spawnCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'clone') {
        await writeSkillInstall(args.at(-1) ?? '', 'plotly')
        return { code: 0, stdout: 'cloned\n', stderr: '' }
      }
      if (command === 'git' && args.includes('rev-parse')) {
        return { code: 0, stdout: '0123456789abcdef0123456789abcdef01234567\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'unexpected command' }
    })

    const result = await installScientificSkills({
      workspaceRoot: workspace,
      backend: 'git',
      ref: 'main'
    }, {
      spawnCommand,
      now: () => new Date('2026-06-21T00:00:00.000Z'),
      tempSuffix: () => 'fixture'
    })

    expect(result).toMatchObject({
      ok: true,
      status: 'installed',
      backend: 'git',
      targetPath: target,
      commit: '0123456789abcdef0123456789abcdef01234567'
    })
    expect(existsSync(join(target, 'skills', 'plotly', 'SKILL.md'))).toBe(true)
    const provenance = JSON.parse(await readFile(join(target, SCIENTIFIC_SKILLS_PROVENANCE_FILE), 'utf8')) as Record<string, unknown>
    expect(provenance).toMatchObject({
      source: KDENSE_SCIENTIFIC_SKILLS_SOURCE,
      backend: 'git',
      ref: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      installedAt: '2026-06-21T00:00:00.000Z',
      targetPath: target,
      installerVersion: 1
    })
  })

  it('returns clone and verification failures from the git backend', async () => {
    const workspace = await tempDir()

    await expect(installScientificSkills({ workspaceRoot: workspace }, {
      spawnCommand: vi.fn(async () => ({ code: 128, stdout: '', stderr: 'network failed' })),
      tempSuffix: () => 'clone-failure'
    })).resolves.toMatchObject({
      ok: false,
      status: 'clone_failed',
      stderrTail: 'network failed'
    })

    const verifyWorkspace = await tempDir()
    await expect(installScientificSkills({ workspaceRoot: verifyWorkspace }, {
      spawnCommand: vi.fn(async (_command: string, args: string[]) => {
        if (args[0] === 'clone') {
          await mkdir(args.at(-1) ?? '', { recursive: true })
          return { code: 0, stdout: 'cloned', stderr: '' }
        }
        return { code: 0, stdout: '0123456', stderr: '' }
      }),
      tempSuffix: () => 'verification-failure'
    })).resolves.toMatchObject({
      ok: false,
      status: 'verification_failed'
    })
  })

  it('supports the npx backend only when discovery succeeds afterward', async () => {
    const workspace = await tempDir()
    const target = resolveScientificSkillsWorkspaceInstallTarget(workspace)
    const spawnCommand = vi.fn(async (command: string) => {
      if (command === 'npx') {
        await writeSkillInstall(target, 'scientific-visualization')
        return { code: 0, stdout: 'installed', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'no git metadata' }
    })

    await expect(installScientificSkills({ workspaceRoot: workspace, backend: 'npx' }, {
      spawnCommand,
      now: () => new Date('2026-06-21T00:00:00.000Z')
    })).resolves.toMatchObject({
      ok: true,
      status: 'installed',
      backend: 'npx',
      targetPath: target
    })
  })

  it('returns npx command and post-discovery failures', async () => {
    const workspace = await tempDir()

    await expect(installScientificSkills({ workspaceRoot: workspace, backend: 'npx' }, {
      spawnCommand: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'npx failed' }))
    })).resolves.toMatchObject({
      ok: false,
      status: 'npx_failed',
      stderrTail: 'npx failed'
    })

    const undiscoveredWorkspace = await tempDir()
    await expect(installScientificSkills({ workspaceRoot: undiscoveredWorkspace, backend: 'npx' }, {
      spawnCommand: vi.fn(async () => ({ code: 0, stdout: 'done', stderr: '' }))
    })).resolves.toMatchObject({
      ok: false,
      status: 'not_discovered_after_npx'
    })
  })
})
