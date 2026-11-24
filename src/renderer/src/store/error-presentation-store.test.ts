import { beforeEach, expect, it } from 'vitest'
import { errorPresentationIdentity, useErrorPresentationStore } from './error-presentation-store'

beforeEach(() => useErrorPresentationStore.setState({ dismissed: {} }))

it('keeps dismissal stable for refreshed diagnostics but shows changed errors and new failed turns', () => {
  const identity = (session = 'A', runtime = 'codex', detail = 'upstream timeout', turn = 'turn-1'): string =>
    errorPresentationIdentity(runtime, session, 'runtime', 'Request failed', detail, turn)
  useErrorPresentationStore.getState().dismiss(identity())
  const isDismissed = (key: string): boolean => useErrorPresentationStore.getState().dismissed[key] === true
  expect(isDismissed(identity())).toBe(true)
  expect(isDismissed(identity('B'))).toBe(false)
  expect(isDismissed(identity('A', 'dsh'))).toBe(false)
  expect(isDismissed(identity('A', 'codex', 'permission denied'))).toBe(false)
  expect(isDismissed(identity('A', 'codex', 'upstream timeout', 'turn-2'))).toBe(false)
  expect(isDismissed(identity())).toBe(true)
})

it('resets presentation only for the runtime and session starting an explicit new attempt', () => {
  const current = errorPresentationIdentity('codex', 'A', 'runtime', 'same failure')
  const receipt = errorPresentationIdentity('codex', 'A', 'session-input', 'failed-input')
  const otherSession = errorPresentationIdentity('codex', 'B', 'runtime', 'same failure')
  const otherRuntime = errorPresentationIdentity('dsh', 'A', 'runtime', 'same failure')
  for (const key of [current, receipt, otherSession, otherRuntime]) useErrorPresentationStore.getState().dismiss(key)
  useErrorPresentationStore.getState().beginAttempt('codex', 'A')
  expect(useErrorPresentationStore.getState().dismissed).toEqual({ [otherSession]: true, [otherRuntime]: true })
})
