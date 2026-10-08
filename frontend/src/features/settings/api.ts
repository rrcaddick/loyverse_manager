/**
 * Settings queries and mutations (admin only).
 *   const { data } = useSettings();          // ["settings"] → SettingsResponse
 *   const save = useUpdateSection("season"); // PUT /settings/season
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import type { PriceTier, SeasonDay, Settings, SettingsResponse, SettingsSection } from "@/types/api";

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<SettingsResponse>("/settings"),
    staleTime: 60_000,
  });
}

export function useUpdateSection<S extends SettingsSection>(section: S) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Settings[S]>) => api.put<{ settings: Settings }>(`/settings/${section}`, data),
    meta: { silent: true },
    onSuccess: ({ settings }) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (current) => (current ? { ...current, settings } : current));
    },
  });
}

export type PriceTierInput = Omit<PriceTier, "id">;

export function useReplacePriceTiers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: PriceTierInput[]) => api.put<{ price_tiers: PriceTier[] }>("/settings/price-tiers", { items }),
    meta: { silent: true },
    onSuccess: ({ price_tiers }) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (current) =>
        current ? { ...current, price_tiers } : current,
      );
    },
  });
}

export function useReplaceSeasonDays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: SeasonDay[]) => api.put<{ season_days: SeasonDay[] }>("/settings/season-days", { items }),
    meta: { silent: true },
    onSuccess: ({ season_days }) => {
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (current) =>
        current ? { ...current, season_days } : current,
      );
    },
  });
}

/** Deposit rule from docs §5, mirrored for the live example on the pricing tab. */
export function depositFor(people: number, price: number, minPeople: number, percent: number): number {
  if (!Number.isFinite(people) || !Number.isFinite(price) || people <= 0 || price <= 0) return 0;
  const total = people * price;
  const byMin = minPeople * price;
  const byPercent = Math.round((people * percent) / 100) * price;
  return Math.min(total, Math.max(byMin, byPercent));
}
