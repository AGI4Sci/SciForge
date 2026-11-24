import { expect, it } from 'vitest'
import { removeComposerContextReference } from './composer-context-references'

it('removes exact references but preserves longer identifiers and surrounding prose', () => {
  expect(removeComposerContextReference('Read tsk_one, not tsk_one_more or prefix_tsk_one.', 'tsk_one'))
    .toBe('Read , not tsk_one_more or prefix_tsk_one.')
  expect(removeComposerContextReference('Use [task:1] here.', '[task:1]')).toBe('Use  here.')
})
