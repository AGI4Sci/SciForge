import { describe, expect, it, vi } from 'vitest'
import {
  disposeSessionRightPanelWorkspace,
  rekeySessionRightPanelWorkspace,
  subscribeSessionRightPanelDisposals,
  subscribeSessionRightPanelRekeys
} from './session-right-panel-lifecycle'
import { EMPTY_GUI_PLAN_SESSION, useGuiPlanStore } from '../plan/plan-store'

describe('session right-panel lifecycle', () => {
  it('disposes only the explicitly removed session and supports unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionRightPanelDisposals(listener)

    disposeSessionRightPanelWorkspace(' session-1 ')
    disposeSessionRightPanelWorkspace('')
    unsubscribe()
    disposeSessionRightPanelWorkspace('session-2')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('session-1')
  })

  it('releases the disposed session plan namespace', () => {
    useGuiPlanStore.setState({
      sessions: {
        'session-1': { ...EMPTY_GUI_PLAN_SESSION, content: 'one' },
        'session-2': { ...EMPTY_GUI_PLAN_SESSION, content: 'two' }
      }
    })

    disposeSessionRightPanelWorkspace('session-1')

    expect(useGuiPlanStore.getState().sessions).toEqual({
      'session-2': { ...EMPTY_GUI_PLAN_SESSION, content: 'two' }
    })
    useGuiPlanStore.getState().clearAllSessions()
  })

  it('publishes one normalized rekey notification and supports unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionRightPanelRekeys(listener)

    rekeySessionRightPanelWorkspace(' session-1 ', ' session-promoted ')
    rekeySessionRightPanelWorkspace('', 'session-ignored')
    rekeySessionRightPanelWorkspace('same-session', ' same-session ')
    unsubscribe()
    rekeySessionRightPanelWorkspace('session-2', 'session-promoted-2')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('session-1', 'session-promoted')
  })
})
