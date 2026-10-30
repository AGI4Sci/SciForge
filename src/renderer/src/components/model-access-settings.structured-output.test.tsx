// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeAppSettings,
  type AppSettingsV1,
  type ModelRouterMemberSettingsV1
} from '@shared/app-settings'
import { ModelAccessSettings } from './model-access-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function settings(textReasoner: Partial<ModelRouterMemberSettingsV1> = {}): AppSettingsV1 {
  return normalizeAppSettings({
    modelAccess: { mode: 'api', planAdapterId: '' },
    modelRouter: {
      profiles: {
        default: {
          textReasoner: {
            baseUrl: 'https://models.example.test/v1',
            apiKey: 'secret',
            model: 'reasoner',
            ...textReasoner
          }
        }
      }
    }
  } as AppSettingsV1)
}

describe('ModelAccessSettings structured-output control', () => {
  let root: Root | undefined

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount() })
    root = undefined
    document.body.innerHTML = ''
  })

  async function render(form: AppSettingsV1, update = vi.fn()): Promise<HTMLSelectElement | null> {
    await act(async () => {
      root = createRoot(document.body.appendChild(document.createElement('div')))
      root.render(createElement(ModelAccessSettings, { form, update, t: (key: string) => key }))
    })
    const label = [...document.querySelectorAll('label')]
      .find((candidate) => candidate.textContent?.includes('modelRouterRoleStructuredOutput'))
    return label?.querySelector('select') ?? null
  }

  it('reads the persisted mode and defaults to json_schema', async () => {
    const select = await render(settings())
    expect(select?.value).toBe('json_schema')
    expect([...select!.options].map((option) => option.textContent)).toEqual([
      'modelRouterStructuredOutput_json_schema',
      'modelRouterStructuredOutput_json_object'
    ])
    expect(document.body.textContent).toContain('modelRouterRoleStructuredOutputHint')

    await act(async () => { root?.unmount() })
    root = undefined
    document.body.innerHTML = ''
    expect((await render(settings({ chatStructuredOutputMode: 'json_object' })))?.value).toBe('json_object')
  })

  it('writes the selected mode as an explicit text reasoner patch', async () => {
    const update = vi.fn()
    const select = await render(settings({ protocol: 'chat-completions' }), update)
    await act(async () => {
      select!.value = 'json_object'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(update).toHaveBeenCalledWith({
      modelRouter: { profiles: { default: { textReasoner: { chatStructuredOutputMode: 'json_object' } } } }
    })
  })

  it('is hidden for wires that do not use Chat response_format', async () => {
    expect(await render(settings({ protocol: 'responses' }))).toBeNull()
  })
})
