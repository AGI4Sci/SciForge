const { contextBridge, ipcRenderer } = require('electron');

const INTERNAL_EVENT_SCHEMA = 'sciforge.desktop.annotation-overlay.internal-event.v1';
const ACTIVE_DISPLAY_CHANNEL = 'desktop:annotation-overlay:active-display';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function bounds(value) {
  const input = record(value);
  const x = finiteNumber(input.x);
  const y = finiteNumber(input.y);
  const width = finiteNumber(input.width);
  const height = finiteNumber(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function text(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t\f\v]+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 1000);
}

function optionalText(value) {
  return text(value, undefined);
}

function commentText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t\f\v]+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);
}

function singleLineText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const trimmed = String(value).trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function booleanValue(value) {
  return value === true;
}

function display(value) {
  const input = record(value);
  const safeBounds = bounds(input.bounds);
  if (!safeBounds) return undefined;
  const id = singleLineText(input.id ?? input.displayId ?? input.screenId);
  const scaleFactor = positiveNumber(input.scaleFactor ?? input.scale);
  return {
    ...(id ? { id } : {}),
    bounds: safeBounds,
    ...(scaleFactor !== undefined ? { scaleFactor } : {}),
  };
}

const api = {
  setActiveDisplay(input) {
    const safeDisplay = display(input);
    if (!safeDisplay) return Promise.resolve({ ok: false });
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-active-display-changed',
      display: safeDisplay,
    });
  },
  setDragState(input) {
    const payload = record(input);
    const safeDisplay = display(payload.display);
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-selection-drag-state-changed',
      active: booleanValue(payload.active),
      ...(safeDisplay ? { display: safeDisplay } : {}),
    });
  },
  onActiveDisplayChanged(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      const safeDisplay = display(value);
      if (safeDisplay) callback(safeDisplay);
    };
    ipcRenderer.on(ACTIVE_DISPLAY_CHANNEL, listener);
    return () => ipcRenderer.removeListener(ACTIVE_DISPLAY_CHANNEL, listener);
  },
  submitSelection(input) {
    const payload = record(input);
    const safeBounds = bounds(payload.bounds);
    if (!safeBounds) {
      return Promise.reject(new Error('Screen-region annotation requires valid bounds.'));
    }
    const safeDisplay = display(payload.display);
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-selection-submitted',
      bounds: safeBounds,
      comment: commentText(payload.comment),
      ...(safeDisplay ? { display: safeDisplay } : {}),
      threadId: optionalText(payload.threadId),
      messageDraftId: optionalText(payload.messageDraftId),
    });
  },
  cancelSelection() {
    return ipcRenderer.invoke('desktop:annotation-overlay:internal-event', {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'screen-region-selection-cancelled',
    });
  },
};

contextBridge.exposeInMainWorld('sciforgeAnnotationOverlay', api);
