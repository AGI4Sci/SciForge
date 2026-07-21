import { describe, expect, it } from 'vitest'
import {
  scientificSkillsRootSourceLabel,
  scientificSkillsRootSourceTitle,
  skillMarketplaceItemsFromDiscoveredSkills
} from './PluginMarketplaceView'

describe('skillMarketplaceItemsFromDiscoveredSkills', () => {
  it('turns discovered project and global skills into personal marketplace items', () => {
    const items = skillMarketplaceItemsFromDiscoveredSkills([
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
