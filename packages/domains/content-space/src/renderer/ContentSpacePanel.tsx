import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  Info,
  Library,
  LoaderCircle,
  Upload,
  UserRound,
  UsersRound,
  X
} from 'lucide-react'

import type {
  DomainRendererFileTransferHost,
  DomainRendererSessionResource
} from '@sciforge/domain-sdk/host'

import {
  ARTIFACT_RESOURCE_KIND,
  CONTENT_CONTAINER_RESOURCE_KIND,
  CONTENT_FILE_RESOURCE_KIND,
  CONTENT_SPACE_LIMITS,
  type ArtifactReference,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpaceContainerSummary,
  type ContentSpaceEntrySummary,
  type ContentSpaceError,
  type ContentSpaceOperation,
  type ContentSpaceCapabilityState,
  type ContentSpaceResult,
  type ContentSpaceTransferProgress
} from '../contract.js'
import type { ContentSpaceCapabilityClient } from './capability-client.js'
import {
  parseContentSpaceProviderAccessState,
  type ContentSpaceProviderAccessState,
  type ContentSpaceProviderEnrollmentView
} from './provider-enrollment-view.js'

import './ContentSpacePanel.css'

const PAGE_SIZE = 50
const transferPickerCancelled = Symbol('content-space-transfer-picker-cancelled')
const immutableProofUnavailable = Symbol('content-space-immutable-proof-unavailable')
const EMPTY_ENROLLMENT_VIEWS: readonly ContentSpaceProviderEnrollmentView[] = Object.freeze([])

export type ContentSpacePanelProps = Readonly<{
  client: ContentSpaceCapabilityClient
  fileTransfers?: DomainRendererFileTransferHost
  className?: string
  onCollapse?: () => void
  initialResource?: DomainRendererSessionResource
  enrollmentViews?: readonly ContentSpaceProviderEnrollmentView[]
}>

