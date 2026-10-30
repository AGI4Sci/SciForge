import React, {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  DomainRendererWorkbenchNavigationSectionRenderContext
} from '@sciforge/domain-sdk/renderer'

import type {
  ProjectCoordinatorWorkspace,
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
  onOpenIdentity?: () => void
  onOpenProject: (projectId: string, view: ProjectCoordinatorSidebarViewId, sessionId?: string) => void
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
  onOpenIdentity,
  onOpenProject,
  onActivateProject
}: ProjectCoordinatorNavigationSectionProps): ReactElement {
  const [ownership, setOwnership] = useState<Awaited<ReturnType<ProjectCoordinatorRendererClient['readSessionOwnership']>>>()
  const ownershipRevisionRef = useRef(0)
  const [projection, setProjection] = useState<ProjectCoordinatorSessionProjection>()
  const sessionBindings = useMemo(() => projection ? projectCoordinatorSidebarBindings(projection) : [], [projection])
  const pendingActivations = useMemo(() => projection?.pendingActivations ?? [], [projection])
  const [workspace, setWorkspace] = useState<ProjectCoordinatorWorkspace>()
  const lastSessions = useRef(new Map<string, string>())
  const activatedRequests = useRef(new Set<string>())
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
    try {
      const projection = await client.readSessionProjection()
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setProjection(projection)
    } catch {
      if (!mountedRef.current || requestRevisionRef.current !== revision) return
      setProjection(previous => previous ? {
        ...previous, bindings: [], pendingActivations: [],
        suppressedSessions: [...previous.bindings, ...previous.suppressedSessions].map(({ runtimeId, threadId }) => ({ runtimeId, threadId }))
      } : undefined)
    }
  }, [client])

  const refreshOwnership = useCallback(async () => {
    const revision = ++ownershipRevisionRef.current
    try {
      const sessions = await client.readSessionOwnership()
      if (mountedRef.current && revision === ownershipRevisionRef.current) setOwnership(sessions)
    } catch {
      // Keep the last authoritative local claims if local storage itself is unavailable.
    }
  }, [client])

  useEffect(() => { void refreshOwnership() }, [refreshOwnership, sessionCatalogRevision])
  useEffect(() => subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    void refreshOwnership()
  }), [refreshOwnership])

  const publishOwnership = context.publishSessionOwnership
  useEffect(() => {
    if (!ownership) return
    publishOwnership?.(ownership.map(identity => {
      const binding = projection?.bindings.find(candidate => (
        candidate.runtimeId === identity.runtimeId && candidate.threadId === identity.threadId
      ))
      const scopeLabel = binding && workspace?.connection.state === 'ready'
        ? workspace.projects.find(({ project }) => project.projectId === binding.projectId)?.project.displayName
        : undefined
      return { ...identity, ...(scopeLabel ? { scopeLabel } : {}) }
    }))
  }, [ownership, projection, publishOwnership, workspace])

  useEffect(() => {
    const binding = sessionBindings.find(binding => binding.threadId === context.session.id && binding.runtimeId === context.session.runtimeId)
    if (binding) lastSessions.current.set(binding.projectId, binding.threadId)
  }, [context.session.id, context.session.runtimeId, sessionBindings])

  const openProject = (projectId: string, view: ProjectCoordinatorSidebarViewId): void => {
    const sessions = context.sessions.filter(session => sessionBindings.some(binding => binding.projectId === projectId && binding.threadId === session.id && binding.runtimeId === session.runtimeId))
    const available = sessions.filter(session => !session.archived)
    const target = available.find(session => session.id === lastSessions.current.get(projectId))
      ?? [...available].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      ?? [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (target) {
      lastSessions.current.set(projectId, target.id)
      context.selectSession(target.id)
    } else {
      context.showOverview?.(workspace?.projects.find(({ project }) => project.projectId === projectId)?.project.displayName ?? '')
    }
    onOpenProject(projectId, view, target?.id)
  }

  useEffect(() => {
    void refresh()
  }, [refresh, sessionCatalogRevision])

  useEffect(() => subscribeProjectCoordinatorWorkspaceInvalidation(() => {
    void refresh()
  }), [refresh])

  useEffect(() => {
    if (!context.active) return undefined
    const timer = globalThis.setInterval(() => {
      void refreshOwnership()
      void refresh()
    }, SESSION_PROJECTION_REFRESH_INTERVAL_MS)
    return () => globalThis.clearInterval(timer)
  }, [context.active, refresh, refreshOwnership])

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
    if (!activatedRequests.current.has(activation.activationRequestId)) {
      activatedRequests.current.add(activation.activationRequestId)
      onActivateProject(activation.projectId, session.id)
    }
    void client.acknowledgeProjectActivation({
      activationRequestId: activation.activationRequestId
    }).then(refresh).catch(() => undefined).finally(() => {
      activatingRef.current.delete(activation.activationRequestId)
    })
  }, [client, context.sessions, onActivateProject, pendingActivations, refresh])

  return (
    <ProjectCoordinatorSidebarSection
      client={client}
      context={{ ...context, selectSession: sessionId => {
        const binding = sessionBindings.find(candidate => candidate.threadId === sessionId && context.sessions.some(session => session.id === sessionId && session.runtimeId === candidate.runtimeId))
        if (!binding) return
        lastSessions.current.set(binding.projectId, sessionId)
        onActivateProject(binding.projectId, sessionId)
      } }}
      onWorkspaceObserved={setWorkspace}
      sessionBindings={sessionBindings}
      onCreateProject={onCreateProject}
      onOpenIdentity={onOpenIdentity}
      onOpenProject={openProject}
    />
  )
}
