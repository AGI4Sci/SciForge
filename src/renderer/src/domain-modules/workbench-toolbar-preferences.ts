import {
  defaultWorkbenchToolbarSettings,
  normalizeWorkbenchToolbarSettings,
  type WorkbenchToolbarSettingsV1
} from '@shared/app-settings'
import type { RegisteredWorkbenchToolbarActionContribution } from './workbench-toolbar-slot'

export function orderWorkbenchToolbarActions(
  actions: readonly RegisteredWorkbenchToolbarActionContribution[],
  preferences?: WorkbenchToolbarSettingsV1
): readonly RegisteredWorkbenchToolbarActionContribution[] {
  const normalized = normalizeWorkbenchToolbarSettings(preferences)
  const order = new Map(
    normalized.commandOrder.map((commandId, index) => [commandId, index])
  )
  return actions
    .map((action, sourceIndex) => ({ action, sourceIndex }))
    .sort((left, right) => {
      const leftOrder = order.get(left.action.contribution.commandId)
      const rightOrder = order.get(right.action.contribution.commandId)
      if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
      if (leftOrder !== undefined) return -1
      if (rightOrder !== undefined) return 1
      return left.sourceIndex - right.sourceIndex
    })
    .map(({ action }) => action)
}

export function visibleWorkbenchToolbarActions(
  actions: readonly RegisteredWorkbenchToolbarActionContribution[],
  preferences?: WorkbenchToolbarSettingsV1
): readonly RegisteredWorkbenchToolbarActionContribution[] {
  const normalized = normalizeWorkbenchToolbarSettings(preferences)
  const hidden = new Set(normalized.hiddenCommandIds)
  return orderWorkbenchToolbarActions(actions, normalized)
    .filter(({ contribution }) => !hidden.has(contribution.commandId))
}

export function setWorkbenchToolbarActionVisible(
  preferences: WorkbenchToolbarSettingsV1 | undefined,
  commandId: string,
  visible: boolean
): WorkbenchToolbarSettingsV1 {
  const normalized = normalizeWorkbenchToolbarSettings(preferences)
  const hidden = new Set(normalized.hiddenCommandIds)
  if (visible) hidden.delete(commandId)
  else hidden.add(commandId)
  return normalizeWorkbenchToolbarSettings({
    ...normalized,
    hiddenCommandIds: [...hidden]
  })
}

export function moveWorkbenchToolbarAction(
  actions: readonly RegisteredWorkbenchToolbarActionContribution[],
  preferences: WorkbenchToolbarSettingsV1 | undefined,
  commandId: string,
  direction: -1 | 1
): WorkbenchToolbarSettingsV1 {
  const normalized = normalizeWorkbenchToolbarSettings(preferences)
  const orderedInstalledIds = orderWorkbenchToolbarActions(actions, normalized)
    .map(({ contribution }) => contribution.commandId)
  const sourceIndex = orderedInstalledIds.indexOf(commandId)
  const targetIndex = sourceIndex + direction
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= orderedInstalledIds.length) {
    return normalized
  }

  const nextInstalledIds = [...orderedInstalledIds]
  const [moved] = nextInstalledIds.splice(sourceIndex, 1)
  nextInstalledIds.splice(targetIndex, 0, moved!)

  const installed = new Set(orderedInstalledIds)
  let nextInstalledIndex = 0
  const commandOrder = normalized.commandOrder.map((persistedId) => {
    if (!installed.has(persistedId)) return persistedId
    return nextInstalledIds[nextInstalledIndex++]!
  })
  commandOrder.push(...nextInstalledIds.slice(nextInstalledIndex))
  return normalizeWorkbenchToolbarSettings({
    ...normalized,
    commandOrder
  })
}

export function resetWorkbenchToolbarPreferences(): WorkbenchToolbarSettingsV1 {
  return defaultWorkbenchToolbarSettings()
}