export function ContentSpacePanel({
  client,
  fileTransfers,
  className,
  onCollapse,
  initialResource,
  enrollmentViews = EMPTY_ENROLLMENT_VIEWS
}: ContentSpacePanelProps) {
  const [providers, setProviders] = useState<readonly Readonly<{
    providerInstanceRef: string
    providerKind: string
    label: string
  }>[]>([])
  const [providerInstanceRef, setProviderInstanceRef] = useState('')
  const [providerDiscoveryReady, setProviderDiscoveryReady] = useState(false)
  const [navigationCapabilities, setNavigationCapabilities] = useState<
    readonly ContentSpaceCapabilityState[]
  >([])
  const [fileCapabilities, setFileCapabilities] = useState<
    readonly ContentSpaceCapabilityState[]
  >([])
  const [containers, setContainers] = useState<readonly ContentSpaceContainerSummary[]>([])
  const [containerCursor, setContainerCursor] = useState<string>()
  const [parent, setParent] = useState<ContentContainerReference>()
  const [entries, setEntries] = useState<readonly ContentSpaceEntrySummary[]>([])
  const [entryCursor, setEntryCursor] = useState<string>()
  const [selectedFile, setSelectedFile] = useState<ContentSpaceEntrySummary & {
    kind: 'file'
  }>()
  const [folderName, setFolderName] = useState('')
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [artifact, setArtifact] = useState<ArtifactReference>()
  const [status, setStatus] = useState('Loading Content Space…')
  const [error, setError] = useState<ContentSpaceError>()
  const [busy, setBusy] = useState(false)
  const [providerAccess, setProviderAccess] = useState<Readonly<{
    providerInstanceRef: string
    state: ContentSpaceProviderAccessState
  }>>()
  const [transferProgress, setTransferProgress] = useState<Readonly<{
    epoch: number
    snapshot: ContentSpaceTransferProgress
  }>>()
  const requestEpoch = useRef(0)
  const mutationEpoch = useRef(0)
  const selectedProviderRef = useRef('')
  const activeDiscovery = useRef<AbortController | undefined>(undefined)
  const activeRead = useRef<AbortController | undefined>(undefined)
  const activeMutation = useRef<AbortController | undefined>(undefined)
  const containerPagination = useRef(newPaginationLedger())
  const entryPagination = useRef(newPaginationLedger())

  const beginRead = useCallback(() => {
    activeRead.current?.abort()
    const controller = new AbortController()
    activeRead.current = controller
    const epoch = ++requestEpoch.current
    return { controller, epoch }
  }, [])

  const supersedeMutation = useCallback(() => {
    activeMutation.current?.abort()
    activeMutation.current = undefined
    mutationEpoch.current += 1
    setTransferProgress(undefined)
    setBusy(false)
  }, [])

  const clearProviderContent = useCallback(() => {
    activeRead.current?.abort()
    activeRead.current = undefined
    requestEpoch.current += 1
    containerPagination.current = newPaginationLedger()
    entryPagination.current = newPaginationLedger()
    setNavigationCapabilities([])
    setFileCapabilities([])
    setParent(undefined)
    setEntries([])
    setSelectedFile(undefined)
    setArtifact(undefined)
    setContainers([])
    setContainerCursor(undefined)
    setEntryCursor(undefined)
    setFolderName('')
    setShowCreateFolder(false)
    setTransferProgress(undefined)
    setError(undefined)
  }, [])

  const loadContainers = useCallback(async (
    targetProviderInstanceRef: string,
    cursor?: string,
    append = false
  ) => {
    const ledger = preparePaginationPage(
      containerPagination,
      `provider:${targetProviderInstanceRef}`,
      cursor,
      append
    )
    if (!ledger) {
      setContainerCursor(undefined)
      setError(paginationError())
      setStatus('')
      return
    }
    const { controller, epoch } = beginRead()
    setStatus(append ? 'Loading more spaces…' : 'Loading spaces…')
    setError(undefined)
    try {
      const result = await client.listContainers({
        providerInstanceRef: targetProviderInstanceRef,
        page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
      }, { signal: controller.signal })
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      const page = unwrap(result)
      const itemKeys = page.items.map(({ reference }) => reference.containerId)
      if (itemKeys.some((key) => ledger.items.has(key))) {
        setContainerCursor(undefined)
        setError(paginationError())
        setStatus('')
        return
      }
      itemKeys.forEach((key) => ledger.items.add(key))
      setContainers((current) => append ? [...current, ...page.items] : page.items)
      setContainerCursor(page.nextCursor)
      setStatus(page.items.length === 0 ? 'No spaces are available.' : '')
    } catch (caught) {
      if (cursor) ledger.cursors.delete(cursor)
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    }
  }, [beginRead, client])

  const loadProvider = useCallback(async (targetProviderInstanceRef: string) => {
    const { controller, epoch } = beginRead()
    setNavigationCapabilities([])
    setFileCapabilities([])
    setStatus('Checking Provider readiness…')
    setError(undefined)
    try {
      const result = await client.describeCapabilities(
        targetProviderInstanceRef,
        { signal: controller.signal }
      )
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      const states = unwrap(result).items
      setNavigationCapabilities(states)
      const listState = states.find(({ operation }) => operation === 'list-containers')
      if (!listState || listState.readiness === 'blocked_by_contract') {
        setStatus('This Provider cannot list Content Space containers yet.')
        return
      }
      void loadContainers(targetProviderInstanceRef)
    } catch (caught) {
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    }
  }, [beginRead, client, loadContainers])

  const loadEntries = useCallback(async (
    targetParent: ContentContainerReference,
    cursor?: string,
    append = false
  ) => {
    const ledger = preparePaginationPage(
      entryPagination,
      `container:${targetParent.providerInstanceRef}:${targetParent.containerId}`,
      cursor,
      append
    )
    if (!ledger) {
      setEntryCursor(undefined)
      setError(paginationError())
      setStatus('')
      return
    }
    const { controller, epoch } = beginRead()
    setStatus(append ? 'Loading more entries…' : 'Loading entries…')
    setError(undefined)
    try {
      const result = await client.listEntries({
        parent: targetParent,
        page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) }
      }, { signal: controller.signal })
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      const page = unwrap(result)
      const itemKeys = page.items.map((item) => item.kind === 'container'
        ? `container:${item.reference.containerId}`
        : `file:${item.reference.fileId}`)
      if (itemKeys.some((key) => ledger.items.has(key))) {
        setEntryCursor(undefined)
        setError(paginationError())
        setStatus('')
        return
      }
      itemKeys.forEach((key) => ledger.items.add(key))
      setEntries((current) => append ? [...current, ...page.items] : page.items)
      setEntryCursor(page.nextCursor)
      setStatus(page.items.length === 0 ? 'This space is empty.' : '')
    } catch (caught) {
      if (cursor) ledger.cursors.delete(cursor)
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    }
  }, [beginRead, client])

  const openInitialResource = useCallback((
    resource: DomainRendererSessionResource & Readonly<{
      kind:
        | typeof CONTENT_CONTAINER_RESOURCE_KIND
        | typeof CONTENT_FILE_RESOURCE_KIND
        | typeof ARTIFACT_RESOURCE_KIND
    }>,
    expectedProviderInstanceRef?: string
  ) => {
    const { controller, epoch } = beginRead()
    supersedeMutation()
    setParent(undefined)
    setEntries([])
    setEntryCursor(undefined)
    setSelectedFile(undefined)
    setArtifact(undefined)
    setNavigationCapabilities([])
    setFileCapabilities([])
    setStatus('Opening Content Space resource…')
    setError(undefined)
    void client.observeResource({
      resourceKind: resource.kind,
      resource: resource.resource
    }, { signal: controller.signal }).then((observed) => {
      if (controller.signal.aborted || epoch !== requestEpoch.current || !observed) return
      const reference = observed.reference
      if (expectedProviderInstanceRef &&
        reference.providerInstanceRef !== expectedProviderInstanceRef) {
        setStatus('This resource does not belong to the selected content source.')
        return
      }
      selectedProviderRef.current = reference.providerInstanceRef
      setProviderInstanceRef(reference.providerInstanceRef)
      if ('containerId' in reference) {
        setNavigationCapabilities(observed.capabilities)
        setFileCapabilities([])
        setSelectedFile(undefined)
        setArtifact(undefined)
        setParent(reference)
        if (isOperationReady(observed.capabilities, 'list-entries')) {
          void loadEntries(reference)
        } else {
          setStatus('This Provider cannot list entries for the selected container.')
        }
      } else {
        setNavigationCapabilities([])
        setFileCapabilities(observed.capabilities)
        setParent(undefined)
        setEntries([])
        setSelectedFile(observed.entry.kind === 'file' ? observed.entry : undefined)
        setArtifact('immutableVersionId' in reference ? reference : undefined)
        setStatus('')
      }
    }).catch((caught) => {
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    })
  }, [beginRead, client, loadEntries, supersedeMutation])

  const checkProviderAccess = useCallback(async (
    targetProviderInstanceRef: string,
    enrollmentView: ContentSpaceProviderEnrollmentView,
    onReady: () => void
  ) => {
    const { controller, epoch } = beginRead()
    setProviderAccess(Object.freeze({
      providerInstanceRef: targetProviderInstanceRef,
      state: Object.freeze({ status: 'checking' as const })
    }))
    setStatus('Checking source access…')
    setError(undefined)
    try {
      const state = parseContentSpaceProviderAccessState(
        await enrollmentView.readAccessState({
          providerInstanceRef: targetProviderInstanceRef,
          signal: controller.signal
        })
      )
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      setProviderAccess(Object.freeze({
        providerInstanceRef: targetProviderInstanceRef,
        state
      }))
      if (state.status === 'ready') onReady()
      else setStatus('')
    } catch {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      setProviderAccess(Object.freeze({
        providerInstanceRef: targetProviderInstanceRef,
        state: Object.freeze({ status: 'unavailable' as const })
      }))
      setStatus('')
    }
  }, [beginRead])

  const activateProvider = useCallback((
    next: string,
    resource?: DomainRendererSessionResource & Readonly<{
      kind:
        | typeof CONTENT_CONTAINER_RESOURCE_KIND
        | typeof CONTENT_FILE_RESOURCE_KIND
        | typeof ARTIFACT_RESOURCE_KIND
    }>
  ) => {
    supersedeMutation()
    clearProviderContent()
    selectedProviderRef.current = next
    setProviderInstanceRef(next)
    setProviderAccess(undefined)
    if (!next) {
      setStatus(resource
        ? 'Choose the content source for this resource.'
        : 'Select a Provider Instance.')
      return
    }
    const provider = providers.find((candidate) =>
      candidate.providerInstanceRef === next
    )
    if (!provider) {
      setStatus('The selected Provider is no longer installed.')
      return
    }
    const matchingViews = enrollmentViews.filter((view) =>
      view.providerKind === provider.providerKind
    )
    if (matchingViews.length > 1) {
      setProviderAccess(Object.freeze({
        providerInstanceRef: next,
        state: Object.freeze({ status: 'unavailable' as const })
      }))
      setStatus('Provider access configuration is unavailable.')
      return
    }
    const continueAfterAccess = () => {
      if (resource) openInitialResource(resource, next)
      else void loadProvider(next)
    }
    const enrollmentView = matchingViews[0]
    if (enrollmentView) {
      void checkProviderAccess(next, enrollmentView, continueAfterAccess)
    } else {
      continueAfterAccess()
    }
  }, [
    checkProviderAccess,
    clearProviderContent,
    enrollmentViews,
    loadProvider,
    openInitialResource,
    providers,
    supersedeMutation
  ])

  useEffect(() => {
    const controller = new AbortController()
    activeDiscovery.current = controller
    setProviderDiscoveryReady(false)
    setProviders([])
    void client.listProviderInstances({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      const list = unwrap(result).items
      setProviders(list)
      setProviderDiscoveryReady(true)
      setStatus((current) => current === 'Loading Content Space…'
        ? (list.length > 0
          ? 'Select a Provider Instance.'
          : 'No Content Space Provider is installed.')
        : current)
    }).catch((caught) => {
      if (controller.signal.aborted) return
      setError(errorFrom(caught))
      setStatus('')
    })
    return () => {
      controller.abort()
      if (activeDiscovery.current === controller) activeDiscovery.current = undefined
    }
  }, [client])

  useEffect(() => () => {
    activeDiscovery.current?.abort()
    activeRead.current?.abort()
    activeMutation.current?.abort()
  }, [])

  useEffect(() => {
    if (!providerDiscoveryReady || !isContentSpaceInitialResource(initialResource)) return
    if (providers.length === 0) {
      activateProvider('', initialResource)
      setStatus('No Content Space Provider is installed.')
      return
    }
    if (providers.length === 1) {
      activateProvider(providers[0]!.providerInstanceRef, initialResource)
      return
    }
    activateProvider('', initialResource)
  }, [activateProvider, initialResource, providerDiscoveryReady, providers])

  const selectProvider = (next: string) => {
    activateProvider(
      next,
      isContentSpaceInitialResource(initialResource) ? initialResource : undefined
    )
  }

  const openContainer = (reference: ContentContainerReference) => {
    supersedeMutation()
    const { controller, epoch } = beginRead()
    setParent(reference)
    setEntries([])
    setEntryCursor(undefined)
    setSelectedFile(undefined)
    setArtifact(undefined)
    setNavigationCapabilities([])
    setFileCapabilities([])
    setStatus('Checking container readiness…')
    setError(undefined)
    void client.observeEntry(reference, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      const observation = unwrap(result)
      setNavigationCapabilities(observation.capabilities)
      if (isOperationReady(observation.capabilities, 'list-entries')) {
        void loadEntries(reference)
      } else {
        setStatus('This Provider cannot list entries for the selected container.')
      }
    }).catch((caught) => {
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    })
  }

  const selectFile = (entry: ContentSpaceEntrySummary & { kind: 'file' }) => {
    supersedeMutation()
    const { controller, epoch } = beginRead()
    setSelectedFile(entry)
    setArtifact(undefined)
    setFileCapabilities([])
    setStatus('Checking file readiness…')
    setError(undefined)
    void client.observeEntry(entry.reference, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      const observation = unwrap(result)
      if (observation.entry.kind !== 'file') {
        throw new Error('Provider returned a non-file observation.')
      }
      setSelectedFile(observation.entry)
      setFileCapabilities(observation.capabilities)
      setStatus('')
    }).catch((caught) => {
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        setError(errorFrom(caught))
        setStatus('')
      }
    })
  }

  const returnToSpaces = () => {
    supersedeMutation()
    setParent(undefined)
    setEntries([])
    setSelectedFile(undefined)
    setArtifact(undefined)
    setNavigationCapabilities([])
    setFileCapabilities([])
    setContainers([])
    setContainerCursor(undefined)
    setEntryCursor(undefined)
    if (providerInstanceRef) void loadProvider(providerInstanceRef)
  }

  const runMutation = async (
    label: string,
    operation: (
      signal: AbortSignal,
      reportTransferPhase: (phase: ContentSpaceTransferProgress['phase']) => void
    ) => Promise<ContentSpaceResult<unknown>>,
    afterSuccess?: () => void | Promise<void>,
    transferOperation?: ContentSpaceTransferProgress['operation']
  ) => {
    activeMutation.current?.abort()
    const controller = new AbortController()
    const epoch = ++mutationEpoch.current
    let transferTerminal = false
    activeMutation.current = controller
    const reportTransferPhase = (
      phase: ContentSpaceTransferProgress['phase'],
      afterAbort = false
    ) => {
      if (!transferOperation || activeMutation.current !== controller ||
        mutationEpoch.current !== epoch || (controller.signal.aborted && !afterAbort)) return
      transferTerminal ||= ['succeeded', 'failed', 'cancelled'].includes(phase)
      setTransferProgress(Object.freeze({
        epoch,
        snapshot: Object.freeze({ operation: transferOperation, phase })
      }))
    }
    if (transferOperation) reportTransferPhase('selecting')
    else setTransferProgress(undefined)
    setBusy(true)
    setError(undefined)
    setStatus(label)
    try {
      unwrap(await operation(controller.signal, reportTransferPhase))
      if (controller.signal.aborted) {
        if (!transferTerminal) reportTransferPhase('cancelled', true)
        return
      }
      if (!transferTerminal) reportTransferPhase('succeeded')
      // The capability receipt is the authoritative terminal result. End the
      // cancellable mutation before any best-effort refresh so a slow read
      // cannot relabel a committed write as cancelled or invite a blind retry.
      if (activeMutation.current === controller) {
        activeMutation.current = undefined
        setBusy(false)
      }
      setStatus('Done.')
      if (afterSuccess) {
        try {
          await afterSuccess()
        } catch (caught) {
          setError(errorFrom(caught))
          setStatus('The operation succeeded, but Content Space could not refresh the view.')
        }
      }
      return
    } catch (caught) {
      if (caught === transferPickerCancelled) {
        reportTransferPhase('cancelled', true)
        setStatus('')
        return
      }
      if (caught === immutableProofUnavailable) {
        setStatus('Provider cannot prove a retained immutable version for this file.')
        return
      }
      if (controller.signal.aborted && isAbortError(caught)) {
        reportTransferPhase('cancelled', true)
        setStatus('')
        return
      }
      const domainError = errorFrom(caught)
      reportTransferPhase(
        domainError.code === 'cancelled' ? 'cancelled' : 'failed',
        true
      )
      if (!controller.signal.aborted || domainError.code !== 'cancelled') {
        setError(domainError)
      }
      setStatus(domainError.code === 'outcome_unknown'
        ? 'Verify the Provider and destination state before taking another action.'
        : '')
    } finally {
      if (activeMutation.current === controller) {
        activeMutation.current = undefined
        setBusy(false)
      }
    }
  }

  const cancelMutation = () => {
    const controller = activeMutation.current
    if (!controller) return
    controller.abort()
    setTransferProgress((current) => current?.epoch === mutationEpoch.current
      ? Object.freeze({
          epoch: current.epoch,
          snapshot: Object.freeze({
            operation: current.snapshot.operation,
            phase: 'cancelled' as const
          })
        })
      : current)
  }

  const createFolder = (event: FormEvent) => {
    event.preventDefault()
    if (!parent || !folderName.trim() ||
      !isOperationReady(navigationCapabilities, 'create-folder')) return
    const name = folderName.trim()
    void runMutation('Creating folder…', (signal) => client.createFolder(
      { parent, name },
      { approval: { mode: 'confirmation' }, signal }
    ), async () => {
      setFolderName('')
      setShowCreateFolder(false)
      await loadEntries(parent)
    })
  }

  const uploadNew = () => {
    if (!parent || !fileTransfers ||
      !isOperationReady(navigationCapabilities, 'upload-new')) return
    void runMutation('Selecting upload source…', async (signal, reportProgress) => {
      const selection = await fileTransfers.pickUploadSource({
        title: 'Upload a new file',
        maxBytes: CONTENT_SPACE_LIMITS.maxUploadBytes
      }, { signal })
      if (selection.cancelled) {
        reportProgress('cancelled')
        throw transferPickerCancelled
      }
      reportProgress('preparing')
      setStatus(`Uploading ${selection.name}…`)
      reportProgress('uploading')
      const result = await client.uploadNew({
        parent,
        name: selection.name,
        sourceHandle: selection.handle
      }, { approval: { mode: 'confirmation' }, signal })
      if (!signal.aborted) reportProgress('finalizing')
      return result
    }, () => loadEntries(parent), 'upload')
  }

  const download = (entry: ContentSpaceEntrySummary & { kind: 'file' }) => {
    if (!fileTransfers || !isOperationReady(fileCapabilities, 'download')) return
    void runMutation('Selecting download destination…', async (signal, reportProgress) => {
      const selection = await fileTransfers.pickDownloadDestination({
        title: 'Download Content Space file',
        suggestedName: safeSuggestedDownloadName(entry.label)
      }, { signal })
      if (selection.cancelled) {
        reportProgress('cancelled')
        throw transferPickerCancelled
      }
      reportProgress('preparing')
      setStatus(`Downloading ${selection.label}…`)
      const exactArtifact = exactArtifactFor(artifact, entry)
      reportProgress('downloading')
      const result = await client.download({
        reference: exactArtifact ?? entry.reference,
        destinationHandle: selection.handle
      }, { approval: { mode: 'confirmation' }, signal })
      if (!signal.aborted) reportProgress('finalizing')
      return result
    }, undefined, 'download')
  }

  const observeImmutable = (reference: ContentFileReference) => {
    if (!isOperationReady(fileCapabilities, 'observe-immutable-version')) return
    void runMutation('Verifying immutable version…', async (signal) => {
      const result = await client.observeImmutableVersion(reference, { signal })
      if (result.ok && !result.value.proven) throw immutableProofUnavailable
      if (!signal.aborted && result.ok && result.value.proven &&
        result.value.artifact.providerInstanceRef === reference.providerInstanceRef &&
        result.value.artifact.fileId === reference.fileId) {
        setArtifact(result.value.artifact)
      }
      return result
    })
  }

  const openPortal = (reference: ContentEntryReference) => {
    if (!isOperationReady(fileCapabilities, 'portal-target')) return
    void runMutation('Opening Provider portal…', (signal) => client.openPortal(
      reference,
      { approval: { mode: 'confirmation' }, signal }
    ))
  }

  const selectedProvider = providers.find((provider) =>
    provider.providerInstanceRef === providerInstanceRef
  )
  const selectedEnrollmentViews = selectedProvider
    ? enrollmentViews.filter((view) => view.providerKind === selectedProvider.providerKind)
    : []
  const selectedEnrollmentView = selectedEnrollmentViews.length === 1
    ? selectedEnrollmentViews[0]
    : undefined
  const selectedAccessState = providerAccess?.providerInstanceRef === providerInstanceRef
    ? providerAccess.state
    : undefined
  const refreshProviderAccess = () => {
    if (!providerInstanceRef || !selectedEnrollmentView) return
    if (selectedProviderRef.current !== providerInstanceRef) return
    activateProvider(
      providerInstanceRef,
      isContentSpaceInitialResource(initialResource) ? initialResource : undefined
    )
  }

  const selectedArtifact = selectedFile ? exactArtifactFor(artifact, selectedFile) : undefined
  const displayedCapabilities = selectedFile ? fileCapabilities : navigationCapabilities
  const readyCapabilityCount = displayedCapabilities.filter((state) =>
    state.readiness === 'production_ready'
  ).length
  const verificationRequiredCount = displayedCapabilities.filter((state) =>
    state.reasonCode === 'verification_profile_required'
  ).length

  return (
    <section
      className={mergeClassNames('content-space-panel', className)}
      data-content-space-panel
      aria-busy={busy}
    >
      <header className="content-space-header">
        <span className="content-space-brand-mark" aria-hidden>
          <Library size={17} strokeWidth={1.75} />
        </span>
        <span className="content-space-heading">
          <h2>Content Space</h2>
          <span>Choose a source and browse its libraries</span>
        </span>
        <span className="content-space-header-actions">
        {busy && (
          <button type="button" onClick={cancelMutation} className="content-space-cancel-button">
            <X size={13} strokeWidth={1.9} aria-hidden />
            Cancel
          </button>
        )}
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse Content Space"
            className="content-space-icon-button">
            <X size={15} strokeWidth={1.8} aria-hidden />
          </button>
        )}
        </span>
      </header>

      <div className="content-space-provider-section">
        <div className="content-space-source-stack">
          <div className="content-space-section-label">
            <label htmlFor="content-space-provider">Content source</label>
            <span aria-live="polite">{providerInstanceRef
              ? selectedEnrollmentView && selectedAccessState
                ? providerAccessLabel(selectedAccessState)
                : 'Source selected'
              : 'Choose a source'}</span>
          </div>
          <div className="content-space-select-wrap">
            <HardDrive size={16} strokeWidth={1.75} aria-hidden />
            <select id="content-space-provider" value={providerInstanceRef}
              onChange={(event) => selectProvider(event.target.value)} disabled={busy}>
              <option value="">Choose a content source…</option>
              {providers.map((provider) => (
                <option key={provider.providerInstanceRef} value={provider.providerInstanceRef}>
                  {provider.label}
                </option>
              ))}
            </select>
            <ChevronDown className="content-space-select-chevron" size={15} strokeWidth={1.8}
              aria-hidden />
          </div>
          {providerInstanceRef && displayedCapabilities.length > 0 && (
            <details className="content-space-readiness">
              <summary>
                <span className={verificationRequiredCount > 0
                  ? 'content-space-status-dot is-development'
                  : 'content-space-status-dot is-ready'} aria-hidden />
                <span className="content-space-readiness-summary">
                  Provider details · {readyCapabilityCount} of {displayedCapabilities.length} operations available
                </span>
                {verificationRequiredCount > 0 && (
                  <span className="content-space-readiness-profile">Verification required</span>
                )}
                <ChevronDown className="content-space-readiness-chevron" size={14}
                  strokeWidth={1.8} aria-hidden />
              </summary>
              <ul aria-label="Content Space Provider readiness">
                {displayedCapabilities.map((state) => (
                  <li key={state.operation} data-operation={state.operation}
                    data-readiness={state.readiness}>
                    <span className="content-space-capability-name">{state.operation}: </span>
                    <span className={`content-space-capability-state is-${state.readiness}`}>
                      {readinessLabel(state)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <div className="content-space-scroll-region">
        {selectedEnrollmentView && selectedAccessState && (
          <div
            className="content-space-provider-enrollment"
            data-content-space-provider-enrollment
            data-access-status={selectedAccessState.status}
          >
            <span className="content-space-source-line" aria-hidden>
              <span className="content-space-source-node" />
            </span>
            <div className="content-space-provider-enrollment-content">
              {selectedEnrollmentView.render({
                providerInstanceRef,
                accessState: selectedAccessState,
                onAccessChanged: refreshProviderAccess
              })}
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="content-space-message is-error">
            <AlertCircle size={15} strokeWidth={1.8} aria-hidden />
            <span>{error.message} <code>({error.code})</code></span>
          </div>
        )}
        {status && (
          <p className="content-space-message" role="status" aria-live="polite">
            {status.endsWith('…')
              ? <LoaderCircle className="content-space-spinner" size={15} strokeWidth={1.8}
                  aria-hidden />
              : status === 'Done.'
                ? <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden />
                : <Info size={15} strokeWidth={1.8} aria-hidden />}
            <span>{status}</span>
          </p>
        )}
        {transferProgress && (
          <p role="status" aria-live="polite" data-content-space-transfer-progress
            data-operation={transferProgress.snapshot.operation}
            data-phase={transferProgress.snapshot.phase}
            className={`content-space-message is-transfer is-${transferProgress.snapshot.phase}`}>
            {transferProgress.snapshot.phase === 'succeeded'
              ? <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden />
              : transferProgress.snapshot.phase === 'failed'
                ? <AlertCircle size={15} strokeWidth={1.8} aria-hidden />
                : <LoaderCircle className={transferProgress.snapshot.phase === 'cancelled'
                  ? undefined
                  : 'content-space-spinner'} size={15} strokeWidth={1.8} aria-hidden />}
            <span>{transferProgressLabel(transferProgress.snapshot)}</span>
          </p>
        )}

        {!parent ? (
          <div className="content-space-libraries">
            {containers.length > 0 && (
              <div className="content-space-list-heading">
                <span>Libraries</span>
                <span>{containers.length}</span>
              </div>
            )}
            <div className="content-space-library-stack">
              {containers.length > 0 && <span className="content-space-library-rail" aria-hidden />}
              {containers.map((container) => (
                <button type="button" key={container.reference.containerId}
                  onClick={() => openContainer(container.reference)}
                  disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                  className="content-space-library-row">
                  <span className="content-space-library-node" aria-hidden />
                  <span className="content-space-library-icon" data-scope={container.scope}
                    aria-hidden>
                    {container.scope === 'personal'
                      ? <UserRound size={16} strokeWidth={1.75} />
                      : <UsersRound size={16} strokeWidth={1.75} />}
                  </span>
                  <span className="content-space-library-copy">
                    <span>{container.label}</span>
                    <span className="content-space-scope-pill">
                      {container.scope === 'personal' ? 'Personal' : 'Shared'}
                    </span>
                  </span>
                  <ChevronRight className="content-space-row-chevron" size={16} strokeWidth={1.8}
                    aria-hidden />
                </button>
              ))}
            </div>
            {containerCursor && (
              <button type="button" onClick={() => void loadContainers(
                providerInstanceRef, containerCursor, true
              )} disabled={busy || !isOperationReady(navigationCapabilities, 'list-containers')}
                className="content-space-secondary-button is-full-width">
                <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
                Load more spaces
              </button>
            )}
          </div>
        ) : (
          <div className="content-space-folder-view">
            <div className="content-space-folder-heading">
              <button type="button" onClick={returnToSpaces}
                className="content-space-back-button">
                <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
                Libraries
              </button>
              <span className="content-space-folder-identity">
                <span>Current folder</span>
                <code>{parent.containerId}</code>
              </span>
            </div>

            <div className="content-space-folder-actions">
              <button type="button" onClick={() => setShowCreateFolder((value) => !value)}
                aria-pressed={showCreateFolder}
                disabled={busy || !isOperationReady(navigationCapabilities, 'create-folder')}
                className="content-space-secondary-button">
                <FolderPlus size={14} strokeWidth={1.8} aria-hidden />
                New folder
              </button>
              <button type="button" onClick={uploadNew}
                disabled={busy || !fileTransfers ||
                  !isOperationReady(navigationCapabilities, 'upload-new')}
                className="content-space-primary-button">
                <Upload size={14} strokeWidth={1.8} aria-hidden />
                Upload new
              </button>
            </div>

            {showCreateFolder && (
              <form onSubmit={createFolder} className="content-space-create-form">
                <input value={folderName} maxLength={CONTENT_SPACE_LIMITS.maxEntryNameCharacters}
                  onChange={(event) => setFolderName(event.target.value)} autoFocus
                  placeholder="Folder name" />
                <button type="submit" disabled={busy || !folderName.trim() ||
                  !isOperationReady(navigationCapabilities, 'create-folder')}
                  className="content-space-primary-button">
                  Create
                </button>
              </form>
            )}

            <div className="content-space-entry-list">
              {entries.map((entry) => entry.kind === 'container' ? (
                <button type="button" key={`container:${entry.reference.containerId}`}
                  onClick={() => openContainer(entry.reference)}
                  disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                  className="content-space-entry-row">
                  <span className="content-space-entry-icon" aria-hidden>
                    <Folder size={16} strokeWidth={1.75} />
                  </span>
                  <span className="content-space-entry-name">{entry.label}</span>
                  <ChevronRight className="content-space-row-chevron" size={15} strokeWidth={1.8}
                    aria-hidden />
                </button>
              ) : (
                <button type="button" key={`file:${entry.reference.fileId}`}
                  onClick={() => {
                    selectFile(entry)
                  }} disabled={busy}
                  aria-pressed={selectedFile?.reference.fileId === entry.reference.fileId}
                  className="content-space-entry-row">
                  <span className="content-space-entry-icon is-file" aria-hidden>
                    <File size={16} strokeWidth={1.75} />
                  </span>
                  <span className="content-space-entry-name">{entry.label}</span>
                  <span className="content-space-entry-size">{entry.size} B</span>
                </button>
              ))}
            </div>
            {entryCursor && (
              <button type="button" onClick={() => void loadEntries(parent, entryCursor, true)}
                disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                className="content-space-secondary-button is-full-width">
                <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
                Load more entries
              </button>
            )}
          </div>
        )}
      </div>

      {selectedFile && (
        <footer className="content-space-file-footer">
          <div className="content-space-selected-file">
            <span className="content-space-entry-icon is-file" aria-hidden>
              <File size={16} strokeWidth={1.75} />
            </span>
            <span>
              <strong>{selectedFile.label}</strong>
          {selectedArtifact && (
                <code>Immutable · {selectedArtifact.immutableVersionId}</code>
          )}
            </span>
          </div>
          <div className="content-space-file-actions">
            {!parent && (
              <button type="button" onClick={returnToSpaces} disabled={busy}
                className="content-space-secondary-button">
                <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
                Libraries
              </button>
            )}
            <button type="button" disabled={busy || !fileTransfers ||
              !isOperationReady(fileCapabilities, 'download')}
              onClick={() => download(selectedFile)}
              className="content-space-secondary-button">
              <Download size={14} strokeWidth={1.8} aria-hidden />
              Download
            </button>
            <button type="button"
              disabled={busy || !isOperationReady(fileCapabilities, 'observe-immutable-version')}
              onClick={() => observeImmutable(selectedFile.reference)}
              className="content-space-secondary-button">
              <CheckCircle2 size={14} strokeWidth={1.8} aria-hidden />
              Verify immutable
            </button>
            <button type="button" disabled={busy ||
              !isOperationReady(fileCapabilities, 'portal-target')}
              onClick={() => openPortal(
                selectedArtifact ?? selectedFile.reference
              )}
              className="content-space-secondary-button">
              <ExternalLink size={14} strokeWidth={1.8} aria-hidden />
              Open Provider portal
            </button>
          </div>
        </footer>
      )}
    </section>
  )
}

function mergeClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

type ContentSpaceInitialResource = DomainRendererSessionResource & Readonly<{
  kind:
    | typeof CONTENT_CONTAINER_RESOURCE_KIND
    | typeof CONTENT_FILE_RESOURCE_KIND
    | typeof ARTIFACT_RESOURCE_KIND
}>

function isContentSpaceInitialResource(
  resource: DomainRendererSessionResource | undefined
): resource is ContentSpaceInitialResource {
  return resource?.kind === CONTENT_CONTAINER_RESOURCE_KIND ||
    resource?.kind === CONTENT_FILE_RESOURCE_KIND ||
    resource?.kind === ARTIFACT_RESOURCE_KIND
}

function readinessLabel(state: ContentSpaceCapabilityState): string {
  if (state.readiness === 'production_ready') return 'ready'
  if (state.reasonCode === 'verification_profile_required') {
    return 'unavailable (verification required)'
  }
  return 'unavailable'
}

function providerAccessLabel(state: ContentSpaceProviderAccessState): string {
  if (state.status === 'checking') return 'Checking…'
  if (state.status === 'ready') return 'Connected'
  if (state.status === 'human_action_required') return 'Needs connection'
  return 'Temporarily unavailable'
}

function unwrap<Value>(result: ContentSpaceResult<Value>): Value {
  if (result.ok) return result.value
  throw result.error
}

function isOperationReady(
  capabilities: readonly ContentSpaceCapabilityState[],
  operation: ContentSpaceOperation
): boolean {
  return capabilities.some((state) =>
    state.operation === operation && state.readiness === 'production_ready'
  )
}

function exactArtifactFor(
  artifact: ArtifactReference | undefined,
  entry: ContentSpaceEntrySummary & { kind: 'file' }
): ArtifactReference | undefined {
  return artifact?.providerInstanceRef === entry.reference.providerInstanceRef &&
    artifact.fileId === entry.reference.fileId
    ? artifact
    : undefined
}

function safeSuggestedDownloadName(label: string): string {
  const safe = [...label].map((character) => {
    const codePoint = character.codePointAt(0)!
    return character === '/' || character === '\\' || codePoint <= 0x1f || codePoint === 0x7f
      ? '_'
      : character
  }).join('').trim().slice(0, CONTENT_SPACE_LIMITS.maxLabelCharacters)
  return safe && safe !== '.' && safe !== '..' ? safe : 'content-space-download'
}

function transferProgressLabel(progress: ContentSpaceTransferProgress): string {
  const labels: Readonly<Record<ContentSpaceTransferProgress['phase'], string>> = {
    selecting: `Selecting ${progress.operation === 'upload' ? 'source' : 'destination'}…`,
    preparing: 'Preparing transfer…',
    uploading: 'Uploading…',
    downloading: 'Downloading…',
    finalizing: 'Finalizing transfer…',
    succeeded: 'Transfer completed.',
    failed: 'Transfer failed; review the reported outcome before retrying.',
    cancelled: 'Transfer cancelled.'
  }
  return labels[progress.phase]
}

function errorFrom(value: unknown): ContentSpaceError {
  if (value && typeof value === 'object' && 'code' in value && 'message' in value) {
    return {
      code: String(value.code) as ContentSpaceError['code'],
      message: String(value.message).slice(0, 256),
      retry: 'never'
    }
  }
  return {
    code: 'provider_unavailable',
    message: 'Content Space operation failed.',
    retry: 'never'
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException
    ? value.name === 'AbortError'
    : Boolean(value && typeof value === 'object' && 'name' in value &&
      value.name === 'AbortError')
}

type PaginationLedger = {
  scope: string
  readonly cursors: Set<string>
  readonly items: Set<string>
}

function newPaginationLedger(scope = ''): PaginationLedger {
  return { scope, cursors: new Set(), items: new Set() }
}

function preparePaginationPage(
  ledgerRef: { current: PaginationLedger },
  scope: string,
  cursor: string | undefined,
  append: boolean
): PaginationLedger | undefined {
  if (!append || ledgerRef.current.scope !== scope) {
    ledgerRef.current = newPaginationLedger(scope)
  } else if (!cursor || ledgerRef.current.cursors.has(cursor)) {
    return undefined
  }
  if (cursor) ledgerRef.current.cursors.add(cursor)
  return ledgerRef.current
}

function paginationError(): ContentSpaceError {
  return Object.freeze({
    code: 'provider_unavailable',
    message: 'The Provider returned non-progressing or duplicate pagination.',
    retry: 'never'
  })
}
