import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_PARAMS, type DiscoveryParams, type WishInterpretation } from '../lib/discovery';
import type { ScoredBook } from '../lib/types';

interface DiscoverState {
  params: DiscoveryParams;
  results: ScoredBook[];
  /** Schlüssel der Suche, zu der `results` gehören. */
  resultKey: string;
  page: number;
  total: number;
  wish?: WishInterpretation;
  dismissed: string[];
  setParams: (patch: Partial<DiscoveryParams>) => void;
  replaceParams: (params: DiscoveryParams) => void;
  setResults: (key: string, results: ScoredBook[], total: number, page: number, wish?: WishInterpretation) => void;
  dismiss: (id: string) => void;
  reset: () => void;
}

export const useDiscover = create<DiscoverState>()(
  persist(
    (set, get) => ({
      params: DEFAULT_PARAMS,
      results: [],
      resultKey: '',
      page: 0,
      total: 0,
      dismissed: [],
      setParams: (patch) => set({ params: { ...get().params, ...patch } }),
      replaceParams: (params) => set({ params }),
      setResults: (resultKey, results, total, page, wish) => set({ resultKey, results, total, page, wish }),
      dismiss: (id) => set({ dismissed: [...get().dismissed, id].slice(-300) }),
      reset: () => set({ params: { ...DEFAULT_PARAMS, language: get().params.language }, results: [], resultKey: '', page: 0, total: 0, wish: undefined }),
    }),
    {
      name: 'lesekompass.discover',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ params: s.params, dismissed: s.dismissed }),
    },
  ),
);
