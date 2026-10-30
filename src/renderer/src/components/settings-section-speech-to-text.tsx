import type { ReactElement } from 'react'
import {
  normalizeSpeechToTextSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type SpeechToTextSettingsPatchV1
} from '@shared/app-settings'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

const SPEECH_LANGUAGE_OPTIONS = ['', 'zh', 'en', 'ja', 'ko'] as const

type SpeechToTextSettingsContext = {
  t: (key: string, values?: Record<string, unknown>) => string
  form: AppSettingsV1
  update: (partial: AppSettingsPatch) => void
  selectControlClass: string
}

function textInputClass(extra = ''): string {
  return `w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 ${extra}`
}

export function speechToTextSettingsPatch(
  current: AppSettingsV1['speechToText'],
  patch: SpeechToTextSettingsPatchV1
): AppSettingsPatch {
  const next = normalizeSpeechToTextSettings({
    ...normalizeSpeechToTextSettings(current),
    ...patch
  })
  return {
    speechToText: {
      enabled: next.enabled,
      protocol: next.protocol,
      model: next.model,
      language: next.language,
      timeoutMs: next.timeoutMs
    }
  }
}

export function SpeechToTextSettingsSection({ ctx }: { ctx: SpeechToTextSettingsContext }): ReactElement {
  const { t, form, update, selectControlClass } = ctx
  const speechToText = normalizeSpeechToTextSettings(form.speechToText)

  const updateSpeechToText = (patch: SpeechToTextSettingsPatchV1): void => {
    update(speechToTextSettingsPatch(speechToText, patch))
  }

  return (
    <>
      <SettingsCard title={t('sectionSpeechToText')}>
        <SettingRow
          title={t('speechToTextEnabled')}
          description={t('speechToTextEnabledDesc')}
          control={
            <Toggle
              checked={speechToText.enabled}
              onChange={(enabled) => updateSpeechToText({ enabled })}
            />
          }
        />
        <SettingRow
          title={t('speechToTextModel')}
          description={t('speechToTextModelDesc')}
          control={
            <input
              className={textInputClass('md:max-w-md')}
              value={speechToText.model}
              placeholder={t('speechToTextModelPlaceholder')}
              onChange={(e) => updateSpeechToText({ model: e.target.value })}
            />
          }
        />
        <SettingRow
          title={t('speechToTextLanguage')}
          description={t('speechToTextLanguageDesc')}
          control={
            <select
              className={selectControlClass}
              value={speechToText.language}
              onChange={(e) => updateSpeechToText({ language: e.target.value })}
            >
              {SPEECH_LANGUAGE_OPTIONS.map((language) => (
                <option key={language || 'auto'} value={language}>
                  {t(`speechLanguage_${language || 'auto'}`)}
                </option>
              ))}
              {!SPEECH_LANGUAGE_OPTIONS.includes(speechToText.language as typeof SPEECH_LANGUAGE_OPTIONS[number]) ? (
                <option value={speechToText.language}>{speechToText.language}</option>
              ) : null}
            </select>
          }
        />
        <SettingRow
          title={t('speechToTextTimeout')}
          description={t('speechToTextTimeoutDesc')}
          control={
            <input
              type="number"
              min={5000}
              max={600000}
              step={5000}
              className="w-32 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
              value={speechToText.timeoutMs}
              placeholder={String(60000)}
              onChange={(e) => updateSpeechToText({ timeoutMs: Number(e.target.value) })}
            />
          }
        />
      </SettingsCard>
    </>
  )
}
