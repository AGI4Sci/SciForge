import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ProjectDagPanel,
  parseProjectSessionList,
  projectDagProgressPercent,
  projectDagUpdateScope
} from './ProjectDagPanel'

const labels: Record<string, string> = {
  projectDagPanelTitle: 'Project evidence',
  projectDagCurrentProject: 'Current project: molclaw',
  projectDagGlobalView: 'Current project',
  projectDagEvidenceSurface: 'Evidence status',
  projectDagEvidenceTab: 'Evidence',
  projectDagGraphTab: 'Graph',
  projectDagGoalTitle: 'Project goal',
  projectDagGoalUnset: 'No goal pinned',
  projectDagEditGoal: 'Edit goal',
  projectDagRefresh: 'Refresh project evidence',
  projectDagUpdate: 'Update now',
  projectDagUpdating: 'Updating',
  projectDagUpdateHelp: 'Queue an end-to-end update to the captured project scope',
  projectDagAutonomyMode: 'Autonomy',
  projectDagAutonomous: 'Autonomous',
  projectDagCheckpointed: 'Checkpointed',
  projectDagSupervised: 'Supervised',
  projectDagScopeDispositions: 'Session scope',
  projectDagScopeIncludedCount: '1 included',
  projectDagScopeHelp: 'Remove an ID and update to include it again.',
  projectDagExcludedSessions: 'Excluded sessions',
  projectDagIsolatedSessions: 'Isolated sessions',
  projectDagSessionListPlaceholder: 'codex:thread-id',
  rightPanelCollapse: 'Collapse right sidebar'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key
  })
}))

describe('ProjectDagPanel', () => {
  it('renders a visible current-project update action', () => {
    const html = renderToStaticMarkup(createElement(ProjectDagPanel, {
      workspaceRoot: '/tmp/molclaw',
      onCollapse: vi.fn()
    }))

    expect(html).toContain('Project evidence')
    expect(html).toContain('Update now')
    expect(html).toContain('aria-label="Queue an end-to-end update to the captured project scope"')
    expect(html).toContain('Autonomous')
    expect(html).toContain('Session scope')
    expect(html).toContain('Excluded sessions')
    expect(html).toContain('Isolated sessions')
  })

  it('normalizes editable session dispositions without project-specific rules', () => {
    expect(parseProjectSessionList(' codex:b\ncodex:a, codex:b ')).toEqual(['codex:a', 'codex:b'])
  })

  it('updates the committed project scope instead of widening to every workspace thread', () => {
    expect(projectDagUpdateScope({
      freshness: 'fresh',
      pendingCount: 0,
      scope: {
        includedSessions: ['codex:included'],
        excludedSessions: ['codex:excluded'],
        isolatedSessions: ['codex:isolated']
      }
    })).toEqual(['codex:excluded', 'codex:included', 'codex:isolated'])
    expect(projectDagUpdateScope(undefined)).toBe('all')
  })

  it('reports monotonic progress across the durable update stages', () => {
    expect(projectDagProgressPercent({
      stage: 'capturing', completedItems: 0, totalItems: 4
    })).toBe(8)
    expect(projectDagProgressPercent({
      stage: 'evidence', completedItems: 2, totalItems: 4
    })).toBe(39)
    expect(projectDagProgressPercent({
      stage: 'project', completedItems: 4, totalItems: 4
    })).toBe(68)
    expect(projectDagProgressPercent({
      stage: 'compile', completedItems: 4, totalItems: 4
    })).toBe(86)
  })
})
