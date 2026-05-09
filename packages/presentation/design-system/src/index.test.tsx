import assert from 'node:assert/strict';
import test from 'node:test';
import { Activity } from 'lucide-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActionButton,
  Badge,
  Card,
  Details,
  EmptyState,
  IconButton,
  Input,
  Panel,
  SectionHeader,
  Select,
  TabBar,
  cssVar,
  semanticTokens,
  themeClassNames,
} from './index';

test('design-system primitives render stable class contracts', () => {
  const tabs = [
    { id: 'summary', label: 'Summary', icon: Activity },
    { id: 'details', label: 'Details' },
  ] as const;
  const markup = renderToStaticMarkup(
    <div>
      <Badge variant="success" glow>ready</Badge>
      <Card>card</Card>
      <Panel>panel</Panel>
      <IconButton icon={Activity} label="Refresh" />
      <ActionButton icon={Activity} variant="secondary">Run</ActionButton>
      <SectionHeader icon={Activity} title="Results" subtitle="Runtime output" />
      <TabBar tabs={[...tabs]} active="summary" onChange={() => undefined} />
      <EmptyState title="No artifacts" detail="Run a task first." />
      <Input aria-label="Name" />
      <Select aria-label="Mode"><option>Auto</option></Select>
      <Details summary="More"><span>Nested content</span></Details>
    </div>,
  );

  for (const className of [
    'badge-success',
    'badge-glow',
    'card',
    'panel',
    'icon-button',
    'action-secondary',
    'section-header',
    'tabbar',
    'empty-runtime-state',
    'ds-input',
    'ds-select',
    'ds-details',
  ]) {
    assert.match(markup, new RegExp(`class="[^"]*${className}`));
  }
  assert.match(markup, /aria-label="Refresh"/);
  assert.match(markup, /role="tablist"/);
});

test('semantic token helpers expose dark and light theme contracts', () => {
  assert.equal(themeClassNames.dark, 'theme-dark');
  assert.equal(themeClassNames.light, 'theme-light');
  assert.ok(semanticTokens.includes('surface'));
  assert.ok(semanticTokens.includes('focus-ring'));
  assert.ok(semanticTokens.includes('space-4'));
  assert.equal(cssVar('surface-raised'), 'var(--surface-raised)');
});
