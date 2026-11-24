// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SettingsSidebar } from './SettingsSidebar'

it('appends installed domain settings after all built-in categories and selects their opaque id', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const setCategory = vi.fn()
  const props = { category: 'general', setCategory, goBack: vi.fn(), t: (key: string) => key === 'fixture:settingsLabel' ? 'Fixture settings' : key,
    extensions: [{ id: 'extension:fixture.settings', label: 'fixture:settingsLabel' }] }
  try {
    await act(async () => root.render(createElement(SettingsSidebar, props)))
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'))
    expect(buttons.map(button => button.textContent)).toEqual([
      'general', 'speechToText', 'agents', 'keyboardShortcuts', 'remoteResources', 'Fixture settings'
    ])
    await act(async () => buttons.at(-1)!.click())
    expect(setCategory).toHaveBeenCalledWith('extension:fixture.settings')
    await act(async () => root.render(createElement(SettingsSidebar, { ...props, category: 'extension:fixture.settings' })))
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Fixture settings')
    await act(async () => root.render(createElement(SettingsSidebar, { ...props, extensions: [] })))
    expect(container.querySelectorAll('nav button')).toHaveLength(5)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
