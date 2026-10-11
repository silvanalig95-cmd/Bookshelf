import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ANNAS_ARCHIVE_MIRRORS } from '../lib/shops';
import type { LanguagePreference, Region } from '../lib/types';

export type Theme = 'auto' | 'light' | 'dark';
export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
export type GeminiModel = 'gemini-3.8-flash' | 'gemini-3.5-flash-lite';
export type AiProvider = 'gemini' | 'claude';

export interface SettingsState {
  region: Region;
  /** ID des Lieblingsshops – wird überall zuerst und hervorgehoben angezeigt. */
  preferredShop: string;
  language: LanguagePreference;
  annasBase: string;
  googleApiKey: string;
  /** Welche KI: Gemini (Google, mit Gratis-Kontingent) oder Claude (Anthropic). */
  aiProvider: AiProvider;
  /** Claude-API-Schlüssel für den Direktzugriff aus dem Browser (optional). */
  aiApiKey: string;
  /** Claude-Modell. */
  aiModel: AiModel;
  /** Gemini-API-Schlüssel aus Google AI Studio für den Direktzugriff aus dem Browser (optional). */
  geminiApiKey: string;
  geminiModel: GeminiModel;
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
      aiProvider: 'gemini',
      aiApiKey: '',
      aiModel: 'claude-opus-5-5',
      geminiApiKey: '',
      geminiModel: 'gemini-3.8-flash',
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
