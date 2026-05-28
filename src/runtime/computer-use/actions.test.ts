import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseGenericActions } from './actions.js';

test('generic action parser keeps final open_app appName contract only', () => {
  const [action] = parseGenericActions([{ type: 'open_app', appName: 'Safari' }]);
  assert.equal(action?.type, 'open_app');
  if (action?.type === 'open_app') assert.equal(action.appName, 'Safari');
  assert.deepEqual(parseGenericActions([{ type: 'open_app', targetDescription: 'Safari' }]), []);
  assert.deepEqual(parseGenericActions([{ type: 'open_app', target: 'Safari' }]), []);
});

test('generic action parser normalizes action discriminator aliases without relaxing payload fields', () => {
  const [typed] = parseGenericActions([{ actionType: 'type_text', text: 'hello' }]);
  assert.equal(typed?.type, 'type_text');
  if (typed?.type === 'type_text') assert.equal(typed.text, 'hello');

  const [pressed] = parseGenericActions([{ action: 'press_key', key: 'Enter' }]);
  assert.equal(pressed?.type, 'press_key');
  if (pressed?.type === 'press_key') assert.equal(pressed.key, 'Enter');

  const [hotkey] = parseGenericActions([{ kind: 'hotkey', keys: ['command', 'space'] }]);
  assert.equal(hotkey?.type, 'hotkey');
  if (hotkey?.type === 'hotkey') assert.deepEqual(hotkey.keys, ['command', 'space']);

  assert.deepEqual(parseGenericActions([{ actionType: 'type_text', targetDescription: 'Search field' }]), []);
  assert.deepEqual(parseGenericActions([{ action: 'press_key', targetDescription: 'Enter key' }]), []);
  assert.deepEqual(parseGenericActions([{ kind: 'hotkey', targetDescription: 'Spotlight shortcut' }]), []);
});

test('generic action parser downgrades false high-risk labels on benign visible controls', () => {
  const [fieldClick] = parseGenericActions([{
    type: 'click',
    targetDescription: 'First Name text input field in the visible form example',
    targetRegionDescription: 'form area containing text fields, checkboxes, and a Submit button',
    riskLevel: 'high',
    requiresConfirmation: true,
  }]);

  assert.equal(fieldClick?.type, 'click');
  assert.equal(fieldClick?.riskLevel, 'low');
  assert.equal(fieldClick?.requiresConfirmation, false);

  const [submitClick] = parseGenericActions([{
    type: 'click',
    targetDescription: 'Submit payment button',
    riskLevel: 'high',
    requiresConfirmation: true,
  }]);

  assert.equal(submitClick?.type, 'click');
  assert.equal(submitClick?.riskLevel, 'high');
  assert.equal(submitClick?.requiresConfirmation, true);
});
