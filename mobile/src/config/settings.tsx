/**
 * Connection settings: where the server is, and who we are.
 *
 * Held in one context because three unrelated things depend on them - the API
 * client, the "are we configured yet?" routing decision, and the Settings
 * screen - and because the values are loaded asynchronously from storage, so
 * every consumer needs to know whether that load has finished.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ApiCredentials } from '@/api/client';
import { deleteSecret, readSecret, readValue, removeValue, writeSecret, writeValue } from '@/storage/keyValue';

const BASE_URL_KEY = 'settings.baseUrl';
const USER_ID_KEY = 'settings.userId';
const API_KEY_KEY = 'settings.apiKey';

/** Matches the port the backend listens on by default. */
export const DEFAULT_BASE_URL = 'http://localhost:3000';

export interface Settings {
  baseUrl: string;
  apiKey: string;
  /** The buyer's user id. Only the accept route requires it. */
  userId: string;
}

export interface SettingsContextValue extends Settings {
  /** False until storage has been read; screens should wait rather than flash. */
  loaded: boolean;
  /** True once there is enough to make a request. */
  configured: boolean;
  credentials: ApiCredentials;
  save: (next: Partial<Settings>) => Promise<void>;
  clear: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const EMPTY: Settings = { baseUrl: '', apiKey: '', userId: '' };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [baseUrl, userId, apiKey] = await Promise.all([
        readValue(BASE_URL_KEY),
        readValue(USER_ID_KEY),
        readSecret(API_KEY_KEY),
      ]);

      if (cancelled) return;
      setSettings({
        baseUrl: baseUrl ?? '',
        userId: userId ?? '',
        apiKey: apiKey ?? '',
      });
      setLoaded(true);
    })().catch(() => {
      // A storage failure must not leave the app on a permanent splash.
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...next }));

    const writes: Array<Promise<unknown>> = [];
    if (next.baseUrl !== undefined) writes.push(writeValue(BASE_URL_KEY, next.baseUrl.trim()));
    if (next.userId !== undefined) writes.push(writeValue(USER_ID_KEY, next.userId.trim()));
    if (next.apiKey !== undefined) {
      const key = next.apiKey.trim();
      writes.push(key ? writeSecret(API_KEY_KEY, key) : deleteSecret(API_KEY_KEY));
    }
    await Promise.all(writes);
  }, []);

  const clear = useCallback(async () => {
    setSettings(EMPTY);
    await Promise.all([
      removeValue(BASE_URL_KEY),
      removeValue(USER_ID_KEY),
      deleteSecret(API_KEY_KEY),
    ]);
  }, []);

  const value = useMemo<SettingsContextValue>(() => {
    const baseUrl = settings.baseUrl.trim();
    return {
      ...settings,
      loaded,
      configured: baseUrl.length > 0,
      credentials: {
        baseUrl,
        apiKey: settings.apiKey.trim() || null,
        userId: settings.userId.trim() || null,
      },
      save,
      clear,
    };
  }, [settings, loaded, save, clear]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside a SettingsProvider');
  return context;
}

/** Just the credentials, for the many hooks that need nothing else. */
export function useCredentials(): ApiCredentials {
  return useSettings().credentials;
}
