import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, and where the session token lives.
 *
 * Configured from `EXPO_PUBLIC_` variables, which are baked into the bundle.
 * That is correct here rather than a leak: the publishable key is designed to
 * sit in a client, and row-level security - not the key - is what stops one
 * account reading another's data. `supabase/verify-rls.mjs` exists to prove
 * that claim rather than assert it.
 *
 * The client is optional. If the variables are missing the app runs exactly as
 * it did before accounts existed: everything local, nothing to sign in to, no
 * errors. A scoring app that will not open because a backend is unreachable
 * has failed at the only job it had.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/**
 * SecureStore in chunks.
 *
 * SecureStore caps a
 * value at about 2 KB and a Supabase session token is comfortably larger, so
 * storing one whole silently fails and the user is signed out on every launch.
 * Values are split across numbered keys with a count alongside.
 */
const CHUNK = 1800;

const LargeSecureStore = {
  async getItem(name: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(name) : null;
    }
    const count = await SecureStore.getItemAsync(`${name}__n`);
    if (!count) return SecureStore.getItemAsync(name);

    const parts: string[] = [];
    for (let i = 0; i < Number.parseInt(count, 10); i += 1) {
      const part = await SecureStore.getItemAsync(`${name}__${i}`);
      // A missing chunk means a partial write; treat the whole value as absent
      // rather than handing back a truncated token.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(name: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(name, value);
      return;
    }
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(name, value);
      return;
    }
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
    for (let i = 0; i < parts.length; i += 1) {
      await SecureStore.setItemAsync(`${name}__${i}`, parts[i]);
    }
    await SecureStore.setItemAsync(`${name}__n`, String(parts.length));
  },

  async removeItem(name: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(name);
      return;
    }
    const count = await SecureStore.getItemAsync(`${name}__n`);
    if (count) {
      for (let i = 0; i < Number.parseInt(count, 10); i += 1) {
        await SecureStore.deleteItemAsync(`${name}__${i}`);
      }
      await SecureStore.deleteItemAsync(`${name}__n`);
    }
    await SecureStore.deleteItemAsync(name);
  },
};

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: LargeSecureStore,
          autoRefreshToken: true,
          persistSession: true,
          // There is no browser redirect to read a session out of; sign-in
          // hands the tokens back directly.
          detectSessionInUrl: false,
        },
      })
    : null;

/** Whether this build has a backend at all. */
export function isCloudConfigured(): boolean {
  return supabase !== null;
}
