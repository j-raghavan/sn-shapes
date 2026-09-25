/**
 * Tests for the palette preferences adapter (#17, SPEC-FREE-RESIZE FR2).
 * Mirrors favoritesStorage.test.ts: envelope round-trip, defensive
 * parsing, never-throw contract, memoised default backend.
 */
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  createKvBackedPreferencesStorage,
  createMemoryPreferencesStorage,
  getDefaultPreferencesStorage,
  __resetDefaultPreferencesStorageForTest,
} from '../src/preferencesStorage';

function makeKvShim(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
}

let consoleErrorSpy: jest.SpyInstance;
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  __resetDefaultPreferencesStorageForTest();
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('createKvBackedPreferencesStorage', () => {
  it.each([true, false])('round-trips keepAspect=%p under the namespaced key', async keepAspect => {
    const kv = makeKvShim();
    const s = createKvBackedPreferencesStorage(kv);
    await s.save({keepAspect});
    expect(kv.setItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY, expect.any(String));
    expect(await s.load()).toEqual({keepAspect});
  });

  it('AC2.1: an empty store yields the defaults', async () => {
    expect(await createKvBackedPreferencesStorage(makeKvShim()).load()).toEqual(DEFAULT_PREFERENCES);
  });

  it.each([
    ['bad JSON', '{nope'],
    ['JSON null', 'null'],
    ['a primitive', '42'],
    ['an array', '[]'],
    ['a wrong version', JSON.stringify({version: 2, keepAspect: true})],
    ['a non-boolean flag', JSON.stringify({version: 1, keepAspect: 'yes'})],
  ])('AC2.1: %s degrades to the defaults', async (_label, raw) => {
    const s = createKvBackedPreferencesStorage(makeKvShim({[PREFERENCES_STORAGE_KEY]: raw}));
    expect(await s.load()).toEqual(DEFAULT_PREFERENCES);
  });

  it('ignores unknown extra fields (forward-compat)', async () => {
    const raw = JSON.stringify({version: 1, keepAspect: true, future: 'x'});
    const s = createKvBackedPreferencesStorage(makeKvShim({[PREFERENCES_STORAGE_KEY]: raw}));
    expect(await s.load()).toEqual({keepAspect: true});
  });

  it('AC2.1: a throwing getItem yields the defaults and logs', async () => {
    const s = createKvBackedPreferencesStorage({
      getItem: async () => {
        throw new Error('disk');
      },
      setItem: async () => {},
    });
    expect(await s.load()).toEqual(DEFAULT_PREFERENCES);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[PreferencesStorage] load failed:', expect.any(Error));
  });

  it('AC2.2: a throwing setItem resolves and logs', async () => {
    const s = createKvBackedPreferencesStorage({
      getItem: async () => null,
      setItem: async () => {
        throw new Error('full');
      },
    });
    await expect(s.save({keepAspect: true})).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[PreferencesStorage] save failed:', expect.any(Error));
  });
});

describe('createMemoryPreferencesStorage', () => {
  it('starts at the defaults and round-trips', async () => {
    const s = createMemoryPreferencesStorage();
    expect(await s.load()).toEqual(DEFAULT_PREFERENCES);
    await s.save({keepAspect: true});
    expect(await s.load()).toEqual({keepAspect: true});
  });

  it('honours the initial seed', async () => {
    expect(await createMemoryPreferencesStorage({keepAspect: true}).load()).toEqual({keepAspect: true});
  });
});

describe('getDefaultPreferencesStorage (AC2.3)', () => {
  it('is memoised and resettable', () => {
    const a = getDefaultPreferencesStorage();
    expect(getDefaultPreferencesStorage()).toBe(a);
    __resetDefaultPreferencesStorageForTest();
    expect(getDefaultPreferencesStorage()).not.toBe(a);
  });

  it('falls back to memory when AsyncStorage is absent', async () => {
    const s = getDefaultPreferencesStorage();
    await s.save({keepAspect: true});
    expect(await s.load()).toEqual({keepAspect: true});
  });

  describe('with AsyncStorage present', () => {
    const MODULE_ID = '@react-native-async-storage/async-storage';

    afterEach(() => {
      jest.dontMock(MODULE_ID);
      jest.resetModules();
    });

    it('uses the KV-backed storage', async () => {
      const getItem = jest.fn(async () => null);
      const setItem = jest.fn(async () => {});
      jest.doMock(MODULE_ID, () => ({default: {getItem, setItem}}), {virtual: true});

      let fresh: typeof import('../src/preferencesStorage');
      jest.isolateModules(() => {
        fresh = require('../src/preferencesStorage');
      });
      const s = fresh!.getDefaultPreferencesStorage();
      await s.save({keepAspect: true});
      expect(setItem).toHaveBeenCalledWith(
        fresh!.PREFERENCES_STORAGE_KEY,
        JSON.stringify({version: 1, keepAspect: true}),
      );
      await s.load();
      expect(getItem).toHaveBeenCalledWith(fresh!.PREFERENCES_STORAGE_KEY);
    });
  });
});
