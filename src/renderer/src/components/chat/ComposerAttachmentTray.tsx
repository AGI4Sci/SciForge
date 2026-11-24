import type { ReactElement } from 'react'
import {
  BarChart3,
  File,
  FileText,
  Globe,
  Image as ImageIcon,
  Paperclip,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  workspaceAttachmentDisplayName,
  workspaceAttachmentKind,
  type WorkspaceAttachmentKind
} from '@sciforge/domain-sdk/attachment-policy'

import type { AttachmentReference } from '../../agent/types'
import {
  composerFileReferenceKey,
  type ComposerFileReference
} from '../../lib/composer-file-references'

type Props = {
  fileReferences?: ComposerFileReference[]
  attachments?: AttachmentReference[]
  uploadError?: string | null
  onPreviewFileReference?: (reference: ComposerFileReference) => void
  onRemoveFileReference?: (reference: ComposerFileReference) => void
  onRemoveAttachment?: (id: string) => void
  /** Clears every pending file reference and attachment in one action. */
  onClearAll?: () => void
}

type TrayKind = 'pdf' | 'image' | 'scientific' | 'web-document' | 'file'

type TrayRow = {
  key: string
  displayName: string
  path: string
  kind: TrayKind
  size?: number
  previewUrl?: string
  preview?: () => void
  previewLabel?: string
  remove?: () => void
  removeLabel?: string
}

const SIZE_UNITS = ['KB', 'MB', 'GB'] as const

