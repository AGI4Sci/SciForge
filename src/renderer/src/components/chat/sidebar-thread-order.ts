/** Presentation-only ordering; moving a row never moves the underlying conversation. */
export const SIDEBAR_THREAD_ORDER_KEY = 'sciforge.sidebar.thread-order.v1'
export type SidebarThreadOrders = Record<string, string[]>

export function readSidebarThreadOrders(): SidebarThreadOrders {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SIDEBAR_THREAD_ORDER_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, ids]) =>
      Array.isArray(ids) && ids.every((id) => typeof id === 'string')
    ))
  } catch { return {} }
}

export function applySidebarThreadOrder<T extends { id: string }>(items: T[], order: readonly string[]): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]))
  // Newly created conversations stay discoverable at the top. Existing rows
  // retain their chosen order even when new provider activity changes dates.
  return [...items].sort((a, b) => (ranks.get(a.id) ?? -1) - (ranks.get(b.id) ?? -1))
}

export function moveSidebarThread(ids: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids
  const next = ids.filter((id) => id !== source)
  next.splice(next.indexOf(target) + Number(after), 0, source)
  return next
}
