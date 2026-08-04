import { describe, expect, it } from 'vitest'
import {
  RECOMMENDED_SKILL_ITEMS,
  scientificSkillsRootSourceLabel,
  scientificSkillsRootSourceTitle,
  skillCatalogItemsFromDiscoveredSkills
} from './PluginMarketplaceView'

describe('recommended skill catalog', () => {
  it('contains only real skill install candidates and no fake extension entry', () => {
    expect(RECOMMENDED_SKILL_ITEMS.length).toBeGreaterThan(0)
    expect(RECOMMENDED_SKILL_ITEMS.every((item) => item.kind === 'skill')).toBe(true)
    expect(RECOMMENDED_SKILL_ITEMS.some((item) => item.id === 'paper-radar')).toBe(false)
  })
})

describe('skillCatalogItemsFromDiscoveredSkills', () => {
  it('turns discovered project and global skills into personal catalog items', () => {
    const items = skillCatalogItemsFromDiscoveredSkills([
      {
        id: 'openspec-apply-change',
        name: 'Openspec Apply Change',
        description: 'Implement tasks from an OpenSpec change.',
        root: '/workspace/.codex/skills/openspec-apply-change',
        entryPath: '/workspace/.codex/skills/openspec-apply-change/SKILL.md',
        scope: 'project',
        legacy: true
      },
      {
        id: 'remotion-best-practices',
        name: 'Remotion Best Practices',
        description: 'Best practices for Remotion.',
        root: '/Users/demo/.agents/skills/remotion-best-practices',
        entryPath: '/Users/demo/.agents/skills/remotion-best-practices/SKILL.md',
        scope: 'global',
        legacy: true
      }
    ], { project: 'Project', global: 'Global' })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'openspec-apply-change',
        group: 'personal',
        title: 'Openspec Apply Change',
        sourceLabel: 'Project'
      }),
      expect.objectContaining({
        id: 'remotion-best-practices',
        group: 'personal',
        title: 'Remotion Best Practices',
        sourceLabel: 'Global'
      })
    ])
  })
})

describe('scientific skills root display labels', () => {
  const labels: Record<string, string> = {
    pluginScientificSkillsRootEnv: 'ENV',
    pluginScientificSkillsRootWorkspaceAgents: 'Workspace .agents',
    pluginScientificSkillsRootWorkspaceSkills: 'Workspace skills',
    pluginScientificSkillsRootGlobalAgents: 'Global .agents'
  }
  const t = (key: string): string => labels[key] ?? key

  it('keeps current roots path-addressable', () => {
    expect(scientificSkillsRootSourceLabel('global-agents', t)).toBe('Global .agents')
    expect(scientificSkillsRootSourceTitle('global-agents', '/Users/demo/.agents/skills', t)).toBe(
      '/Users/demo/.agents/skills'
    )
  })

  it('falls back to unknown source ids without adding legacy root labels', () => {
    expect(scientificSkillsRootSourceLabel('custom-source', t)).toBe('custom-source')
    expect(scientificSkillsRootSourceTitle('custom-source', '/tmp/custom', t)).toBe('/tmp/custom')
  })
})
