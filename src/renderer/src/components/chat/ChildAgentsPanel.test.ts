import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeChild } from '@shared/agent-runtime-contract'
import type { SideConversation } from '../../store/chat-store-types'
import {
  CHILD_AGENT_HISTORY_PAGE_SIZE,
  ChildAgentsPanelView,
  childAgentAttemptGroups,
  childAgentGroupBuckets,
  childAgentsPanelContextStateKey,
  mergeChildAgentPages,
  reloadChildAgentPageWindow,
  sessionChildAgentsOwner
} from './ChildAgentsPanel'

const labels: Record<string, string> = {
  sidebarChildren: 'Children',
  sidebarChildrenActive: 'Active',
  sidebarChildrenFilterActive: 'Show active child agents',
  sidebarChildrenRecent: 'Recent',
  sidebarChildrenHistory: 'History',
  sidebarChildrenFilterRecent: 'Show child agents from the current turn',
  sidebarChildrenFilterHistory: 'Show child agents from earlier turns',
  sidebarChildrenCurrentTurn: 'Current turn · {{turnId}}',
  sidebarChildrenHistoryTurns: 'Earlier child-agent turns',
  sidebarChildrenHistoryTurn: 'Turn · {{turnId}}',
  sidebarChildrenLoadMore: 'Load more history',
  sidebarChildrenLoadingMore: 'Loading more history',
  sidebarChildrenActiveEmpty: 'No child agents are active right now.',
  sidebarChildrenRecentEmpty: 'No completed child agents in the current turn.',
  sidebarChildrenHistoryCollapsed: 'Expand an earlier turn to view its child agents.',
  sidebarChildrenHistoryTruncated: 'Only the most recent 200 completed children are listed.',
  sidebarChildrenLoading: 'Loading children',
  sidebarChildrenLoadError: 'Unable to load children',
  sidebarChildrenNoThread: 'No active thread.',
  sidebarChildrenEmpty: 'No child agents yet.',
  sidebarChildrenNavigation: 'Child agent navigation',
  sidebarChildrenRoot: 'Main',
  sidebarChildrenViewNested: 'View child agents',
  sidebarChildrenOpenInFocus: 'Open in focus workspace',
  sidebarChildrenAttempt: 'attempt {{current}}/{{total}}',
  sidebarChildrenAttemptLabel: 'Attempt',
  sidebarChildrenShowAttemptHistory: 'Show {{count}} earlier attempt(s)',
  sidebarChildrenHideAttemptHistory: 'Hide earlier attempts',
  sidebarChildrenParentTurn: 'Parent turn',
  sidebarChildrenStartedAt: 'Started',
  sidebarChildrenChildId: 'Child ID',
  sidebarChildrenAbortedNotice: 'This attempt was cancelled and does not continue in the background.',
  sidebarChildrenDetail: 'details',
  sidebarChildrenCloseDetail: 'Close child details',
  sidebarChildrenStatus: 'Status',
  sidebarChildrenPrompt: 'Prompt',
  sidebarChildrenPromptEmpty: 'No prompt provided.',
  sidebarChildrenSummary: 'Summary',
  sidebarChildrenSummaryEmpty: 'No summary yet.',
  sidebarChildrenUsage: 'Usage',
  sidebarChildrenUsageUnavailable: 'No usage recorded',
  sidebarChildrenUsageTotal: '{{count}} total',
  sidebarChildrenUsageInput: '{{count}} input',
  sidebarChildrenUsageOutput: '{{count}} output',
  sidebarChildrenUsageReasoning: '{{count}} reasoning',
  sidebarChildrenUsageCost: '{{cost}}',
  sidebarChildrenOpenThread: 'Open thread',
  sidebarChildrenTranscriptLoading: 'Loading transcript',
  sidebarChildrenTranscriptError: 'Unable to load transcript',
  sidebarChildrenTranscriptUnavailable: 'Transcript is unavailable',
  sidebarChildrenTranscriptTitle: 'Transcript',
  sidebarChildrenTranscriptEmpty: 'No transcript entries yet.',
  sidebarChildrenKindAgent: 'Agent',
  sidebarChildrenKindWorkflow: 'Workflow',
  sidebarChildrenKindThread: 'Thread',
  sidebarChildrenKindRemote: 'Remote',
  sidebarChildrenStatusQueued: 'Queued',
  sidebarChildrenStatusRunning: 'Running',
  sidebarChildrenStatusCompleted: 'Completed',
  sidebarChildrenStatusFailed: 'Failed',
  sidebarChildrenStatusAborted: 'Aborted',
  sidebarChildrenStatusUnknown: 'Unknown',
  processed: 'Processed',
  processStepCount: '{{count}} steps',
  toolKindTool: 'Tool',
  rightPanelCollapse: 'Collapse right sidebar'
}

