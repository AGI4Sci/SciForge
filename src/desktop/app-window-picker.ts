import {
  type DesktopAnnotationAppWindowCandidate,
  type DesktopAnnotationAppWindowChooser,
  type DesktopAnnotationAppWindowChooserInput,
  type DesktopAnnotationAppWindowChooserResult,
} from './app-window-selection-provider.js';

export const DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA =
  'sciforge.desktop.annotation.app-window-picker.internal-event.v1' as const;
export const DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL =
  'desktop:annotation-app-window-picker:internal-event' as const;

export type DesktopAnnotationAppWindowPickerBrowserWindowOptions = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  title: string;
  webPreferences: {
    preload?: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
  };
};

export type DesktopAnnotationAppWindowPickerWindow = {
  loadURL?(url: string): Promise<void> | void;
  show?(): void;
  focus?(): void;
  close?(): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  isDestroyed?(): boolean;
};

export type DesktopAnnotationAppWindowPickerElectron = {
  BrowserWindow: new(options: DesktopAnnotationAppWindowPickerBrowserWindowOptions) => DesktopAnnotationAppWindowPickerWindow;
  ipcMain: {
    handle(channel: string, listener: (...args: unknown[]) => unknown): void;
  };
};

export type DesktopAnnotationAppWindowChooserOptions = {
  preloadPath?: string;
  pickerIdFactory?: () => string;
  rendererHtml?: (input: DesktopAnnotationAppWindowPickerRendererInput) => string;
};

export type DesktopAnnotationAppWindowPickerRendererInput = {
  pickerId: string;
  candidates: readonly DesktopAnnotationAppWindowCandidate[];
};

type ActivePicker = {
  pickerId: string;
  window: DesktopAnnotationAppWindowPickerWindow;
  resolve(choice: DesktopAnnotationAppWindowChooserResult): void;
};

const DEFAULT_TEXT_LIMIT = 180;

export function createDesktopAnnotationAppWindowChooser(
  electron: DesktopAnnotationAppWindowPickerElectron,
  options: DesktopAnnotationAppWindowChooserOptions = {},
): DesktopAnnotationAppWindowChooser {
  let activePicker: ActivePicker | undefined;
  let sequence = 0;

  electron.ipcMain.handle(DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_CHANNEL, async (_event: unknown, value: unknown) => {
    const internalEvent = appWindowPickerInternalEvent(value);
    if (!activePicker || activePicker.pickerId !== internalEvent.pickerId) {
      return {
        schemaVersion: 'sciforge.desktop.annotation.app-window-picker.internal-event-result.v1',
        ok: false,
        status: 'blocked',
        reason: 'desktop.annotation.app-window-picker-not-active',
        refs: [],
        metadata: refsOnlyMetadata(),
      };
    }
    const picker = activePicker;
    activePicker = undefined;
    closePickerWindow(picker.window);
    if (internalEvent.event === 'app-window-selection-cancelled') {
      picker.resolve({ status: 'cancelled' });
      return {
        schemaVersion: 'sciforge.desktop.annotation.app-window-picker.internal-event-result.v1',
        ok: true,
        status: 'cancelled',
        refs: [],
        metadata: refsOnlyMetadata(),
      };
    }
    const choice = internalEvent.windowRef
      ? { status: 'selected' as const, windowRef: internalEvent.windowRef }
      : { status: 'selected' as const, candidateId: internalEvent.candidateId };
    picker.resolve(choice);
    return {
      schemaVersion: 'sciforge.desktop.annotation.app-window-picker.internal-event-result.v1',
      ok: true,
      status: 'selected',
      refs: compactRefs([internalEvent.windowRef]),
      metadata: refsOnlyMetadata(),
    };
  });

  async function chooseWindow(input: DesktopAnnotationAppWindowChooserInput): Promise<DesktopAnnotationAppWindowChooserResult> {
    if (activePicker) {
      return {
        status: 'blocked',
        message: 'An app-window picker is already active.',
      };
    }
    if (!input.candidates.length) {
      return {
        status: 'blocked',
        message: 'No app-window candidates are available for selection.',
      };
    }
    const pickerId = sanitizePickerId(options.pickerIdFactory?.() ?? `app-window-picker-${Date.now().toString(36)}-${++sequence}`);
    const window = new electron.BrowserWindow({
      width: 560,
      height: 540,
      minWidth: 460,
      minHeight: 380,
      show: true,
      title: 'SciForge App Window',
      webPreferences: {
        ...(options.preloadPath ? { preload: options.preloadPath } : {}),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const html = options.rendererHtml?.({ pickerId, candidates: input.candidates })
      ?? desktopAnnotationAppWindowPickerRendererHtml({ pickerId, candidates: input.candidates });
    await Promise.resolve(window.loadURL?.(desktopAnnotationAppWindowPickerRendererDataUrl(html)));
    window.show?.();
    window.focus?.();
    return new Promise<DesktopAnnotationAppWindowChooserResult>((resolve) => {
      activePicker = { pickerId, window, resolve };
      window.on?.('closed', () => {
        if (activePicker?.pickerId !== pickerId) return;
        activePicker = undefined;
        resolve({ status: 'cancelled' });
      });
    });
  }

  return chooseWindow;
}

export function desktopAnnotationAppWindowPickerRendererDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function desktopAnnotationAppWindowPickerRendererHtml(
  input: DesktopAnnotationAppWindowPickerRendererInput,
): string {
  const candidates = input.candidates.map((candidate) => pickerCandidate(candidate));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #f8fafc;
      color: #172033;
      font: 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid #d8dee8;
      background: #ffffff;
    }
    h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 650;
      letter-spacing: 0;
    }
    main {
      padding: 10px;
    }
    button {
      font: inherit;
    }
    .candidate {
      width: 100%;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 10px;
      align-items: center;
      margin: 0 0 8px;
      padding: 10px;
      border: 1px solid #d8dee8;
      border-radius: 8px;
      background: #ffffff;
      color: inherit;
      text-align: left;
    }
    .candidate:focus {
      outline: 2px solid #2563eb;
      outline-offset: 1px;
    }
    .app {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
    }
    .title, .meta {
      grid-column: 1 / -1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #475569;
    }
    .bounds {
      color: #64748b;
      font-variant-numeric: tabular-nums;
    }
    footer {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: flex-end;
      padding: 10px;
      border-top: 1px solid #d8dee8;
      background: rgba(248, 250, 252, 0.95);
    }
    #cancel {
      height: 34px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
      padding: 0 12px;
    }
  </style>
</head>
<body>
  <header><h1>Select app window</h1></header>
  <main id="list"></main>
  <footer><button id="cancel" type="button">Cancel</button></footer>
  <script>
    (() => {
      const api = window.sciforgeAppWindowPicker;
      const pickerId = ${JSON.stringify(input.pickerId)};
      const candidates = ${JSON.stringify(candidates)};
      const list = document.getElementById('list');
      const cancel = document.getElementById('cancel');
      for (const candidate of candidates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'candidate';
        button.dataset.windowRef = candidate.windowRef;
        button.dataset.candidateId = candidate.id || '';
        button.innerHTML = '<span class="app"></span><span class="bounds"></span><span class="title"></span><span class="meta"></span>';
        button.querySelector('.app').textContent = candidate.appName || 'App window';
        button.querySelector('.bounds').textContent = candidate.boundsLabel;
        button.querySelector('.title').textContent = candidate.title || candidate.windowRef;
        button.querySelector('.meta').textContent = candidate.pid ? 'pid ' + candidate.pid : candidate.windowRef;
        button.addEventListener('click', () => {
          api?.chooseWindow?.({
            pickerId,
            windowRef: candidate.windowRef,
            candidateId: candidate.id,
          });
        });
        list.appendChild(button);
      }
      cancel.addEventListener('click', () => api?.cancel?.({ pickerId }));
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') api?.cancel?.({ pickerId });
      });
      list.querySelector('button')?.focus();
    })();
  </script>
