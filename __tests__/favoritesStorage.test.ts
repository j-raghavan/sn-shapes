/**
 * Tests for the favorites storage adapter (v1.0.5).
 *
 * Covers:
 *   • envelope round-trip (load returns what save persisted)
 *   • defensive parsing (corrupt JSON / wrong shape / wrong schema
 *     version / non-string ids all degrade to empty)
 *   • cap enforcement at the read AND write boundary
 *   • the in-memory backend used by the rest of the test suite
 *   • the default-storage memoisation hatch
 *
 * The lazy-AsyncStorage path can't be exercised here without installing
 * the dep, so we test the equivalent code path with a hand-rolled KV
 * shim. That's the same surface AsyncStorage exposes.
 */
import {
  FAVORITES_STORAGE_KEY,
  FavoritesStorage,
  createKvBackedFavoritesStorage,
  createMemoryFavoritesStorage,
  getDefaultFavoritesStorage,
  __resetDefaultFavoritesStorageForTest,
} from '../src/favoritesStorage';
import {ShapeId, MAX_FAVORITES} from '../src/shapes';

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
  __resetDefaultFavoritesStorageForTest();
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('createMemoryFavoritesStorage', () => {
  it('round-trips favorites unchanged', async () => {
    const s: FavoritesStorage = createMemoryFavoritesStorage();
    await s.save(['rectangle', 'circle']);
    expect(await s.load()).toEqual(['rectangle', 'circle']);
  });

  it('starts empty by default', async () => {
    const s = createMemoryFavoritesStorage();
    expect(await s.load()).toEqual([]);
  });

  it('honours the initial seed', async () => {
    const s = createMemoryFavoritesStorage(['triangle']);
    expect(await s.load()).toEqual(['triangle']);
  });

  it('caps writes at MAX_FAVORITES', async () => {
    const s = createMemoryFavoritesStorage();
    const tooMany: ShapeId[] = Array.from(
      {length: MAX_FAVORITES + 5},
      (_, i) => `id_${i}` as ShapeId,
    );
    await s.save(tooMany);
    expect((await s.load()).length).toBe(MAX_FAVORITES);
  });

  it('caps the initial seed at MAX_FAVORITES', async () => {
    const tooMany: ShapeId[] = Array.from(
      {length: MAX_FAVORITES + 5},
      (_, i) => `id_${i}` as ShapeId,
    );
    const s = createMemoryFavoritesStorage(tooMany);
    expect((await s.load()).length).toBe(MAX_FAVORITES);
  });
});

