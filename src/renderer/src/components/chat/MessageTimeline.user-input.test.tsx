// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { MessageTimeline } from './MessageTimeline'
import { installedRendererContributions } from '../../domain-modules/installed-renderer-contributions'
import i18n from '../../i18n'

it.each(['pending', 'error', 'submitted', 'cancelled'] as const)('shows truthful progress for %s questions', (status) => {
  const html = renderToStaticMarkup(<MessageTimeline
    blocks={[
      { id: 'user', kind: 'user', text: 'Proceed', turnId: 'turn' },
      { id: 'question', kind: 'user_input', requestId: 'request', questions: [], status }
    ]}
    activeThreadId="thread" live="" liveReasoning="" busyOverride runtimeConnection="ready"
    onRetryConnection={() => {}} onOpenSettings={() => {}}
  />)
  const waiting = status === 'pending' || status === 'error'
  expect(html).toContain(i18n.t(waiting ? 'common:userInputPending' : 'common:working'))
  expect(html).not.toContain(i18n.t(waiting ? 'common:working' : 'common:userInputPending'))
})

it('keeps submitted answers between the preceding and subsequent runtime messages', () => {
  const html = renderToStaticMarkup(<MessageTimeline
    blocks={[
      { id: 'user', kind: 'user', text: 'Proceed', turnId: 'turn' },
      { id: 'before', kind: 'assistant', text: 'BeforeQuestionMarker' },
      { id: 'question', kind: 'user_input', requestId: 'request',
        questions: [{ id: 'q', header: '', question: 'SelectScopeMarker', options: [] }],
        answers: [{ id: 'q', label: 'Answer', value: 'AnsweredScopeMarker' }], status: 'submitted' },
      { id: 'after', kind: 'assistant', text: 'AfterQuestionMarker' },
      { id: 'tool-after', kind: 'tool', summary: 'FollowupToolMarker', status: 'running' }
    ]}
    activeThreadId="thread" live="LiveFollowupMarker" liveReasoning="" busyOverride runtimeConnection="ready"
    onRetryConnection={() => {}} onOpenSettings={() => {}}
  />)
  const markers = ['BeforeQuestionMarker', 'SelectScopeMarker', 'AnsweredScopeMarker', 'AfterQuestionMarker', 'LiveFollowupMarker']
  for (const marker of markers) expect(html).toContain(marker)
  expect(html).not.toContain('FollowupToolMarker')
  for (let i = 1; i < markers.length; i++) expect(html.indexOf(markers[i - 1])).toBeLessThan(html.indexOf(markers[i]))
})


it.each([true, false])('anchors future modality panels to their source with work expanded/collapsed (active: %s)', (active) => {
  const registration = installedRendererContributions.chatResultPanels.register({
    ownerId: 'test-modality',
    contribution: {
      id: 'test-modality.inline', placement: 'after-item',
      render: ({ anchor, blocks }) => anchor.kind === 'item' && anchor.itemId === 'media'
        ? <div>FutureModalityMarker:{blocks.length}</div> : null
    }
  })
  const summary = installedRendererContributions.chatResultPanels.register({
    ownerId: 'test-summary',
    contribution: { id: 'test-summary.end', placement: 'turn-end', render: ({ anchor }) =>
      anchor.kind === 'turn-end' ? <div>TurnSummaryMarker</div> : null }
  })
  try {
    const html = renderToStaticMarkup(<MessageTimeline
      blocks={[
        { id: 'user', kind: 'user', text: 'Proceed', turnId: 'turn' },
        { id: 'media', kind: 'tool', summary: 'Produced media', status: 'success' },
        { id: 'question', kind: 'user_input', requestId: 'request',
          questions: [{ id: 'q', header: '', question: 'LaterQuestionMarker', options: [] }], status: 'pending' }
      ]}
      activeThreadId="thread" live="" liveReasoning="" busyOverride={active} runtimeConnection="ready"
      onRetryConnection={() => {}} onOpenSettings={() => {}}
    />)
    expect(html).toContain('FutureModalityMarker:1')
    expect(html.indexOf('FutureModalityMarker')).toBeLessThan(html.indexOf('LaterQuestionMarker'))
    expect(html.indexOf('LaterQuestionMarker')).toBeLessThan(html.indexOf('TurnSummaryMarker'))
  } finally {
    registration.dispose()
    summary.dispose()
  }
})


it.each([true, false])('renders a generated image before subsequent questions while active=%s', (active) => {
  const html = renderToStaticMarkup(<MessageTimeline
    blocks={[
      { id: 'user', kind: 'user', text: 'Proceed', turnId: 'turn' },
      { id: 'image', kind: 'tool', summary: 'Created figure', status: 'success',
        meta: { generatedImages: [{ path: '/tmp/InlineFigureMarker.png', previewUrl: 'data:image/png;base64,aGVsbG8=' }] } },
      { id: 'question', kind: 'user_input', requestId: 'request',
        questions: [{ id: 'q', header: '', question: 'AfterImageQuestionMarker', options: [] }], status: 'submitted' }
    ]}
    activeThreadId="thread" live="" liveReasoning="" busyOverride={active} runtimeConnection="ready"
    onRetryConnection={() => {}} onOpenSettings={() => {}}
  />)
  expect(html).toContain('InlineFigureMarker')
  expect(html.indexOf('InlineFigureMarker')).toBeLessThan(html.indexOf('AfterImageQuestionMarker'))
})

it('allows a side conversation questionnaire to open using its owning transcript', async () => {
  const { useChatStore } = await import('../../store/chat-store')
  const previous = useChatStore.getState()
  const block = { id: 'side-question', kind: 'user_input' as const, requestId: 'side-request',
    questions: [], status: 'pending' as const }
  const presenter = installedRendererContributions.userInput!
  const render = vi.spyOn(presenter, 'render')
  useChatStore.setState({
    blocks: [],
    sideConversations: { child: { ...previous.sideConversations.child, threadId: 'child', blocks: [block] } }
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MessageTimeline blocks={[block]}
      activeThreadId="child" live="" liveReasoning="" busyOverride runtimeConnection="ready"
      onRetryConnection={() => {}} onOpenSettings={() => {}} />))
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'side-request', active: true, autoOpen: true }))
    const trigger = [...container.querySelectorAll('button')].find((button) =>
      button.textContent === i18n.t('userDecisions:answerQuestions', { count: 0 }))
    expect(trigger).toBeDefined()
    await act(async () => trigger!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    render.mockRestore()
    useChatStore.setState(previous)
  }
})
