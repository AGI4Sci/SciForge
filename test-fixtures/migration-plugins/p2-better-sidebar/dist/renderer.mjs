const TABS = Object.freeze([
  { id: 'explorer', title: 'Explorer', order: 10 },
  { id: 'changes', title: 'Changes', order: 20 },
  { id: 'tasks', title: 'Tasks', order: 30 },
  { id: 'sidechat', title: 'Side chat', order: 40 }
])

export function activateRenderer(registrar, generation) {
  const disposers = []
  disposers.push(registrar.registerPanel({
    id: 'better-sidebar.workbench-right-panel',
    render: ({ sessionId, activeTabId }) => ({
      sessionId,
      tabs: TABS.map(({ id }) => id),
      activeTabId: activeTabId ?? TABS[0].id
    })
  }, generation))
  for (const tab of TABS) disposers.push(registrar.registerTab(tab, generation))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
