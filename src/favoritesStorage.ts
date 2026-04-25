/**
 * Persistence adapter for the user's favorites list.
 *
 * Single responsibility: convert between the in-memory `readonly ShapeId[]`
 * the palette holds and the durable JSON envelope on disk. All shape-
 * domain operations (add / remove / toggle / cap) live in shapes.ts so
 * this module never has to know what a "favorite" *means* — only how to
 * read and write a string array under one well-known key.
 *
 * Backend choice — lazy AsyncStorage, with a memory fallback:
 *   • The Supernote firmware doesn't expose a key-value store through
 *     sn-plugin-lib (only file-system metadata), and React Native has
 *     no built-in persistent KV. The community-standard solution is
 *     `@react-native-async-storage/async-storage`, which is a native
 *     module and therefore requires a rebuild after install.
 *   • To keep the source compiling and tests running whether or not
 *     the dep is present, the default backend `require()`s AsyncStorage
 *     lazily inside a try/catch. If absent, persistence quietly degrades
 *     to in-memory (favorites work in-session but reset on app restart).
 *     Once the dep is installed and the app rebuilt, the same code path
 *     starts persisting — no source changes required.
 *   • Tests inject `createMemoryFavoritesStorage()` for determinism.
 *
 * Every public surface here is the `FavoritesStorage` interface; the
 * palette depends on the interface only (Dependency Inversion). Swap
 * the backend by passing a different implementation; everything else
 * stays unchanged.
 */
import {ShapeId, MAX_FAVORITES} from './shapes';

/**
 * Storage abstraction the palette consumes. Two methods, both async —
 * the underlying KV is async on every plausible platform we'd target.
 *
 * Contract:
 *   • load() never throws; on any failure returns an empty array.
 *   • save() never throws; failures are logged but not surfaced. The
 *     palette treats favorites as a UX enhancement, not a critical
 *     write — losing a save is annoying but recoverable on the next
 *     toggle.
 */
export interface FavoritesStorage {
  load(): Promise<readonly ShapeId[]>;
  save(favorites: readonly ShapeId[]): Promise<void>;
}

/** Storage key, namespaced to this plugin so it never collides with host-app keys. */
export const FAVORITES_STORAGE_KEY = '@snshapes_favorites';

/**
 * On-disk envelope. `version` lets future releases migrate the schema
 * (e.g. adding `lastUsed` for recency-weighted ordering) without
 * silently breaking older clients — load() rejects records whose
 * `version` it doesn't recognise rather than mis-parsing them.
 */
export type FavoritesEnvelope = {
  readonly version: 1;
  readonly favorites: readonly ShapeId[];
};

const SCHEMA_VERSION = 1 as const;

/**
 * Minimal duck-typed shape of the bits of AsyncStorage we use. Defining
 * it here means we don't import the real type (which would force the
 * dep to exist at compile time) and gives the in-memory backend a
 * clean target to mimic.
 */
type KvBackend = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/**
 * Lazy `require` so the absence of @react-native-async-storage/async-storage
 * downgrades gracefully to in-memory. Wrapped in a function so the
 * resolution happens once at storage-creation time, not on every load /
 * save call.
 */
function tryLoadAsyncStorage(): KvBackend | null {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const candidate = mod?.default ?? mod;
    if (
      candidate &&
      typeof candidate.getItem === 'function' &&
      typeof candidate.setItem === 'function'
    ) {
      return candidate as KvBackend;
    }
  } catch {
    // Dep absent — fall through to memory backend.
  }
  return null;
}

/**
 * Parse and validate the on-disk envelope. Defensive against bad JSON,
 * wrong-shape objects, and stale schema versions — the goal is "never
 * throw", because a corrupted store should look like an empty store
 * (user loses favorites, app stays up).
 */
function parseEnvelope(raw: string | null): readonly ShapeId[] {
  if (!raw) {return [];}
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null) {return [];}
  const env = data as Partial<FavoritesEnvelope>;
  if (env.version !== SCHEMA_VERSION) {return [];}
  if (!Array.isArray(env.favorites)) {return [];}
  // Drop non-string entries defensively. We don't validate against the
  // ShapeId union here — favoriteShapes() in shapes.ts filters unknown
  // IDs at render time, so the catalogue evolution doesn't need a
  // storage-layer migration.
  const ids = env.favorites.filter(
    (x): x is ShapeId => typeof x === 'string',
  );
  return ids.slice(0, MAX_FAVORITES);
}

function serialiseEnvelope(favorites: readonly ShapeId[]): string {
  const env: FavoritesEnvelope = {
    version: SCHEMA_VERSION,
    favorites: favorites.slice(0, MAX_FAVORITES),
  };
  return JSON.stringify(env);
}

/**
 * Wrap a generic KV backend (anything that quacks like AsyncStorage)
 * into a FavoritesStorage. Single source of truth for the
 * envelope-to-array translation, so AsyncStorage / future Supernote
 * native KV / mocks all share the same parsing rules.
 */
export function createKvBackedFavoritesStorage(
  backend: KvBackend,
): FavoritesStorage {
  return {
    async load() {
      try {
        const raw = await backend.getItem(FAVORITES_STORAGE_KEY);
        return parseEnvelope(raw);
      } catch (e) {
        console.error('[FavoritesStorage] load failed:', e);
        return [];
      }
    },
    async save(favorites) {
      try {
        await backend.setItem(
          FAVORITES_STORAGE_KEY,
          serialiseEnvelope(favorites),
        );
      } catch (e) {
        console.error('[FavoritesStorage] save failed:', e);
      }
    },
  };
}

/**
 * Pure in-memory backend. Used when AsyncStorage is unavailable (e.g.
 * during unit tests, or before the dep is installed) and as the
 * deterministic substrate for tests that want to seed favorites.
 *
 * Persists for the lifetime of the JS engine only; restarting the
 * native app drops the contents.
 */
export function createMemoryFavoritesStorage(
  initial: readonly ShapeId[] = [],
): FavoritesStorage {
  let state: readonly ShapeId[] = initial.slice(0, MAX_FAVORITES);
  return {
    async load() {
      return state;
    },
    async save(favorites) {
      state = favorites.slice(0, MAX_FAVORITES);
    },
  };
}

/**
 * Default factory the palette uses when no override is injected. Picks
 * AsyncStorage if the dep is installed, otherwise falls back to memory.
 *
 * Memoised so two palette mounts in the same JS engine share the same
 * memory backend — without this, opening + closing + reopening the
 * popup would lose any in-session-only favorites because each mount
 * would build a fresh backend.
 */
let cachedDefault: FavoritesStorage | null = null;

export function getDefaultFavoritesStorage(): FavoritesStorage {
  if (cachedDefault) {return cachedDefault;}
  const backend = tryLoadAsyncStorage();
  cachedDefault = backend
    ? createKvBackedFavoritesStorage(backend)
    : createMemoryFavoritesStorage();
  return cachedDefault;
}

/**
 * Test-only escape hatch — resets the cached default backend. Used by
 * the test harness to swap in a fresh memory backend between cases
 * without leaking state across `describe` blocks.
 */
export function __resetDefaultFavoritesStorageForTest(): void {
  cachedDefault = null;
}
