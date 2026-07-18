import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  PROJECT_DAG_REVIEW_VIEW,
  ProjectDagPanel,
  consumeProjectDagInitialClaim,
  consumeProjectDagInitialNode,
  parseProjectSessionList,
  projectDagFrameUrl,
  projectDagProgressPercent,
  projectDagReviewRequest,
  projectDagUpdateScope
} from './ProjectDagPanel'

const labels: Record<string, string> = {
  projectDagPanelTitle: 'Project evidence',
  dagRuntimeToggle: 'Toggle DAG background processing',
  dagRuntimeToggleHelp: 'Shared DAG switch',
  dagRuntimeEnabled: 'DAG on',
  dagRuntimeDisabled: 'DAG off',
  dagRuntimeSaving: 'Applying',
  dagRuntimeLoading: 'Checking DAG status',
  dagRuntimeLoadFailed: 'Could not read DAG settings',
  dagRuntimePausedTitle: 'DAG background processing is paused',
  dagRuntimePausedDescription: 'Turn it on to resume.',
  projectDagCurrentProject: 'Current project: molclaw',
  projectDagGlobalView: 'Current project',
  projectDagReviewSurface: 'Project evidence review',
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
  projectDagSettings: 'Settings',
  projectDagScopeIncludedCount: '1 included',
  projectDagScopeHelp: 'Remove an ID and update to include it again.',
  projectDagExcludedSessions: 'Excluded sessions',
  projectDagIsolatedSessions: 'Isolated sessions',
  projectDagSessionListPlaceholder: 'codex:thread-id',
  rightPanelCollapse: 'Collapse right sidebar'
}

const enabledDagRuntime = {
  enabled: true,
  saving: false,
  error: null,
  setEnabled: vi.fn()
} as const

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key
  })
}))

describe('ProjectDagPanel', () => {
  it('restores a returned Claim without dropping the sidecar token', () => {
    expect(projectDagFrameUrl(
      'http://127.0.0.1:3898/?view=home#token=secret',
      'claim:target'
    )).toBe('http://127.0.0.1:3898/?view=home&claim=claim%3Atarget#token=secret')
  })

  it('restores an opaque graph node ahead of the legacy Claim fallback', () => {
    expect(projectDagFrameUrl(
      'http://127.0.0.1:3898/?view=home#token=secret',
      'claim:source',
      'evidence:source-1'
    )).toBe('http://127.0.0.1:3898/?view=home&claim=claim%3Asource&node=evidence%3Asource-1#token=secret')
    expect(projectDagFrameUrl(
      'http://127.0.0.1:3898/?view=home#token=secret',
      undefined,
      'evidence source'
    )).toBe('http://127.0.0.1:3898/?view=home#token=secret')
  })

  it('consumes a restored Claim once after the initial frame load', () => {
    const pendingClaim = { current: 'claim:target' as string | undefined }

    expect(consumeProjectDagInitialClaim(pendingClaim)).toBe('claim:target')
    expect(pendingClaim.current).toBeUndefined()
    expect(consumeProjectDagInitialClaim(pendingClaim)).toBeUndefined()
    expect(projectDagFrameUrl(
      'http://127.0.0.1:3898/?view=home#token=secret',
      pendingClaim.current
    )).toBe('http://127.0.0.1:3898/?view=home#token=secret')
  })

  it('consumes a restored graph node once after the initial frame load', () => {
    const pendingNode = { current: 'evidence:source-1' as string | undefined }

    expect(consumeProjectDagInitialNode(pendingNode)).toBe('evidence:source-1')
    expect(pendingNode.current).toBeUndefined()
    expect(consumeProjectDagInitialNode(pendingNode)).toBeUndefined()
  })

  it('uses one combined review surface instead of mutually exclusive tabs', () => {
    expect(PROJECT_DAG_REVIEW_VIEW).toBe('home')
    expect(projectDagReviewRequest({
      workspaceRoot: '/tmp/molclaw',
      projectRoot: '/tmp/molclaw'
    })).toEqual({
      view: 'home',
      workspaceRoot: '/tmp/molclaw',
      projectRoot: '/tmp/molclaw'
    })

    const html = renderToStaticMarkup(createElement(ProjectDagPanel, {
      workspaceRoot: '/tmp/molclaw',
      ownerSessionId: 'session-1',
      onCollapse: vi.fn(),
      dagRuntimeControl: enabledDagRuntime
    }))

    expect(html).not.toContain('aria-pressed=')
    expect(html).not.toContain('projectDagEvidenceTab')
    expect(html).not.toContain('projectDagGraphTab')
    expect(html).toContain('Settings')
    expect(html).toContain('group shrink-0 border-b')
    expect(html).toContain('min-h-8')
    expect(html).toContain('sm:px-4')
  })

  it('renders a visible current-project update action', () => {
    const html = renderToStaticMarkup(createElement(ProjectDagPanel, {
      workspaceRoot: '/tmp/molclaw',
      ownerSessionId: 'session-1',
      onCollapse: vi.fn(),
      dagRuntimeControl: enabledDagRuntime
    }))

    expect(html).toContain('Project evidence')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-label="Toggle DAG background processing"')
    expect(html).toContain('Update now')
    expect(html).toContain('aria-label="Queue an end-to-end update to the captured project scope"')
    expect(html).toContain('Autonomous')
    expect(html).toContain('Settings')
    expect(html).toContain('Session scope')
    expect(html).toContain('Excluded sessions')
    expect(html).toContain('Isolated sessions')
  })

  it('shows the shared runtime switch instead of a service error when DAG processing is paused', () => {
    const html = renderToStaticMarkup(createElement(ProjectDagPanel, {
      workspaceRoot: '/tmp/molclaw',
      ownerSessionId: 'session-1',
      onCollapse: vi.fn(),
      dagRuntimeControl: {
        enabled: false,
        saving: false,
        error: null,
        setEnabled: vi.fn()
      }
    }))

    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('DAG background processing is paused')
    expect(html).not.toContain('Could not load project evidence')
  })

  it('keeps the retained panel rendered while it has background priority', () => {
    const html = renderToStaticMarkup(createElement(ProjectDagPanel, {
      workspaceRoot: '/tmp/molclaw',
      ownerSessionId: 'session-1',
      active: false,
      onCollapse: vi.fn(),
      dagRuntimeControl: enabledDagRuntime
    }))

    expect(html).toContain('Project evidence')
    expect(html).toContain('Update now')
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
