import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DomainRendererWorkbenchMainAreaRenderContext } from '@sciforge/domain-sdk/renderer'
import type { CloudSpace, CloudSpaceEnsureRequest } from '@sciforge/cloud-spaces-contracts'
import type { z } from 'zod'
import type { siyuanEditorResultSchema, SiYuanEditorViewport } from '../editor-contract.js'
import type { SiYuanEditorConfigurationStore } from './editor-configuration.js'
import { useNativeSiYuanPresentation } from './native-siyuan-presentation.js'
import { useSiYuanServiceStatus, type SiYuanServiceControls } from './service-status.js'
import { createEditorSessionStateStore, type EditorSessionStateStore } from './editor-session-state.js'
import { SiYuanSettingsSection } from './settings-section.js'
import { DocumentSharing, type DocumentSharingControls } from './document-sharing.js'
import { useSiYuanLocale } from './locale.js'

type EditorSession = z.infer<typeof siyuanEditorResultSchema>

/** The dock and settings contribution share one package-owned connection form. */
const buttonClass = 'ds-no-drag rounded-md border border-ds-border bg-ds-card px-2.5 py-1 text-ds-sm text-ds-ink hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50'
const primaryButtonClass = buttonClass + ' border-ds-ink font-medium'
const directoryRetryDelays = [2_000, 4_000, 8_000] as const