function t(key: string, opts?: Record<string, unknown>): string {
  return (labels[key] ?? key).replace(/\{\{(\w+)}}/g, (_, name: string) => String(opts?.[name] ?? ''))
}

function child(overrides: Partial<AgentRuntimeChild> = {}): AgentRuntimeChild {
  return {
    runtimeId: 'codex',
    parentThreadId: 'thread-main',
    id: 'child-research',
    kind: 'agent',
    name: 'research',
    status: 'running',
    prompt: 'Find recent papers',
    summary: 'Collecting sources',
    usage: {
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200
    },
    ...overrides
  }
}

function renderView(overrides: Partial<Parameters<typeof ChildAgentsPanelView>[0]> = {}): string {
  const props: Parameters<typeof ChildAgentsPanelView>[0] = {
    activeThreadId: 'thread-main',
    activeRuntimeId: 'codex',
    children: [child()],
    selectedChildId: null,
    loading: false,
    error: null,
    selectedSide: null,
    sideLoading: false,
    runtimeConnection: 'ready',
    composerPickList: ['deepseek-chat'],
    composerModelGroups: [],
    activeAgentRuntime: 'codex',
    runtimeCapabilities: {
      interrupt: true,
      stream: true,
      approvals: true,
      attachFiles: false
    },
    transcriptState: { status: 'idle' },
    onSelectChild: vi.fn(),
    onSideInputChange: vi.fn(),
    onSideSend: vi.fn(),
    onSideRemoveQueuedMessage: vi.fn(),
    onSideInterrupt: vi.fn(),
    onSideModelChange: vi.fn(),
    onSideReasoningEffortChange: vi.fn(),
    onCollapse: vi.fn(),
    t,
    ...overrides
  }
  return renderToStaticMarkup(createElement(ChildAgentsPanelView, props))
}

function side(overrides: Partial<SideConversation> = {}): SideConversation {
  return {
    threadId: 'thread-child',
    runtimeId: 'codex',
    parentThreadId: 'thread-main',
    source: 'child_agent',
    title: 'research',
    createdAt: '2026-06-27T08:00:00.000Z',
    inheritedAt: '2026-06-27T08:00:00.000Z',
    blocks: [
      { kind: 'user', id: 'user-1', text: 'Analyze the UI' },
      { kind: 'assistant', id: 'assistant-1', text: 'child-ok' }
    ],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 4,
    input: '',
    model: 'deepseek-chat',
    reasoningEffort: 'max',
    busy: false,
    turnId: null,
    userItemId: null,
    error: null,
    ...overrides
  }
}

