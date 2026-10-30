import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuiPlanArtifact,
  guiPlanMatchesContext,
  guiPlanSession,
  guiPlanSessionGeneration,
  useGuiPlanStore
} from './plan-store'

function planFor(ownerSessionId: string, relativePath: string) {
  return createGuiPlanArtifact({
    workspaceRoot: '/tmp/app',
    threadId: ownerSessionId,
    relativePath,
    sourceRequest: relativePath,
    now: 1
  })
}

describe('plan-store', () => {
  beforeEach(() => {
    useGuiPlanStore.getState().clearAllSessions()
  })

  afterEach(() => {
    vi.useRealTimers()
    useGuiPlanStore.getState().clearAllSessions()
  })

  it('creates artifacts with shared plan id and relative path normalization', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: 'C:\\Users\\Codex\\APP\\',
      threadId: 'thread-a',
      relativePath: '.sciforge\\plan\\Checkout.md',
      sourceRequest: 'checkout',
      now: 1
    })

    expect(plan).toMatchObject({
      id: 'C:/Users/Codex/APP:.sciforge/plan/checkout.md',
      workspaceRoot: 'C:/Users/Codex/APP',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/Checkout.md',
      featureName: 'checkout'
    })
  })

  it('keeps plan content, save state, and errors independent by owner Session', () => {
    const planA = planFor('thread-a', '.sciforge/plan/a.md')
    const planB = planFor('thread-b', '.sciforge/plan/b.md')
    const store = useGuiPlanStore.getState()

    store.setActivePlan('thread-a', planA, '# A')
    store.setActivePlan('thread-b', planB, '# B')
    store.setContent('thread-a', '# A dirty')
    store.setOperationStatus('thread-b', 'error', 'B failed')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a')).toMatchObject({
      activePlan: { id: planA.id, threadId: 'thread-a' },
      content: '# A dirty',
      saveStatus: 'dirty',
      operationStatus: 'ready',
      error: null
    })
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-b')).toMatchObject({
      activePlan: { id: planB.id, threadId: 'thread-b' },
      content: '# B',
      saveStatus: 'saved',
      operationStatus: 'error',
      error: 'B failed'
    })
  })

  it('attributes an activated plan to the namespace owner', () => {
    const incorrectlyAttributed = planFor('thread-stale', '.sciforge/plan/a.md')
    useGuiPlanStore.getState().setActivePlan('thread-a', incorrectlyAttributed, '# A')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a').activePlan?.threadId)
      .toBe('thread-a')
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-stale').activePlan).toBeNull()
  })

  it('does not let a delayed save mutate another plan or overwrite newer content', () => {
    const planA = planFor('thread-a', '.sciforge/plan/a.md')
    const planB = planFor('thread-b', '.sciforge/plan/b.md')
    const store = useGuiPlanStore.getState()
    store.setActivePlan('thread-a', planA, '# A old')
    store.setActivePlan('thread-b', planB, '# B')
    store.setContent('thread-a', '# A new')

    store.markSaved('thread-a', planA.id, '# A old')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a')).toMatchObject({
      content: '# A new',
      lastSavedContent: '# A old',
      saveStatus: 'dirty'
    })
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-b')).toMatchObject({
      content: '# B',
      saveStatus: 'saved'
    })
  })

  it('updates timestamps only inside the addressed owner namespace', () => {
    const planA = planFor('thread-a', '.sciforge/plan/a.md')
    const planB = planFor('thread-b', '.sciforge/plan/b.md')
    const store = useGuiPlanStore.getState()
    store.setActivePlan('thread-a', planA, '# A')
    store.setActivePlan('thread-b', planB, '# B')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))

    store.markSaved('thread-a', planA.id, '# A')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a').activePlan?.updatedAt)
      .toBe('2026-01-02T03:04:05.000Z')
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-b').activePlan?.updatedAt)
      .toBe(planB.updatedAt)
  })

  it('releases only the removed Session state', () => {
    const store = useGuiPlanStore.getState()
    store.setActivePlan('thread-a', planFor('thread-a', '.sciforge/plan/a.md'), '# A')
    store.setActivePlan('thread-b', planFor('thread-b', '.sciforge/plan/b.md'), '# B')

    store.removeSession('thread-a')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a').activePlan).toBeNull()
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-b').content).toBe('# B')
  })

  it('advances the owner generation when a Session is disposed', () => {
    const store = useGuiPlanStore.getState()
    const before = guiPlanSessionGeneration('thread-a')
    store.removeSession('thread-a')

    expect(guiPlanSessionGeneration('thread-a')).toBe(before + 1)
  })

  it('moves one Session namespace while preserving every other owner', () => {
    const store = useGuiPlanStore.getState()
    const planA = planFor('thread-a', '.sciforge/plan/a.md')
    const planB = planFor('thread-b', '.sciforge/plan/b.md')
    store.setActivePlan('thread-a', planA, '# A')
    store.setContent('thread-a', '# A dirty')
    store.setOperationStatus('thread-a', 'error', 'A failed')
    store.setActivePlan('thread-b', planB, '# B')
    const sessionB = guiPlanSession(useGuiPlanStore.getState(), 'thread-b')
    const previousGeneration = guiPlanSessionGeneration('thread-a')

    store.moveSession(' thread-a ', ' thread-promoted ')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-a')).toBe(
      guiPlanSession(useGuiPlanStore.getState(), 'missing-session')
    )
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-promoted')).toMatchObject({
      activePlan: { id: planA.id, threadId: 'thread-promoted' },
      content: '# A dirty',
      lastSavedContent: '# A',
      saveStatus: 'dirty',
      operationStatus: 'error',
      error: 'A failed'
    })
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-b')).toBe(sessionB)
    expect(guiPlanSessionGeneration('thread-a')).toBe(previousGeneration + 1)
  })

  it('preserves the canonical target plan when a handoff collides', () => {
    const store = useGuiPlanStore.getState()
    store.setActivePlan('thread-source', planFor('thread-source', '.sciforge/plan/source.md'), '# Source')
    store.setActivePlan('thread-target', planFor('thread-target', '.sciforge/plan/target.md'), '# Target')
    const target = guiPlanSession(useGuiPlanStore.getState(), 'thread-target')

    store.moveSession('thread-source', 'thread-target')

    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-source').activePlan).toBeNull()
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-target')).toBe(target)
    expect(guiPlanSession(useGuiPlanStore.getState(), 'thread-target').content).toBe('# Target')
  })

  it('matches plans to both their workspace and owner Session', () => {
    const plan = planFor('thread-a', '.sciforge/plan/a.md')
    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-a')).toBe(true)
    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-b')).toBe(false)
    expect(guiPlanMatchesContext(plan, '/tmp/other', 'thread-a')).toBe(false)
  })
})
