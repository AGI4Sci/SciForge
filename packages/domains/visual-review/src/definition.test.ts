import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import {
  VISUAL_REVIEW_CAPABILITY_FACTORY_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_I18N_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT,
  VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT,
  VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION,
  domainPackageDefinition
} from './definition.js'

describe('Visual Review domain definition', () => {
  it('declares one package-owned main capability entry and renderer surface', () => {
    expect(domainPackageDefinition.packageName).toBe('@sciforge/domain-visual-review')
    expect(domainPackageDefinition.module.id).toBe('sciforge.visual-review')
    expect(VISUAL_REVIEW_CAPABILITY_FACTORY_CONTRIBUTION.id).toBe(
      'visual-review.capabilities'
    )
    expect(VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRIBUTION.id).toBe(
      'visual-review.workbench-right-panel'
    )
    expect(VISUAL_REVIEW_RENDERER_COMMAND_CONTRIBUTION.id).toBe('visual-review.open')
    expect(VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRIBUTION.id).toBe(
      'visual-review.workbench-toolbar-action'
    )
    expect(VISUAL_REVIEW_RENDERER_I18N_CONTRIBUTION.id).toBe(
      'visual-review.translations'
    )
  })

  it('keeps the manifest activation contracts generic and exact', () => {
    expect(VISUAL_REVIEW_RENDERER_RIGHT_PANEL_CONTRACT).toEqual({
      location: 'workbench.right-panel',
      title: 'visualReviewPanelTitle',
      resourceKind: 'visual-review-document'
    })
    expect(VISUAL_REVIEW_RENDERER_TOOLBAR_ACTION_CONTRACT).toEqual({
      location: 'workbench.topbar',
      commandId: 'visual-review.open',
      label: 'rightPanelVisualReview',
      group: {
        id: 'workbench.review',
        label: 'workbenchToolGroupReview'
      }
    })
  })

  it('does not import host-private renderer, main, or shared implementation paths', async () => {
    const sourceRoot = new URL('./', import.meta.url)
    const files = (await readdir(sourceRoot, { recursive: true }))
      .filter((file) => /\.(?:ts|tsx)$/u.test(file) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
    const contents = await Promise.all(
      files.map((file) => readFile(new URL(file, sourceRoot), 'utf8'))
    )
    const forbidden = [
      ['@', 'shared'].join(''),
      ['@', 'renderer'].join(''),
      ['window', '.sciforge'].join(''),
      ['src', '/main'].join(''),
      ['src', '/renderer'].join(''),
      ['src', '/shared'].join('')
    ]
    for (const pattern of forbidden) {
      expect(contents.some((source) => source.includes(pattern)), pattern).toBe(false)
    }
  })
})
