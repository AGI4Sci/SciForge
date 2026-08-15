import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { guiSkillRootsForRuntime, listGuiSkills } from './skill-service'

describe('skill-service', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'gui-skills-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('discovers project Codex skills from the active workspace', async () => {
    const workspaceRoot = join(tempRoot, 'workspace')
    const skillRoot = join(workspaceRoot, '.codex', 'skills', 'openspec-apply-change')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: openspec-apply-change',
      'description: Implement tasks from an OpenSpec change.',
      '---',
      '',
      'Implement tasks from an OpenSpec change.'
    ].join('\n'), 'utf8')

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'openspec-apply-change',
      name: 'Openspec Apply Change',
      description: 'Implement tasks from an OpenSpec change.',
      scope: 'project'
    }))
  })

  it('keeps legacy SKILL.md entries with Chinese frontmatter names distinct', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-cn')
    const skillRoot = join(workspaceRoot, '.agents', 'skills')
    const tddRoot = join(skillRoot, 'tdd')
    const reviewRoot = join(skillRoot, 'code-review')
    await mkdir(tddRoot, { recursive: true })
    await mkdir(reviewRoot, { recursive: true })
    await writeFile(join(tddRoot, 'SKILL.md'), [
      '---',
      'name: 测试驱动开发(TDD)',
      'description: 用测试先行推进实现。',
      '---',
      '',
      '# TDD',
      '',
      '先写失败测试，再实现。'
    ].join('\n'), 'utf8')
    await writeFile(join(reviewRoot, 'SKILL.md'), [
      '---',
      'name: 代码审查',
      'description: 检查回归风险。',
      '---',
      '',
      '# Review',
      '',
      '关注正确性和测试。'
    ].join('\n'), 'utf8')

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const projectSkills = result.skills.filter((skill) => skill.root.startsWith(skillRoot))
    expect(projectSkills).toHaveLength(2)
    expect(projectSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tdd',
        name: '测试驱动开发(TDD)',
        description: '用测试先行推进实现。'
      }),
      expect.objectContaining({
        id: 'code-review',
        name: '代码审查',
        description: '检查回归风险。'
      })
    ]))
    expect(projectSkills.map((skill) => skill.id)).not.toContain('skill')
  })

  it('maps workspace-intel manifest skills back to GUI root and entry paths', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-manifest')
    const extraRoot = join(tempRoot, 'external-skills')
    const skillRoot = join(extraRoot, 'paper-helper')
    const entryPath = join(skillRoot, 'docs', 'guide.md')
    await mkdir(join(skillRoot, 'docs'), { recursive: true })
    await writeFile(join(skillRoot, 'skill.json'), JSON.stringify({
      id: 'paper-helper',
      name: 'Paper Helper',
      description: 'Summarize paper notes.',
      entry: 'docs/guide.md'
    }), 'utf8')
    await writeFile(entryPath, '# Paper Helper\n\nSummarize paper notes.', 'utf8')

    const settings = createSettings(workspaceRoot)
    settings.skills.extraDirs = [extraRoot]

    const result = await listGuiSkills(settings, workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'paper-helper',
      name: 'Paper Helper',
      description: 'Summarize paper notes.',
      root: skillRoot,
      entryPath,
      scope: 'global',
      legacy: false
    }))
  })

  it('prefers project skills over global skills with the same id', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-priority')
    const projectPackageRoot = join(workspaceRoot, '.codex', 'skills', 'shared-helper')
    const globalRoot = join(tempRoot, 'global-skills')
    const globalPackageRoot = join(globalRoot, 'shared-helper')
    await writeSkill(projectPackageRoot, {
      name: 'Project Helper',
      description: 'Project-local instructions win.'
    })
    await writeSkill(globalPackageRoot, {
      name: 'Global Helper',
      description: 'Global fallback instructions.'
    })

    const settings = createSettings(workspaceRoot)
    settings.skills.extraDirs = [globalRoot]

    const result = await listGuiSkills(settings, workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shared = result.skills.filter((skill) => skill.id === 'shared-helper')
    expect(shared).toHaveLength(1)
    expect(shared[0]).toMatchObject({
      name: 'Project Helper',
      description: 'Project-local instructions win.',
      root: projectPackageRoot,
      scope: 'project'
    })
  })

  it('deduplicates configured roots after normalization', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-dedupe')
    const projectRoot = join(workspaceRoot, '.codex', 'skills')
    const externalRoot = join(tempRoot, 'external-dedupe')
    await writeSkill(join(projectRoot, 'project-only'), {
      name: 'Project Only',
      description: 'One project root.'
    })
    await writeSkill(join(externalRoot, 'external-only'), {
      name: 'External Only',
      description: 'One external root.'
    })
    const settings = createSettings(workspaceRoot)
    settings.skills.extraDirs = [
      projectRoot,
      `${projectRoot}${sep}`,
      `${projectRoot}${sep}..${sep}skills`,
      externalRoot,
      `${externalRoot}${sep}`,
      `${externalRoot}${sep}..${sep}external-dedupe`
    ]
    settings.schedule.skills.extraDirs = [externalRoot]

    const roots = await guiSkillRootsForRuntime(settings, workspaceRoot)

    expect(roots.filter((root) => root.path === projectRoot)).toEqual([
      { path: projectRoot, scope: 'project' }
    ])
    expect(roots.filter((root) => root.path === externalRoot)).toEqual([
      { path: externalRoot, scope: 'global' }
    ])
  })

  it('keeps generic default global skill roots neutral without falling back to ~/.kun', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-default-roots')
    const homeRoot = join(tempRoot, 'home')
    const neutralRoot = join(homeRoot, '.agents', 'skills')
    const kunHome = join(homeRoot, '.kun')
    const kunRoot = join(kunHome, 'skills')
    await mkdir(neutralRoot, { recursive: true })
    await mkdir(kunRoot, { recursive: true })

    await withHome(homeRoot, async () => {
      const roots = await guiSkillRootsForRuntime(createSettings(workspaceRoot), workspaceRoot)

      expect(roots).toEqual(expect.arrayContaining([
        { path: neutralRoot, scope: 'global' }
      ]))
      expect(roots.some((root) => root.path === kunHome || root.path.startsWith(`${kunHome}${sep}`))).toBe(false)
    })
  })

  function createSettings(workspaceRoot: string): AppSettingsV1 {
    return {
      version: 1,
      locale: 'en',
      theme: 'system',
      uiFontScale: 'small',
      agents: { sciforge: defaultLocalRuntimeSettings() },
      workspaceRoot,
      log: { enabled: false, retentionDays: 7 },
      notifications: { turnComplete: true },
      appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
      keyboardShortcuts: defaultKeyboardShortcuts(),
      write: defaultWriteSettings(),
      skills: { extraDirs: [] },
      schedule: defaultScheduleSettings(),
      workflow: defaultWorkflowSettings(),
      guiUpdate: { channel: 'stable' },
      codePromptPrefix: ''
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

  async function writeSkill(
    root: string,
    frontmatter: { name: string; description: string }
  ): Promise<void> {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'SKILL.md'), [
      '---',
      `name: ${frontmatter.name}`,
      `description: ${frontmatter.description}`,
      '---',
      '',
      `# ${frontmatter.name}`,
      '',
      frontmatter.description
    ].join('\n'), 'utf8')
  }
})
