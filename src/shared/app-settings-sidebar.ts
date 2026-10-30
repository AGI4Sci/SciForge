/** Persisted presentation preferences shared by renderer instances. */
export type SidebarThreadOrdersV1 = Record<string, string[]>

export function normalizeSidebarThreadOrders(value: unknown): SidebarThreadOrdersV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: SidebarThreadOrdersV1 = {}
  for (const [key, ids] of Object.entries(value)) {
    if (!key || !Array.isArray(ids)) continue
    const normalized = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    if (normalized.length > 0) result[key] = [...new Set(normalized)]
  }
  return result
}

export function mergeSidebarThreadOrders(
  current: SidebarThreadOrdersV1,
  patch: unknown
): SidebarThreadOrdersV1 {
  return normalizeSidebarThreadOrders({ ...current, ...normalizeSidebarThreadOrders(patch) })
}
