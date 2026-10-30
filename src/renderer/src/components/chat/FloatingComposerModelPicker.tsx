import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Bot, Brain, Check, ChevronDown, ChevronRight, ExternalLink, Gauge, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import type { AgentRuntimeModelCatalog } from '@shared/agent-runtime-contract'
import { agentRuntimeTurnControls } from '@shared/agent-runtime-turn-controls'
import {
  composerModelControlOptions,
  composerRuntimeModelIds,
  filterReasoningOptionsForRuntime,
  runtimeTransfersServiceTier
} from '../../lib/composer-runtime-options'
import {
  composerTurnControlScopeKey,
  readComposerTurnControlMemory,
  writeComposerTurnControlMemory
} from '../../lib/composer-turn-control-memory'
import {
  composerModelEntryFor,
  composerReasoningEntry,
  composerReasoningLevelLabelKey,
  composerReasoningOptionsFromOutcome,
  composerReasoningSourceKey,
  type ComposerReasoningDiscoverySnapshot
} from '../../lib/composer-reasoning-discovery'
export {
  composerModelControlOptions,
  composerRuntimeModelIds,
  supportedComposerTurnSettings
} from '../../lib/composer-runtime-options'

export type ComposerReasoningEffort = string

type Props = {
  compact: boolean
  mode: 'select' | 'combobox'
  composerModel: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeLocked?: boolean
  /** Bound after the first message: the session keeps its execution runtime. */
  runtimeSessionLocked?: boolean
  canChangeModel: boolean
  stretch?: boolean
  composerReasoningEffort?: string
  composerServiceTier?: string
  modelCatalog?: AgentRuntimeModelCatalog | null
  composerReasoningDiscovery?: ComposerReasoningDiscoverySnapshot | null
  onComposerModelChange: (modelId: string) => void
  onActiveAgentRuntimeChange?: (runtimeId: AgentRuntimeId) => void
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  onComposerServiceTierChange?: (serviceTier: string) => void
  onRefreshComposerReasoningDiscovery?: (options?: { force?: boolean }) => void
  onOpenModelAccess?: () => void
}

export const COMPOSER_RUNTIME_IDS = ['codex', 'claude', 'dsh'] as const satisfies readonly AgentRuntimeId[]

const RUNTIME_OPTIONS: Array<{ id: (typeof COMPOSER_RUNTIME_IDS)[number]; labelKey: string; shortLabelKey: string }> = [
  { id: 'codex', labelKey: 'composerRuntimeCodex', shortLabelKey: 'composerRuntimeCodexShort' },
  { id: 'claude', labelKey: 'composerRuntimeClaude', shortLabelKey: 'composerRuntimeClaudeShort' },
  { id: 'dsh', labelKey: 'composerRuntimeDsh', shortLabelKey: 'composerRuntimeDshShort' }
]

export type ComposerRuntimeSectionState = {
  /** Whether the section offers switching right now. */
  interactive: boolean
  /** Runtime rows to render (all while unbound; only the bound one once locked). */
  visibleRuntimeIds: AgentRuntimeId[]
  noteKey: 'composerRuntimeSessionLocked' | 'composerRuntimeCodexPlanLocked' | null
}

/**
 * The execution-runtime choice lives in its own top-level section and is only
 * offered while the session is still unbound (no first message sent). Once the
 * session is bound the section turns into a read-only summary — the runtime
 * chip keeps showing the bound runtime — so there is exactly one authoritative
 * place for this choice (`避免两个可互相矛盾的执行环境入口`).
 */
export function composerRuntimeSectionState(args: {
  currentRuntime: AgentRuntimeId
  runtimeLocked: boolean
  runtimeSessionLocked: boolean
}): ComposerRuntimeSectionState {
  if (args.runtimeSessionLocked) {
    return {
      interactive: false,
      visibleRuntimeIds: [args.currentRuntime],
      noteKey: 'composerRuntimeSessionLocked'
    }
  }
  return {
    interactive: !args.runtimeLocked,
    visibleRuntimeIds: RUNTIME_OPTIONS.map((option) => option.id),
    noteKey: args.runtimeLocked ? 'composerRuntimeCodexPlanLocked' : null
  }
}

type FloatingMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingSubmenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

type FloatingMenuAnchorRect = Pick<DOMRect, 'bottom' | 'right' | 'top'>
type FloatingSubmenuAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

type ComposerModelMenuGroup = {
  providerId: string
  label: string
  modelIds: string[]
}

const FLOATING_MENU_MARGIN = 12
const FLOATING_MENU_GAP = 7
const FLOATING_MENU_WIDTH = 320
const FLOATING_MENU_MIN_WIDTH = 240
const FLOATING_MENU_MIN_HEIGHT = 112
const FLOATING_MENU_MAX_HEIGHT = 520
const FLOATING_SUBMENU_GAP = 6
const FLOATING_SUBMENU_WIDTH = 232
const FLOATING_SUBMENU_MIN_HEIGHT = 80
const FLOATING_SUBMENU_MAX_HEIGHT = 320
const UNGROUPED_MODEL_PROVIDER_ID = '__composer_models__'

export function FloatingComposerModelPicker({
  compact,
  mode,
  composerModel,
  composerPickList,
  composerModelGroups = [],
  activeAgentRuntime = 'codex',
  runtimeLocked = false,
  runtimeSessionLocked = false,
  canChangeModel,
  stretch = false,
  composerReasoningEffort = '',
  composerServiceTier = '',
  modelCatalog,
  composerReasoningDiscovery = null,
  onComposerModelChange,
  onActiveAgentRuntimeChange,
  onComposerReasoningEffortChange,
  onComposerServiceTierChange,
  onRefreshComposerReasoningDiscovery,
  onOpenModelAccess
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const pickerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const providerRowRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<FloatingMenuPlacement | null>(null)
  const [submenuPlacement, setSubmenuPlacement] = useState<FloatingSubmenuPlacement | null>(null)
  const declaredEntryIds = useMemo(
    () => [...new Set(
      composerModelGroups
        .flatMap((group) => (group.models ?? []).map((model) => model.id.trim()))
        .filter(Boolean)
    )],
    [composerModelGroups]
  )
  // 模型只列 Model API 设置中真实接入的模型（按服务商分组）：有接入声明时，
  // 运行时的自带目录不再参与模型列表；没有声明时才回退到运行时目录/兜底列表。
  const modelOptions = useMemo(
    () => (declaredEntryIds.length > 0
      ? declaredEntryIds
      : composerRuntimeModelIds(modelCatalog, composerPickList)),
    [composerPickList, declaredEntryIds, modelCatalog]
  )
  const providerMenuGroups = useMemo<ComposerModelMenuGroup[]>(() => {
    const allowed = new Set(modelOptions)
    const seen = new Set<string>()
    const groups = composerModelGroups
      .map((group) => {
        const ids = group.modelIds
          .map((id) => id.trim())
          .filter((id) => {
            if (!allowed.has(id) || seen.has(id)) return false
            seen.add(id)
            return true
          })
        return {
          ...group,
          label: group.label.trim() || group.providerId,
          modelIds: ids
        }
      })
      .filter((group) => group.modelIds.length > 0)
    const ungrouped = modelOptions.filter((id) => !seen.has(id))
    if (ungrouped.length > 0) {
      groups.push({
        providerId: UNGROUPED_MODEL_PROVIDER_ID,
        label: t('composerModel'),
        modelIds: ungrouped
      })
    }
    return groups
  }, [composerModelGroups, modelOptions, t])
  const runtimeEnabled = Boolean(onActiveAgentRuntimeChange)
  const currentRuntime = normalizeComposerRuntimeId(activeAgentRuntime)
  // Turn-control intersection: a level is only selectable when the model side
  // has evidence AND the runtime can actually transfer it. An explicit “off”
  // additionally requires the runtime to express an off/disabled state.
  const turnControls = agentRuntimeTurnControls(currentRuntime)
  const currentRuntimeLabel = t(runtimeShortLabelKey(currentRuntime))
  const discoveredCapabilityOptions = composerModelControlOptions(composerModel, modelCatalog)
  // 'auto'/empty resolves to the first declared entry: the router really serves
  // that entry for the default selection, so discovery follows it.
  const discoveryEntry = composerReasoningEntry(composerModelGroups, composerModel)
  const discoveryEnabled = Boolean(discoveryEntry) && Boolean(onRefreshComposerReasoningDiscovery)
  const discovery = discoveryEnabled ? composerReasoningDiscovery : null
  const catalogReasoningOptions = modelCatalog?.available
    ? discoveredCapabilityOptions.reasoningEfforts
    : []
  type ReasoningOptionView = { id: string; label: string; description?: string; isDefault: boolean }
  const reasoningOptions: ReasoningOptionView[] = filterReasoningOptionsForRuntime(
    discoveryEnabled
      ? composerReasoningOptionsFromOutcome(discovery?.status === 'ready' ? discovery.outcome : null).map((option) => {
          const labelKey = option.id ? composerReasoningLevelLabelKey(option.id) : undefined
          return {
            id: option.id,
            label: option.id ? (labelKey ? t(labelKey) : option.id) : t('composerReasoningUpstreamDefault'),
            isDefault: option.isDefault
          }
        })
      : catalogReasoningOptions.map((option) => ({
          id: option.id,
          label: option.description ?? option.id,
          ...(option.description ? { description: option.description } : {}),
          isDefault: option.isDefault === true
        })),
    turnControls
  )
  const serviceTierOptions = discoveryEnabled || !runtimeTransfersServiceTier(turnControls)
    ? []
    : discoveredCapabilityOptions.serviceTiers
  const reasoningEnabled = Boolean(onComposerReasoningEffortChange && reasoningOptions.length)
  const currentReasoning = composerReasoningEffort.trim()
  const currentReasoningOption = reasoningOptions.find((option) => option.id === currentReasoning)
  const currentReasoningLabelKey = currentReasoning
    ? composerReasoningLevelLabelKey(currentReasoning)
    : undefined
  const currentReasoningLabel = currentReasoningOption?.label
    ?? (currentReasoning
      ? (currentReasoningLabelKey ? t(currentReasoningLabelKey) : currentReasoning)
      : t('composerReasoningUpstreamDefault'))
  const reasoningUnsupportedSelection = Boolean(currentReasoning) && !currentReasoningOption
  const discoveryHintKey = discoveryEnabled && discovery?.status === 'ready' && discovery.outcome
    ? discovery.outcome.state === 'unknown'
      ? 'composerReasoningUnknownHint'
      : discovery.outcome.state === 'unsupported'
        ? 'composerReasoningUnsupportedHint'
        : undefined
    : undefined
  const discoverySourceLabel = discoveryEnabled && discovery?.status === 'ready' && discovery.outcome
    ? composerReasoningSourceKey(discovery.outcome)
    : undefined
  const discoveryPartial = discoveryEnabled
    && discovery?.status === 'ready'
    && discovery.outcome?.completeness === 'partial'
  const sessionFixedControls = currentRuntime === 'dsh'
  const runtimeSection = composerRuntimeSectionState({
    currentRuntime,
    runtimeLocked,
    runtimeSessionLocked
  })
  const runtimeChipLabel = runtimeEnabled ? t(runtimeChipLabelKey(currentRuntime)) : ''
  const reasoningChipLabel = currentReasoning
    ? currentReasoningLabel
    : (reasoningEnabled ? t('composerReasoningUpstreamDefault') : '')
  const serviceTierEnabled = Boolean(onComposerServiceTierChange && serviceTierOptions.length)
  const currentServiceTier = composerServiceTier.trim()
  const currentServiceTierLabel = serviceTierOptions.find(
    (option) => option.id === currentServiceTier
  )?.displayName ?? currentServiceTier
  const currentModel = composerModel.trim()
  const currentModelDescriptor = modelCatalog?.models.find((model) => model.id === currentModel)
  const currentModelEntry = discoveryEntry
  const resolvedModelId = currentModelEntry?.id ?? currentModel
  const modelLabel = currentModelEntry?.displayName
    || currentModelDescriptor?.displayName
    || fullModelLabel(composerModel, t('autoLabel'))
  const controlLabels = [
    runtimeEnabled ? currentRuntimeLabel : '',
    modelLabel,
    reasoningEnabled ? currentReasoningLabel : '',
    serviceTierEnabled ? currentServiceTierLabel : ''
  ].filter(Boolean)
  const controlsTitle = t('composerModelControlsTitle', {
    controls: controlLabels.join(' / ')
  })
  const selectedProviderId = providerMenuGroups.find((group) =>
    group.modelIds.includes(resolvedModelId)
  )?.providerId ?? null
  const activeProviderGroup =
    providerMenuGroups.find((group) => group.providerId === activeProviderId) ?? null
  const comboboxWidthClass = stretch
    ? 'min-w-0 flex-1 max-w-[284px]'
    : compact
      ? 'w-[184px] max-w-[184px] shrink-0'
      : 'w-[248px] max-w-[260px] shrink-0'

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (pickerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      if (submenuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      setMenuPlacement(null)
      setSubmenuPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const picker = pickerRef.current
      if (!picker) return

      setMenuPlacement(
        calculateFloatingMenuPlacement({
          anchorRect: picker.getBoundingClientRect(),
          menuHeight: menuRef.current?.offsetHeight ?? 0,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      setActiveProviderId(null)
      return
    }
    if (providerMenuGroups.length === 0) {
      setActiveProviderId(null)
      return
    }
    setActiveProviderId((current) => {
      if (current && providerMenuGroups.some((group) => group.providerId === current)) return current
      return null
    })
  }, [menuOpen, providerMenuGroups])

  useEffect(() => {
    if (!menuOpen || !activeProviderGroup) {
      setSubmenuPlacement(null)
      return
    }

    const updatePlacement = (): void => {
      const row = providerRowRefs.current.get(activeProviderGroup.providerId)
      if (!row) return

      setSubmenuPlacement(
        calculateFloatingSubmenuPlacement({
          anchorRect: row.getBoundingClientRect(),
          submenuHeight:
            submenuRef.current?.offsetHeight
            || estimatedModelSubmenuHeight(activeProviderGroup.modelIds.length),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          coordinateScale: currentBodyZoom()
        })
      )
    }

    updatePlacement()
    const menu = menuRef.current
    menu?.addEventListener('scroll', updatePlacement, true)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      menu?.removeEventListener('scroll', updatePlacement, true)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [activeProviderGroup, menuOpen])

  // Discovery: re-resolve when the menu opens or the model changes. Opening the
  // menu is explicit user intent to inspect, so it forces a fresh local
  // re-resolve: declarations can change in Settings while the cached snapshot
  // still says 'ready'. The store still guards against late responses
  // overriding a newer selection.
  useEffect(() => {
    if (!discoveryEnabled) return
    onRefreshComposerReasoningDiscovery?.({ force: menuOpen })
  }, [menuOpen, composerModel, discoveryEnabled, onRefreshComposerReasoningDiscovery])

  // Per (runtime × model) memory: switching back to a previous pair restores
  // that pair's remembered choice; the store revalidates it against discovery
  // and persists any reset with the same notice used when restoring a Session.
  const turnControlScope = composerTurnControlScopeKey(currentRuntime, resolvedModelId)
  const turnControlScopeRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = turnControlScopeRef.current
    turnControlScopeRef.current = turnControlScope
    if (!onComposerReasoningEffortChange) return
    if (previous === null || previous === turnControlScope) return
    const remembered = readComposerTurnControlMemory(turnControlScope)
    if (!remembered || remembered.reasoningEffort === undefined) return
    if ((composerReasoningEffort ?? '').trim() === remembered.reasoningEffort) return
    onComposerReasoningEffortChange(remembered.reasoningEffort)
    onRefreshComposerReasoningDiscovery?.()
  }, [turnControlScope, composerReasoningEffort, onComposerReasoningEffortChange, onRefreshComposerReasoningDiscovery])

  const menuStyle: CSSProperties = menuPlacement
    ? {
        left: `${menuPlacement.left}px`,
        top: `${menuPlacement.top}px`,
        width: `${menuPlacement.width}px`,
        maxHeight: `${menuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_MENU_WIDTH}px`,
        maxHeight: `${FLOATING_MENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const submenuStyle: CSSProperties = submenuPlacement
    ? {
        left: `${submenuPlacement.left}px`,
        top: `${submenuPlacement.top}px`,
        width: `${submenuPlacement.width}px`,
        maxHeight: `${submenuPlacement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${FLOATING_SUBMENU_WIDTH}px`,
        maxHeight: `${FLOATING_SUBMENU_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  const renderMenu = (className: string): ReactElement | null => {
    if (!menuOpen || !canChangeModel) return null
    const menu = (
      <>
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle}
          className={className}
        >
        {runtimeEnabled ? (
          <>
            <MenuSectionTitle icon={<Bot className="h-3.5 w-3.5" strokeWidth={1.9} />}>
              {t('composerRuntimeSection')}
            </MenuSectionTitle>
            <div className="rounded-xl border border-ds-border-muted bg-ds-main/30 px-2 py-2">
              <div className="flex flex-col gap-1">
                {runtimeSection.visibleRuntimeIds.map((runtimeId) => {
                  const option = RUNTIME_OPTIONS.find((candidate) => candidate.id === runtimeId)
                  if (!option) return null
                  const canSwitch = runtimeSection.interactive || (runtimeLocked && option.id === 'codex')
                  return (
                    <PickerRow
                      key={option.id}
                      selected={currentRuntime === option.id}
                      title={t(option.labelKey)}
                      disabled={!canSwitch}
                      onClick={() => {
                        if (!canSwitch) return
                        onActiveAgentRuntimeChange?.(option.id)
                        setMenuOpen(false)
                      }}
                    />
                  )
                })}
              </div>
              {runtimeSection.noteKey ? (
                <div className="mt-2 rounded-lg bg-ds-hover/60 px-2.5 py-2 text-[11.5px] leading-4 text-ds-faint">
                  {t(runtimeSection.noteKey)}
                </div>
              ) : null}
            </div>
            <MenuSeparator />
          </>
        ) : null}

        <MenuSectionTitle icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.9} />}>
          {t('composerModel')}
        </MenuSectionTitle>
        <div className="max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-ds-border-muted bg-ds-main/20 p-1">
          {declaredEntryIds.length === 0 ? (
            <PickerRow
              selected={!currentModel}
              title={t('autoLabel')}
              onClick={() => {
                if (sessionFixedControls) return
                onComposerModelChange('')
                setMenuOpen(false)
              }}
            />
          ) : null}
          {modelOptions.map((id) => {
            const entry = composerModelEntryFor(composerModelGroups, id)
            const descriptor = modelCatalog?.models.find((model) => model.id === id)
            const rowLocked = sessionFixedControls && id !== resolvedModelId
            return (
              <PickerRow
                key={id}
                selected={resolvedModelId === id}
                title={entry?.displayName || descriptor?.displayName || id}
                subtitle={entry && entry.displayName !== id ? id : undefined}
                disabled={rowLocked}
                onClick={() => {
                  if (rowLocked) return
                  onComposerModelChange(id)
                  setMenuOpen(false)
                }}
              />
            )
          })}
        </div>
        {sessionFixedControls ? (
          <div className="px-1 pt-1.5 text-[11.5px] leading-4 text-ds-faint">
            {t('composerDshSessionFixed')}
          </div>
        ) : null}
        {onOpenModelAccess ? (
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              onOpenModelAccess()
            }}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <span>{t('composerManageModelAccess')}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          </button>
        ) : null}
        <MenuSeparator />

        {reasoningEnabled ? (
          <>
            <MenuSectionTitle icon={<Brain className="h-3.5 w-3.5" strokeWidth={1.9} />}>
              {t('composerReasoning')}
            </MenuSectionTitle>
            <div className="rounded-xl border border-ds-border-muted bg-ds-main/30 px-3 py-3">
              <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 text-[13px] font-semibold text-ds-ink">
                  {currentReasoningLabel}
                </div>
                {discoveryEnabled ? (
                  <button
                    type="button"
                    aria-label={t('composerReasoningRefresh')}
                    title={t('composerReasoningRefresh')}
                    disabled={discovery?.status === 'loading'}
                    onClick={() => onRefreshComposerReasoningDiscovery?.({ force: true })}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${discovery?.status === 'loading' ? 'animate-spin' : ''}`}
                      strokeWidth={1.9}
                    />
                  </button>
                ) : null}
              </div>
              <div role="radiogroup" aria-label={t('composerReasoning')} className="flex flex-wrap gap-1">
                {reasoningOptions.map((option) => {
                  const selected = currentReasoning === option.id
                  const optionLocked = sessionFixedControls && !selected
                  return (
                    <button
                      key={option.id || '__upstream-default'}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`composer-reasoning-option-${option.id || 'default'}`}
                      disabled={optionLocked}
                      onClick={() => {
                        if (optionLocked) return
                        writeComposerTurnControlMemory(turnControlScope, {
                          reasoningEffort: (option.id ?? '').trim()
                        })
                        onComposerReasoningEffortChange?.(option.id)
                      }}
                      className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
                        selected
                          ? 'border-accent/60 bg-accent/10 text-ds-ink'
                          : 'border-ds-border-muted bg-ds-card/60 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {reasoningUnsupportedSelection ? (
                <div className="mt-2 text-[11.5px] leading-4 text-amber-700 dark:text-amber-300">
                  {t('composerReasoningUnsupported')}
                </div>
              ) : null}
              {discovery?.status === 'loading' ? (
                <div className="mt-2 flex items-center gap-1.5 text-[11.5px] leading-4 text-ds-faint">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.9} />
                  {t('composerReasoningLoading')}
                </div>
              ) : null}
              {discovery?.status === 'error' ? (
                <div className="mt-2 text-[11.5px] leading-4 text-amber-700 dark:text-amber-300">
                  {t('composerReasoningDiscoveryError', { message: discovery.message ?? '' })}
                </div>
              ) : null}
              {discoveryHintKey ? (
                <div className="mt-2 text-[11.5px] leading-4 text-ds-faint">{t(discoveryHintKey)}</div>
              ) : null}
              {discoverySourceLabel ? (
                <div className="mt-2 text-[10.5px] leading-4 text-ds-faint">
                  {t(discoverySourceLabel)}
                  {discovery?.status === 'ready' && discovery.outcome?.checkedAt
                    ? ` · ${t('composerReasoningUpdatedAt', {
                        time: formatDiscoveryCheckedAt(discovery.outcome.checkedAt)
                      })}`
                    : ''}
                </div>
              ) : null}
              {discovery?.status === 'ready' && discovery.outcome?.stale ? (
                <div className="mt-1 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
                  {t('composerReasoningStaleNote', {
                    message: discovery.outcome.refreshError ?? ''
                  })}
                </div>
              ) : null}
              {discoveryPartial ? (
                <div className="mt-1 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
                  {t('composerReasoningPartial')}
                </div>
              ) : null}
            </div>
            <MenuSeparator />
          </>
        ) : null}

        {serviceTierEnabled ? (
          <>
            <div className="flex items-center gap-2 px-1">
              <div className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-ds-faint">
                <Gauge className="h-3.5 w-3.5" strokeWidth={1.9} />
                <span>{t('composerServiceTier')}</span>
              </div>
              <div className="ml-auto flex min-w-0 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-main/30 p-1">
                <SpeedTierButton
                  selected={!currentServiceTier}
                  title={t('autoLabel')}
                  onClick={() => onComposerServiceTierChange?.('')}
                />
                {serviceTierOptions.map((option) => (
                  <SpeedTierButton
                    key={option.id}
                    selected={currentServiceTier === option.id}
                    title={option.displayName || option.id}
                    onClick={() => onComposerServiceTierChange?.(option.id)}
                  />
                ))}
              </div>
            </div>
            <MenuSeparator />
          </>
        ) : null}
        </div>
      </>
    )

    if (typeof document === 'undefined') return menu
    return createPortal(menu, document.body)
  }

  if (mode === 'combobox') {
    return (
      <div
        ref={(node) => {
          pickerRef.current = node
        }}
        className={`ds-composer-model-picker ds-no-drag relative flex h-9 items-center rounded-full transition ${comboboxWidthClass} ${
          canChangeModel ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
        }`}
        title={controlsTitle}
      >
        <span className="sr-only">{t('composerModel')}</span>
        <button
          type="button"
          disabled={!canChangeModel}
          onClick={() => setMenuOpen((open) => !open)}
          title={controlsTitle}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={t('composerModelControls')}
          className={`flex h-9 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden rounded-full py-2 pl-3 pr-1 text-[13px] font-medium outline-none transition ${
            canChangeModel
              ? 'text-current focus-visible:ring-2 focus-visible:ring-accent/25'
              : 'cursor-not-allowed text-ds-faint'
          }`}
        >
          <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          {runtimeChipLabel ? (
            <span className="ds-composer-runtime flex min-w-0 shrink items-center gap-1 overflow-hidden text-[12px] font-medium text-ds-faint">
              <span className="truncate">{runtimeChipLabel}</span>
              <span aria-hidden="true">·</span>
            </span>
          ) : null}
          <span className="ds-composer-model-label max-w-[180px] min-w-0 shrink truncate text-right">
            {modelLabel}
          </span>
          {reasoningChipLabel ? (
            <span className="ds-composer-reasoning flex min-w-0 shrink items-center gap-1 overflow-hidden text-[12px] font-semibold text-ds-faint">
              <span aria-hidden="true">·</span>
              <span className="truncate">{reasoningChipLabel}</span>
            </span>
          ) : null}
          <span className="ds-composer-model-chevron mr-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint">
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
          </span>
        </button>
        {renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[12.5px] shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:bg-ds-card')}
      </div>
    )
  }

  return (
    <div
      className={`ds-composer-model-picker ds-no-drag relative h-9 min-w-0 shrink items-center overflow-hidden rounded-full transition ${
        canChangeModel ? 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink' : 'text-ds-faint'
      } ${
        compact ? 'max-w-[280px]' : 'max-w-[360px]'
      }`}
      ref={(node) => {
        pickerRef.current = node
      }}
    >
      <button
        type="button"
        disabled={!canChangeModel}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex h-9 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed ${
          canChangeModel ? 'hover:bg-ds-hover' : ''
        }`}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t('composerModelControls')}
        title={controlsTitle}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {runtimeChipLabel ? (
          <span className="ds-composer-runtime flex min-w-0 shrink items-center gap-1 overflow-hidden text-[12px] font-medium text-ds-faint">
            <span className="truncate">{runtimeChipLabel}</span>
            <span aria-hidden="true">·</span>
          </span>
        ) : null}
        <span className="ds-composer-model-label max-w-[180px] min-w-0 shrink truncate whitespace-nowrap">{modelLabel}</span>
        {reasoningChipLabel ? (
          <span className="ds-composer-reasoning flex min-w-0 shrink items-center gap-1 overflow-hidden text-ds-faint">
            <span aria-hidden="true">·</span>
            <span className="truncate">{reasoningChipLabel}</span>
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
      </button>

      {menuOpen && canChangeModel ? (
        renderMenu('fixed z-[1000] overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_22px_64px_rgba(15,23,42,0.18)] dark:bg-ds-card')
      ) : null}
    </div>
  )
}

/** Localized label for an effort id; an empty id is the upstream default. */
export function composerReasoningEffortLabel(id: string, t: (key: string) => string): string {
  const labelKey = composerReasoningLevelLabelKey(id)
  return labelKey ? t(labelKey) : id || t('composerReasoningUpstreamDefault')
}

export function normalizeComposerReasoningEffort(value: string | undefined): ComposerReasoningEffort {
  return value?.trim() ?? ''
}

export function composerReasoningEffortRequestValue(
  value: ComposerReasoningEffort
): string | undefined {
  return value.trim() || undefined
}

export function calculateFloatingMenuPlacement({
  anchorRect,
  menuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingMenuAnchorRect
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(0, normalizedViewportWidth - FLOATING_MENU_MARGIN * 2)
  const width = Math.min(FLOATING_MENU_WIDTH, viewportMaxWidth)
  const left = clamp(
    normalizedAnchorRect.right - width,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(menuHeight, FLOATING_MENU_MIN_HEIGHT)
  const spaceAbove = Math.max(0, normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP)
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP
  )
  const targetHeight = Math.min(contentHeight, FLOATING_MENU_MAX_HEIGHT)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow)
  const viewportMaxHeight = Math.max(0, normalizedViewportHeight - FLOATING_MENU_MARGIN * 2)
  const maxHeight = Math.min(FLOATING_MENU_MAX_HEIGHT, availableHeight, viewportMaxHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_MENU_GAP - visibleHeight
    : normalizedAnchorRect.bottom + FLOATING_MENU_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function calculateFloatingSubmenuPlacement({
  anchorRect,
  submenuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingSubmenuAnchorRect
  submenuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingSubmenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(FLOATING_SUBMENU_WIDTH, viewportMaxWidth)
  const spaceRight = normalizedViewportWidth - normalizedAnchorRect.right - FLOATING_MENU_MARGIN
  const spaceLeft = normalizedAnchorRect.left - FLOATING_MENU_MARGIN
  const openRight = spaceRight >= width + FLOATING_SUBMENU_GAP || spaceRight >= spaceLeft
  const preferredLeft = openRight
    ? normalizedAnchorRect.right + FLOATING_SUBMENU_GAP
    : normalizedAnchorRect.left - width - FLOATING_SUBMENU_GAP
  const left = clamp(
    preferredLeft,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(submenuHeight, FLOATING_SUBMENU_MIN_HEIGHT)
  const maxHeight = Math.min(
    FLOATING_SUBMENU_MAX_HEIGHT,
    Math.max(FLOATING_SUBMENU_MIN_HEIGHT, normalizedViewportHeight - FLOATING_MENU_MARGIN * 2)
  )
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = normalizedAnchorRect.top - 8
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function normalizeComposerRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'codex' || value === 'claude' || value === 'dsh') return value
  return 'codex'
}

function formatDiscoveryCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function runtimeShortLabelKey(value: AgentRuntimeId): string {
  return RUNTIME_OPTIONS.find((option) => option.id === value)?.shortLabelKey ?? 'composerRuntimeCodexShort'
}

function runtimeChipLabelKey(value: AgentRuntimeId): string {
  switch (value) {
    case 'claude':
      return 'composerRuntimeChipClaude'
    case 'dsh':
      return 'composerRuntimeChipDsh'
    default:
      return 'composerRuntimeChipCodex'
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function fullModelLabel(model: string, autoLabel: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'auto') return autoLabel
  return trimmed
}

function estimatedModelSubmenuHeight(modelCount: number): number {
  return 34 + Math.max(1, modelCount) * 36 + 12
}

function MenuSectionTitle({
  children,
  icon
}: {
  children: string
  icon: ReactElement
}): ReactElement {
  return (
    <div className="flex h-8 items-center gap-2 px-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ds-faint">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function MenuSeparator(): ReactElement {
  return <div className="my-2 h-px bg-ds-border-muted" />
}

function PickerRow({
  selected,
  title,
  subtitle,
  disabled = false,
  onClick
}: {
  selected: boolean
  title: string
  subtitle?: string
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        selected
          ? 'bg-ds-hover text-ds-ink'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] font-semibold leading-4">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block break-all text-[10.5px] font-normal leading-4 text-ds-faint">
            {subtitle}
          </span>
        ) : null}
      </span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} /> : null}
    </button>
  )
}

function SpeedTierButton({
  selected,
  title,
  onClick
}: {
  selected: boolean
  title: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`min-h-7 min-w-[62px] rounded-md border px-2 py-1 text-center text-[11.5px] font-semibold leading-4 transition ${
        selected
          ? 'border-accent/40 bg-ds-card text-ds-ink shadow-sm'
          : 'border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="block break-words">{title}</span>
    </button>
  )
}

function ProviderRow({
  active,
  selected,
  title,
  subtitle,
  refNode,
  onClick,
  onMouseEnter
}: {
  active: boolean
  selected: boolean
  title: string
  subtitle: string
  refNode: (node: HTMLButtonElement | null) => void
  onClick: () => void
  onMouseEnter: () => void
}): ReactElement {
  return (
    <button
      ref={refNode}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={active}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onMouseEnter}
      onFocus={onMouseEnter}
      onClick={onClick}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
        active
          ? 'bg-ds-hover text-ds-ink'
          : selected
            ? 'text-ds-ink hover:bg-ds-hover'
            : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[11.5px] font-medium text-ds-faint">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
    </button>
  )
}
