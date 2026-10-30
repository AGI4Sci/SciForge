import { describe, expect, it } from 'vitest'
import {
  findKeyboardShortcutCommand,
  findKeyboardShortcutConflict,
  formatKeyboardShortcut,
  keyboardEventToShortcut,
  normalizeKeyboardShortcuts,
  normalizeKeyboardShortcut,
  resolveKeyboardShortcutBindings
} from './keyboard-shortcuts'

describe('keyboard shortcuts', () => {
  it.each(['win32', 'linux'])('uses Control editing shortcuts on %s', platform => {
    const bindings = resolveKeyboardShortcutBindings(undefined, platform)
    expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key: 'c', ctrlKey: true }))).toBe('copy')
    expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key: 'v', ctrlKey: true }))).toBe('paste')
    expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key: 'c', metaKey: true }))).toBeNull()
  })

  it('uses Command editing shortcuts and native menu conventions on macOS', () => {
    const bindings = resolveKeyboardShortcutBindings(undefined, 'darwin')
    for (const [key, command] of [['c', 'copy'], ['v', 'paste'], ['x', 'cut'], ['a', 'select-all'], ['z', 'undo'], ['q', 'quit'], ['w', 'close'], ['m', 'minimize']]) {
      expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key, metaKey: true }))).toBe(command)
    }
    expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo')
    expect(bindings['toggle-devtools']).toEqual(['Alt+Meta+I'])
    expect(bindings['toggle-plan-mode']).toEqual(['Shift+Tab'])
    expect(findKeyboardShortcutCommand(bindings, keyboardEventToShortcut({ key: 'c', ctrlKey: true }))).toBeNull()
    expect(formatKeyboardShortcut(bindings.copy[0], 'darwin')).toBe('⌘+C')
  })

  it('preserves explicit Control overrides on macOS and restores platform defaults on reset', () => {
    expect(resolveKeyboardShortcutBindings({ bindings: { copy: ['Ctrl+C'], paste: [] } }, 'darwin')).toMatchObject({
      copy: ['Ctrl+C'], paste: ['Meta+V']
    })
  })

  it('normalizes common shortcut strings', () => {
    expect(normalizeKeyboardShortcut('shift + tab')).toBe('Shift+Tab')
    expect(normalizeKeyboardShortcut('ctrl++')).toBe('Ctrl++')
    expect(normalizeKeyboardShortcut('control + shift + i')).toBe('Ctrl+Shift+I')
  })

  it('converts keyboard events to shortcut strings', () => {
    expect(keyboardEventToShortcut({ key: 'Tab', shiftKey: true })).toBe('Shift+Tab')
    expect(keyboardEventToShortcut({ key: '+', ctrlKey: true })).toBe('Ctrl++')
    expect(keyboardEventToShortcut({ key: 'Shift', shiftKey: true })).toBeNull()
  })

  it('uses defaults unless a command has a custom binding', () => {
    const bindings = resolveKeyboardShortcutBindings({
      bindings: {
        'toggle-plan-mode': ['Ctrl+Shift+P'],
        'new-chat': []
      }
    })

    expect(bindings['toggle-plan-mode']).toEqual(['Ctrl+Shift+P'])
    expect(bindings['new-chat']).toEqual(['Ctrl+N'])
  })

  it('ignores unknown commands and detects conflicts', () => {
    const bindings = resolveKeyboardShortcutBindings(normalizeKeyboardShortcuts({
      bindings: {
        'toggle-plan-mode': ['Ctrl+Shift+P'],
        unknown: ['Ctrl+Shift+X']
      } as Record<string, string[]>
    }))

    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+Shift+P')).toBe('toggle-plan-mode')
    expect(findKeyboardShortcutCommand(bindings, 'Ctrl+Shift+X')).toBeNull()
    expect(findKeyboardShortcutConflict(bindings, 'settings', 'Ctrl+Shift+P')).toBe('toggle-plan-mode')
  })
})