describe('sessionChildAgentsOwner', () => {
  it('binds polling to the resident panel session instead of the globally focused session', () => {
    const sessionOne = sessionChildAgentsOwner('session-1', {
      id: 'session-1',
      runtimeId: 'codex',
      title: 'Session 1',
      updatedAt: '2026-07-18T00:00:00.000Z',
      model: 'gpt-5',
      mode: 'agent'
    })
    const sessionTwo = sessionChildAgentsOwner('session-2', {
      id: 'session-2',
      runtimeId: 'claude',
      title: 'Session 2',
      updatedAt: '2026-07-18T00:00:00.000Z',
      model: 'claude',
      mode: 'agent'
    })

    expect(sessionOne).toEqual({ activeThreadId: 'session-1', activeRuntimeId: 'codex' })
    expect(sessionTwo).toEqual({ activeThreadId: 'session-2', activeRuntimeId: 'claude' })
  })

  it('does not fall back to another session when the owner id is empty', () => {
    expect(sessionChildAgentsOwner('   ', null)).toEqual({
      activeThreadId: null,
      activeRuntimeId: undefined
    })
  })
})

describe('childAgentsPanelContextStateKey', () => {
  it('isolates duplicate child-agent panes owned by the same Session', () => {
    const first = childAgentsPanelContextStateKey({
      activeThreadId: 'session-1',
      surfaceId: 'pane-a'
    })
    const second = childAgentsPanelContextStateKey({
      activeThreadId: 'session-1',
      surfaceId: 'pane-b'
    })

    expect(first).not.toBe(second)
    expect(first).toContain('pane-a')
    expect(second).toContain('pane-b')
  })
})

