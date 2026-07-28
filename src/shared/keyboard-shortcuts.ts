export const KEYBOARD_SHORTCUT_COMMANDS = [
  {
    id: 'toggle-plan-mode',
    labelKey: 'shortcutTogglePlanMode',
    descriptionKey: 'shortcutTogglePlanModeDesc',
    defaultBindings: ['Shift+Tab']
  },
  {
    id: 'new-chat',
    labelKey: 'shortcutNewChat',
    descriptionKey: 'shortcutNewChatDesc',
    defaultBindings: ['Ctrl+N']
  },
  {
    id: 'choose-workspace',
    labelKey: 'shortcutChooseWorkspace',
    descriptionKey: 'shortcutChooseWorkspaceDesc',
    defaultBindings: ['Ctrl+O']
  },
  {
    id: 'settings',
    labelKey: 'shortcutSettings',
    descriptionKey: 'shortcutSettingsDesc',
    defaultBindings: ['Ctrl+,']
  },
  {
    id: 'quit',
    labelKey: 'shortcutQuit',
    descriptionKey: 'shortcutQuitDesc',
    defaultBindings: ['Alt+F4']
  },
  {
    id: 'undo',
    labelKey: 'shortcutUndo',
    descriptionKey: 'shortcutUndoDesc',
    defaultBindings: ['Ctrl+Z']
  },
  {
    id: 'redo',
    labelKey: 'shortcutRedo',
    descriptionKey: 'shortcutRedoDesc',
    defaultBindings: ['Ctrl+Y']
  },
  {
    id: 'cut',
    labelKey: 'shortcutCut',
    descriptionKey: 'shortcutCutDesc',
    defaultBindings: ['Ctrl+X']
  },
  {
    id: 'copy',
    labelKey: 'shortcutCopy',
    descriptionKey: 'shortcutCopyDesc',
    defaultBindings: ['Ctrl+C']
  },
  {
    id: 'paste',
    labelKey: 'shortcutPaste',
    descriptionKey: 'shortcutPasteDesc',
    defaultBindings: ['Ctrl+V']
  },
  {
    id: 'select-all',
    labelKey: 'shortcutSelectAll',
    descriptionKey: 'shortcutSelectAllDesc',
    defaultBindings: ['Ctrl+A']
  },
  {
    id: 'reload',
    labelKey: 'shortcutReload',
    descriptionKey: 'shortcutReloadDesc',
    defaultBindings: ['Ctrl+R']
  },
  {
    id: 'zoom-in',
    labelKey: 'shortcutZoomIn',
    descriptionKey: 'shortcutZoomInDesc',
    defaultBindings: ['Ctrl++']
  },
  {
    id: 'zoom-out',
    labelKey: 'shortcutZoomOut',
    descriptionKey: 'shortcutZoomOutDesc',
    defaultBindings: ['Ctrl+-']
  },
  {
    id: 'reset-zoom',
    labelKey: 'shortcutResetZoom',
    descriptionKey: 'shortcutResetZoomDesc',
    defaultBindings: ['Ctrl+0']
  },
  {
    id: 'toggle-devtools',
    labelKey: 'shortcutDevTools',
    descriptionKey: 'shortcutDevToolsDesc',
    defaultBindings: ['Ctrl+Shift+I']
  },
  {
    id: 'close',
    labelKey: 'shortcutCloseWindow',
    descriptionKey: 'shortcutCloseWindowDesc',
    defaultBindings: ['Ctrl+W']
  },
  {
    id: 'minimize',
    labelKey: 'shortcutMinimize',
    descriptionKey: 'shortcutMinimizeDesc',
    defaultBindings: []
  },
  {
    id: 'toggle-maximize',
    labelKey: 'shortcutToggleMaximize',
    descriptionKey: 'shortcutToggleMaximizeDesc',
    defaultBindings: []
  }
] as const

export type KeyboardShortcutCommand = typeof KEYBOARD_SHORTCUT_COMMANDS[number]
export type KeyboardShortcutCommandId = KeyboardShortcutCommand['id']
export type KeyboardShortcutBindingsV1 = Partial<Record<KeyboardShortcutCommandId, string[]>>
export type KeyboardShortcutsConfigV1 = {
  bindings: KeyboardShortcutBindingsV1
}

