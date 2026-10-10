import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ANNAS_ARCHIVE_MIRRORS } from '../lib/shops';
import type { LanguagePreference, Region } from '../lib/types';

export type Theme = 'auto' | 'light' | 'dark';
export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export interface SettingsState {
  region: Region;
  /** ID des Lieblingsshops – wird überall zuerst und hervorgehoben angezeigt. */
  preferredShop: string;
  language: LanguagePreference;
  annasBase: string;
  googleApiKey: string;
  /** Claude-API-Schlüssel für den Direktzugriff aus dem Browser (optional). */
  aiApiKey: string;
  aiModel: AiModel;
  theme: Theme;
  onboarded: boolean;
  goodreadsUserId: string;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      region: 'CH',
      preferredShop: 'amazon-de',
      language: 'de-first',
      annasBase: ANNAS_ARCHIVE_MIRRORS[0],
      googleApiKey: '',
      aiApiKey: '',
      aiModel: 'claude-opus-5-5',
      theme: 'auto',
      onboarded: false,
      goodreadsUserId: '',
      set: (patch) => set(patch),
    }),
    { name: 'lesekompass.settings', version: 1 },
  ),
);

/** Länderkürzel für Google Books (Preise) passend zur Region. */
export function regionCountry(region: Region): string {
  return region;
}
