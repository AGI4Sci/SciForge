import type { BiologyRoomAsset, BiologyRoomManifest } from '@shared/biology-room'
import type { BioGymRunEvent, BioGymRunSnapshot, BioGymStageAttemptSnapshot } from '@shared/biogym'

export type BioGymAssetGroup = {
  id: string
  label: string
  stage?: BioGymStageAttemptSnapshot
  assets: BiologyRoomAsset[]
}

export function bioGymEventHasDisplayableAsset(event: BioGymRunEvent): boolean {
  return Boolean(event.activeAssetId?.trim() || event.activeAssetPath?.trim())
}

export function shouldMarkBioGymEventPending(event: BioGymRunEvent): boolean {
  // A successful stage emits artifact_ready followed by stage_terminal with
  // the same retained active asset. Only the artifact event is a new visual
  // result; treating stage_terminal as one would reopen an old asset after a
  // later stage failure. Snapshot is included for restart/reconnect replay.
  return bioGymEventHasDisplayableAsset(event) &&
    (event.type === 'artifact_ready' || event.type === 'snapshot')
}

export function shouldResetBioGymFollowRun(
  previousRunId: string | undefined,
  nextRunId: string | undefined
): boolean {
  return previousRunId !== nextRunId
}

export function shouldOpenPendingBioGymRun(input: {
  event?: BioGymRunEvent | null
  activeThreadId?: string | null
  route: string
  pendingThreadIds: ReadonlySet<string>
}): input is typeof input & { event: BioGymRunEvent; activeThreadId: string } {
  return input.route === 'chat' &&
    Boolean(input.activeThreadId) &&
    Boolean(input.event) &&
    input.event?.threadId === input.activeThreadId &&
    input.pendingThreadIds.has(input.activeThreadId ?? '')
}

export function resolveBioGymDisplayedAssetId(input: {
  room: BiologyRoomManifest
  followRun: boolean
  preferredAssetId?: string
  pinnedAssetId?: string | null
}): string | undefined {
  const available = new Set(input.room.assets.map((asset) => asset.id))
  if (input.followRun) {
    return input.preferredAssetId && available.has(input.preferredAssetId)
      ? input.preferredAssetId
      : input.room.activeAssetId
  }
  return input.pinnedAssetId && available.has(input.pinnedAssetId)
    ? input.pinnedAssetId
    : input.room.activeAssetId
}

export function mergeBioGymRunEvent(
  current: BioGymRunEvent | undefined,
  incoming: BioGymRunEvent
): BioGymRunEvent {
  if (!current) return incoming
  const sameRun = current.designRunId === incoming.designRunId
  if (sameRun && incoming.revision < current.revision) return current
  if (!sameRun && timestamp(incoming.emittedAt) < timestamp(current.emittedAt)) return current
  if (
    sameRun &&
    incoming.revision === current.revision &&
    timestamp(incoming.emittedAt) < timestamp(current.emittedAt)
  ) return current
  if (!sameRun) return incoming
  return {
    ...incoming,
    activeCandidateId: incoming.activeCandidateId ?? current.activeCandidateId,
    activeAssetId: incoming.activeAssetId ?? current.activeAssetId,
    activeAssetPath: incoming.activeAssetPath ?? current.activeAssetPath
  }
}

export function groupBioGymAssets(
  room: BiologyRoomManifest,
  snapshot?: BioGymRunSnapshot | null
): BioGymAssetGroup[] {
  if (!snapshot) return [{ id: 'all', label: 'Assets', assets: room.assets }]
  const assetsById = new Map(room.assets.map((asset) => [asset.id, asset]))
  const assigned = new Set<string>()
  const groups: BioGymAssetGroup[] = []
  for (const stage of snapshot.stages) {
    const stageAssetIds = [...new Set([
      ...stage.assetIds,
      ...stage.candidates.flatMap((candidate) => candidate.assetId ? [candidate.assetId] : [])
    ])]
    const assets = stageAssetIds.flatMap((assetId) => {
      const asset = assetsById.get(assetId)
      if (!asset || assigned.has(asset.id)) return []
      assigned.add(asset.id)
      return [asset]
    })
    if (!assets.length) continue
    groups.push({
      id: stage.id,
      label: `${stageLabel(stage.kind)} · attempt ${stage.attempt}`,
      stage,
      assets
    })
  }
  const other = room.assets.filter((asset) => !assigned.has(asset.id))
  if (other.length) groups.push({ id: 'other', label: groups.length ? 'Other assets' : 'Assets', assets: other })
  return groups
}

export function stageLabel(kind: BioGymStageAttemptSnapshot['kind']): string {
  switch (kind) {
    case 'backbone': return 'Backbone'
    case 'sequence': return 'Sequence design'
    case 'verify': return 'Structure prediction'
    case 'binder': return 'Binder design'
  }
}

export function workflowLabel(workflow: BioGymRunSnapshot['workflow']): string {
  switch (workflow) {
    case 'de_novo_scaffold': return 'De novo scaffold'
    case 'fixed_backbone': return 'Fixed backbone'
    case 'target_binder': return 'Target binder'
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
