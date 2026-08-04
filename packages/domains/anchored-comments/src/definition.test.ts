import { describe, expect, it } from 'vitest'
import {
  ANCHORED_COMMENTS_COMMAND_CONTRIBUTION,
  ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION,
  ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION,
  ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION,
  domainPackageDefinition
} from './definition'

describe('Anchored Comments package definition', () => {
  it('owns the command, toolbar placement, global overlay, and composer provider', () => {
    expect(domainPackageDefinition.publisher?.id).toBe('sciforge')
    expect(domainPackageDefinition.module.id).toBe('sciforge.anchored-comments')
    expect([
      ANCHORED_COMMENTS_COMMAND_CONTRIBUTION.kind,
      ANCHORED_COMMENTS_TOOLBAR_CONTRIBUTION.kind,
      ANCHORED_COMMENTS_OVERLAY_CONTRIBUTION.kind,
      ANCHORED_COMMENTS_COMPOSER_CONTEXT_CONTRIBUTION.kind
    ]).toEqual([
      'renderer.command',
      'renderer.workbench-toolbar-action',
      'renderer.workbench-global-overlay',
      'renderer.composer-context-provider'
    ])
  })
})
