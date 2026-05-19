import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGuiProtocolController, type GuiProtocolController, type GuiProtocolSnapshotInput } from '../../ui/src/app/guiProtocol.js';

export const GUI_EXTENSION_STATE_SCHEMA = 'sciforge.gui-extension-state.v1';

export interface GuiExtensionStateFile {
  schemaVersion: typeof GUI_EXTENSION_STATE_SCHEMA;
  snapshot: GuiProtocolSnapshotInput;
}

export async function loadGuiExtensionSnapshot(path: string): Promise<GuiProtocolSnapshotInput> {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw error;
  });
  if (!text) return defaultGuiExtensionSnapshot();
  const parsed = JSON.parse(text) as Partial<GuiExtensionStateFile>;
  if (parsed.schemaVersion !== GUI_EXTENSION_STATE_SCHEMA || !parsed.snapshot) {
    throw new Error(`Invalid Runtime GUI extension state file: ${path}`);
  }
  return parsed.snapshot;
}

export async function saveGuiExtensionSnapshot(path: string, snapshot: GuiProtocolSnapshotInput): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ schemaVersion: GUI_EXTENSION_STATE_SCHEMA, snapshot }, null, 2)}\n`, 'utf8');
}

export async function createFileBackedGuiProtocolController(path: string): Promise<{
  controller: GuiProtocolController;
  flush: () => Promise<void>;
}> {
  const controller = createGuiProtocolController(await loadGuiExtensionSnapshot(path));
  return {
    controller,
    flush: () => saveGuiExtensionSnapshot(path, controller.snapshot()),
  };
}

export async function ensureGuiExtensionState(path: string, snapshot: GuiProtocolSnapshotInput = defaultGuiExtensionSnapshot()): Promise<void> {
  await readFile(path, 'utf8').catch(async (error: unknown) => {
    if (!isNotFound(error)) throw error;
    await saveGuiExtensionSnapshot(path, snapshot);
  });
}

export function defaultGuiExtensionSnapshot(): GuiProtocolSnapshotInput {
  const now = new Date(0).toISOString();
  return {
    revision: 1,
    focusedPanel: 'chat',
    layoutMode: 'desktop',
    updatedAt: now,
    hotRegion: {
      panel: 'chat',
      selectedRefs: [],
      interactionMode: 'idle',
      lastChangeOrigin: 'system',
      lastChangeAt: now,
      availableActions: [],
    },
    regions: [{
      regionId: 'chat',
      visibleRefs: [],
      affordances: [],
      summary: 'Main chat region is visible.',
    }],
    intentLog: [],
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