</body>
</html>`;
}

function appWindowPickerInternalEvent(value: unknown): {
  pickerId: string;
  event: 'app-window-selection-selected' | 'app-window-selection-cancelled';
  windowRef?: string;
  candidateId?: string;
} {
  const record = requireRecord(value, 'desktop app-window picker internal event requires an object');
  const schemaVersion = optionalText(record.schemaVersion);
  if (schemaVersion && schemaVersion !== DESKTOP_ANNOTATION_APP_WINDOW_PICKER_INTERNAL_EVENT_SCHEMA) {
    throw new Error('desktop app-window picker internal event schemaVersion is invalid');
  }
  const pickerId = requireText(record.pickerId, 'pickerId');
  if (record.event === 'app-window-selection-cancelled') {
    return { pickerId, event: 'app-window-selection-cancelled' };
  }
  if (record.event === 'app-window-selection-selected') {
    const windowRef = optionalRef(record.windowRef);
    const candidateId = optionalText(record.candidateId);
    if (!windowRef && !candidateId) {
      throw new Error('desktop app-window picker selected event requires windowRef or candidateId');
    }
    return {
      pickerId,
      event: 'app-window-selection-selected',
      ...(windowRef ? { windowRef } : {}),
      ...(candidateId ? { candidateId } : {}),
    };
  }
  throw new Error('desktop app-window picker internal event is unsupported');
}

function pickerCandidate(candidate: DesktopAnnotationAppWindowCandidate): Record<string, unknown> {
  const appName = safeText(candidate.windowSummary?.appName);
  const title = safeText(candidate.windowSummary?.title);
  return {
    windowRef: candidate.windowRef,
    targetRef: candidate.targetRef,
    ...(candidate.id ? { id: candidate.id } : {}),
    ...(appName ? { appName } : {}),
    ...(title ? { title } : {}),
    ...(candidate.windowSummary?.pid !== undefined ? { pid: candidate.windowSummary.pid } : {}),
    boundsLabel: `${Math.round(candidate.windowBounds.x)}, ${Math.round(candidate.windowBounds.y)} · ${Math.round(candidate.windowBounds.width)}x${Math.round(candidate.windowBounds.height)}`,
  };
}

function closePickerWindow(window: DesktopAnnotationAppWindowPickerWindow): void {
  try {
    if (!window.isDestroyed?.()) window.close?.();
  } catch {
    // Closing the picker is best-effort; the selection result has already been resolved.
  }
}

function refsOnlyMetadata(): Record<string, unknown> {
  return {
    refsOnly: true,
    windowListPayloadReturned: false,
    screenshotPayloadReturned: false,
    providerPayloadReturned: false,
  };
}

function compactRefs(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.flatMap((value) => {
    const ref = optionalRef(value);
    return ref ? [ref] : [];
  })));
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`desktop app-window picker internal event requires ${field}`);
  return text;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, DEFAULT_TEXT_LIMIT) : undefined;
}

function optionalRef(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text || /data:|base64|<[^>]*>/i.test(text)) return undefined;
  return text;
}

function safeText(value: unknown): string | undefined {
  const text = optionalText(value);
  if (!text || /data:|base64|secret|token|api[-_\s]?key|password|passwd|bearer|<[^>]*>/i.test(text)) return undefined;
  return text;
}

function sanitizePickerId(value: string): string {
  return value.replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 96) || 'app-window-picker';
}
