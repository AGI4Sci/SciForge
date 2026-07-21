import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

function renderHero(options: {
  remoteChannelMode?: boolean
  ready?: boolean
  hasWorkspace?: boolean
  runtimeError?: string | null
  runtimeId?: 'codex' | 'claude'
} = {}): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      remoteChannelMode: options.remoteChannelMode ?? false,
      ready: options.ready ?? true,
      hasWorkspace: options.hasWorkspace ?? true,
      runtimeError: options.runtimeError ?? null,
      runtimeId: options.runtimeId ?? 'codex',
      activeRemoteChannel: null,
      onPickWorkspace: () => undefined,
      onRetry: () => undefined,
      onOpenSettings: () => undefined,
      onSelectSuggestion: () => undefined
    })
  )
}

describe('MessageTimeline initial heatmap empty hero routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the unified usage panel for eligible initial chat states', () => {
    const html = renderHero()

    expect(html).toContain('ds-initial-usage-heatmap')
    expect(html).toContain('ds-usage-command-center')
    expect(html).toContain('Codex activity pulse')
    expect(html).not.toContain('Preparing your usage calendar')
    expect(html).not.toContain('Start a new conversation')
  })

  it('uses the same panel with the active Claude runtime label', () => {
    const html = renderHero({ runtimeId: 'claude' })

    expect(html).toContain('ds-usage-command-center')
    expect(html).toContain('Claude Code activity pulse')
    expect(html).not.toContain('Codex activity pulse')
  })

  it('keeps offline, missing-workspace, and remote-channel empty states gated away from the heatmap', () => {
    const offlineHtml = renderHero({ ready: false })
    expect(offlineHtml).toContain('SciForge is waking the local agent')
    expect(offlineHtml).toContain('ds-runtime-wake-logo')
    expect(offlineHtml).toContain('ds-work-logo')
    expect(renderHero({ hasWorkspace: false })).toContain('Choose working directory')
    const clawHtml = renderHero({ remoteChannelMode: true })
    expect(clawHtml).toContain('Start a conversation with this assistant')
    expect(clawHtml).toContain('ds-remote-channel-empty-logo')
    expect(clawHtml).toContain('ds-work-logo')
    expect(clawHtml).not.toContain('ds-initial-usage-heatmap')
  })

  it('shows the runtime error in the offline hero when one is available', () => {
    const html = renderHero({
      ready: false,
      runtimeError: i18n.t('common:runtimePortConflict')
    })

    expect(html).toContain('The runtime port is already in use.')
  })
})
