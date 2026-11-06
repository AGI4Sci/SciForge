import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
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
  const markers = ['BeforeQuestionMarker', 'SelectScopeMarker', 'AnsweredScopeMarker', 'AfterQuestionMarker', 'FollowupToolMarker', 'LiveFollowupMarker']
  for (const marker of markers) expect(html).toContain(marker)
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
