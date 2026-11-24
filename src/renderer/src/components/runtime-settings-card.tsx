import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { AgentRuntimeCapabilities, AgentRuntimeDiscoveryResult } from '@shared/agent-runtime-contract'
import { getProvider } from '../agent/registry'
import { runtimeErrorTranslationKey } from '../lib/format-runtime-error'

type Props = {
  runtimeId: AgentRuntimeId
  command: string
  selected: boolean
  onSelect: () => void
  onCommand: (command: string) => void
  t: (key: string) => string
  tCommon: (key: string) => string
  children?: ReactNode
  details?: ReactNode
  capabilities?: AgentRuntimeCapabilities
  discovery?: AgentRuntimeDiscoveryResult
}

export async function runLatestRuntimeDiscovery<T extends { runtimeId: string }>(
  runtimeId: AgentRuntimeId, command: string, sequence: { current: number },
  probe: (runtimeId: AgentRuntimeId, command: string) => Promise<T>
): Promise<{ status: 'current'; result: T } | { status: 'stale' }> {
  const request = ++sequence.current
  try {
    const result = await probe(runtimeId, command)
    return sequence.current === request && result.runtimeId === runtimeId
      ? { status: 'current', result } : { status: 'stale' }
  } catch (error) {
    if (sequence.current !== request) return { status: 'stale' }
    throw error
  }
}

/** Thin settings integration; executable discovery and protocol semantics remain adapter-owned. */
export function RuntimeSettingsCard(props: Props): ReactElement {
  const { runtimeId, command, selected, onSelect, onCommand, t, tCommon } = props
  const provider = getProvider()
  const recoveryOptions = provider.getRecoveryOptions(runtimeId)
  const sequence = useRef(0)
  const [discovery, setDiscovery] = useState(props.discovery)
  const [capabilities, setCapabilities] = useState(props.capabilities)
  const [checking, setChecking] = useState(false)
  const detect = useCallback(async (): Promise<void> => {
    setChecking(true)
    setCapabilities(undefined)
    const request = sequence.current + 1
    try {
      const outcome = await runLatestRuntimeDiscovery(runtimeId, command, sequence,
        (id, candidate) => provider.probe(id, candidate))
      if (outcome.status === 'stale') return
      setDiscovery(outcome.result)
      if (outcome.result.available) {
        const result = await provider.getRuntimeCapabilities?.(runtimeId)
        if (sequence.current !== request) return
        if (result?.runtimeId === runtimeId) setCapabilities(result)
      }
    } catch {
      if (sequence.current !== request) return
      setDiscovery({ runtimeId, available: false, executablePath: null, source: null,
        version: null, protocol: null, failure: { code: 'runtime_probe_failed' } })
    } finally {
      if (sequence.current === request) setChecking(false)
    }
  }, [runtimeId, command, provider])
  useEffect(() => {
    const requests = sequence
    requests.current++
    setDiscovery(props.discovery)
    setCapabilities(props.capabilities)
    setChecking(false)
    if (!props.discovery) void detect()
    return () => { requests.current++ }
  }, [detect, selected, props.discovery, props.capabilities])
  const support = (value: boolean | undefined): string => t(value === undefined
    ? 'runtimeSupportUnknown' : value ? 'runtimeSupported' : 'runtimeUnsupported')
  return <section data-runtime-settings={runtimeId} className="grid gap-3 border-t border-ds-border-muted p-4">
    <h3 className="font-semibold">{t(`${runtimeId}Runtime`)}</h3>
    <p className="text-ds-lg text-ds-muted">{t(`${runtimeId}RuntimeDesc`)}</p>
    <button type="button" disabled={selected} onClick={onSelect}>
      {t(selected ? 'runtimeSelected' : 'runtimeSelect')}
    </button>
    <label className="grid gap-2">{t('runtimeCommand')}
      <input value={command} onChange={(event) => { sequence.current++; onCommand(event.target.value) }}
        className="rounded-xl border border-ds-border bg-ds-card px-3 py-2" />
    </label>
    <div className="flex gap-3">
      <button type="button" disabled={checking} onClick={() => void detect()}>{t('runtimeDetect')}</button>
      <button type="button" onClick={() => {
        const request = ++sequence.current
        setChecking(false)
        void window.sciforge.pickFile({ title: t('runtimeChooseExecutable'), filters: [{ name: '*', extensions: ['*'] }] }).then((selection) => {
          if (request !== sequence.current || selection.canceled || !selection.path) return
          onCommand(provider.normalizeExecutablePath(runtimeId, selection.path))
        })
      }}>{t('runtimeChooseExecutable')}</button>
      {recoveryOptions.installGuideUrl ? <button type="button" onClick={() => {
        void window.sciforge.openExternal(recoveryOptions.installGuideUrl!)
      }}>{tCommon('runtimeInstallGuide')}</button> : null}
    </div>
    {props.children}
    <p role="status">{t(discovery?.available ? 'runtimeDiscoveryAvailable' : 'runtimeDiscoveryUnavailable')}</p>
    {discovery?.failure ? <p role="alert">{tCommon(runtimeErrorTranslationKey(discovery.failure.code) ?? 'runtimeActionFailed')}</p> : null}
    <details data-runtime-details={runtimeId}><summary>{t('runtimeDetails')}</summary>
      {props.details}
      {discovery?.executablePath ? <code className="break-all">{discovery.executablePath}</code> : null}
      {discovery?.source
        ? <p>{tCommon('runtimeDiscoveryDetectedFrom')}: {tCommon(`runtimeDiscoverySource_${discovery.source.replaceAll('-', '_')}`)}</p>
        : null}
      {discovery?.version ? <p>{tCommon('runtimeDiscoveryVersionLabel')}: {discovery.version}</p> : null}
      {discovery?.deploymentIntegrity
        ? <p>{tCommon(discovery.deploymentIntegrity === 'pinned' ? 'runtimeDeploymentIntegrityPinned' : 'runtimeDeploymentIntegrityDerived')}</p>
        : null}
      {discovery?.protocol ? <p>{discovery.protocol.id}: {support(discovery.protocol.supported)}</p> : null}
      <p>{t('runtimeImageInput')}: {support(capabilities ? capabilities.model.inputModalities.includes('image') : undefined)}</p>
      <p>{t('runtimeFork')}: {support(capabilities?.controls.fork)}</p>
      <p>{t('runtimeSteer')}: {support(capabilities?.controls.steer)}</p>
      <p>{t('runtimeReplay')}: {support(capabilities?.events.replayable)}</p>
      <p>{t('runtimeResume')}: {support(capabilities?.controls.resumeSession)}</p>
    </details>
  </section>
}
