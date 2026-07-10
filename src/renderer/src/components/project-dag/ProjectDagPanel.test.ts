import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDagPanel } from './ProjectDagPanel'

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
  projectDagUpdate: 'Update project',
  projectDagUpdating: 'Updating',
  projectDagUpdateHelp: 'Run compute and update the current project Goal tree and graph',
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
    expect(html).toContain('Update project')
    expect(html).toContain('aria-label="Run compute and update the current project Goal tree and graph"')
  })
})
