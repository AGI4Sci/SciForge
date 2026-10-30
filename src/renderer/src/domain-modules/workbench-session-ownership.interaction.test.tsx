// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import type { DomainRendererWorkbenchNavigationSectionRenderContext, DomainRendererWorkbenchSessionOwnership } from '@sciforge/domain-sdk/renderer'
import { WorkbenchNavigationSectionContributionRegistry } from './workbench-navigation-section-slot'
import { WorkbenchNavigationSectionOutlet } from './workbench-session-ownership'
import { WORKBENCH_NAVIGATION_SECTION_CONTRACT_VERSION, WORKBENCH_NAVIGATION_SECTION_LOCATION } from '@sciforge/domain-sdk/renderer'

it('retains ownership while collapsed and releases it only when the contribution unmounts', async () => {
  const reports: Array<readonly DomainRendererWorkbenchSessionOwnership[] | undefined> = []
  function Contribution({ context }: { context: DomainRendererWorkbenchNavigationSectionRenderContext }) {
    const publishOwnership = context.publishSessionOwnership
    useEffect(() => { publishOwnership?.([{ runtimeId: 'codex', threadId: 'owned' }]) }, [publishOwnership])
    return <button id="owned-session" onClick={() => context.selectSession('owned')}>Task title</button>
  }
  const registry = new WorkbenchNavigationSectionContributionRegistry()
  registry.register({ id: 'fixture.navigation', ownerId: 'fixture', contract: { location: WORKBENCH_NAVIGATION_SECTION_LOCATION, contractVersion: WORKBENCH_NAVIGATION_SECTION_CONTRACT_VERSION, label: 'fixture' }, value: { ownsSessions: true, render: context => <Contribution context={context} /> } })
  const section = registry.list()[0]
  expect(section.contribution.ownsSessions).toBe(true)
  const selections: string[] = []
  const publish = (_id: string, sessions: readonly DomainRendererWorkbenchSessionOwnership[] | undefined) => { reports.push(sessions) }
  function Harness() {
    const [collapsed, collapse] = useState(false)
    return <><button id="collapse" onClick={() => collapse(!collapsed)}>Collapse</button><div hidden={collapsed}><WorkbenchNavigationSectionOutlet section={section} context={{ active: !collapsed, className: '', session: { id: 'local' }, sessions: [], selectSession: id => { selections.push(id) } }} publish={publish} showOverview={() => {}} /></div></>
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<Harness />) })
    expect(reports).toEqual([[{ runtimeId: 'codex', threadId: 'owned' }]])
    await act(async () => { container.querySelector<HTMLButtonElement>('#owned-session')!.click() })
    expect(selections).toEqual(['owned'])
    await act(async () => { container.querySelector<HTMLButtonElement>('#collapse')!.click() })
    expect(reports).toHaveLength(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    registry.dispose()
  }
  expect(reports.at(-1)).toBeUndefined()
})
