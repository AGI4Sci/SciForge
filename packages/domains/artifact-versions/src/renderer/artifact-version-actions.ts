import type { ArtifactVersionListV1 } from '../contract.js'

type HistoryItem = ArtifactVersionListV1['items'][number]

const MATERIALIZED_ROOT = '.sciforge/artifact-versions/materialized'
const BUNDLE_ROOT = '.sciforge/artifact-versions/bundles'

export function defaultMaterializeDestination(item: HistoryItem): string {
  return [
    MATERIALIZED_ROOT,
    artifactPathSegment(item),
    `v${item.version.sequence}-${item.ref.contentDigest.slice(0, 12)}${mediaExtension(item.ref.mediaType)}`
  ].join('/')
}

export function defaultBundleDestination(item: HistoryItem): string {
  return [
    BUNDLE_ROOT,
    `${artifactPathSegment(item)}-v${item.version.sequence}.artifact-bundle.json`
  ].join('/')
}

export function stableUiActionKey(
  action: 'materialize' | 'bundle-export',
  item: HistoryItem
): string {
  return [
    'artifact-version-ui',
    action,
    item.version.versionId,
    item.ref.contentDigest.slice(0, 16)
  ].join(':')
}

export function uniqueRestoreActionKey(versionId: string): string {
  const token = globalThis.crypto?.randomUUID?.() ?? [
    Date.now().toString(36),
    Math.random().toString(36).slice(2)
  ].join('-')
  return `artifact-version-ui:restore:${versionId}:${token}`
}

function artifactPathSegment(item: HistoryItem): string {
  const readable = safeSegment(item.artifact.label ?? item.artifact.kind) || 'artifact'
  const identity = safeSegment(item.artifact.artifactId.split(':').at(-1) ?? '').slice(0, 12)
  return identity ? `${readable}-${identity}` : readable
}

function safeSegment(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function mediaExtension(mediaType?: string): string {
  switch (mediaType?.toLowerCase()) {
    case 'application/json': return '.json'
    case 'application/pdf': return '.pdf'
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/svg+xml': return '.svg'
    case 'text/csv': return '.csv'
    case 'text/tab-separated-values': return '.tsv'
    case 'text/html': return '.html'
    case 'text/markdown': return '.md'
    case 'text/plain': return '.txt'
    default: return '.bin'
  }
}
