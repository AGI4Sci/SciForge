import assert from 'node:assert/strict'
import test from 'node:test'
import { History, LibraryBig } from 'lucide-react'
import type { ReactElement } from 'react'

import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import {
  RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  createResearchDossierCommand,
  createResearchDossierResourceNavigationContribution,
  type ResearchDossierRightPanelContribution
} from './index.js'

test('resolves exact generic resources to package-owned dossier activation', () => {
  const navigation = createResearchDossierResourceNavigationContribution()
  assert.deepEqual(navigation.resolve({
    sessionId: 'session-1',
    resource: {
      resourceKind: 'artifact-version',
      resourceId: 'artifact-version:figure:2',
      integrity: {
        algorithm: 'sha256',
        expectedDigest: `sha256:${'a'.repeat(64)}`
      }
    }
  }), {
    activation: {
      revision: 1,
      payload: {
        contractVersion: 1,
        target: {
          kind: 'artifact-version',
          versionId: 'artifact-version:figure:2'
        },
        page: 'overview',
        expectedDigest: `sha256:${'a'.repeat(64)}`
      }
    }
  })
  assert.equal(navigation.resolve({
    sessionId: 'session-1',
    resource: {
      resourceKind: 'unknown',
      resourceId: 'unknown:1'
    }
  }), null)
})

test('one distinct toolbar action opens the session-owned dossier panel', async () => {
  const opened: unknown[] = []
  const host = {
    capabilityInvoker: {},
    workbench: { openRightPanel: (input: unknown) => opened.push(input) }
  } as unknown as DomainRendererHost
  const command = createResearchDossierCommand(host)
  assert.equal(command.isAvailable?.({
    sessionId: 'session-1',
    workspaceRoot: '/workspace/lab'
  }), true)
  await command.execute({
    sessionId: 'session-1',
    workspaceRoot: '/workspace/lab',
    payload: {
      contractVersion: 1,
      target: { kind: 'compute-run', runId: 'compute-run:plot-1' },
      page: 'overview'
    }
  })
  assert.deepEqual(opened, [{
    contributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
    sessionId: 'session-1',
    activation: {
      contributionId: RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id,
      revision: 1,
      payload: {
        contractVersion: 1,
        target: { kind: 'compute-run', runId: 'compute-run:plot-1' },
        page: 'overview'
      }
    }
  }])

  const entry = createDomainRendererEntry(host)
  const panel = entry.contributions.find(
    ({ id }) => id === RESEARCH_DOSSIER_RENDERER_RIGHT_PANEL_CONTRIBUTION.id
  )?.value as ResearchDossierRightPanelContribution
  const rendered = panel.render({
    active: true,
    className: 'dossier-panel',
    focused: false,
    onCollapse: () => undefined,
    session: { id: 'session-1', workspaceRoot: '/workspace/lab' },
    surfaceId: 'surface-dossier-a'
  }) as ReactElement<Record<string, unknown>>
  assert.equal(rendered.props.surfaceId, 'surface-dossier-a')

  const toolbar = entry.contributions.find(
    ({ id }) => id === RESEARCH_DOSSIER_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id
  )
  assert.ok(toolbar && 'icon' in toolbar.value)
  assert.equal(toolbar.value.icon, LibraryBig)
  assert.notEqual(toolbar.value.icon, History)
  assert.equal(entry.contributions.filter(({ kind }) =>
    kind === 'renderer.workbench-toolbar-action').length, 1)
})
