// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const bridge = vi.hoisted(() => ({ readLatestSessionFailure: vi.fn() }))
vi.mock('../../store/chat-session-admission', () => bridge)
import { useSessionFailure } from './use-session-failure'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => { resolve = value })
  return { promise, resolve }
}

it('fences delayed failure facts by exact runtime/thread and refreshes after terminal activity', async () => {
  const first = deferred<unknown>()
  const second = deferred<unknown>()
  bridge.readLatestSessionFailure.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(null)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Fixture(props: Parameters<typeof useSessionFailure>[0]) {
    const fact = useSessionFailure(props)
    return <p>{fact?.receipt.clientDirectiveId ?? 'none'}</p>
  }
  const input = { runtimeId: 'codex', threadId: 'A', runtimeReady: true, refreshKey: 1, busy: false }
  await act(async () => root.render(<Fixture {...input} />))
  await act(async () => root.render(<Fixture {...input} threadId="B" />))
  expect(container.textContent).toBe('none')
  await act(async () => second.resolve({ receipt: { clientDirectiveId: 'failure-B' } }))
  expect(container.textContent).toBe('failure-B')
  await act(async () => first.resolve({ receipt: { clientDirectiveId: 'stale-failure-A' } }))
  expect(container.textContent).toBe('failure-B')
  await act(async () => root.render(<Fixture {...input} threadId="B" refreshKey={2} />))
  expect(container.textContent).toBe('none')
  await act(async () => root.render(<Fixture {...input} threadId="B" refreshKey={3} busy />))
  expect(container.textContent).toBe('none')
  expect(bridge.readLatestSessionFailure.mock.calls.map(([ref]) => ref)).toEqual([
    { runtimeId: 'codex', threadId: 'A' }, { runtimeId: 'codex', threadId: 'B' }, { runtimeId: 'codex', threadId: 'B' }
  ])
  await act(async () => root.unmount())
  container.remove()
})

it('refreshes a live stop after optimistic idle and a stale stream sequence when the exact terminal snapshot arrives', async () => {
  bridge.readLatestSessionFailure.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ receipt: {
    clientDirectiveId: 'stopped-input', turnId: 'stopped-turn', execution: 'cancelled' } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Fixture(props: Parameters<typeof useSessionFailure>[0]) {
    const fact = useSessionFailure(props)
    return <p>{fact?.receipt.clientDirectiveId ?? 'none'}</p>
  }
  const input = { runtimeId: 'codex', threadId: 'task-thread', runtimeReady: true, refreshKey: 50,
    latestTurnId: 'stopped-turn', latestTurnStatus: 'running' }
  await act(async () => root.render(<Fixture {...input} busy />))
  // Stop clears renderer busy before the native interrupt and ledger settlement finish.
  await act(async () => root.render(<Fixture {...input} busy={false} />))
  expect(container.textContent).toBe('none')
  expect(bridge.readLatestSessionFailure).toHaveBeenCalledTimes(1)
  // The stream was aborted, so its sequence stays at 50; refreshThreads supplies the final snapshot.
  await act(async () => root.render(<Fixture {...input} latestTurnStatus="cancelled" busy={false} />))
  expect(container.textContent).toBe('stopped-input')
  expect(bridge.readLatestSessionFailure).toHaveBeenCalledTimes(2)
  await act(async () => root.unmount())
  container.remove()
})

it.each(['cancelled', 'running'])('reconciles an idle renderer with a %s snapshot until Host validation settles and then stops reading', async latestTurnStatus => {
  vi.useFakeTimers()
  bridge.readLatestSessionFailure.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ receipt: {
    clientDirectiveId: 'confirmed-stop', turnId: 'stopped-turn', execution: 'cancelled' } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Fixture() {
    const fact = useSessionFailure({ runtimeId: 'codex', threadId: 'task-thread', runtimeReady: true,
      refreshKey: 50, busy: false, latestTurnId: 'stopped-turn', latestTurnStatus })
    return <p>{fact?.receipt.clientDirectiveId ?? 'none'}</p>
  }
  try {
    await act(async () => root.render(<Fixture />))
    expect(container.textContent).toBe('none')
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(container.textContent).toBe('none')
    await act(async () => vi.advanceTimersByTimeAsync(250))
    expect(container.textContent).toBe('confirmed-stop')
    expect(bridge.readLatestSessionFailure).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(bridge.readLatestSessionFailure).toHaveBeenCalledTimes(3)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  }
})

it.each([
  { label: 'stale completed summary', latestTurnId: 'old-completed-turn', latestTurnStatus: 'completed' },
  { label: 'missing summary metadata', latestTurnId: undefined, latestTurnStatus: undefined }
])('uses the latest Host directive after live stop with $label', async ({ latestTurnId, latestTurnStatus }) => {
  vi.useFakeTimers()
  bridge.readLatestSessionFailure.mockReset().mockResolvedValueOnce(null).mockResolvedValue({ receipt: {
    clientDirectiveId: 'new-confirmed-stop', turnId: 'new-stopped-turn', execution: 'cancelled' } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Fixture() {
    const fact = useSessionFailure({ runtimeId: 'codex', threadId: 'task-thread', runtimeReady: true,
      refreshKey: 50, busy: false, latestTurnId, latestTurnStatus })
    return <p>{fact?.receipt.clientDirectiveId ?? 'none'}</p>
  }
  try {
    await act(async () => root.render(<Fixture />))
    expect(container.textContent).toBe('none')
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(container.textContent).toBe('new-confirmed-stop')
    expect(bridge.readLatestSessionFailure).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  }
})
