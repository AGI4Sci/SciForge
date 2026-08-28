import React, {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type {
  DomainRendererWorkbenchNavigationSectionRenderContext
} from '@sciforge/domain-sdk/renderer'

import type { ProjectCoordinatorSessionProjection } from '../contract.js'
import {
  ProjectCoordinatorSidebarSection,
  type ProjectCoordinatorSidebarSessionBinding,
  type ProjectCoordinatorSidebarViewId
} from './ProjectCoordinatorSidebarSection.js'
import type {
  ProjectCoordinatorRendererClient
} from './project-coordinator-capability-client.js'
import {
  subscribeProjectCoordinatorWorkspaceInvalidation
} from './workspace-invalidation.js'

const SESSION_PROJECTION_REFRESH_INTERVAL_MS = 30_000

export type ProjectCoordinatorNavigationSectionProps = Readonly<{
  client: ProjectCoordinatorRendererClient
  context: DomainRendererWorkbenchNavigationSectionRenderContext
  onCreateProject: () => void
  onOpenProject: (projectId: string, view: ProjectCoordinatorSidebarViewId) => void
}>

export function projectCoordinatorSidebarBindings(
  projection: ProjectCoordinatorSessionProjection
): readonly ProjectCoordinatorSidebarSessionBinding[] {
  return Object.freeze(projection.bindings.map(({ projectId, runtimeId, threadId }) => (
    Object.freeze({ projectId, runtimeId, threadId })
  )))
}

export function ProjectCoordinatorNavigationSection({
  client,
  context,
  onCreateProject,
  onOpenProject
}: ProjectCoordinatorNavigationSectionProps): ReactElement {
  const [sessionBindings, setSessionBindings] = useState<
    readonly ProjectCoordinatorSidebarSessionBinding[]
  >([])
  const requestRevisionRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const revision = requestRevisionRef.current + 1
    requestRevisionRef.current = revision
    setSessionBindings([])
    try {
      const projection = await client.readSessionProjection()
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setSessionBindings(projectCoordinatorSidebarBindings(projection))
    } catch {
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setSessionBindings([])
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [context.session.id, refresh])

  useEffect(() => subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    void refresh()
  }), [refresh])

  useEffect(() => {
    if (!context.active) return undefined
    const timer = globalThis.setInterval(() => void refresh(), SESSION_PROJECTION_REFRESH_INTERVAL_MS)
    return () => globalThis.clearInterval(timer)
  }, [context.active, refresh])

  return (
    <ProjectCoordinatorSidebarSection
      client={client}
      context={context}
      sessionBindings={sessionBindings}
      onCreateProject={onCreateProject}
      onOpenProject={onOpenProject}
    />
  )
}
