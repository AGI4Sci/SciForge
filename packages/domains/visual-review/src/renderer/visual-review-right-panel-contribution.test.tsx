import type { ReactElement } from 'react'
import type { DomainRendererHost } from '@sciforge/domain-sdk/host'
import type { DomainRendererCommandHandler } from '@sciforge/domain-sdk/renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION
} from '../definition.js'
import {
  createDomainRendererEntry,
  type VisualReviewRightPanelContribution
} from './visual-review-right-panel-contribution.js'

describe('Visual Review renderer entry', () => {
  it('opens artifacts through the same command used by the toolbar', async () => {
    const invoked: Array<{ actionId: string; input: unknown; workspaceId?: string }> = []
    const openedPanels: unknown[] = []
    const host: DomainRendererHost = {
      capabilityInvoker: {
        observe: async () => {
          throw new Error('not observed')
        },
        invoke: async (contract, input, options) => {
          invoked.push({
            actionId: contract.actionId,
            input,
            workspaceId: options?.workspaceId
          })
          return {
            ok: true,
            status: 'created',
            workspaceRoot: '/workspace',
            document: { documentId: 'figure-1' },
            paths: {}
          } as never
        }
      },
      openExternal: () => undefined,
      workbench: {
        openRightPanel: (input) => openedPanels.push(input),
        sendMessage: vi.fn()
      }
    }
    const entry = createDomainRendererEntry(host)
    const command = entry.contributions.find(({ kind }) =>
      kind === VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION.kind
    )!.value as DomainRendererCommandHandler

    await command.execute({
      sessionId: 'session-1',
      workspaceRoot: '/workspace',
      payload: {
        documentId: 'figure-1',
        artifact: {
          kind: 'generated_image',
          sourcePath: 'outputs/figure.png'
        },
        refreshKey: 7
      }
    })

    expect(invoked).toEqual([{
      actionId: 'visual-review.open',
      input: {
        documentId: 'figure-1',
        artifact: {
          kind: 'generated_image',
          sourcePath: 'outputs/figure.png'
        }
      },
      workspaceId: '/workspace'
    }])
    expect(openedPanels).toEqual([{
      contributionId: 'visual-review.workbench-right-panel',
      sessionId: 'session-1',
      activation: {
        contributionId: 'visual-review.workbench-right-panel',
        revision: 1,
        payload: {
          documentId: 'figure-1',
          refreshKey: 7
        }
      }
    }])
  })

  it('lets the toolbar choose an image through the public workspace host', async () => {
    const invoked: unknown[] = []
    const openedPanels: unknown[] = []
    const pickFile = vi.fn(async () => ({
      canceled: false,
      path: '/workspace/figure.png'
    }))
    const host = {
      capabilityInvoker: {
        observe: vi.fn(),
        invoke: async (contract: { actionId: string }, input: unknown) => {
          invoked.push({ actionId: contract.actionId, input })
          return {
            ok: true,
            status: 'created',
            workspaceRoot: '/workspace',
            document: { documentId: 'opened-document' },
            paths: {}
          }
        }
      },
      openExternal: vi.fn(),
      workspace: { pickFile },
      workbench: {
        openRightPanel: (input: unknown) => openedPanels.push(input)
      }
    } as unknown as DomainRendererHost
    const entry = createDomainRendererEntry(host)
    const command = entry.contributions.find(({ kind }) =>
      kind === VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION.kind
    )!.value as DomainRendererCommandHandler

    await command.execute({
      sessionId: 'session-1',
      workspaceRoot: '/workspace'
    })

    expect(pickFile).toHaveBeenCalledWith({
      title: 'Open image for Visual Review',
      defaultPath: '/workspace',
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg']
      }]
    })
    expect(invoked).toEqual([{
      actionId: 'visual-review.open',
      input: {
        documentId: expect.stringMatching(/^visual-/),
        artifact: {
          kind: 'image',
          sourcePath: '/workspace/figure.png'
        }
      }
    }])
    expect(openedPanels).toEqual([expect.objectContaining({
      contributionId: 'visual-review.workbench-right-panel',
      sessionId: 'session-1'
    })])
  })

  it('renders only package-owned panel props and repeats manifest contracts', () => {
    const host: DomainRendererHost = {
      capabilityInvoker: {
        observe: async () => {
          throw new Error('not observed')
        },
        invoke: async () => {
          throw new Error('not invoked while rendering the lazy panel')
        }
      },
      openExternal: () => undefined,
      workbench: {
        openRightPanel: vi.fn(),
        sendMessage: vi.fn()
      }
    }
    const entry = createDomainRendererEntry(host)
    const panelRuntime = entry.contributions.find(({ kind }) =>
      kind === VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.kind
    )!
    const panel = panelRuntime.value as VisualReviewRightPanelContribution
    expect(Object.keys(panel)).toEqual(['render'])
    const rendered = panel.render({
      active: true,
      className: 'panel',
      focused: true,
      onCollapse: vi.fn(),
      surfaceId: 'surface-visual-a',
      session: {
        id: 'session-1',
        workspaceRoot: '/workspace'
      },
      activation: {
        revision: 1,
        payload: { documentId: 'figure-1', refreshKey: 3 }
      }
    }) as ReactElement<Record<string, unknown>>

    expect(panelRuntime.contract).toEqual(VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT)
    expect(rendered.props).toMatchObject({
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      documentId: 'figure-1',
      refreshKey: 3,
      className: 'panel'
    })

    const toolbarRuntime = entry.contributions.find(({ kind }) =>
      kind === VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.kind
    )!
    expect(toolbarRuntime.contract).toEqual(VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT)
    expect(toolbarRuntime.value).toEqual({
      icon: expect.anything()
    })

    expect(() => panel.render({
      active: true,
      className: 'panel',
      focused: true,
      onCollapse: vi.fn(),
      surfaceId: 'surface-visual-a',
      session: {
        id: 'session-1',
        workspaceRoot: '/workspace'
      },
      activation: {
        revision: 1,
        payload: { documentId: '' }
      }
    })).toThrow()
  })
})
