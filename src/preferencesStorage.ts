/**
 * Persistence adapter for the palette's sticky preferences (#17).
 *
 * Today that is one flag — "Keep aspect ratio" — but it lives in its own
 * versioned envelope rather than being bolted onto FavoritesStorage, so
 * the favorites contract stays single-purpose and a future preference
 * does not need a favorites-schema migration.
 *
 * The backend is resolved exactly as favorites resolve theirs
 * (`tryLoadAsyncStorage`, memory fallback), so both persist — or both
 * reset per JS-engine lifetime — together.
 */
import {KvBackend, tryLoadAsyncStorage} from './favoritesStorage';

export type PalettePreferences = {readonly keepAspect: boolean};

export const DEFAULT_PREFERENCES: PalettePreferences = {keepAspect: false};

/** Storage key, namespaced to this plugin so it never collides with host-app keys. */
export const PREFERENCES_STORAGE_KEY = '@snshapes_preferences';

/**
 * Contract mirrors FavoritesStorage: load() never throws (any failure
 * yields DEFAULT_PREFERENCES) and save() never throws (failures logged).
 */
export interface PreferencesStorage {
  load(): Promise<PalettePreferences>;
  save(prefs: PalettePreferences): Promise<void>;
}

const SCHEMA_VERSION = 1 as const;

type PreferencesEnvelope = {
  readonly version: typeof SCHEMA_VERSION;
  readonly keepAspect: boolean;
};

/**
 * Corrupt, stale or wrong-typed data looks like "no preferences yet".
 * Unknown extra fields are ignored so a newer writer never breaks an
 * older reader.
 */
function parseEnvelope(raw: string | null): PalettePreferences {
  if (!raw) {return DEFAULT_PREFERENCES;}
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof data !== 'object' || data === null) {return DEFAULT_PREFERENCES;}
  const env = data as Partial<PreferencesEnvelope>;
  if (env.version !== SCHEMA_VERSION || typeof env.keepAspect !== 'boolean') {
    return DEFAULT_PREFERENCES;
  }
  return {keepAspect: env.keepAspect};
}

function serialiseEnvelope(prefs: PalettePreferences): string {
  const env: PreferencesEnvelope = {version: SCHEMA_VERSION, keepAspect: prefs.keepAspect};
  return JSON.stringify(env);
}

export function createKvBackedPreferencesStorage(backend: KvBackend): PreferencesStorage {
  return {
    async load() {
      try {
        return parseEnvelope(await backend.getItem(PREFERENCES_STORAGE_KEY));
      } catch (e) {
        console.error('[PreferencesStorage] load failed:', e);
        return DEFAULT_PREFERENCES;
      }
    },
    async save(prefs) {
      try {
        await backend.setItem(PREFERENCES_STORAGE_KEY, serialiseEnvelope(prefs));
      } catch (e) {
        console.error('[PreferencesStorage] save failed:', e);
      }
    },
  };
}

/** In-memory backend: the fallback when AsyncStorage is absent, and the test substrate. */
export function createMemoryPreferencesStorage(
  initial: PalettePreferences = DEFAULT_PREFERENCES,
): PreferencesStorage {
  let state = initial;
  return {
    async load() {
      return state;
    },
    async save(prefs) {
      state = prefs;
    },
  };
}

/** Memoised for the same reason as getDefaultFavoritesStorage: reopening the popup must not lose in-session state. */
let cachedDefault: PreferencesStorage | null = null;

export function getDefaultPreferencesStorage(): PreferencesStorage {
  if (cachedDefault) {return cachedDefault;}
  const backend = tryLoadAsyncStorage();
  cachedDefault = backend
    ? createKvBackedPreferencesStorage(backend)
    : createMemoryPreferencesStorage();
  return cachedDefault;
}

/** Test-only: drop the memoised default backend. */
export function __resetDefaultPreferencesStorageForTest(): void {
  cachedDefault = null;
}
