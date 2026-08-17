import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react'

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

const PAGE_SIZE = 50
const transferPickerCancelled = Symbol('content-space-transfer-picker-cancelled')
const immutableProofUnavailable = Symbol('content-space-immutable-proof-unavailable')

export type ContentSpacePanelProps = Readonly<{
  client: ContentSpaceCapabilityClient
  fileTransfers?: DomainRendererFileTransferHost
  className?: string
  onCollapse?: () => void
  initialResource?: DomainRendererSessionResource
}>

export function ContentSpacePanel({
  client,
  fileTransfers,
  className,
  onCollapse,
  initialResource
}: ContentSpacePanelProps) {
  const [providers, setProviders] = useState<readonly Readonly<{
    providerInstanceRef: string
    label: string
  }>[]>([])
  const [providerInstanceRef, setProviderInstanceRef] = useState('')
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
  const [transferProgress, setTransferProgress] = useState<Readonly<{
    epoch: number
    snapshot: ContentSpaceTransferProgress
  }>>()
  const requestEpoch = useRef(0)
  const mutationEpoch = useRef(0)
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
      if (listState?.readiness !== 'production_ready') {
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

  useEffect(() => {
    const controller = new AbortController()
    activeDiscovery.current = controller
    void client.listProviderInstances({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      const list = unwrap(result).items
      setProviders(list)
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
    if (!initialResource) return
    if (![CONTENT_CONTAINER_RESOURCE_KIND, CONTENT_FILE_RESOURCE_KIND, ARTIFACT_RESOURCE_KIND]
      .includes(initialResource.kind as typeof CONTENT_CONTAINER_RESOURCE_KIND)) return
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
      resourceKind: initialResource.kind as
        | typeof CONTENT_CONTAINER_RESOURCE_KIND
        | typeof CONTENT_FILE_RESOURCE_KIND
        | typeof ARTIFACT_RESOURCE_KIND,
      resource: initialResource.resource
    }, { signal: controller.signal }).then((observed) => {
      if (controller.signal.aborted || epoch !== requestEpoch.current || !observed) return
      const reference = observed.reference
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
    return () => controller.abort()
  }, [beginRead, client, initialResource, loadEntries, supersedeMutation])

  const selectProvider = (next: string) => {
    supersedeMutation()
    setProviderInstanceRef(next)
    setNavigationCapabilities([])
    setFileCapabilities([])
    setParent(undefined)
    setEntries([])
    setSelectedFile(undefined)
    setArtifact(undefined)
    setContainers([])
    setContainerCursor(undefined)
    setEntryCursor(undefined)
    if (next) {
      void loadProvider(next)
    } else {
      activeRead.current?.abort()
      setStatus('Select a Provider Instance.')
    }
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

  const selectedArtifact = selectedFile ? exactArtifactFor(artifact, selectedFile) : undefined
  const displayedCapabilities = selectedFile ? fileCapabilities : navigationCapabilities

  return (
    <section className={className ?? 'flex h-full min-h-0 flex-col bg-white text-slate-900'}>
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Content Space</h2>
        {busy && (
          <button type="button" onClick={cancelMutation}
            className="rounded border border-slate-300 px-2 py-1 text-xs">
            Cancel
          </button>
        )}
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse Content Space"
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">×</button>
        )}
      </header>

      <div className="border-b border-slate-200 p-3">
        <label className="block text-xs font-medium text-slate-600" htmlFor="content-space-provider">
          Provider Instance
        </label>
        <select id="content-space-provider" value={providerInstanceRef}
          onChange={(event) => selectProvider(event.target.value)} disabled={busy}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
          <option value="">Select a Provider Instance…</option>
          {providers.map((provider) => (
            <option key={provider.providerInstanceRef} value={provider.providerInstanceRef}>
              {provider.label}
            </option>
          ))}
        </select>
        {providerInstanceRef && displayedCapabilities.length > 0 && (
          <ul aria-label="Content Space Provider readiness"
            className="mt-2 grid grid-cols-2 gap-x-2 text-[11px] text-slate-500">
            {displayedCapabilities.map((state) => (
              <li key={state.operation}>
                {state.operation}: {state.readiness === 'production_ready' ? 'ready' : 'unavailable'}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error.message} <span className="font-mono">({error.code})</span>
          </div>
        )}
        {status && <p className="mb-3 text-xs text-slate-500">{status}</p>}
        {transferProgress && (
          <p role="status" aria-live="polite" data-content-space-transfer-progress
            data-operation={transferProgress.snapshot.operation}
            data-phase={transferProgress.snapshot.phase}
            className="mb-3 text-xs text-slate-600">
            {transferProgressLabel(transferProgress.snapshot)}
          </p>
        )}

        {!parent ? (
          <div className="space-y-2">
            {containers.map((container) => (
              <button type="button" key={container.reference.containerId}
                onClick={() => openContainer(container.reference)}
                disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                className="flex w-full items-center rounded border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="mr-2" aria-hidden>▣</span>{container.label}
              </button>
            ))}
            {containerCursor && (
              <button type="button" onClick={() => void loadContainers(
                providerInstanceRef, containerCursor, true
              )} disabled={busy || !isOperationReady(navigationCapabilities, 'list-containers')}
                className="w-full rounded border border-slate-300 py-1.5 text-xs">
                Load more spaces
              </button>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <button type="button" onClick={returnToSpaces}
                className="rounded border border-slate-300 px-2 py-1 text-xs">Spaces</button>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-500">
                {parent.containerId}
              </span>
              <button type="button" onClick={() => setShowCreateFolder((value) => !value)}
                disabled={busy || !isOperationReady(navigationCapabilities, 'create-folder')}
                className="rounded border border-slate-300 px-2 py-1 text-xs">
                New folder
              </button>
              <button type="button" onClick={uploadNew}
                disabled={busy || !fileTransfers ||
                  !isOperationReady(navigationCapabilities, 'upload-new')}
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-40">
                Upload new
              </button>
            </div>

            {showCreateFolder && (
              <form onSubmit={createFolder} className="mb-3 flex gap-2">
                <input value={folderName} maxLength={CONTENT_SPACE_LIMITS.maxEntryNameCharacters}
                  onChange={(event) => setFolderName(event.target.value)} autoFocus
                  placeholder="Folder name" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
                <button type="submit" disabled={busy || !folderName.trim() ||
                  !isOperationReady(navigationCapabilities, 'create-folder')}
                  className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-40">
                  Create
                </button>
              </form>
            )}

            <div className="space-y-1">
              {entries.map((entry) => entry.kind === 'container' ? (
                <button type="button" key={`container:${entry.reference.containerId}`}
                  onClick={() => openContainer(entry.reference)}
                  disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                  className="flex w-full rounded px-2 py-2 text-left text-sm hover:bg-slate-100">
                  <span className="mr-2" aria-hidden>▣</span>{entry.label}
                </button>
              ) : (
                <button type="button" key={`file:${entry.reference.fileId}`}
                  onClick={() => {
                    selectFile(entry)
                  }} disabled={busy}
                  className={`flex w-full items-center rounded px-2 py-2 text-left text-sm hover:bg-slate-100 ${
                    selectedFile?.reference.fileId === entry.reference.fileId ? 'bg-slate-100' : ''
                  }`}>
                  <span className="mr-2" aria-hidden>□</span>
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className="ml-2 text-xs text-slate-400">{entry.size} B</span>
                </button>
              ))}
            </div>
            {entryCursor && (
              <button type="button" onClick={() => void loadEntries(parent, entryCursor, true)}
                disabled={busy || !isOperationReady(navigationCapabilities, 'list-entries')}
                className="mt-2 w-full rounded border border-slate-300 py-1.5 text-xs">
                Load more entries
              </button>
            )}
          </div>
        )}
      </div>

      {selectedFile && (
        <footer className="border-t border-slate-200 p-3">
          <p className="truncate text-sm font-medium">{selectedFile.label}</p>
          {selectedArtifact && (
            <p className="mt-1 truncate font-mono text-[11px] text-emerald-700">
              Immutable: {selectedArtifact.immutableVersionId}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {!parent && (
              <button type="button" onClick={returnToSpaces} disabled={busy}
                className="rounded border border-slate-300 px-2 py-1 text-xs">
                Spaces
              </button>
            )}
            <button type="button" disabled={busy || !fileTransfers ||
              !isOperationReady(fileCapabilities, 'download')}
              onClick={() => download(selectedFile)}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">
              Download
            </button>
            <button type="button"
              disabled={busy || !isOperationReady(fileCapabilities, 'observe-immutable-version')}
              onClick={() => observeImmutable(selectedFile.reference)}
              className="rounded border border-slate-300 px-2 py-1 text-xs">
              Verify immutable
            </button>
            <button type="button" disabled={busy ||
              !isOperationReady(fileCapabilities, 'portal-target')}
              onClick={() => openPortal(
                selectedArtifact ?? selectedFile.reference
              )}
              className="rounded border border-slate-300 px-2 py-1 text-xs">
              Open Provider portal
            </button>
          </div>
        </footer>
      )}
    </section>
  )
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
