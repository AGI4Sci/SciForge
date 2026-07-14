import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { AlertTriangle, Dna, Loader2 } from 'lucide-react'
import { SeqViz, type SeqVizProps } from 'seqviz'
import { BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES } from '@shared/biology-room'
import type { BiologyRoomViewerAdapterProps } from './BiologyRoomViewerOutlet'
import { validateBiologyAssetSource } from './asset-sources'
import {
  biologySequenceSelectionFromSeqViz,
  buildSeqVizProps,
  initialBiologySequenceRecordIndex,
  parseBiologySequenceText,
  seqVizSelectionFromBiologyRanges,
  type BiologySequenceRecord
} from './sequence-adapter-model'

export function SeqVizBiologyRoomAdapter({
  room,
  asset,
  source,
  onApply
}: BiologyRoomViewerAdapterProps): ReactElement {
  const [records, setRecords] = useState<BiologySequenceRecord[]>([])
  const [recordIndex, setRecordIndex] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [transientSelection, setTransientSelection] = useState<
    Extract<NonNullable<typeof room.selection>, { kind: 'sequence' }> | null | undefined
  >(undefined)
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSequenceIdRef = useRef<string | null>(null)
  const validation = validateBiologyAssetSource(source)
  const sourceUrl = source?.sourceUrl
  const validationReason = validation.ok ? null : validation.reason
  const assetPath = asset.path

  useEffect(() => () => {
    if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
  }, [])

  useEffect(() => {
    setTransientSelection(undefined)
  }, [room.selection])

  useEffect(() => {
    if (!sourceUrl || validationReason) {
      setRecords([])
      setStatus('error')
      setError(validationReason ?? 'The host did not provide a source URL.')
      return
    }
    let cancelled = false
    setStatus('loading')
    setError(null)
    void fetch(sourceUrl, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not read sequence asset (${response.status}).`)
        const parsed = parseBiologySequenceText(
          await readBoundedSequenceText(response, assetPath),
          { path: assetPath }
        )
        if (cancelled) return
        setRecords(parsed)
        setRecordIndex(0)
        setStatus('ready')
      })
      .catch((cause) => {
        if (cancelled) return
        setRecords([])
        setStatus('error')
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [assetPath, sourceUrl, validationReason])

  useEffect(() => {
    if (!records.length) return
    const pendingSequenceId = pendingSequenceIdRef.current
    const persistedSequenceState = room.viewerStates.sequence?.assetId === asset.id
      ? room.viewerStates.sequence
      : undefined
    const nextIndex = initialBiologySequenceRecordIndex(
      records,
      pendingSequenceId ? null : room.selection,
      asset.id,
      pendingSequenceId ?? persistedSequenceState?.sequenceId
    )
    setRecordIndex(nextIndex)
    const selectionStillTargetsAnotherRecord = room.selection?.kind === 'sequence' &&
      room.selection.assetId === asset.id &&
      room.selection.sequenceId !== pendingSequenceId
    if (pendingSequenceId &&
      persistedSequenceState?.sequenceId === pendingSequenceId &&
      !selectionStillTargetsAnotherRecord) {
      pendingSequenceIdRef.current = null
    }
  }, [asset.id, records, room.selection, room.viewerStates.sequence])

  const record = records[Math.min(recordIndex, Math.max(0, records.length - 1))]
  const viewState = room.viewerStates.sequence?.assetId === asset.id
    ? room.viewerStates.sequence
    : { assetId: asset.id, mode: 'linear' as const, showTranslations: false }
  const linearZoom = Math.max(10, Math.min(100, Math.round(viewState.zoom ?? 50)))
  const seqVizProps = useMemo<SeqVizProps | null>(() => {
    if (!record) return null
    const props = buildSeqVizProps({
      room,
      asset,
      record,
      viewer: record.type === 'aa' ? 'linear' : viewState.mode,
      onSelection: (selection) => {
        const normalized = biologySequenceSelectionFromSeqViz({
          assetId: asset.id,
          sequenceId: record.name,
          sequenceLength: record.seq.length,
          start: selection.start,
          end: selection.end,
          clockwise: selection.clockwise
        })
        setTransientSelection(normalized)
        if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = setTimeout(() => {
          selectionTimerRef.current = null
          void Promise.resolve(onApply?.({ type: 'setSelection', selection: normalized })).then((success) => {
            if (success === false) setTransientSelection(undefined)
          })
        }, 180)
      }
    })
    if (transientSelection === undefined) return props
    const selection = seqVizSelectionFromBiologyRanges(transientSelection?.ranges, record.seq.length)
    return {
      ...props,
      selection
    }
  }, [asset, onApply, record, room, transientSelection, viewState.mode])

  if (status === 'loading') return <SequenceAdapterState kind="loading" message="Parsing sequence records…" />
  if (status === 'error' || !record || !seqVizProps) {
    return <SequenceAdapterState kind="error" message={error ?? 'No sequence record is available.'} />
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-ds-canvas"
      data-seqviz-biology-room-adapter
      data-record-count={records.length}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ds-border bg-ds-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Dna className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={1.7} />
          {records.length > 1 ? (
            <select
              value={recordIndex}
              onChange={(event) => {
                const nextIndex = Number(event.currentTarget.value)
                const nextRecord = records[nextIndex]
                if (!nextRecord) return
                setTransientSelection(undefined)
                pendingSequenceIdRef.current = nextRecord.name
                setRecordIndex(nextIndex)
                if (room.selection?.kind === 'sequence' &&
                  room.selection.assetId === asset.id &&
                  room.selection.sequenceId !== nextRecord.name) {
                  void onApply?.({ type: 'setSelection', selection: null })
                }
                const result = onApply?.({
                  type: 'setViewport',
                  viewport: {
                    kind: 'sequence',
                    state: { ...viewState, sequenceId: nextRecord.name }
                  }
                })
                void Promise.resolve(result).then((success) => {
                  if (success === false && pendingSequenceIdRef.current === nextRecord.name) {
                    pendingSequenceIdRef.current = null
                  }
                })
              }}
              className="max-w-64 truncate rounded-md border border-ds-border bg-ds-canvas px-2 py-1 text-[11px] text-ds-ink outline-none focus:border-emerald-500"
              aria-label="Sequence record"
            >
              {records.map((candidate, index) => (
                <option key={`${candidate.name}:${index}`} value={index}>
                  {candidate.name} ({candidate.seq.length.toLocaleString()} {candidate.type === 'aa' ? 'aa' : 'bp'})
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-[11.5px] font-medium text-ds-ink">{record.name}</span>
          )}
          <span className="shrink-0 text-[10.5px] text-ds-faint">
            {record.seq.length.toLocaleString()} {record.type === 'aa' ? 'aa' : 'bp'}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-ds-border bg-ds-subtle p-0.5">
          <button
            type="button"
            onClick={() => onApply?.({
              type: 'setViewport',
              viewport: {
                kind: 'sequence',
                state: { ...viewState, zoom: Math.max(10, linearZoom - 10) }
              }
            })}
            disabled={!onApply || linearZoom <= 10}
            className="rounded px-2 py-1 text-[10.5px] text-ds-muted transition hover:text-ds-ink disabled:opacity-35"
            aria-label="Zoom sequence out"
          >−</button>
          <span className="min-w-8 text-center text-[10px] tabular-nums text-ds-faint">{linearZoom}%</span>
          <button
            type="button"
            onClick={() => onApply?.({
              type: 'setViewport',
              viewport: {
                kind: 'sequence',
                state: { ...viewState, zoom: Math.min(100, linearZoom + 10) }
              }
            })}
            disabled={!onApply || linearZoom >= 100}
            className="rounded px-2 py-1 text-[10.5px] text-ds-muted transition hover:text-ds-ink disabled:opacity-35"
            aria-label="Zoom sequence in"
          >+</button>
          {(['linear', 'circular'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onApply?.({
                type: 'setViewport',
                viewport: {
                  kind: 'sequence',
                  state: { ...viewState, mode }
                }
              })}
              disabled={!onApply || record.type === 'aa' && mode === 'circular'}
              className={compactClassName(
                'rounded px-2 py-1 text-[10.5px] capitalize transition disabled:cursor-not-allowed disabled:opacity-35',
                viewState.mode === mode ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              )}
              aria-pressed={viewState.mode === mode}
            >
              {mode}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onApply?.({
              type: 'setViewport',
              viewport: {
                kind: 'sequence',
                state: { ...viewState, showTranslations: !viewState.showTranslations }
              }
            })}
            disabled={!onApply || record.type === 'aa'}
            className={compactClassName(
              'rounded px-2 py-1 text-[10.5px] transition disabled:cursor-not-allowed disabled:opacity-35',
              viewState.showTranslations ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
            )}
            aria-pressed={viewState.showTranslations}
          >
            Translation
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white p-2 text-black" data-seqviz-viewport>
        <SeqViz {...seqVizProps} />
      </div>
    </section>
  )
}

export async function readBoundedSequenceText(response: Response, path: string): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES && !/\.gz$/i.test(path)) {
    throw new Error('Sequence view is limited to 25 MiB; navigate this indexed FASTA through a linked genome track in JBrowse.')
  }
  if (!response.body) {
    throw new Error('This build cannot stream the sequence source safely.')
  }
  const compressed = /\.gz$/i.test(path)
  if (compressed && typeof DecompressionStream === 'undefined') {
    throw new Error('This build cannot decompress the indexed FASTA source.')
  }
  const body = compressed
    ? response.body.pipeThrough(new DecompressionStream('gzip'))
    : response.body
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text = ''
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > BIOLOGY_ROOM_MAX_UNINDEXED_ASSET_BYTES) {
        await reader.cancel()
        throw new Error(`${compressed ? 'Decompressed FASTA' : 'Sequence source'} exceeds the 25 MiB interactive sequence limit; navigate it through a linked genome track in JBrowse.`)
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function SequenceAdapterState({ kind, message }: { kind: 'loading' | 'error'; message: string }): ReactElement {
  return (
    <div
      className="flex h-full min-h-[18rem] flex-col items-center justify-center bg-ds-canvas px-8 text-center"
      role={kind === 'error' ? 'alert' : 'status'}
      data-seqviz-adapter-state={kind}
    >
      {kind === 'loading'
        ? <Loader2 className="h-6 w-6 animate-spin text-emerald-500" strokeWidth={1.8} />
        : <AlertTriangle className="h-6 w-6 text-amber-500" strokeWidth={1.8} />}
      <p className="mt-3 max-w-sm text-[12px] leading-5 text-ds-muted">{message}</p>
    </div>
  )
}

function compactClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
