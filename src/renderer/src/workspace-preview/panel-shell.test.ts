import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  type WorkspaceObservation,
  type WorkspacePreviewFileState,
  type WorkspacePreviewSession
} from '@shared/workspace-preview'
import { createWorkspacePreviewHostState } from './host'
import {
  createRendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry
} from './registry'
import {
  WorkspacePreviewPanelShell,
  type WorkspacePreviewPanelShellContext,
  workspacePreviewOpenInputForPanelTarget,
  workspacePreviewPanelTargetKey
} from './WorkspacePreviewPanelShell'

function requireDescriptor(
  registry: RendererWorkspacePreviewRegistry,
  path: string
): RendererWorkspacePreviewPluginDescriptor {
  const descriptor = registry.resolve({ path })
  if (!descriptor) throw new Error(`Expected descriptor for ${path}`)
  return descriptor
}

function createSession(
  descriptor: RendererWorkspacePreviewPluginDescriptor,
  file: WorkspacePreviewFileState
): WorkspacePreviewSession {
  return {
    id: 'session-1',
    pluginId: descriptor.manifest.id,
    workspaceRoot: file.workspaceRoot,
    path: file.path,
    modality: descriptor.manifest.modality,
    mode: 'preview',
    openedAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    mtimeMs: file.mtimeMs
  }
}

describe('WorkspacePreviewPanelShell', () => {
  it('derives stable target keys and host open inputs from legacy file targets', () => {
    const target = {
      path: 'data/samples.csv',
      workspaceRoot: ' /workspace/lab ',
      line: 2,
      column: 4
    }

    expect(workspacePreviewPanelTargetKey(target, '/fallback')).toBe(
      '/workspace/lab\u0000data/samples.csv\u00002\u00004'
    )
    expect(workspacePreviewOpenInputForPanelTarget(target, '/fallback')).toEqual({
      path: 'data/samples.csv',
      workspaceRoot: '/workspace/lab'
    })
  })

  it('renders deferred state through shared chrome before the legacy body opens', () => {
    const html = renderToStaticMarkup(createElement(
      WorkspacePreviewPanelShell,
      {
        target: { path: 'mesh.vtk', workspaceRoot: '/workspace/lab' },
        workspaceRoot: '/workspace/lab'
      },
      createElement('div', { 'data-legacy-preview-body': 'true' }, 'Legacy body')
    ))

    expect(html).toContain('data-workspace-preview-chrome')
    expect(html).toContain('data-status="error"')
    expect(html).toContain('Preview deferred')
    expect(html).toContain('data-legacy-preview-body="true"')
  })

  it('wraps preview body slots without top metadata while keeping inspector hidden by default', () => {
    const registry = createRendererWorkspacePreviewRegistry()
    const descriptor = requireDescriptor(registry, 'data/samples.csv')
    const file: WorkspacePreviewFileState = {
      workspaceRoot: '/workspace/lab',
      path: '/workspace/lab/data/samples.csv',
      relativePath: 'data/samples.csv',
      mimeType: 'text/csv',
      size: 128,
      mtimeMs: 1783468800000
    }
    const observation: WorkspaceObservation = {
      schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
      file,
      view: {
        pluginId: descriptor.manifest.id,
        modality: descriptor.manifest.modality,
        mode: 'preview',
        title: 'samples.csv'
      },
      tables: [{ id: 'table-1', name: 'samples', rowCount: 3, columnCount: 2 }],
      actions: ['workspace.setSelection', 'tabular.updateCell']
    }
    const state = createWorkspacePreviewHostState({
      session: createSession(descriptor, file),
      descriptor,
      file,
      observation
    })

    const html = renderToStaticMarkup(createElement(
      WorkspacePreviewPanelShell,
      {
        target: { path: 'data/samples.csv', workspaceRoot: '/workspace/lab' },
        workspaceRoot: '/workspace/lab',
        initialState: state,
        children: ({ assetStatus }: WorkspacePreviewPanelShellContext) =>
          createElement('div', { 'data-shell-status': assetStatus }, 'Preview body')
      }
    ))

    expect(html).toContain('data-status="ready"')
    expect(html).not.toContain('Workspace preview breadcrumb')
    expect(html).not.toContain('data-action-id="workspace.setSelection"')
    expect(html).not.toContain('data-action-id="tabular.updateCell"')
    expect(html).toContain('data-inspector-open="false"')
    expect(html).not.toContain('Workspace preview inspector')
    expect(html).not.toContain('3 rows x 2 columns')
    expect(html).toContain('data-shell-status="idle"')
  })
})
