import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type ReactElement } from 'react'

import {
  DagWorkbenchFrame,
  DagWorkbenchProgressiveLayer
} from './dag-workbench-ui'

type ElementProps = Record<string, unknown> & Readonly<{
  children?: ReactElement | readonly ReactElement[]
}>

test('provides one progressive layer contract for Project and Evidence graphs', () => {
  const layer = DagWorkbenchProgressiveLayer({
    ariaLabel: 'Committed graph',
    auditWarning: 'Pending changes are not committed.',
    committedLabel: 'Committed v3',
    pending: {
      failed: false,
      label: 'Updating',
      state: 'running'
    }
  }) as ReactElement<ElementProps>

  assert.equal(layer.props['data-dag-progressive-view'], 'true')
  assert.equal(layer.props['aria-label'], 'Committed graph')
})

test('provides one sandboxed frame contract for Project and Evidence graphs', () => {
  const frame = DagWorkbenchFrame({
    emptyIcon: createElement('span'),
    emptyLabel: 'No graph',
    frameKey: 'graph:sha256:digest',
    frameRef: { current: null },
    frameUrl: 'http://127.0.0.1:9000/',
    hasView: true,
    loading: false,
    loadingLabel: 'Loading graph',
    sandbox: 'allow-forms allow-same-origin allow-scripts',
    title: 'Graph'
  }) as ReactElement<ElementProps>
  const child = frame.props.children as ReactElement<ElementProps>

  assert.equal(frame.props['data-dag-workbench-frame'], 'true')
  assert.equal(child.type, 'iframe')
  assert.equal(child.props.sandbox, 'allow-forms allow-same-origin allow-scripts')
  assert.equal(child.props.referrerPolicy, 'no-referrer')
})
