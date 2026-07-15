import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { GitCompareArrows } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  extractScientificObjectMetadata,
  scientificObjectIdentityKey,
  type ScientificObjectAnnotation,
  type ScientificObjectComparison,
  type ScientificObjectRef,
  type WorkspaceStructuredSelection
} from '@shared/scientific-objects'
import { biologyRoomFormatFromPath } from '@shared/biology-room'
import { workspaceStructuredSelectionSchema } from '@shared/workspace-preview'
import type { ChatBlock } from '../../agent/types'
import { browserStorage } from '../../lib/browser-storage'
import {
  addScientificObjectAnnotation,
  annotationsForScientificObject,
  deleteScientificObjectAnnotation,
  readScientificObjectAnnotationStore,
  writeScientificObjectAnnotationStore,
  type ScientificObjectAnnotationStore
} from '../../lib/scientific-object-annotations'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { ScientificObjectCard } from './ScientificObjectCard'
import { ScientificObjectComparisonPanel } from './ScientificObjectComparisonPanel'
import { TimelineImageGallery } from './message-timeline-media'

export type TimelineScientificObjectData = {
  objects: ScientificObjectRef[]
  comparisons: ScientificObjectComparison[]
}

export type TimelineScientificObjectsPanelProps = {
  blocks: ChatBlock[]
  workspaceRoot?: string
  onContinuePrompt?: (prompt: string) => void
}

export function scientificObjectDataFromTimelineBlocks(
  blocks: readonly ChatBlock[]
): TimelineScientificObjectData {
  const objects: ScientificObjectRef[] = []
  const comparisons: ScientificObjectComparison[] = []
  const objectKeys = new Set<string>()
  const comparisonIds = new Set<string>()

  const collect = (value: unknown): void => {
    const extracted = extractScientificObjectMetadata(value)
    for (const object of extracted.scientificObjects) {
      const key = scientificObjectIdentityKey(object)
      if (objectKeys.has(key)) continue
      objectKeys.add(key)
      objects.push(object)
    }
    for (const comparison of extracted.comparisons) {
      if (comparisonIds.has(comparison.id)) continue
      comparisonIds.add(comparison.id)
      comparisons.push(comparison)
    }
  }

  for (const block of blocks) {
    if (block.kind === 'tool' && block.status !== 'success') continue
    if ('meta' in block) collect(block.meta)
    if (block.kind === 'tool' && block.detail) collect(parseStructuredToolDetail(block.detail))
  }

  return { objects, comparisons }
}

export function scientificObjectSelectionPrompt(input: {
  object: ScientificObjectRef
  selection: WorkspaceStructuredSelection
  language?: string
}): string {
  const selection = JSON.stringify(input.selection, null, 2)
  const hash = `${input.object.hash.algorithm}:${input.object.hash.digest}`
  if (input.language?.toLowerCase().startsWith('zh')) {
    return [
      `请针对科学对象“${input.object.title}”的当前选择继续分析。`,
      `模态：${input.object.modality}`,
      `文件：${input.object.path}`,
      `内容哈希：${hash}`,
      '当前结构化选择：',
      '```json',
      selection,
      '```',
      '请明确区分从对象数据直接观察到的事实、推断以及仍需验证的结论。'
    ].join('\n')
  }
  return [
    `Continue the analysis for the current selection in “${input.object.title}”.`,
    `Modality: ${input.object.modality}`,
    `File: ${input.object.path}`,
    `Content hash: ${hash}`,
    'Structured selection:',
    '```json',
    selection,
    '```',
    'Separate direct observations, inferences, and conclusions that still require validation.'
  ].join('\n')
}