describe('ChildAgentsPanelView', () => {
  it('shows direct children of the active thread as horizontal tabs in a right panel', () => {
    const html = renderView({
      children: [
        child(),
        child({
          id: 'child-other',
          parentThreadId: 'thread-other',
          name: 'hidden child',
          status: 'completed'
        })
      ]
    })

    expect(html).toContain('Children')
    expect(html).toContain('Collapse right sidebar')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('research')
    expect(html).toContain('Running')
    expect(html).toContain('Collecting sources')
    expect(html).not.toContain('hidden child')
  })

  it('renders an empty state instead of a blank panel', () => {
    const html = renderView({ children: [] })

    expect(html).toContain('No child agents yet.')
    expect(html).toContain('Children')
  })

  it('renders selected child context and usage above the transcript', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          summary: 'Found the best candidates',
          usage: {
            inputTokens: 456,
            outputTokens: 778,
            reasoningTokens: 12,
            totalTokens: 1234
          }
        })
      ]
    })

    expect(html).toContain('Completed')
    expect(html).toContain('Find recent papers')
    expect(html).toContain('Found the best candidates')
    expect(html).toContain('1,234 total')
    expect(html).toContain('456 input')
    expect(html).toContain('778 output')
  })

  it('keeps the transcript area as the bounded vertical scroll container', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          summary: 'A long child answer',
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ]
    })

    expect(html).toContain('flex min-h-0 flex-1 flex-col overflow-hidden')
    expect(html).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto')
  })

  it('renders a child transcript in chronological chat and process order without open-thread actions', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ],
      transcriptState: {
        status: 'loaded',
        childId: 'child-research',
        transcript: {
          runtimeId: 'codex',
          parentThreadId: 'thread-main',
          childId: 'child-research',
          entries: [
            { id: 'entry-user', kind: 'user_message', text: 'Analyze the UI' },
            { id: 'entry-reasoning', kind: 'reasoning', text: 'Inspecting the panel layout' },
            { id: 'entry-tool', kind: 'tool', summary: 'Read component files', status: 'completed' },
            { id: 'entry-assistant', kind: 'assistant_message', text: 'The panel is ready.' }
          ]
        }
      }
    })

    expect(html).toContain('Analyze the UI')
    expect(html).toContain('Processed')
    expect(html).toContain('2 steps')
    expect(html).toContain('Inspecting the panel layout')
    expect(html).toContain('Read component files')
    expect(html).toContain('The panel is ready.')
    expect(html).not.toContain('Open transcript')
    expect(html).not.toContain('Open thread')
  })

  it('hides injected child runtime guardrails from the visible transcript prompt', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'running',
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ],
      transcriptState: {
        status: 'loaded',
        childId: 'child-research',
        transcript: {
          runtimeId: 'codex',
          parentThreadId: 'thread-main',
          childId: 'child-research',
          entries: [
            {
              id: 'entry-user',
              kind: 'user_message',
              text: [
                'Child-agent runtime guardrails:',
                '- Work only inside the assigned workspace.',
                '',
                'Delegated task:',
                '',
                'Collect sources and summarize.'
              ].join('\n')
            }
          ]
        }
      }
    })

    expect(html).toContain('Collect sources and summarize.')
    expect(html).not.toContain('Child-agent runtime guardrails')
    expect(html).not.toContain('Work only inside the assigned workspace')
  })

  it('hides internal child tool-call markup and duplicate prompt entries', () => {
    const delegatedPrompt = 'Collect sources and summarize.'
    const guardrailedPrompt = [
      'Child-agent runtime guardrails:',
      '- Work only inside the assigned workspace.',
      '',
      'Delegated task:',
      '',
      delegatedPrompt
    ].join('\n')
    const internalMarkup = [
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="web_fetch">',
      '<｜｜DSML｜｜parameter name="url" string="true">[redacted-url]</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>'
    ].join('\n')
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          summary: internalMarkup,
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ],
      transcriptState: {
        status: 'loaded',
        childId: 'child-research',
        transcript: {
          runtimeId: 'codex',
          parentThreadId: 'thread-main',
          childId: 'child-research',
          entries: [
            { id: 'entry-user-seed', kind: 'user_message', text: guardrailedPrompt },
            {
              id: 'entry-call',
              kind: 'tool',
              summary: 'Call web_fetch',
              text: '{"url":"https://example.test/source","max_bytes":50000}',
              status: 'completed',
              metadata: { phase: 'call', callId: 'call-1', toolName: 'web_fetch' }
            },
            {
              id: 'entry-result',
              kind: 'tool',
              summary: 'web_fetch result',
              text: '{"title":"Example Source","url":"https://example.test/source","text":"large body omitted"}',
              status: 'completed',
              metadata: { phase: 'result', callId: 'call-1', toolName: 'web_fetch' }
            },
            { id: 'entry-internal', kind: 'assistant_message', text: internalMarkup },
            { id: 'entry-user-runtime', kind: 'user_message', text: guardrailedPrompt }
          ]
        }
      }
    })

    expect(html).toContain(delegatedPrompt)
    expect(html.match(new RegExp(delegatedPrompt, 'g'))).toHaveLength(1)
    expect(html).toContain('Processed')
    expect(html).toContain('1 steps')
    expect(html).toContain('Example Source')
    expect(html).not.toContain('DSML')
    expect(html).not.toContain('invoke name')
    expect(html).not.toContain('[redacted-url]')
    expect(html).not.toContain('large body omitted')
  })

  it('rewrites legacy collected-results fallback text before rendering', () => {
    const legacyFallback = [
      'Child agent gathered tool results, but the model kept emitting internal tool-call markup instead of a final answer.',
      'Usable collected results:',
      '- web_fetch: Qwen3 release notes (https://qwen.ai/blog/qwen3-2507)'
    ].join('\n')
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          summary: legacyFallback,
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ],
      transcriptState: {
        status: 'loaded',
        childId: 'child-research',
        transcript: {
          runtimeId: 'codex',
          parentThreadId: 'thread-main',
          childId: 'child-research',
          entries: [
            { id: 'entry-user', kind: 'user_message', text: 'Collect sources' },
            { id: 'entry-assistant', kind: 'assistant_message', text: legacyFallback }
          ]
        }
      }
    })

    expect(html).toContain('Collected research notes from available sources')
    expect(html).toContain('Sources reviewed')
    expect(html).toContain('Qwen3 release notes')
    expect(html).not.toContain('model kept emitting')
    expect(html).not.toContain('internal tool-call markup')
  })

  it('renders an attached child thread as a chat surface with a composer', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' },
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        })
      ],
      selectedSide: side()
    })

    expect(html).toContain('Analyze the UI')
    expect(html).toContain('child-ok')
    expect(html).toContain('<textarea')
    expect(html).not.toContain('Open thread')
  })

  it('presents busy child sends as steering and shows queued follow-ups', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        })
      ],
      runtimeCapabilities: {
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: false,
        steer: true
      },
      selectedSide: side({
        busy: true,
        input: 'Use the new evidence',
        queuedMessages: [
          {
            id: 'queued-1',
            text: 'Run the follow-up checks',
            model: 'deepseek-chat'
          }
        ]
      })
    })

    expect(html).toContain('Keep typing; sends inject into the current run')
    expect(html).toContain('Inject into current run')
    expect(html).toContain('Run the follow-up checks')
  })

  it('deduplicates native and event child records that open the same thread', () => {
    const html = renderView({
      children: [
        child({
          id: 'remote-call-1',
          name: 'clone-repo',
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        }),
        child({
          id: 'thread-child',
          name: 'clone-repo',
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        })
      ],
      selectedSide: side({ title: 'clone-repo' })
    })

    expect(html.match(/role="tab"/g)).toHaveLength(1)
    expect(html.match(/>clone-repo</g)).toHaveLength(1)
  })

  it('merges a prompt-only event shadow into the matching reasoning thread record', () => {
    const html = renderView({
      children: [
        child({
          id: 'child-event-shadow',
          name: 'writing-review',
          parentTurnId: 'turn-review',
          prompt: 'Child-agent runtime guardrails:\nDo not spawn children.\n\nDelegated task:\nReview the writing.',
          summary: 'Prompt-only event record'
        }),
        child({
          id: 'thread-writing-review',
          kind: 'thread',
          name: 'writing-review',
          parentTurnId: 'turn-review',
          prompt: 'Review the writing.',
          summary: undefined,
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-writing-review' },
          transcriptRef: { runtimeId: 'codex', childId: 'thread-writing-review', transcriptId: 'thread-writing-review' }
        })
      ],
      selectedSide: side({ threadId: 'thread-writing-review', title: 'writing-review' })
    })

    expect(html.match(/role="tab"/g)).toHaveLength(1)
    expect(html.match(/>writing-review</g)).toHaveLength(1)
    expect(html).toContain('child-ok')
    expect(html).not.toContain('Prompt-only event record')
  })

  it('keeps a same-name event when its delegated task differs from the reasoning thread', () => {
    const html = renderView({
      children: [
        child({
          id: 'child-event-methods',
          name: 'paper-review',
          parentTurnId: 'turn-review',
          prompt: 'Review the methods.'
        }),
        child({
          id: 'thread-writing-review',
          kind: 'thread',
          name: 'paper-review',
          parentTurnId: 'turn-review',
          prompt: 'Review the writing.',
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-writing-review' }
        })
      ]
    })

    expect(html.match(/role="tab"/g)).toHaveLength(2)
  })

  it('renders Active, Recent, and History as bounded list navigation', () => {
    const html = renderView({
      children: [
        child({ id: 'running-child', name: 'running-child', status: 'running' }),
        child({ id: 'completed-child', name: 'completed-child', status: 'completed', prompt: 'A different task' })
      ]
    })

    expect(html).toContain('aria-label="Show active child agents"')
    expect(html).toContain('aria-label="Show child agents from the current turn"')
    expect(html).toContain('aria-label="Show child agents from earlier turns"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('collapses distinct retries under the latest active attempt by default', () => {
    const html = renderView({
      children: [
        child({
          id: 'reader-first',
          name: 'read-ending',
          parentTurnId: 'turn-before-interrupt',
          status: 'aborted',
          createdAt: '2026-07-12T01:00:00.000Z'
        }),
        child({
          id: 'reader-restarted',
          name: 'read-ending',
          parentTurnId: 'turn-after-restart',
          status: 'running',
          createdAt: '2026-07-12T01:01:00.000Z'
        })
      ]
    })

    expect(html).toContain('read-ending · attempt 2/2')
    expect(html).not.toContain('read-ending · attempt 1/2')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Show 1 earlier attempt(s)"')
    expect(html.match(/role="tab"/g)).toHaveLength(1)
  })

  it('keeps an explicitly selected historical attempt visible and marks it aborted', () => {
    const html = renderView({
      selectedChildId: 'reader-first',
      children: [
        child({
          id: 'reader-first',
          name: 'read-ending',
          parentTurnId: 'turn-before-interrupt',
          status: 'aborted',
          createdAt: '2026-07-12T01:00:00.000Z'
        }),
        child({
          id: 'reader-restarted',
          name: 'read-ending',
          parentTurnId: 'turn-after-restart',
          status: 'running',
          createdAt: '2026-07-12T01:01:00.000Z'
        })
      ]
    })

    expect(html).toContain('read-ending · attempt 1/2')
    expect(html).toContain('read-ending · attempt 2/2')
    expect(html).toContain('aria-expanded="true"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('Aborted')
    expect(html).toContain('This attempt was cancelled and does not continue in the background.')
    expect(html).toContain('turn-before-interrupt')
    expect(html).toContain('reader-first')
    expect(html).toContain('Attempt')
  })

  it('does not group same-name children with different prompts as retries', () => {
    const html = renderView({
      children: [
        child({ id: 'reader-a', name: 'reader', prompt: 'Read methods' }),
        child({ id: 'reader-b', name: 'reader', prompt: 'Read results' })
      ]
    })

    expect(html).not.toContain('attempt')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
  })

  it('renders bounded breadcrumb navigation and a drill-down action in the same panel', () => {
    const html = renderView({
      children: [
        child({
          id: 'grandchild',
          parentThreadId: 'thread-child',
          name: 'reviewer',
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-grandchild' }
        })
      ],
      activeThreadId: 'thread-child',
      selectedChildId: 'grandchild',
      selectedSide: side({ threadId: 'thread-grandchild', parentThreadId: 'thread-child' }),
      navigationPath: [
        { threadId: 'thread-child', runtimeId: 'codex', label: 'clone-repo' }
      ],
      onNavigateToDepth: vi.fn(),
      onOpenSelectedChildren: vi.fn()
    })

    expect(html).toContain('aria-label="Child agent navigation"')
    expect(html).toContain('Main')
    expect(html).toContain('clone-repo')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('View child agents')
    expect(html).toContain('grid-cols-3')
  })

  it('offers a clear action to promote the selected child into the focus workspace', () => {
    const html = renderView({
      children: [child({
        openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
      })],
      selectedSide: side(),
      onOpenChildInFocus: vi.fn()
    })

    expect(html).toContain('Open in focus workspace')
    expect(html).toContain('title="Open in focus workspace"')
  })

  it('keeps Active children first while showing current-turn Recent children', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          id: 'completed-recent',
          name: 'completed-recent',
          status: 'completed',
          updatedAt: '2026-06-27T12:00:00.000Z'
        }),
        child({
          id: 'queued-child',
          name: 'queued-child',
          status: 'queued',
          updatedAt: '2026-06-27T09:00:00.000Z'
        }),
        child({
          id: 'running-child',
          name: 'running-child',
          status: 'running',
          updatedAt: '2026-06-27T08:00:00.000Z'
        })
      ]
    })

    expect(html.indexOf('running-child')).toBeLessThan(html.indexOf('queued-child'))
    expect(html.indexOf('queued-child')).toBeLessThan(html.indexOf('completed-recent'))
  })

  it('partitions active, current-turn, and historical groups without duplication', () => {
    const groups = childAgentAttemptGroups([
      child({ id: 'active', status: 'running', parentTurnId: 'turn-current' }),
      child({ id: 'recent', name: 'recent', prompt: 'recent', status: 'completed', parentTurnId: 'turn-current' }),
      child({ id: 'old-a', name: 'old-a', prompt: 'old-a', status: 'failed', parentTurnId: 'turn-old' }),
      child({ id: 'old-b', name: 'old-b', prompt: 'old-b', status: 'completed', parentTurnId: 'turn-old' })
    ])
    const buckets = childAgentGroupBuckets(groups, 'turn-current')

    expect(buckets.active.map((group) => group.primary.id)).toEqual(['active'])
    expect(buckets.recent.map((group) => group.primary.id)).toEqual(['recent'])
    expect(buckets.history).toHaveLength(1)
    expect(buckets.history[0]?.turnId).toBe('turn-old')
    expect(buckets.history[0]?.groups.map((group) => group.primary.id)).toEqual(['old-a', 'old-b'])
  })

  it('defaults to Recent while keeping Active visible and historical groups folded', () => {
    const onLoadMore = vi.fn()
    const html = renderView({
      currentTurnId: 'turn-current',
      children: [
        child({ id: 'active-child', name: 'active-child', status: 'running', parentTurnId: 'turn-current' }),
        child({ id: 'historical-child', name: 'historical-child', status: 'completed', parentTurnId: 'turn-old' })
      ],
      nextCursor: 'cursor-1',
      onLoadMore
    })

    expect(html).toContain('Current turn · turn-current')
    expect(html).toContain('Show child agents from earlier turns')
    expect(html).toContain('active-child')
    expect(html).not.toContain('historical-child')
    expect(html).not.toContain('Load more history')
    expect(html.match(/role="tab"/g)).toHaveLength(1)
  })

  it('deduplicates active records repeated by cursor pages and bounds a rendered page to 40', () => {
    const firstPage = Array.from({ length: CHILD_AGENT_HISTORY_PAGE_SIZE }, (_, index) => child({
      id: `child-${index}`,
      name: `child-${index}`,
      prompt: `task-${index}`,
      status: 'completed',
      parentTurnId: 'turn-current',
      updatedAt: `2026-08-19T00:00:${String(index).padStart(2, '0')}.000Z`
    }))
    const merged = mergeChildAgentPages([
      firstPage,
      [child({ id: 'active-repeat', status: 'running' }), child({ id: 'child-0', status: 'completed' })],
      [child({ id: 'active-repeat', status: 'running' })]
    ])
    const html = renderView({ currentTurnId: 'turn-current', children: firstPage })

    expect(merged.filter((entry) => entry.id === 'active-repeat')).toHaveLength(1)
    expect(merged.filter((entry) => entry.id === 'child-0')).toHaveLength(1)
    expect(html.match(/role="tab"/g)).toHaveLength(CHILD_AGENT_HISTORY_PAGE_SIZE)
  })

  it('rebuilds loaded history pages from the refreshed first-page cursor', async () => {
    const requestedCursors: Array<string | undefined> = []
    const pages = await reloadChildAgentPageWindow(async ({ cursor }) => {
      requestedCursors.push(cursor)
      if (!cursor) {
        return {
          runtimeId: 'codex',
          threadId: 'thread-main',
          children: [child({ id: 'new-child', status: 'completed' })],
          nextCursor: 'refreshed-boundary'
        }
      }
      return {
        runtimeId: 'codex',
        threadId: 'thread-main',
        children: [child({ id: 'boundary-child', status: 'completed' })]
      }
    }, 2)

    expect(requestedCursors).toEqual([undefined, 'refreshed-boundary'])
    expect(pages.flatMap((page) => page.children).map((entry) => entry.id)).toEqual([
      'new-child',
      'boundary-child'
    ])
  })
})
