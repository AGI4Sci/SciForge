import { useEffect, type RefObject } from 'react'
import type { DomainRendererVisibleContextHost, DomainVisibleContextTarget } from '@sciforge/domain-sdk/host'
import type { ResearchRecordNode, ResearchRecordScope } from '../research-record-contract'

export function researchRecordVisualTarget(scope: ResearchRecordScope, node: ResearchRecordNode | null, id?: string): DomainVisibleContextTarget {
  return {
    id: id ?? node?.id ?? 'research-record-overview', kind: 'region', contentType: 'text/markdown', active: true,
    metadata: {
      label: node?.title || '研究记录', resourceKind: 'research-record-node', resourceId: node?.id || 'root',
      // The record's explicit parent owns the discussion; a cross-session source is separate.
      runtimeId: scope.runtimeId, threadId: scope.threadId, workspaceRoot: scope.workspaceRoot,
      ...(node?.source ? {
        sourceRuntimeId: node.source.runtimeId, sourceThreadId: node.source.threadId,
        turnId: node.source.turnId, itemId: node.source.itemId
      } : {})
    }
  }
}

/** Only viewport-visible nodes register targets; long histories do not fill the Host target budget. */
export function useResearchRecordVisualTarget(input: {
  visibleContext?: DomainRendererVisibleContextHost
  componentId: string
  target: DomainVisibleContextTarget
  element: RefObject<HTMLElement | null>
  active: boolean
}): void {
  const { visibleContext, componentId, target, element, active } = input
  const targetJson = JSON.stringify(target)
  useEffect(() => {
    const node = element.current
    if (!active || !visibleContext || !node) return
    let unregister: (() => void) | undefined
    const show = () => {
      unregister ??= visibleContext.registerVisualTarget({ componentId, target: JSON.parse(targetJson), element: () => element.current })
    }
    const hide = () => { unregister?.(); unregister = undefined }
    if (typeof IntersectionObserver === 'undefined') { show(); return hide }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) show()
      else hide()
    })
    observer.observe(node)
    return () => { observer.disconnect(); hide() }
  }, [active, componentId, element, targetJson, visibleContext])
}
