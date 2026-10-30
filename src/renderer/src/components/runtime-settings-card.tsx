import { useEffect, useRef, useState, type ReactElement } from 'react'
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
  tCommon?: (key: string) => string
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
  const { runtimeId, command, selected, onSelect, onCommand, t, tCommon = t } = props
  const provider = getProvider()
  const sequence = useRef(0)
  const [discovery, setDiscovery] = useState(props.discovery)
  const [capabilities, setCapabilities] = useState(props.capabilities)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    sequence.current++
    setDiscovery(props.discovery)
    setCapabilities(props.capabilities)
    setChecking(false)
    return () => { sequence.current++ }
  }, [runtimeId, command, selected, props.discovery, props.capabilities])
  const detect = async (): Promise<void> => {
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
  }
  const support = (value: boolean | undefined): string => t(value === undefined
    ? 'runtimeSupportUnknown' : value ? 'runtimeSupported' : 'runtimeUnsupported')
  return <section data-runtime-settings={runtimeId} className="grid gap-3 border-t border-ds-border-muted p-4">
    <h3 className="font-semibold">{t(`${runtimeId}Runtime`)}</h3>
    <p className="text-sm text-ds-muted">{t(`${runtimeId}RuntimeDesc`)}</p>
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
        void window.sciforge.pickFile({ title: t('runtimeChooseExecutable'), filters: [{ name: '*', extensions: ['*'] }] }).then((selection) => {
          if (request !== sequence.current || selection.canceled || !selection.path) return
          onCommand(provider.normalizeExecutablePath(runtimeId, selection.path))
        })
      }}>{t('runtimeChooseExecutable')}</button>
    </div>
    <p role="status">{t(discovery?.available ? 'runtimeDiscoveryAvailable' : 'runtimeDiscoveryUnavailable')}</p>
    {discovery?.failure ? <p role="alert">{tCommon(runtimeErrorTranslationKey(discovery.failure.code) ?? 'runtimeActionFailed')}</p> : null}
    <details><summary>{t('runtimeDetails')}</summary>
      {discovery?.source
        ? <p>{t('runtimeDiscoveryDetectedFrom')}: {t(`runtimeDiscoverySource_${discovery.source.replaceAll('-', '_')}`)}</p>
        : null}
      {discovery?.version ? <p>{t('runtimeDiscoveryVersionLabel')}: {discovery.version}</p> : null}
      {discovery?.deploymentIntegrity
        ? <p>{t(discovery.deploymentIntegrity === 'pinned' ? 'runtimeDeploymentIntegrityPinned' : 'runtimeDeploymentIntegrityDerived')}</p>
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
