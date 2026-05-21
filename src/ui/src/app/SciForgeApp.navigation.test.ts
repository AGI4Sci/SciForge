import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { defaultBuiltInScenarioId } from '@sciforge/scenario-core/scenario-routing-policy';
import { loadStoredAppNavigation } from './sciforgeApp/navigationStorage';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const originalWindow = (globalThis as { window?: unknown }).window;
const navigationStorageKey = 'sciforge.app-navigation.v1.localhost:5173';

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
});

test('cold app navigation opens the workbench default chat', () => {
  installWindow(new MemoryStorage());

  assert.deepEqual(loadStoredAppNavigation(), {
    page: 'workbench',
    scenarioId: defaultBuiltInScenarioId,
  });
});

test('invalid stored page falls back to workbench without losing scenario id', () => {
  const storage = new MemoryStorage();
  storage.setItem(navigationStorageKey, JSON.stringify({ page: 'landing', scenarioId: 'custom-scenario' }));
  installWindow(storage);

  assert.deepEqual(loadStoredAppNavigation(), {
    page: 'workbench',
    scenarioId: 'custom-scenario',
  });
});

test('valid stored navigation is preserved', () => {
  const storage = new MemoryStorage();
  storage.setItem(navigationStorageKey, JSON.stringify({ page: 'timeline', scenarioId: 'structure-exploration' }));
  installWindow(storage);

  assert.deepEqual(loadStoredAppNavigation(), {
    page: 'timeline',
    scenarioId: 'structure-exploration',
  });
});

function installWindow(localStorage: MemoryStorage) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: { host: 'localhost:5173' },
      localStorage,
    },
    configurable: true,
    writable: true,
  });
}
