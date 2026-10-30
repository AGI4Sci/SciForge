import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SddAssistantToggleButton } from './SddDraftEditorView'

describe('SddDraftEditorView', () => {
  it('renders a control to reopen the Requirement AI panel', () => {
    const html = renderToStaticMarkup(
      createElement(SddAssistantToggleButton, {
        assistantOpen: false,
        onToggleAssistant: () => undefined,
        label: 'Requirement AI'
      })
    )

    expect(html).toContain('aria-label="Requirement AI"')
  })
})
