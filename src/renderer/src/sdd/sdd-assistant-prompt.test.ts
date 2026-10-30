import { describe, expect, it } from 'vitest'
import { composeSddAssistantPrompt } from './sdd-assistant-prompt'

const DRAFT_PATH = '.sciforge/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md'

describe('composeSddAssistantPrompt', () => {
  it('includes draft context and keeps the user-facing prompt separate', () => {
    const prompt = composeSddAssistantPrompt({
      workspaceRoot: '/tmp/app',
      draftRelativePath: DRAFT_PATH,
      draftMarkdown: '# Requirement\n\n![flow](../../img/flow.png)',
      userPrompt: '帮我澄清边界'
    })

    expect(prompt).toContain('Workspace: /tmp/app')
    expect(prompt).toContain(`Draft file: ${DRAFT_PATH}`)
    expect(prompt).toContain('```markdown\n# Requirement\n\n![flow](../../img/flow.png)\n```')
    expect(prompt).toContain('User request:\n帮我澄清边界')
    expect(prompt).toContain('edit the draft file directly')
  })

  it('marks an empty draft explicitly', () => {
    expect(
      composeSddAssistantPrompt({
        workspaceRoot: '/tmp/app',
        draftRelativePath: DRAFT_PATH,
        draftMarkdown: '   ',
        userPrompt: 'what is missing?'
      })
    ).toContain('```markdown\n(empty draft)\n```')
  })
})