/** Compact, locale-neutral byte size for an attachment row. */
export function formatComposerAttachmentSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${SIZE_UNITS[unitIndex]}`
}

function trayKind(kind: WorkspaceAttachmentKind): TrayKind {
  return kind === 'unsupported' ? 'file' : kind
}

function AttachmentKindIcon({ kind }: { kind: TrayKind }): ReactElement {
  if (kind === 'image') return <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
  if (kind === 'scientific') return <BarChart3 className="h-4 w-4" strokeWidth={1.8} />
  if (kind === 'web-document') return <Globe className="h-4 w-4" strokeWidth={1.8} />
  if (kind === 'pdf') return <FileText className="h-4 w-4" strokeWidth={1.8} />
  return <File className="h-4 w-4" strokeWidth={1.8} />
}

type TrayTranslate = (key: string, options?: Record<string, unknown>) => string

function attachmentKindLabel(kind: TrayKind, t: TrayTranslate): string {
  if (kind === 'pdf') return t('composerAttachmentKindPdf')
  if (kind === 'image') return t('composerAttachmentKindImage')
  if (kind === 'scientific') return t('composerAttachmentKindScientific')
  if (kind === 'web-document') return t('composerAttachmentKindWeb')
  return t('composerAttachmentKindFile')
}

function fileReferenceRow(
  reference: ComposerFileReference,
  t: TrayTranslate,
  onPreview?: (reference: ComposerFileReference) => void,
  onRemove?: (reference: ComposerFileReference) => void
): TrayRow {
  const displayName =
    workspaceAttachmentDisplayName(reference.relativePath) || reference.name || reference.relativePath
  return {
    key: composerFileReferenceKey(reference),
    displayName,
    path: reference.relativePath,
    kind: trayKind(workspaceAttachmentKind({ name: displayName, type: reference.mimeType })),
    ...(reference.size != null ? { size: reference.size } : {}),
    ...(onPreview
      ? {
          preview: () => onPreview(reference),
          previewLabel: t('composerOpenFileReference', { name: displayName })
        }
      : {}),
    ...(onRemove
      ? {
          remove: () => onRemove(reference),
          removeLabel: t('composerRemoveFileReference')
        }
      : {})
  }
}

function storeAttachmentRow(
  attachment: AttachmentReference,
  t: TrayTranslate,
  onRemove?: (id: string) => void
): TrayRow {
  const displayName = attachment.name || attachment.id
  const path = attachment.absolutePath || attachment.path || attachment.relativePath || displayName
  return {
    key: attachment.id,
    displayName,
    path,
    kind: trayKind(workspaceAttachmentKind({ name: displayName, type: attachment.mimeType })),
    ...(attachment.byteSize != null ? { size: attachment.byteSize } : {}),
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
    ...(onRemove
      ? {
          remove: () => onRemove(attachment.id),
          removeLabel: t('composerRemoveAttachment')
        }
      : {})
  }
}

/**
 * Pending attachments for the composer, rendered as a persistent list above the
 * input. It is the single place that names, classifies, sizes, previews, and
 * removes everything the next send will carry.
 */
export function ComposerAttachmentTray({
  fileReferences = [],
  attachments = [],
  uploadError = null,
  onPreviewFileReference,
  onRemoveFileReference,
  onRemoveAttachment,
  onClearAll
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const rows: TrayRow[] = [
    ...fileReferences.map((reference) =>
      fileReferenceRow(reference, t, onPreviewFileReference, onRemoveFileReference)
    ),
    ...attachments.map((attachment) => storeAttachmentRow(attachment, t, onRemoveAttachment))
  ]
  if (rows.length === 0 && !uploadError) return null
  const canClearAll = rows.length > 0 && Boolean(onClearAll)

  return (
    <div className="ds-no-drag flex flex-col gap-1 px-1" data-composer-attachment-tray>
      {rows.length > 0 ? (
        <div
          aria-live="polite"
          className="flex items-center gap-1.5 px-1 text-ds-xs font-semibold text-ds-muted"
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
          <span className="min-w-0 truncate">{t('composerAttachmentsTitle', { count: rows.length })}</span>
          {canClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              className="ml-auto shrink-0 rounded px-1 py-0.5 text-ds-xs font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('composerAttachmentsClearAll')}
              aria-label={t('composerAttachmentsClearAll')}
            >
              {t('composerAttachmentsClearAll')}
            </button>
          ) : null}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-1">
          {rows.map((row) => {
            const sizeLabel = formatComposerAttachmentSize(row.size)
            return (
              <li
                key={row.key}
                title={row.path}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-ds-border-muted bg-ds-card/80 px-2 py-1 text-ds-sm text-ds-muted"
              >
                {row.previewUrl ? (
                  <img
                    src={row.previewUrl}
                    alt={row.displayName}
                    className="h-8 w-8 shrink-0 rounded-lg border border-ds-border-muted object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-hover text-ds-faint"
                  >
                    <AttachmentKindIcon kind={row.kind} />
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.preview ? (
                      <button
                        type="button"
                        onClick={row.preview}
                        aria-label={row.previewLabel}
                        title={row.previewLabel}
                        className="min-w-0 truncate rounded-md text-left font-medium text-ds-ink transition hover:underline"
                      >
                        {row.displayName}
                      </button>
                    ) : (
                      <span className="min-w-0 truncate font-medium text-ds-ink">{row.displayName}</span>
                    )}
                    <span className="shrink-0 rounded bg-ds-hover px-1 py-0.5 font-mono text-ds-2xs leading-none text-ds-faint">
                      {attachmentKindLabel(row.kind, t)}
                    </span>
                    {sizeLabel ? (
                      <span className="shrink-0 tabular-nums text-ds-2xs text-ds-faint">{sizeLabel}</span>
                    ) : null}
                  </span>
                  {row.path !== row.displayName ? (
                    <span className="truncate text-ds-2xs text-ds-faint" title={row.path}>
                      {row.path}
                    </span>
                  ) : null}
                </span>
                {row.remove ? (
                  <button
                    type="button"
                    onClick={row.remove}
                    className="shrink-0 rounded-full p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                    aria-label={row.removeLabel}
                    title={row.removeLabel}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {uploadError ? (
        <p role="alert" className="min-w-0 break-words px-1 text-ds-sm font-medium text-red-600 dark:text-red-300">
          {uploadError}
        </p>
      ) : null}
    </div>
  )
}
