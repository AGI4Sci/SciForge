import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES,
  SCIENTIFIC_SKILLS_ENV_ROOT,
  buildScientificExternalSkillCatalog,
  buildScientificSkillsStatusSummary,
  buildScientificSkillsIndex,
  planScientificSkills,
  readScientificSkill,
  searchScientificSkills
} from './scientific-skills-index'

const tempRoots: string[] = []

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'scientific-skills-test-'))
  tempRoots.push(root)
  return root
}

async function writeSkill(root: string, skillId: string, content: string): Promise<void> {
  const dir = join(root, 'skills', skillId)
  await mkdir(join(dir, 'scripts'), { recursive: true })
  await writeFile(join(dir, 'scripts', 'render.py'), '# fixture\n', 'utf8')
  await writeFile(join(dir, 'SKILL.md'), content, 'utf8')
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('scientific skills index', () => {
  it('exposes external skill catalog as an additive CNS/domain layer', () => {
    const catalog = buildScientificExternalSkillCatalog({
      figureNeeds: ['mechanism_schematic', 'summary_figure'],
      domain: 'life science'
    })
    const ids = catalog.map((item) => item.skillId)

    expect(ids).toContain('scientific-visualization')
    expect(ids).toContain('nature-figure')
    expect(ids).toContain('nature-academic-search')
    expect(ids).toContain('nature-reader')
    expect(ids).toContain('pathway-enrichment')
    expect(ids).toContain('claude-code-skills')
    expect(ids).toContain('openai-codex-skills')
    expect(catalog.find((item) => item.skillId === 'nature-figure')).toMatchObject({
      sourceKind: 'cns',
      source: 'Yuan1z0825/nature-skills',
      readOnly: true,
      executionPolicy: 'read-only-planning'
    })
    expect(catalog.find((item) => item.skillId === 'claude-code-skills')).toMatchObject({
      sourceKind: 'compat',
      status: 'compatible-standard'
    })
    expect(JSON.stringify(catalog)).not.toMatch(/SciVisAgentSkills|Paraview|ChartMimic|SciFig/)
    expect(EXCLUDED_SCIENTIFIC_PLOTTING_RESEARCH_SOURCES).toContain('KuangshiAi/SciVisAgentSkills')
  })

  it('includes paper-figures as a read-only data-first plotting workflow source', () => {
    const catalog = buildScientificExternalSkillCatalog({
      figureNeeds: ['statistical_comparison', 'heatmap_matrix', 'multi_panel_figure'],
      domain: 'clinical medicine'
    })
    const paperFigures = catalog.find((item) => item.skillId === 'paper-figures')

    expect(paperFigures).toMatchObject({
      sourceKind: 'domain',
      source: 'DRZ-hang/paper-figures',
      repository: 'https://github.com/DRZ-hang/paper-figures',
      status: 'remote-reference',
      readOnly: true,
      executionPolicy: 'read-only-planning',
      roles: expect.arrayContaining(['paper-level figure plan', 'raw-data-to-chart mapping'])
    })
  })

  it('discovers repo roots, parses K-Dense-style frontmatter, and searches Chinese/English terms', async () => {
    const root = await tempDir()
    await writeSkill(root, 'matplotlib', [
      '---',
      'name: matplotlib',
      'description: Publication plotting with Matplotlib for 科研绘图.',
      'license: MIT',
      'compatibility:',
      '  - codex',
      '  - claude',
      'allowed-tools:',
      '  - Read',
      '  - Bash',
      'metadata: {"domain":"plotting","package":"matplotlib"}',
      '---',
      '# Matplotlib',
      '',
      'Create publication-ready scientific plots and journal figures. '.repeat(40),
      '',
      '## Resources',
      '- style templates',
      '- example gallery'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      env: { [SCIENTIFIC_SKILLS_ENV_ROOT]: root },
      homeDir: join(root, 'home')
    })

    expect(index.installed).toBe(true)
    expect(index.skillCount).toBe(1)
    expect(index.roots.some((item) => item.path === join(root, 'skills') && item.skillCount === 1)).toBe(true)
    expect(index.skills[0]).toMatchObject({
      id: 'matplotlib',
      name: 'matplotlib',
      frontmatter: {
        allowedTools: ['Read', 'Bash'],
        metadata: { domain: 'plotting', package: 'matplotlib' }
      }
    })
    expect(index.skills[0]?.resources).toContain('style templates')
    expect(index.skills[0]?.scripts).toContain('scripts/render.py')

    const results = searchScientificSkills(index, '科研绘图 matplotlib', 8)
    expect(results[0]?.skillId).toBe('matplotlib')

    const summary = readScientificSkill(index, 'matplotlib')
    expect(summary?.fullContent).toBeUndefined()
    expect(summary?.scripts).toBeUndefined()

    const full = readScientificSkill(index, 'matplotlib', ['full'], 1_000)
    expect(full?.fullContent).toContain('Matplotlib')
    expect(full?.fullContent).toContain('[truncated]')
    expect(full?.truncated).toBe(true)
  })

  it('records validation errors without failing the whole index', async () => {
    const root = await tempDir()
    await writeSkill(root, 'missing-frontmatter', [
      '# Missing Frontmatter',
      '',
      'Still indexable as overview text.'
    ].join('\n'))
    await writeSkill(root, 'bad-yaml', [
      '---',
      'name: bad-yaml',
      'description: Broken metadata.',
      ': nope',
      'metadata: {"domain":',
      '---',
      '# Bad YAML',
      '',
      'This skill should not crash discovery.'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      env: { [SCIENTIFIC_SKILLS_ENV_ROOT]: join(root, 'skills') },
      homeDir: join(root, 'home')
    })

    expect(index.skillCount).toBe(2)
    expect(index.validationErrors.some((error) => error.message.includes('Missing frontmatter'))).toBe(true)
    expect(index.validationErrors.some((error) => error.message.includes('metadata JSON parse failed'))).toBe(true)
    expect(index.validationErrors.some((error) => error.message.includes('Unparsed frontmatter line'))).toBe(true)
  })

  it('discovers workspace .agents scientific-agent-skills installs and creates read-only plans', async () => {
    const workspace = await tempDir()
    const skillsRoot = join(workspace, '.agents', 'skills', 'scientific-agent-skills', 'skills')
    await writeSkill(join(workspace, '.agents', 'skills', 'scientific-agent-skills'), 'scientific-visualization', [
      '---',
      'name: scientific-visualization',
      'description: Publication-ready scientific visualization planning.',
      'allowed-tools: Read',
      '---',
      '# Scientific Visualization',
      '',
      'Plan figures, visual encodings, captions, and reproducible plotting workflows.'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      workspaceRoot: workspace,
      env: {},
      homeDir: join(workspace, 'home')
    })

    expect(index.roots.some((root) => root.path === skillsRoot && root.skillCount === 1)).toBe(true)
    const plan = planScientificSkills(index, 'Need a publication figure plan for omics data')
    expect(plan.installed).toBe(true)
    expect(plan.recommendedSkills[0]?.skillId).toBe('scientific-visualization')
    expect(plan.guardrails.join(' ')).toContain('v1 is read-only')
    expect(plan.nextSciForgeActions.join(' ')).toContain('controlled tool')
  })

  it('does not use legacy local runtime skill roots unless explicitly configured', async () => {
    const home = await tempDir()
    const legacyRoot = join(home, '.kun', 'skills', 'scientific-agent-skills')
    await writeSkill(legacyRoot, 'matplotlib', [
      '---',
      'name: matplotlib',
      'description: Publication plotting with Matplotlib.',
      'allowed-tools: Read',
      '---',
      '# Matplotlib',
      '',
      'Build paper-ready plots.'
    ].join('\n'))

    const defaultIndex = await buildScientificSkillsIndex({
      env: {},
      homeDir: home
    })
    expect(defaultIndex.installed).toBe(false)
    expect(defaultIndex.skills.map((skill) => skill.id)).not.toContain('matplotlib')
    expect(defaultIndex.roots.map((root) => root.path)).not.toContain(join(legacyRoot, 'skills'))
    expect(JSON.stringify(defaultIndex.roots)).not.toContain('.kun')

    const explicitIndex = await buildScientificSkillsIndex({
      env: { [SCIENTIFIC_SKILLS_ENV_ROOT]: legacyRoot },
      homeDir: home
    })
    expect(explicitIndex.installed).toBe(true)
    expect(explicitIndex.roots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'env',
        path: join(legacyRoot, 'skills'),
        skillCount: 1
      })
    ]))
  })

  it('discovers global SciForge scientific-agent-skills installs by default', async () => {
    const home = await tempDir()
    const sciforgeRoot = join(home, '.sciforge', 'skills', 'scientific-agent-skills')
    await writeSkill(sciforgeRoot, 'seaborn', [
      '---',
      'name: seaborn',
      'description: Statistical plotting with Seaborn.',
      'allowed-tools: Read',
      '---',
      '# Seaborn',
      '',
      'Build publication-ready statistical plots.'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      env: {},
      homeDir: home
    })

    expect(index.installed).toBe(true)
    expect(index.skills.map((skill) => skill.id)).toContain('seaborn')
    expect(index.roots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'global-sciforge',
        path: join(sciforgeRoot, 'skills'),
        skillCount: 1
      })
    ]))
  })

  it('summarizes the curated plotting pack and prioritizes it for plotting tasks', async () => {
    const root = await tempDir()
    await writeSkill(root, 'plotly', [
      '---',
      'name: plotly',
      'description: Interactive scientific plotting.',
      'allowed-tools: Read',
      '---',
      '# Plotly',
      '',
      'Build interactive figures and exploratory charts.'
    ].join('\n'))
    await writeSkill(root, 'matplotlib', [
      '---',
      'name: matplotlib',
      'description: Static publication-ready figures.',
      'allowed-tools: Read',
      '---',
      '# Matplotlib',
      '',
      'Build paper-ready plots and chart exports.'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      env: { [SCIENTIFIC_SKILLS_ENV_ROOT]: root },
      homeDir: join(root, 'home')
    })
    const status = buildScientificSkillsStatusSummary(index)
    const availableIds = status.plottingPack.items
      .filter((item) => item.installed)
      .map((item) => item.skillId)

    expect(status.plottingPack.total).toBe(6)
    expect(status.plottingPack.installed).toBe(2)
    expect(availableIds).toEqual(['matplotlib', 'plotly'])

    const plan = planScientificSkills(index, '需要做一个交互式科研绘图')
    expect(plan.recommendedSkills.map((skill) => skill.skillId)).toContain('plotly')
    expect(plan.installRecommendation).toMatchObject({
      recommended: true,
      targetScope: 'workspace',
      backend: 'git',
      source: 'K-Dense-AI/scientific-agent-skills'
    })
    expect(plan.installRecommendation?.missingSkills).toContain('scientific-visualization')
    expect(plan.plottingWorkflow).toMatchObject({
      detected: true,
      availableSkills: ['matplotlib', 'plotly'],
      nextControlledTool: 'SciForge DataFigure Engine'
    })
    expect(plan.plottingWorkflow?.missingSkills).toContain('seaborn')
    expect(JSON.stringify(plan)).not.toContain('npx ')
  })

  it('plans a controlled figure style extraction workflow for reference-paper aesthetics', async () => {
    const root = await tempDir()
    await writeSkill(root, 'scientific-visualization', [
      '---',
      'name: scientific-visualization',
      'description: Publication-ready scientific visualization planning.',
      'allowed-tools: Read',
      '---',
      '# Scientific Visualization',
      '',
      'Plan visual style, encodings, and journal figure production.'
    ].join('\n'))
    await writeSkill(root, 'matplotlib', [
      '---',
      'name: matplotlib',
      'description: Static publication-ready figures.',
      'allowed-tools: Read',
      '---',
      '# Matplotlib',
      '',
      'Build paper-ready plots and chart exports.'
    ].join('\n'))

    const index = await buildScientificSkillsIndex({
      env: { [SCIENTIFIC_SKILLS_ENV_ROOT]: root },
      homeDir: join(root, 'home')
    })
    const plan = planScientificSkills(index, '用户给一篇参考文献的美学风格，帮我做同样效果的科研绘图')

    expect(plan.plottingWorkflow).toMatchObject({
      detected: true,
      styleReference: {
        detected: true,
        extractionTool: 'figure-style:extract',
        outputArtifact: 'FigureStyleSpec v1',
        nextControlledTool: 'SciForge DataFigure Engine'
      }
    })
    expect(plan.plottingWorkflow?.styleReference?.acceptedSourceTypes).toEqual(['image', 'pdf'])
    expect(plan.plottingWorkflow?.dataFigureHints.join(' ')).toContain('FigureStyleSpec')
    expect(plan.nextSciForgeActions.join(' ')).toContain('figure-style:extract')
    expect(plan.plottingWorkflow?.styleReference?.guardrails.join(' ')).toContain('do not copy original data')
  })

  it('keeps uninstalled plans free of executable install commands', async () => {
    const root = await tempDir()
    const index = await buildScientificSkillsIndex({
      workspaceRoot: root,
      env: {},
      homeDir: join(root, 'home')
    })

    expect(index.installHint).toContain('SciForge plugin page')
    expect(index.installHint).toContain(SCIENTIFIC_SKILLS_ENV_ROOT)
    expect(index.installHint).not.toContain('npx ')
    expect(index.installHint).not.toContain('outside SciForge')

    const plan = planScientificSkills(index, 'Need scientific plotting skills')
    expect(plan.installed).toBe(false)
    expect(plan.installHint).toContain('SciForge plugin page')
    expect(plan.installHint).toContain(SCIENTIFIC_SKILLS_ENV_ROOT)
    expect(plan.installHint).not.toContain('npx ')
    expect(plan.installHint).not.toContain('outside SciForge')
    expect(plan.installRecommendation).toMatchObject({
      recommended: true,
      requiresUserApproval: true
    })
    expect(plan.plottingWorkflow?.missingSkills).toContain('matplotlib')
    expect(JSON.stringify(plan)).not.toContain('npx ')
  })
})
