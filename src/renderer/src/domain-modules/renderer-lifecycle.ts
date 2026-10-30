export const RENDERER_LIFECYCLE_CONTRIBUTION_KIND = 'renderer.lifecycle' as const

export type RendererLifecycleContribution = Readonly<{
  activate(): void | (() => void)
}>

export function isRendererLifecycleContribution(
  value: unknown
): value is RendererLifecycleContribution {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<RendererLifecycleContribution>).activate === 'function'
  )
}
