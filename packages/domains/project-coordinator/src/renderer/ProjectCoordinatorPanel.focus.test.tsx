import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import i18next from 'i18next'
import { act, createElement, createRef } from 'react'
import { initReactI18next } from 'react-i18next'
import { CollaborationSettingsDrawer } from './ProjectCoordinatorPanel.js'

test('settings parent refresh does not steal focus from its active input', async () => {
  const window = new Window()
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true
  })
  await i18next.use(initReactI18next).init({
    lng: 'en',
    showSupportNotice: false,
    resources: {
      en: {
        common: {
          projectCoordinatorTitle: 'Collaboration Center',
          projectCoordinatorCenterConnections: 'Connections and settings',
          projectCoordinatorCenterCloseSettings: 'Close connections and settings',
          fixtureConnectionSettings: 'Connection'
        }
      }
    }
  })
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const returnFocusRef = createRef<HTMLButtonElement>()
  let firstCloseCalls = 0
  let secondCloseCalls = 0
  const sections = [{
    contributionId: 'fixture.connection-settings',
    sectionId: 'connections',
    label: 'fixtureConnectionSettings',
    render: () => createElement('input', {
      'aria-label': 'Collaboration service address',
      defaultValue: 'https://cloud-test.sciforge.cn'
    })
  }] as unknown as Parameters<typeof CollaborationSettingsDrawer>[0]['sections']
  const session = { id: 'session-focus-regression' } as Parameters<
    typeof CollaborationSettingsDrawer
  >[0]['session']

  try {
    await act(async () => {
      root.render(createElement(CollaborationSettingsDrawer, {
        open: true,
        sections,
        session,
        returnFocusRef,
        onClose: () => { firstCloseCalls += 1 }
      }))
    })

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Collaboration service address"]'
    )
    assert.ok(input)
    input.focus()
    assert.equal(document.activeElement, input)

    await act(async () => {
      root.render(createElement(CollaborationSettingsDrawer, {
        open: true,
        sections,
        session,
        returnFocusRef,
        onClose: () => { secondCloseCalls += 1 }
      }))
    })

    assert.equal(document.activeElement, input)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    assert.equal(firstCloseCalls, 0)
    assert.equal(secondCloseCalls, 1)
  } finally {
    await act(async () => root.unmount())
    window.close()
  }
})