export type KeyboardShortcutEventLike = {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

const COMMAND_IDS = new Set<string>(KEYBOARD_SHORTCUT_COMMANDS.map((command) => command.id))
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const MODIFIER_LABELS: Record<string, 'Ctrl' | 'Shift' | 'Alt' | 'Meta'> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta'
}

export function defaultKeyboardShortcuts(): KeyboardShortcutsConfigV1 {
  return { bindings: {} }
}

export function normalizeKeyboardShortcuts(
  settings?: Partial<KeyboardShortcutsConfigV1> | null
): KeyboardShortcutsConfigV1 {
  const bindings: KeyboardShortcutBindingsV1 = {}
  const rawBindings = settings?.bindings
  if (!rawBindings || typeof rawBindings !== 'object') return { bindings }

  for (const [rawCommandId, rawShortcuts] of Object.entries(rawBindings)) {
    if (!COMMAND_IDS.has(rawCommandId) || !Array.isArray(rawShortcuts)) continue
    const shortcuts = rawShortcuts
      .map((shortcut) => normalizeKeyboardShortcut(shortcut))
      .filter((shortcut): shortcut is string => shortcut !== null)
      .filter((shortcut, index, list) => list.indexOf(shortcut) === index)
      .slice(0, 4)
    bindings[rawCommandId as KeyboardShortcutCommandId] = shortcuts
  }

  return { bindings }
}

export function resolveKeyboardShortcutBindings(
  settings?: Partial<KeyboardShortcutsConfigV1> | null
): Required<KeyboardShortcutBindingsV1> {
  const normalized = normalizeKeyboardShortcuts(settings)
  const bindings: Required<KeyboardShortcutBindingsV1> = {} as Required<KeyboardShortcutBindingsV1>
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    const configured = normalized.bindings[command.id]
    bindings[command.id] = configured && configured.length > 0
      ? configured
      : [...command.defaultBindings]
  }
  return bindings
}

export function normalizeKeyboardShortcut(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null

  const split = raw.split('+')
  let key = split.pop() ?? ''
  if (!key && raw.endsWith('+')) key = '+'
  const modifiers = split
    .map((part) => MODIFIER_LABELS[part.trim().toLowerCase()])
    .filter((part): part is 'Ctrl' | 'Shift' | 'Alt' | 'Meta' => Boolean(part))

  const normalizedKey = normalizeShortcutKey(key)
  if (!normalizedKey || MODIFIER_KEYS.has(normalizedKey)) return null
  const orderedModifiers = ['Ctrl', 'Shift', 'Alt', 'Meta']
    .filter((modifier) => modifiers.includes(modifier as 'Ctrl' | 'Shift' | 'Alt' | 'Meta'))
  return [...orderedModifiers, normalizedKey].join('+')
}

export function keyboardEventToShortcut(event: KeyboardShortcutEventLike): string | null {
  const key = normalizeShortcutKey(event.key)
  if (!key || MODIFIER_KEYS.has(key)) return null
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.shiftKey ? 'Shift' : '',
    event.altKey ? 'Alt' : '',
    event.metaKey ? 'Meta' : ''
  ].filter(Boolean)
  return [...modifiers, key].join('+')
}

export function findKeyboardShortcutCommand(
  bindings: Required<KeyboardShortcutBindingsV1>,
  shortcut: string | null
): KeyboardShortcutCommandId | null {
  if (!shortcut) return null
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    if (bindings[command.id].includes(shortcut)) return command.id
  }
  return null
}

export function findKeyboardShortcutConflict(
  bindings: Required<KeyboardShortcutBindingsV1>,
  commandId: KeyboardShortcutCommandId,
  shortcut: string
): KeyboardShortcutCommandId | null {
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    if (command.id === commandId) continue
    if (bindings[command.id].includes(shortcut)) return command.id
  }
  return null
}

function normalizeShortcutKey(rawKey: string): string | null {
  const key = rawKey.trim()
  if (!key) return null
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  const lower = key.toLowerCase()
  if (lower === 'esc') return 'Escape'
  if (lower === 'arrowup') return 'ArrowUp'
  if (lower === 'arrowdown') return 'ArrowDown'
  if (lower === 'arrowleft') return 'ArrowLeft'
  if (lower === 'arrowright') return 'ArrowRight'
  if (lower === 'plus') return '+'
  if (lower === 'minus') return '-'
  if (lower === 'comma') return ','
  if (lower.startsWith('f') && /^f\d{1,2}$/.test(lower)) return lower.toUpperCase()
  return key[0].toUpperCase() + key.slice(1)
}
