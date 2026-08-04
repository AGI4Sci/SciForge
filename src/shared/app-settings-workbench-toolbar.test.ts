import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH,
  WORKBENCH_TOOLBAR_MAX_COMMANDS,
  mergeWorkbenchToolbarSettings,
  normalizeWorkbenchToolbarSettings
} from './app-settings-workbench-toolbar'

describe('Workbench toolbar settings', () => {
  it('trims, deduplicates, bounds, and drops invalid command IDs', () => {
    const normalized = normalizeWorkbenchToolbarSettings({
      hiddenCommandIds: [
        ' paper-radar.open ',
        'paper-radar.open',
        '',
        'x'.repeat(WORKBENCH_TOOLBAR_COMMAND_ID_MAX_LENGTH + 1),
        ...Array.from(
          { length: WORKBENCH_TOOLBAR_MAX_COMMANDS + 10 },
          (_, index) => `plugin-${index}.open`
        )
      ],
      commandOrder: ['remote-ssh.open', ' remote-ssh.open ', 'browser-preview.open']
    })

    expect(normalized.hiddenCommandIds).toHaveLength(WORKBENCH_TOOLBAR_MAX_COMMANDS)
    expect(normalized.hiddenCommandIds[0]).toBe('paper-radar.open')
    expect(normalized.commandOrder).toEqual([
      'remote-ssh.open',
      'browser-preview.open'
    ])
  })

  it('merges partial updates without discarding the other preference list', () => {
    expect(mergeWorkbenchToolbarSettings({
      hiddenCommandIds: ['paper-radar.open'],
      commandOrder: ['remote-ssh.open', 'paper-radar.open']
    }, {
      hiddenCommandIds: []
    })).toEqual({
      hiddenCommandIds: [],
      commandOrder: ['remote-ssh.open', 'paper-radar.open']
    })
  })
})
