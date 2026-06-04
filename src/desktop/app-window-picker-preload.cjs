const { contextBridge, ipcRenderer } = require('electron');

const INTERNAL_EVENT_SCHEMA = 'sciforge.desktop.annotation.app-window-picker.internal-event.v1';
const INTERNAL_EVENT_CHANNEL = 'desktop:annotation-app-window-picker:internal-event';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 180) : undefined;
}

function ref(value) {
  const trimmed = text(value);
  if (!trimmed || /data:|base64|<[^>]*>/i.test(trimmed)) return undefined;
  return trimmed;
}

const api = {
  chooseWindow(input) {
    const payload = record(input);
    const pickerId = text(payload.pickerId);
    const windowRef = ref(payload.windowRef);
    const candidateId = text(payload.candidateId);
    if (!pickerId) return Promise.reject(new Error('App-window picker requires pickerId.'));
    if (!windowRef && !candidateId) return Promise.reject(new Error('App-window picker requires windowRef or candidateId.'));
    return ipcRenderer.invoke(INTERNAL_EVENT_CHANNEL, {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'app-window-selection-selected',
      pickerId,
      ...(windowRef ? { windowRef } : {}),
      ...(candidateId ? { candidateId } : {}),
    });
  },
  cancel(input) {
    const payload = record(input);
    const pickerId = text(payload.pickerId);
    if (!pickerId) return Promise.reject(new Error('App-window picker requires pickerId.'));
    return ipcRenderer.invoke(INTERNAL_EVENT_CHANNEL, {
      schemaVersion: INTERNAL_EVENT_SCHEMA,
      event: 'app-window-selection-cancelled',
      pickerId,
    });
  },
};

contextBridge.exposeInMainWorld('sciforgeAppWindowPicker', api);
