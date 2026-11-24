// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import { MessageTimeline } from './MessageTimeline'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const original = useChatStore.getState()
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useChatStore.setState({ workspaceRoot: '/isolated', activeThreadId: 'quiet', busy: false,
    currentTurnUserId: null, threads: [], conversationSourceNavigation: null })
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); useChatStore.setState(original, true)
})

const blocks: ChatBlock[] = [
  { kind: 'user', id: 'user', turnId: 'turn', text: 'Compare the results' },
  { kind: 'assistant', id: 'progress', text: 'I am comparing both measurements.' },
  { kind: 'reasoning', id: 'reasoning', text: 'TechnicalReasoningMarker' },
  { kind: 'tool', id: 'read', status: 'success', summary: 'InternalReadMarker' },
  { kind: 'tool', id: 'run', status: 'running', summary: 'InternalRunMarker' }
]
async function render(items = blocks, processing = true, live = 'The first comparison is ready.') {
  await act(async () => root.render(<MessageTimeline blocks={items} live={live} liveReasoning=""
    activeThreadId="quiet" busyOverride={processing} runtimeConnection="ready"
    onRetryConnection={() => undefined} onOpenSettings={() => undefined} />))
}
function disclosure() { return container.querySelector<HTMLButtonElement>('button[aria-expanded]')! }

it('keeps readable progress and live output while technical work is opt-in during execution', async () => {
  await render()
  expect(container.textContent).toContain('I am comparing both measurements.')
  expect(container.textContent).toContain('The first comparison is ready.')
  expect(container.textContent).not.toContain('InternalReadMarker')
  expect(container.textContent).not.toContain('InternalRunMarker')
  expect(container.textContent).not.toContain('TechnicalReasoningMarker')
  expect(disclosure().getAttribute('aria-expanded')).toBe('false')
  expect(disclosure().textContent).not.toContain('steps')
  expect(container.textContent?.split(i18n.t('common:working'))).toHaveLength(2)
  await act(async () => disclosure().click())
  expect(container.textContent).toContain('InternalReadMarker')
  expect(container.textContent).toContain('InternalRunMarker')
  await act(async () => disclosure().click())
  expect(container.textContent).not.toContain('InternalReadMarker')
})

it('keeps failures, warnings, permission requests and user questions outside the folded process', async () => {
  await render([...blocks,
    { kind: 'tool', id: 'failed', status: 'error', summary: 'ComparisonFailedMarker', detail: 'Input file missing.' },
    { kind: 'compaction', id: 'compact-failed', status: 'error', summary: 'CompactionFailedMarker' },
    { kind: 'system', id: 'warning', severity: 'warning', text: 'ConnectionWarningMarker' },
    { kind: 'approval', id: 'approval', approvalId: 'approval', status: 'pending', summary: 'PermissionNeededMarker' },
    { kind: 'user_input', id: 'question', requestId: 'request', status: 'pending', questions: [
      { id: 'scope', header: '', question: 'WhichScopeMarker', options: [] }
    ] }
  ])
  for (const marker of ['ComparisonFailedMarker', 'CompactionFailedMarker', 'ConnectionWarningMarker', 'PermissionNeededMarker', 'WhichScopeMarker'])
    expect(container.textContent).toContain(marker)
  expect(container.textContent).toContain(i18n.t('common:userInputPending'))
  expect(container.textContent).not.toContain(i18n.t('common:working'))
  expect(container.textContent).not.toContain('InternalReadMarker')
})

it('finishing a turn leaves its answer visible and keeps the chosen process disclosure', async () => {
  await render()
  await act(async () => disclosure().click())
  await render([...blocks.slice(0, -1), { kind: 'assistant', id: 'answer', text: 'The measurements differ under the same conditions.' }], false, '')
  expect(container.textContent).toContain('The measurements differ under the same conditions.')
  expect(disclosure().getAttribute('aria-expanded')).toBe('true')
  await act(async () => disclosure().click())
  expect(container.textContent).not.toContain('InternalReadMarker')
  expect(container.textContent).not.toContain('I am comparing both measurements.')
  expect(container.textContent).toContain('The measurements differ under the same conditions.')
})
