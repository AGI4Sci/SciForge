import { describe, expect, it } from 'vitest'
import { installedRendererContributions } from './installed-renderer-contributions'
import {
  moveWorkbenchToolbarAction,
  orderWorkbenchToolbarActions,
  resetWorkbenchToolbarPreferences,
  setWorkbenchToolbarActionVisible,
  visibleWorkbenchToolbarActions
} from './workbench-toolbar-preferences'

const actions = installedRendererContributions.toolbarActions.list()

function commandIds(
  candidates: ReturnType<typeof installedRendererContributions.toolbarActions.list>
): string[] {
  return candidates.map(({ contribution }) => contribution.commandId)
}

describe('Workbench toolbar preferences', () => {
  it('uses registry order by default and appends unmentioned installed actions', () => {
    const defaults = commandIds(actions)
    expect(commandIds(orderWorkbenchToolbarActions(actions))).toEqual(defaults)

    expect(commandIds(orderWorkbenchToolbarActions(actions, {
      hiddenCommandIds: [],
      commandOrder: ['remote-ssh.open', 'missing.open']
    }))).toEqual([
      'remote-ssh.open',
      ...defaults.filter((commandId) => commandId !== 'remote-ssh.open')
    ])
  })

  it('adds and removes placement without changing the registered action set', () => {
    const hidden = setWorkbenchToolbarActionVisible(
      resetWorkbenchToolbarPreferences(),
      'paper-radar.open',
      false
    )
    expect(commandIds(visibleWorkbenchToolbarActions(actions, hidden)))
      .not.toContain('paper-radar.open')
    expect(commandIds(actions)).toContain('paper-radar.open')

    const visible = setWorkbenchToolbarActionVisible(
      hidden,
      'paper-radar.open',
      true
    )
    expect(commandIds(visibleWorkbenchToolbarActions(actions, visible)))
      .toContain('paper-radar.open')
  })

  it('reorders installed actions while retaining absent-package preferences', () => {
    const initial = {
      hiddenCommandIds: ['temporarily-missing.open'],
      commandOrder: ['temporarily-missing.open', 'remote-ssh.open', 'paper-radar.open']
    }
    const moved = moveWorkbenchToolbarAction(
      actions,
      initial,
      'paper-radar.open',
      -1
    )

    expect(moved.hiddenCommandIds).toContain('temporarily-missing.open')
    expect(moved.commandOrder[0]).toBe('temporarily-missing.open')
    expect(commandIds(orderWorkbenchToolbarActions(actions, moved)).slice(0, 2)).toEqual([
      'paper-radar.open',
      'remote-ssh.open'
    ])
  })
})
