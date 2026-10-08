/**
 * GET /queue and POST /reminders/:id/dismiss.
 *
 * Dismissal is optimistic: the reminder leaves its group immediately and the
 * counts drop; on error the previous queue is restored and the toast from the
 * mutation cache explains why.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

import type { DismissedReminder, QueueResponse } from "./types";

export const queueKey = ["queue"] as const;

export function useQueue() {
  return useQuery({
    queryKey: queueKey,
    queryFn: () => api.get<QueueResponse>("/queue"),
    refetchInterval: 120_000,
  });
}

function withoutReminder(queue: QueueResponse, reminderId: number): QueueResponse {
  let removed = 0;
  const sections = queue.sections.map((section) => {
    if (section.key !== "reminders_due") return section;
    const groups = section.items
      .map((group) => {
        const items = group.items.filter((item) => item.reminder_id !== reminderId);
        removed += group.items.length - items.length;
        return { ...group, items, count: items.length };
      })
      .filter((group) => group.items.length > 0);
    return { ...section, items: groups, count: Math.max(0, section.count - removed) };
  });
  return { ...queue, sections, total: Math.max(0, queue.total - removed) };
}

export function useDismissReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: number) => api.post<{ reminder: DismissedReminder }>(`/reminders/${reminderId}/dismiss`),
    meta: { successMessage: "Reminder dismissed" },
    onMutate: async (reminderId) => {
      await qc.cancelQueries({ queryKey: queueKey });
      const previous = qc.getQueryData<QueueResponse>(queueKey);
      if (previous) qc.setQueryData<QueueResponse>(queueKey, withoutReminder(previous, reminderId));
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) qc.setQueryData(queueKey, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queueKey });
      void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}