export function TimelineScientificObjectsPanel({
  blocks,
  workspaceRoot,
  onContinuePrompt
}: TimelineScientificObjectsPanelProps): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const data = useMemo(() => scientificObjectDataFromTimelineBlocks(blocks), [blocks])
  const [annotationStore, setAnnotationStore] = useState<ScientificObjectAnnotationStore>(() =>
    readScientificObjectAnnotationStore(browserStorage())
  )
  const [showGeneratedComparison, setShowGeneratedComparison] = useState(false)

  useEffect(() => {
    writeScientificObjectAnnotationStore(browserStorage(), annotationStore)
  }, [annotationStore])

  if (data.objects.length === 0 && data.comparisons.length === 0) return null

  const generatedComparison = data.comparisons.length === 0 && data.objects.length >= 2
    ? createTimelineComparison(data.objects, t('scientificObjectComparison'))
    : null

  const openObject = (object: ScientificObjectRef): void => {
    previewWorkspaceFile({
      path: object.path,
      workspaceRoot: object.workspaceRoot || workspaceRoot,
      ...(object.selection ? { selection: object.selection } : {}),
      integrity: {
        algorithm: object.hash.algorithm,
        expectedDigest: `${object.hash.algorithm}:${object.hash.digest}`
      }
    })
  }

  const askAboutSelection = (object: ScientificObjectRef, value: unknown): void => {
    const selection = workspaceStructuredSelectionSchema.safeParse(value)
    if (!selection.success) return
    onContinuePrompt?.(scientificObjectSelectionPrompt({
      object,
      selection: selection.data,
      language: i18n.language
    }))
  }

  const addAnnotation = (object: ScientificObjectRef, text: string): void => {
    setAnnotationStore((current) => addScientificObjectAnnotation(
      current,
      object,
      text,
      object.selection
    ))
  }

  const deleteAnnotation = (
    object: ScientificObjectRef,
    annotation: ScientificObjectAnnotation
  ): void => {
    setAnnotationStore((current) => deleteScientificObjectAnnotation(current, object, annotation.id))
  }

  return (
    <section
      className="flex w-full max-w-2xl flex-col gap-3"
      aria-label={t('scientificObjectRegion')}
      data-timeline-scientific-objects
    >
      {data.objects.map((object) => (
        <ScientificObjectCard
          key={scientificObjectIdentityKey(object)}
          object={object}
          selection={object.selection}
          annotations={annotationsForScientificObject(object, annotationStore)}
          labels={{
            openWorkspace: biologyRoomFormatFromPath(object.path)
              ? t('scientificObjectOpenBiologyRoom')
              : t('scientificObjectOpenWorkspace'),
            askAboutSelection: t('scientificObjectAskSelection'),
            selectionRequired: t('scientificObjectSelectionRequired'),
            annotations: t('scientificObjectAnnotations'),
            addAnnotation: t('scientificObjectAddAnnotation'),
            annotationPlaceholder: t('scientificObjectAnnotationPlaceholder'),
            saveAnnotation: t('scientificObjectSaveAnnotation'),
            cancel: t('scientificObjectCancel'),
            deleteAnnotation: t('scientificObjectDeleteAnnotation'),
            unnamedObject: t('scientificObjectUnnamed'),
            unknownValue: t('scientificObjectUnknown')
          }}
          renderStaticPreview={(item, fallback) => item.preview ? (
            <TimelineImageGallery
              variant="assistant"
              images={[{
                id: `${item.id}-preview`,
                name: item.preview.alt || item.title,
                mimeType: item.preview.mimeType,
                width: item.preview.width,
                height: item.preview.height,
                path: item.preview.path,
                workspaceRoot: item.workspaceRoot,
                source: 'generated'
              }]}
            />
          ) : fallback}
          onOpenWorkspace={openObject}
          onAskAboutSelection={onContinuePrompt ? askAboutSelection : undefined}
          onAddAnnotation={addAnnotation}
          onDeleteAnnotation={deleteAnnotation}
        />
      ))}

      {generatedComparison ? (
        <>
          <button
            type="button"
            onClick={() => setShowGeneratedComparison((current) => !current)}
            aria-expanded={showGeneratedComparison}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
            {showGeneratedComparison
              ? t('scientificObjectHideComparison')
              : t('scientificObjectCompareCount', { count: data.objects.length })}
          </button>
          {showGeneratedComparison ? (
            <ScientificObjectComparisonPanel
              comparison={generatedComparison}
              labels={comparisonLabels(t)}
              onOpenObject={openObject}
            />
          ) : null}
        </>
      ) : null}

      {data.comparisons.map((comparison) => (
        <ScientificObjectComparisonPanel
          key={comparison.id}
          comparison={comparison}
          labels={comparisonLabels(t)}
          onOpenObject={openObject}
        />
      ))}
    </section>
  )
}

function comparisonLabels(t: (key: string) => string) {
  return {
    comparison: t('scientificObjectComparison'),
    object: t('scientificObjectComparisonObjects'),
    modality: t('scientificObjectComparisonModality'),
    source: t('scientificObjectComparisonSource'),
    format: t('scientificObjectComparisonFormat'),
    openObject: t('scientificObjectComparisonOpen'),
    empty: t('scientificObjectComparisonEmpty'),
    needsMoreObjects: t('scientificObjectComparisonNeedsMore'),
    unknownValue: t('scientificObjectUnknown')
  }
}

function parseStructuredToolDetail(detail: string): unknown {
  const trimmed = detail.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function createTimelineComparison(
  objects: ScientificObjectRef[],
  title: string
): ScientificObjectComparison {
  return {
    schemaVersion: 1,
    id: `timeline-comparison-${objects.map((object) => object.id).join('-')}`.slice(0, 256),
    title,
    objects
  }
}
