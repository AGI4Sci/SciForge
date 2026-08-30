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

import type {
  ProjectCoordinatorPendingActivation,
  ProjectCoordinatorSessionProjection
} from '../contract.js'
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
  onActivateProject: (projectId: string, sessionId: string) => void
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
  onOpenProject,
  onActivateProject
}: ProjectCoordinatorNavigationSectionProps): ReactElement {
  const [sessionBindings, setSessionBindings] = useState<
    readonly ProjectCoordinatorSidebarSessionBinding[]
  >([])
  const [pendingActivations, setPendingActivations] = useState<
    readonly ProjectCoordinatorPendingActivation[]
  >([])
  const requestRevisionRef = useRef(0)
  const mountedRef = useRef(true)
  const activatingRef = useRef(new Set<string>())
  const sessionCatalogRevision = context.sessions.map((session) => (
    `${session.runtimeId ?? ''}\u0000${session.id}\u0000${session.updatedAt}`
  )).join('\u0001')

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
    setPendingActivations([])
    try {
      const projection = await client.readSessionProjection()
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setSessionBindings(projectCoordinatorSidebarBindings(projection))
      setPendingActivations(projection.pendingActivations)
    } catch {
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setSessionBindings([])
      setPendingActivations([])
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [context.session.id, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh, sessionCatalogRevision])

  useEffect(() => subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    void refresh()
  }), [refresh])

  useEffect(() => {
    if (!context.active) return undefined
    const timer = globalThis.setInterval(() => void refresh(), SESSION_PROJECTION_REFRESH_INTERVAL_MS)
    return () => globalThis.clearInterval(timer)
  }, [context.active, refresh])

  useEffect(() => {
    const activation = pendingActivations.find((candidate) => context.sessions.some((session) => (
      session.id === candidate.coordinatorSession.threadId &&
      session.runtimeId === candidate.coordinatorSession.runtimeId
    )))
    if (!activation || activatingRef.current.has(activation.activationRequestId)) return
    const session = context.sessions.find((candidate) => (
      candidate.id === activation.coordinatorSession.threadId &&
      candidate.runtimeId === activation.coordinatorSession.runtimeId
    ))
    if (!session) return
    activatingRef.current.add(activation.activationRequestId)
    onActivateProject(activation.projectId, session.id)
    void client.acknowledgeProjectActivation({
      activationRequestId: activation.activationRequestId
    }).then(refresh).catch(() => undefined).finally(() => {
      activatingRef.current.delete(activation.activationRequestId)
    })
  }, [client, context.sessions, onActivateProject, pendingActivations, refresh])

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