describe('createKvBackedFavoritesStorage', () => {
  it('writes a versioned envelope to the namespaced key', async () => {
    const kv = makeKvShim();
    const s = createKvBackedFavoritesStorage(kv);
    await s.save(['rectangle', 'circle']);

    expect(kv.setItem).toHaveBeenCalledTimes(1);
    const [key, raw] = kv.setItem.mock.calls[0];
    expect(key).toBe(FAVORITES_STORAGE_KEY);
    const env = JSON.parse(raw);
    expect(env).toEqual({version: 1, favorites: ['rectangle', 'circle']});
  });

  it('round-trips through the KV shim', async () => {
    const kv = makeKvShim();
    const s = createKvBackedFavoritesStorage(kv);
    await s.save(['rectangle', 'circle']);
    expect(await s.load()).toEqual(['rectangle', 'circle']);
  });

  it('returns [] when the key is empty', async () => {
    const kv = makeKvShim();
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('returns [] when the JSON is malformed', async () => {
    const kv = makeKvShim({[FAVORITES_STORAGE_KEY]: 'not json {'});
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('returns [] when the parsed JSON is a primitive, not an object', async () => {
    const kv = makeKvShim({[FAVORITES_STORAGE_KEY]: '42'});
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('returns [] when the parsed JSON is literally null', async () => {
    const kv = makeKvShim({[FAVORITES_STORAGE_KEY]: 'null'});
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('returns [] when the envelope is shaped wrong', async () => {
    const kv = makeKvShim({
      [FAVORITES_STORAGE_KEY]: JSON.stringify({version: 1, favorites: 'oops'}),
    });
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('returns [] when the schema version is unrecognised', async () => {
    const kv = makeKvShim({
      [FAVORITES_STORAGE_KEY]: JSON.stringify({version: 999, favorites: ['rectangle']}),
    });
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
  });

  it('drops non-string ids on load', async () => {
    const kv = makeKvShim({
      [FAVORITES_STORAGE_KEY]: JSON.stringify({
        version: 1,
        favorites: ['rectangle', 42, null, 'circle'],
      }),
    });
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual(['rectangle', 'circle']);
  });

  it('caps load output at MAX_FAVORITES', async () => {
    const huge = Array.from({length: MAX_FAVORITES + 10}, (_, i) => `id_${i}`);
    const kv = makeKvShim({
      [FAVORITES_STORAGE_KEY]: JSON.stringify({version: 1, favorites: huge}),
    });
    const s = createKvBackedFavoritesStorage(kv);
    expect((await s.load()).length).toBe(MAX_FAVORITES);
  });

  it('caps save input at MAX_FAVORITES', async () => {
    const kv = makeKvShim();
    const s = createKvBackedFavoritesStorage(kv);
    const huge: ShapeId[] = Array.from(
      {length: MAX_FAVORITES + 10},
      (_, i) => `id_${i}` as ShapeId,
    );
    await s.save(huge);
    const env = JSON.parse(kv.setItem.mock.calls[0][1]);
    expect(env.favorites.length).toBe(MAX_FAVORITES);
  });

  it('swallows getItem errors and returns []', async () => {
    const kv = {
      getItem: jest.fn(async () => {
        throw new Error('boom');
      }),
      setItem: jest.fn(async () => {}),
    };
    const s = createKvBackedFavoritesStorage(kv);
    expect(await s.load()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('swallows setItem errors without throwing to the caller', async () => {
    const kv = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => {
        throw new Error('disk full');
      }),
    };
    const s = createKvBackedFavoritesStorage(kv);
    await expect(s.save(['rectangle'])).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('tryLoadAsyncStorage backend resolution (via getDefaultFavoritesStorage)', () => {
  // The dep isn't installed in this repo, so getDefaultFavoritesStorage()
  // resolves the in-memory fallback in every other test in this file
  // (see the module header comment). These cases use a virtual jest
  // mock to simulate the dep being present, exercising the success path
  // of tryLoadAsyncStorage() that the other tests can't reach.
  const MODULE_ID = '@react-native-async-storage/async-storage';

  afterEach(() => {
    jest.dontMock(MODULE_ID);
    jest.resetModules();
  });

  it('adopts the module when it exposes an ESM-style default export', async () => {
    const getItem = jest.fn(async () => null);
    const setItem = jest.fn(async () => {});
    jest.doMock(MODULE_ID, () => ({default: {getItem, setItem}}), {virtual: true});

    let freshModule: typeof import('../src/favoritesStorage');
    jest.isolateModules(() => {
      freshModule = require('../src/favoritesStorage');
    });
    const storage = freshModule!.getDefaultFavoritesStorage();
    await storage.load();
    expect(getItem).toHaveBeenCalledWith(freshModule!.FAVORITES_STORAGE_KEY);
  });

  it('adopts the module when it exposes a plain CJS export (no default)', async () => {
    const getItem = jest.fn(async () => null);
    const setItem = jest.fn(async () => {});
    jest.doMock(MODULE_ID, () => ({getItem, setItem}), {virtual: true});

    let freshModule: typeof import('../src/favoritesStorage');
    jest.isolateModules(() => {
      freshModule = require('../src/favoritesStorage');
    });
    const storage = freshModule!.getDefaultFavoritesStorage();
    await storage.save(['rectangle']);
    expect(setItem).toHaveBeenCalled();
  });

  it('falls back to memory when the resolved module lacks getItem/setItem', async () => {
    jest.doMock(MODULE_ID, () => ({default: {notAKvBackend: true}}), {virtual: true});

    let freshModule: typeof import('../src/favoritesStorage');
    jest.isolateModules(() => {
      freshModule = require('../src/favoritesStorage');
    });
    const storage = freshModule!.getDefaultFavoritesStorage();
    await storage.save(['circle']);
    expect(await storage.load()).toEqual(['circle']);
  });
});

describe('getDefaultFavoritesStorage', () => {
  it('returns the same instance across calls (memoised)', () => {
    const a = getDefaultFavoritesStorage();
    const b = getDefaultFavoritesStorage();
    expect(a).toBe(b);
  });

  it('returns a working FavoritesStorage that round-trips in-memory', async () => {
    // AsyncStorage is not installed in this repo, so the default
    // backend resolves to the in-memory fallback. The contract holds
    // either way: load() / save() are safe and consistent.
    const s = getDefaultFavoritesStorage();
    await s.save(['rectangle']);
    expect(await s.load()).toEqual(['rectangle']);
  });

  it('builds a fresh instance after the test reset hook', () => {
    const a = getDefaultFavoritesStorage();
    __resetDefaultFavoritesStorageForTest();
    const b = getDefaultFavoritesStorage();
    expect(a).not.toBe(b);
  });
});
