export type RemoteToolMetadata = {
  target?: string
  mode?: string
  trusted?: boolean
  runId?: string
  jobId?: string
  status?: string
}

export type RemoteToolChip = {
  key: string
  label: string
  title?: string
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) return value
  }
  return undefined
}

export function remoteToolMetadataFromMeta(meta: Record<string, unknown> | undefined): RemoteToolMetadata | null {
  if (!meta) return null
  const remote = unknownRecord(meta.remote)
  const source = Object.keys(remote).length > 0 ? remote : meta
  const targetObject = unknownRecord(source.target)
  const rawTarget =
    firstString(source, [
      'displayLabel',
      'targetLabel',
      'label',
      'remoteTargetLabel',
      'workspaceHostLabel'
    ]) ||
    firstString(targetObject, ['label', 'displayLabel'])
  const target = rawTarget
    ? sanitizeRemoteWorkspaceDisplayLabel(rawTarget, '')
    : undefined
  const mode = firstString(source, ['mode', 'kind', 'executorKind', 'remoteMode'])
  const runId = firstString(source, ['runId', 'run_id'])
  const jobId = firstString(source, ['jobId', 'job_id', 'slurmJobId'])
  const status = firstString(source, ['status', 'runStatus', 'jobStatus'])
  const trusted =
    booleanValue(source.trusted) ??
    booleanValue(source.workspaceTrusted) ??
    booleanValue(source.approvalBypass)

  if (!target && !mode && !runId && !jobId && !status && trusted === undefined) return null
  return {
    ...(target ? { target } : {}),
    ...(mode ? { mode } : {}),
    ...(trusted !== undefined ? { trusted } : {}),
    ...(runId ? { runId } : {}),
    ...(jobId ? { jobId } : {}),
    ...(status ? { status } : {})
  }
}

export function remoteToolSummarySuffix(
  meta: Record<string, unknown> | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const remote = remoteToolMetadataFromMeta(meta)
  if (!remote) return ''
  const parts = [
    remote.target ? t('toolRemoteTargetSummary', { target: remote.target }) : '',
    remote.mode ? t('toolRemoteModeSummary', { mode: remote.mode }) : '',
    remote.trusted !== undefined
      ? remote.trusted ? t('toolRemoteTrusted') : t('toolRemoteUntrusted')
      : '',
    remote.status ? t('toolRemoteStatusSummary', { status: remote.status }) : ''
  ].filter(Boolean)
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ''
}

export function remoteToolMetadataChips(
  meta: Record<string, unknown> | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): RemoteToolChip[] {
  const remote = remoteToolMetadataFromMeta(meta)
  if (!remote) return []
  const chips: RemoteToolChip[] = []
  if (remote.target) {
    chips.push({
      key: `target:${remote.target}`,
      label: t('toolRemoteTarget', { target: remote.target }),
      title: remote.target
    })
  }
  if (remote.mode) {
    chips.push({
      key: `mode:${remote.mode}`,
      label: t('toolRemoteMode', { mode: remote.mode }),
      title: remote.mode
    })
  }
  if (remote.trusted !== undefined) {
    chips.push({
      key: `trusted:${remote.trusted ? 'yes' : 'no'}`,
      label: remote.trusted ? t('toolRemoteTrusted') : t('toolRemoteUntrusted')
    })
  }
  if (remote.runId) {
    chips.push({
      key: `run:${remote.runId}`,
      label: t('toolRemoteRun', { run: remote.runId }),
      title: remote.runId
    })
  }
  if (remote.jobId) {
    chips.push({
      key: `job:${remote.jobId}`,
      label: t('toolRemoteJob', { job: remote.jobId }),
      title: remote.jobId
    })
  }
  if (remote.status) {
    chips.push({
      key: `status:${remote.status}`,
      label: t('toolRemoteStatus', { status: remote.status }),
      title: remote.status
    })
  }
  return chips
}
import { sanitizeRemoteWorkspaceDisplayLabel } from '../../remote-workspace/display'