export function SiYuanEditorPage({ context, open, spaces, ensure, projects, present, service, settings, sessionStates, visibleContext, sharing }: Readonly<{
  context: DomainRendererWorkbenchMainAreaRenderContext<ReactElement | null>
  sharing?: DocumentSharingControls
  spaces?: () => Promise<readonly CloudSpace[]>
  ensure?: (input: CloudSpaceEnsureRequest) => Promise<CloudSpace>
  open: (input?: Readonly<{ spaceId?: string; refresh?: boolean }>) => Promise<EditorSession>
  projects?: () => Promise<readonly Readonly<{ projectId: string; name: string; canCreate?: boolean }>[]>
  present: (input: Readonly<{ url: string | null; sessionId?: string; reloadRevision?: number; viewport: SiYuanEditorViewport }>) => Promise<unknown>
  visibleContext?: (input: Readonly<{ sessionId: string; nativeSessionId: string; spaceId?: string; workspaceId?: string }>) => () => void
  sessionStates?: EditorSessionStateStore
  service: SiYuanServiceControls
  settings: SiYuanEditorConfigurationStore
}>): ReactElement {
  const { text, errorText } = useSiYuanLocale()
  const [localStates] = useState(createEditorSessionStateStore)
  const states = sessionStates ?? localStates
  const configuration = useSyncExternalStore(settings.subscribe, settings.getSnapshot)
  const [serviceStatus, , statusError] = useSiYuanServiceStatus(service, context.active)
  const [directory, setDirectory] = useState<Readonly<{ session: string; spaces: readonly CloudSpace[] }> | null>(null)
  const [projectDirectory, setProjectDirectory] = useState<Readonly<{ session: string; items: readonly Readonly<{ projectId: string; name: string; canCreate?: boolean }>[] }> | null>(null)
  const [createProjectId, setCreateProjectId] = useState('')
  const [createProjectOpen, setCreateProjectOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const actionEpoch = useRef(0)
  const initialized = useRef(new Set<string>())
  const [directoryError, setDirectoryError] = useState<string>()
  const [listing, setListing] = useState(false)
  const [resolved, setResolved] = useState<Readonly<EditorSession & { key: string }> | null>(null)
  const managed = serviceStatus?.mode !== 'custom'
  const identity = serviceStatus?.identity
  const accountKey = identity?.state === 'signed-in' ? 'user:' + identity.userId : identity?.state
  const sessionKey = context.session ? JSON.stringify([accountKey, context.session.runtimeId, context.session.id]) : accountKey
  const stateKey = sessionKey ?? 'unavailable'
  const liveStateKey = useRef(stateKey)
  liveStateKey.current = stateKey
  const sessionState = useSyncExternalStore(states.subscribe, () => states.read(stateKey))
  const configurationReady = sessionState.configurationRevision === configuration.revision
  const reloadRevision = sessionState.reloadRevision
  const refreshSession = () => states.update(stateKey, { reloadRevision: reloadRevision + 1 })
  useEffect(() => {
    if (sessionState.configurationRevision === configuration.revision) return
    states.update(stateKey, { configurationRevision: configuration.revision,
      reloadRevision: sessionState.reloadRevision + (sessionState.configurationRevision === undefined ? 0 : 1) })
  }, [states, stateKey, sessionState, configuration.revision])
  const selectedSpaceId = sessionState.spaceId
  const settingsOpen = sessionState.settingsOpen
  const setSelectedSpaceId = (spaceId: string) => states.update(stateKey, { spaceId })
  const setSettingsOpen = (settingsOpen: boolean) => states.update(stateKey, { settingsOpen })
  const editorAvailable = serviceStatus?.editorAvailable !== false
  const signedIn = identity?.state === 'signed-in'
  const projectChoices = projectDirectory && projectDirectory.session === sessionKey ? projectDirectory.items : []
  const spaceChoices = directory && directory.session === sessionKey ? directory.spaces : []
  const creatableProjects = directory?.session === sessionKey ? projectChoices.filter(project => project.canCreate === true &&
    !spaceChoices.some(space => space.scope.kind === 'project' && space.scope.projectId === project.projectId)) : []
  const selectedSpace = spaceChoices.find(space => space.spaceId === selectedSpaceId)
  const selectedProjectId = selectedSpace?.scope.kind === 'project' ? selectedSpace.scope.projectId : undefined
  const mayEnsureSelectedSpace = selectedSpace?.scope.kind === 'personal' || projectChoices.some(project => project.projectId === selectedProjectId && project.canCreate === true)
  const spaceId = selectedSpace?.status === 'ready' ? selectedSpace.spaceId : ''
  const resolutionKey = `${configuration.revision}:${reloadRevision}:${managed ? 'managed:' + spaceId : 'custom'}:${sessionKey}`
  const sessionExpired = Boolean(managed && resolved?.expiresAt && Date.parse(resolved.expiresAt) <= Date.now())
  const url = configurationReady && editorAvailable && resolved?.key === resolutionKey && (!managed || signedIn && spaceId && !sessionExpired) ? resolved.url : null
  const serviceUrl = serviceStatus?.url
  const needsConfiguration = !managed && serviceUrl === null && !configuration.url && !url
  const showingSettings = needsConfiguration || settingsOpen
  const [opening, setOpening] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const [renewalError, setRenewalError] = useState<string>()
  const [renewalAttempt, setRenewalAttempt] = useState(0)
  const viewport = useRef<HTMLDivElement | null>(null)
  const openedRevisions = useRef(new Map<string, number>())
  useEffect(() => { setCreating(false); setCreateProjectId(''); setCreateProjectOpen(false); setDirectoryError(undefined); return () => { actionEpoch.current++ } }, [stateKey, context.active])

  useEffect(() => {
    if (!configurationReady || !managed || !context.active || !signedIn || !sessionKey) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let projectTimer: ReturnType<typeof setTimeout> | undefined
    let readFailures = 0
    let projectFailures = 0
    const load = async () => {
      setListing(true)
      let reading = false
      try {
        if (!spaces || !ensure) throw new Error('cloud_spaces_unavailable')
        reading = true
        let items = await spaces()
        reading = false
        if (cancelled) return
        readFailures = 0
        if (!initialized.current.has(accountKey!) && !items.some(item => item.scope.kind === 'personal')) {
          const personal = await ensure({ scope: { kind: 'personal' } })
          if (cancelled) return
          items = [...items.filter(item => item.spaceId !== personal.spaceId), personal]
        }
        initialized.current.add(accountKey!)
        const personal = items.find(item => item.scope.kind === 'personal')
        if (!states.read(stateKey).spaceId && personal) states.update(stateKey, { spaceId: personal.spaceId })
        setDirectory({ session: sessionKey, spaces: items })
        setDirectoryError(undefined)
        if (items.some(item => item.status === 'queued' || item.status === 'provisioning')) timer = setTimeout(() => { void load() }, 2_000)
      } catch (failure) {
        if (!cancelled) {
          setDirectory(null)
          setDirectoryError(errorText(failure))
          // Only replay directory reads, never an ensure whose write outcome is unknown.
          if (reading && readFailures < directoryRetryDelays.length) {
            timer = setTimeout(() => { void load() }, directoryRetryDelays[readFailures++])
          }
        }
      }
      finally { if (!cancelled) setListing(false) }
    }
    const loadProjects = async () => {
      if (!projects) return
      try {
        const items = await projects()
        if (!cancelled) setProjectDirectory({ session: sessionKey, items })
      } catch {
        if (!cancelled) {
          setProjectDirectory(null)
          if (projectFailures < directoryRetryDelays.length) {
            projectTimer = setTimeout(() => { void loadProjects() }, directoryRetryDelays[projectFailures++])
          }
        }
      }
    }
    void load()
    void loadProjects()
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(projectTimer) }
  }, [managed, context.active, signedIn, sessionKey, spaces, ensure, projects, configuration.revision, reloadRevision, configurationReady, errorText, accountKey, states, stateKey])

  const ensureSpace = async (request: CloudSpaceEnsureRequest) => {
    if (!ensure) return
    const captured = stateKey
    const epoch = actionEpoch.current
    const current = () => captured === liveStateKey.current && epoch === actionEpoch.current
    setCreating(true)
    try {
      const space = await ensure(request)
      if (!current()) return
      states.update(captured, { spaceId: space.spaceId, reloadRevision: states.read(captured).reloadRevision + 1 })
      setCreateProjectOpen(false)
      setCreateProjectId('')
      setError(undefined)
    } catch (failure) { if (current()) setDirectoryError(errorText(failure)) }
    finally { if (current()) setCreating(false) }
  }

  const onReady = useCallback((): void => { setReady(true); setError(undefined) }, [])
  const onError = useCallback((message: string): void => { setReady(false); setError(errorText(message)) }, [errorText])
  useNativeSiYuanPresentation({
    active: context.active && !showingSettings && editorAvailable, ownerDocument: context.ownerDocument, url, sessionKey, reloadRevision, viewportRef: viewport, present, onReady, onError
  })

  useEffect(() => {
    if (!context.active || !ready || !url || showingSettings || !editorAvailable || !context.session || !sessionKey) return
    return visibleContext?.({ sessionId: context.session.id, nativeSessionId: sessionKey,
      ...(managed ? { spaceId } : {}), ...(context.session.workspaceRoot ? { workspaceId: context.session.workspaceRoot } : {}) })
  }, [context.active, ready, url, showingSettings, editorAvailable, context.session?.id, context.session?.workspaceRoot, sessionKey, managed, spaceId, resolutionKey, visibleContext])

  useEffect(() => {
    if (!configurationReady || !context.active || !editorAvailable || showingSettings || !serviceStatus || (managed ? !signedIn || !spaceId : serviceUrl === null && !configuration.url)) return
    // A still-valid managed view keeps its editor state when the panel returns.
    // Its renewal timer below handles the approaching expiry.
    if (managed && resolved?.key === resolutionKey && !sessionExpired) {
      // A different chat may have started an open that was cancelled when we
      // returned. Its finally callback cannot clear this page's pending UI.
      setOpening(false)
      return
    }
    let cancelled = false
    setOpening(true)
    setReady(false)
    setError(undefined)
    setRenewalError(undefined)
    // Restoring a chat starts at its saved revision; only a later explicit
    // Refresh/Retry asks for new authorization. Keys include account and chat.
    if (!openedRevisions.current.has(stateKey)) openedRevisions.current.set(stateKey, reloadRevision)
    const refresh = reloadRevision > openedRevisions.current.get(stateKey)!
    void (managed ? open({ spaceId, ...(refresh ? { refresh: true } : {}) }) : open()).then((next) => {
      if (!cancelled) {
        openedRevisions.current.set(stateKey, reloadRevision)
        setResolved({ ...next, key: resolutionKey })
      }
    }).catch((failure: unknown) => {
      if (!cancelled) setError(errorText(failure))
    }).finally(() => { if (!cancelled) setOpening(false) })
    return () => { cancelled = true }
  }, [context.active, configuration, open, serviceUrl, errorText, managed, signedIn, spaceId, resolutionKey, showingSettings, serviceStatus !== undefined, sessionExpired, renewalAttempt, editorAvailable, configurationReady, stateKey, reloadRevision])

  useEffect(() => {
    if (!configurationReady || !context.active || !editorAvailable || showingSettings || !managed || !signedIn || !spaceId ||
      resolved?.key !== resolutionKey || !resolved.expiresAt || sessionExpired) return
    let cancelled = false
    const timer = setTimeout(() => {
      void open({ spaceId }).then(next => {
        if (cancelled) return
        setResolved({ ...next, key: resolutionKey })
        setRenewalError(undefined)
      }).catch(failure => {
        if (!cancelled) setRenewalError(errorText(failure))
      })
    }, Math.max(1_000, Date.parse(resolved.expiresAt) - Date.now() - 30_000))
    return () => { cancelled = true; clearTimeout(timer) }
  }, [context.active, showingSettings, managed, signedIn, spaceId, resolved, resolutionKey, sessionExpired, open, errorText, renewalAttempt, editorAvailable, configurationReady])

  const failureMessage = error ?? directoryError ?? (statusError ? errorText(statusError) : undefined)
  const managedMessage = !serviceStatus ? text('正在确认账号…', 'Checking your account…')
    : !signedIn ? text('登录 SciForge 即可使用个人和项目空间。', 'Sign in to SciForge to access personal and project spaces.')
      : selectedSpace?.status === 'failed' ? !mayEnsureSelectedSpace ? text('项目空间创建失败，请联系项目负责人重试。', 'Project space provisioning failed. Ask its owner to retry.') : selectedSpace.failure?.retryable ? text('空间创建失败，可以重试。', 'Space provisioning failed. You can retry.') : text('空间暂不可用，请联系管理员。', 'This space is unavailable. Contact an administrator.')
        : selectedSpace && selectedSpace.status !== 'ready' ? text('正在准备空间，请稍候…', 'Preparing your space…')
          : !spaceId ? listing ? text('正在读取空间…', 'Loading spaces…') : text('请选择一个空间。', 'Choose a space.')
            : opening || !url ? text('正在安全登录云空间…', 'Signing in to your cloud space…')
              : !ready ? text('正在加载云文档编辑器…', 'Loading the cloud document editor…') : undefined
  const message = !editorAvailable ? text('请在 SciForge 桌面应用中打开云服务。当前浏览器无法显示内嵌编辑器。', 'Open Cloud Services in the SciForge desktop app. This browser cannot display the embedded editor.') : failureMessage ?? (managed ? managedMessage : opening || !ready ? text('正在连接云服务…（若服务启用了访问授权码，请在内嵌页面中解锁一次）', 'Connecting to cloud services… If your service uses an access code, unlock it in the embedded page.') : undefined)

  return (
    <section className={context.className + ' flex-col'} aria-label={text('云服务', 'Cloud Services')}>
      {managed && !showingSettings ? <div className="flex min-w-0 items-center gap-2 border-b border-ds-border bg-ds-card px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center">
          <select aria-label={text('云空间', 'Cloud space')} className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-bg px-2 py-1 text-ds-sm text-ds-ink"
            disabled={!signedIn} value={selectedSpace?.spaceId ?? ''} onChange={event => {
              if (event.target.value === selectedSpaceId) return
              setSelectedSpaceId(event.target.value); setError(undefined); setReady(false)
            }}>
            <option value="">{text('选择空间', 'Choose a space')}</option>
            {spaceChoices.map(space => <option key={space.spaceId} value={space.spaceId}>{space.scope.kind === 'personal' ? text('个人空间', 'Personal space') : projectChoices.find(project => space.scope.kind === 'project' && project.projectId === space.scope.projectId)?.name ?? text('项目空间', 'Project space')}</option>)}
          </select>
        </label>
        {sharing && context.active && url && sessionKey && spaceId && mayEnsureSelectedSpace ? <DocumentSharing key={JSON.stringify([sessionKey, spaceId])} controls={sharing} sessionId={sessionKey} spaceId={spaceId} /> : null}
        <button type="button" className={buttonClass} onClick={refreshSession}>{text('刷新', 'Refresh')}</button>
        <button type="button" className={buttonClass} onClick={() => setSettingsOpen(true)}>{text('设置', 'Settings')}</button>
      </div> : null}
      {renewalError && managed && !showingSettings ? <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-ds-border px-3 py-2 text-ds-sm text-ds-danger">
        <span>{text('云服务登录续期失败：', 'Cloud Services sign-in could not be renewed: ')}{renewalError}</span>
        <button type="button" className={buttonClass} onClick={() => {
          setRenewalError(undefined)
          setRenewalAttempt(value => value + 1)
        }}>{text('重试', 'Retry')}</button>
      </div> : null}
      {showingSettings ? <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          <h1 className="text-xl font-semibold">{text('连接云服务', 'Connect cloud services')}</h1>
          <p className="text-ds-muted">{managed ? text('个人和项目云空间随 SciForge 账号登录，无需填写服务地址或令牌。', 'Personal and project spaces use your SciForge account. No service address or token is needed.') : text('填写团队提供的服务地址即可开始。设置会保存在此设备，保存后自动连接。', 'Enter the service address provided by your team. Settings stay on this device; saving connects automatically.')}</p>
          {!needsConfiguration ? <button type="button" onClick={() => setSettingsOpen(false)}>{text('返回云服务', 'Back to cloud services')}</button> : null}
          {managed && directoryError ? <p role="alert" className="text-ds-sm text-ds-danger">{directoryError}</p> : null}
          {managed && (creatableProjects.length > 0 || selectedSpace?.status === 'failed' && selectedSpace.failure?.retryable && mayEnsureSelectedSpace) ? <div className="space-y-3 border-t border-ds-border pt-5">
            <h2 className="text-ds-md font-semibold text-ds-ink">{text('项目空间', 'Project spaces')}</h2>
            {creatableProjects.length > 0 && !createProjectOpen ? <button type="button" className={primaryButtonClass} onClick={() => setCreateProjectOpen(true)}>{text('开通项目空间', 'Set up project space')}</button> : null}
            {creatableProjects.length > 0 && createProjectOpen ? <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text('开通项目空间', 'Set up project space')}>
              <select className="w-full min-w-0 rounded-md border border-ds-border bg-ds-bg px-2 py-1 text-ds-sm text-ds-ink" aria-label={text('待开通项目', 'Project to set up')} value={createProjectId} onChange={event => setCreateProjectId(event.target.value)} disabled={creating}>
                <option value="">{text('选择项目', 'Choose a project')}</option>
                {creatableProjects.map(project => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
              </select>
              <button type="button" className={primaryButtonClass} disabled={!creatableProjects.some(project => project.projectId === createProjectId) || creating} onClick={() => { void ensureSpace({ scope: { kind: 'project', projectId: createProjectId } }) }}>{text('确认开通', 'Confirm')}</button>
              <button type="button" className={buttonClass} disabled={creating} onClick={() => { setCreateProjectOpen(false); setCreateProjectId('') }}>{text('取消', 'Cancel')}</button>
            </div> : null}
            {selectedSpace?.status === 'failed' && selectedSpace.failure?.retryable && mayEnsureSelectedSpace ? <button type="button" className={primaryButtonClass} disabled={creating} onClick={() => { void ensureSpace({ scope: selectedSpace.scope.kind === 'personal' ? { kind: 'personal' } : selectedSpace.scope, retryFailed: true }) }}>{text('重试创建', 'Retry provisioning')}</button> : null}
          </div> : null}
          <SiYuanSettingsSection service={service} settings={settings} onSaved={() => setSettingsOpen(false)} />
        </div>
      </div> : <div className="relative flex min-h-0 min-w-0 flex-1">
        <div ref={viewport} className="flex min-h-0 min-w-0 flex-1" data-siyuan-editor-slot="" />
        {message ? <div data-siyuan-scaffold="" role="presentation"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ds-bg p-6 text-center text-ds-muted">
          <p role={failureMessage ? 'alert' : 'status'} className={failureMessage ? 'max-w-xs text-ds-md text-ds-danger' : 'max-w-xs text-ds-md text-ds-ink'}>{message}</p>
          {failureMessage ? <>
            <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={primaryButtonClass}
              onClick={refreshSession}>{text('重试', 'Retry')}</button>
            <button type="button" className={buttonClass} onClick={() => setSettingsOpen(true)}>{text('连接设置', 'Connection settings')}</button>
            </div>
          </> : null}
        </div> : null}
      </div>}
    </section>
  )
}
