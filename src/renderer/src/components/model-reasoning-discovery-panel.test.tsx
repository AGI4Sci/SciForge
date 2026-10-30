// @vitest-environment happy-dom
/**
 * The settings discovery panel: outcome display, declared-level status
 * (confirmed / unconfirmed / conflict), refresh, and restore-to-auto.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoningDiscoveryPanel } from './model-reasoning-discovery-panel'
import type { ModelReasoningOutcome } from '@shared/model-reasoning'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const labels: Record<string, string> = {
  modelRouterReasoningDiscoveryTitle: 'Auto-discovery',
  modelRouterReasoningDiscoveryRefresh: 'Refresh',
  modelRouterReasoningDiscoveryRestore: 'Restore auto',
  modelRouterReasoningDiscoveryLoading: 'Querying…',
  modelRouterReasoningDiscoveryError: 'Query failed',
  modelRouterReasoningDiscoveryStateKnown: 'Levels discovered',
  modelRouterReasoningDiscoveryStateUnsupported: 'Explicitly unsupported',
  modelRouterReasoningDiscoveryStateUnknown: 'No declaration yet',
  modelRouterReasoningDiscoveryPartial: 'partially verified',
  modelRouterReasoningDiscoveryDefault: 'default',
  modelRouterReasoningDiscoveryDeclaredConfirmed: 'declared-confirmed',
  modelRouterReasoningDiscoveryDeclaredUnconfirmed: 'unconfirmed-still-sent',
  modelRouterReasoningDiscoveryDeclaredConflictUnsupported: 'conflict-still-sent',
  modelRouterReasoningDiscoveryPrecedence: 'Precedence: manual > catalog > table',
  modelRouterReasoningDiscoveryStaleNote: 'stale-note {{message}}',
  composerReasoningSourceCatalog: 'Source: upstream catalog query',
  composerReasoningLow: 'Low',
  composerReasoningHigh: 'High'
}

function t(key: string, values?: Record<string, unknown>): string {
  const base = labels[key] ?? key
  if (key === 'modelRouterReasoningDiscoveryUpdatedAt' && values?.time) {
    return `Updated ${String(values.time)}`
  }
  return base.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
}

const OUTCOME_KNOWN: ModelReasoningOutcome = {
  state: 'known',
  levels: ['low', 'high'],
  completeness: 'partial',
  defaultLevel: 'high',
  source: 'catalog',
  verifiedAt: '2026-10-26T00:00:00.000Z',
  checkedAt: '2026-10-26T03:00:00.000Z',
  attachEffort: true
}

const OUTCOME_UNKNOWN: ModelReasoningOutcome = {
  state: 'unknown',
  levels: [],
  completeness: null,
  defaultLevel: null,
  source: 'none',
  verifiedAt: null,
  checkedAt: '2026-10-26T03:00:00.000Z',
  attachEffort: false
}

let container: HTMLDivElement
let root: Root | undefined

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container.remove()
  vi.restoreAllMocks()
})

async function renderPanel(props: {
  outcome: ModelReasoningOutcome
  declaredEfforts?: string[]
  onRestoreAuto?: () => void
  discover?: ReturnType<typeof vi.fn>
  reject?: boolean
}): Promise<{ discover: ReturnType<typeof vi.fn> }> {
  const discover =
    props.discover ??
    vi.fn(async () =>
      props.reject
        ? Promise.reject(new Error('down'))
        : { ...props.outcome, levels: [...props.outcome.levels] }
    )
  Object.defineProperty(window, 'sciforge', {
    configurable: true,
    value: { modelReasoning: { discover } }
  })
  root = createRoot(container)
  await act(async () =>
    root!.render(
      createElement(ModelReasoningDiscoveryPanel, {
        model: 'deepseek-v4.1-flash',
        protocol: 'auto',
        endpoint: 'https://up.example/v1',
        declaredEfforts: props.declaredEfforts ?? [],
        ...(props.onRestoreAuto ? { onRestoreAuto: props.onRestoreAuto } : {}),
        t
      })
    )
  )
  return { discover }
}

describe('model reasoning discovery panel', () => {
  it('shows the discovered levels, the catalog source, partial marker and updated time', async () => {
    await renderPanel({ outcome: OUTCOME_KNOWN })
    const text = container.textContent ?? ''
    expect(text).toContain('Levels discovered')
    expect(text).toContain('Source: upstream catalog query')
    expect(text).toContain('partially verified')
    expect(text).toContain('High')
    expect(text).toContain('default')
    expect(text).toMatch(/Updated /)
  })

  it('marks declared levels: confirmed inside the list, unconfirmed outside — never "unsupported"', async () => {
    await renderPanel({ outcome: OUTCOME_KNOWN, declaredEfforts: ['high', 'turbo'] })
    const text = container.textContent ?? ''
    expect(text).toContain('high — declared-confirmed')
    expect(text).toContain('turbo — unconfirmed-still-sent')
    expect(text).not.toContain('turbo — conflict-still-sent')
  })

  it('an explicit upstream unsupported shows the conflict wording while keeping the declaration', async () => {
    await renderPanel({
      outcome: { ...OUTCOME_UNKNOWN, state: 'unsupported', completeness: null },
      declaredEfforts: ['high']
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Explicitly unsupported')
    expect(text).toContain('high — conflict-still-sent')
  })

  it('refresh re-queries with force and restore clears the manual override', async () => {
    const onRestoreAuto = vi.fn()
    const { discover } = await renderPanel({ outcome: OUTCOME_UNKNOWN, declaredEfforts: ['high'], onRestoreAuto })
    expect(discover).toHaveBeenCalledTimes(1)
    const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Refresh')
    await act(async () => refresh?.click())
    expect(discover).toHaveBeenCalledTimes(2)
    expect(discover.mock.calls[1]?.[0]).toMatchObject({ force: true })
    const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Restore auto')
    await act(async () => restore?.click())
    expect(onRestoreAuto).toHaveBeenCalledTimes(1)
  })

  it('a failed refresh keeps the previous conclusion and flags the failure', async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce({ ...OUTCOME_KNOWN, levels: [...OUTCOME_KNOWN.levels] })
      .mockRejectedValueOnce(new Error('down'))
    await renderPanel({ outcome: OUTCOME_KNOWN, discover })
    const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Refresh')
    await act(async () => refresh?.click())
    const text = container.textContent ?? ''
    expect(text).toContain('Query failed')
    expect(text).toContain('High')
  })

  it('labels a stale observation with its refresh failure instead of a fresh timestamp claim', async () => {
    const staleOutcome: ModelReasoningOutcome = {
      ...OUTCOME_KNOWN,
      stale: true,
      refreshError: 'upstream catalog request failed (503)'
    }
    await renderPanel({ outcome: staleOutcome })
    const text = container.textContent ?? ''
    expect(text).toContain('stale-note upstream catalog request failed (503)')
  })

  it('shows no stale note for a plainly fresh observation', async () => {
    await renderPanel({ outcome: OUTCOME_KNOWN })
    expect(container.textContent ?? '').not.toContain('stale-note')
  })
})