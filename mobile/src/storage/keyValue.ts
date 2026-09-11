/**
 * Persistent key-value storage with one deliberate split.
 *
 * The API key is a credential, so it goes to the device keychain via
 * expo-secure-store. Everything else is preference data and goes to
 * AsyncStorage. SecureStore has no web implementation, so it degrades to
 * AsyncStorage there rather than throwing - a browser is not a device keychain
 * and the app says so in the Settings screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

async function secureAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function readSecret(key: string): Promise<string | null> {
  try {
    if (await secureAvailable()) return await SecureStore.getItemAsync(key);
  } catch {
    // Fall through to the plain store rather than losing the setting.
  }
  return AsyncStorage.getItem(key);
}

export async function writeSecret(key: string, value: string): Promise<void> {
  try {
    if (await secureAvailable()) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
  } catch {
    // Fall through.
  }
  await AsyncStorage.setItem(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    if (await secureAvailable()) await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore; also clear the fallback below.
  }
  await AsyncStorage.removeItem(key);
}

export async function readValue(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function writeValue(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

export async function removeValue(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/** Read and parse JSON, returning the fallback on absence or corruption. */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readValue(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await writeValue(key, JSON.stringify(value));
}
