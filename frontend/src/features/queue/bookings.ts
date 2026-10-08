/**
 * The slice of the bookings API that the queue, inbox and payments pages need:
 * a search for pickers, the send actions fired from the queue, PATCH for
 * "extend hold" and POST for "create booking from this email".
 *
 * The bookings pages own the full detail shape; these types are the subset
 * read here, named after the list-item fields in docs/handoff/bookings.md.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { BookingStatus, Paginated } from "@/types/api";

/** The `booking` object every queue item carries. */
export interface BookingSummary {
  id: number;
  reference: string;
  group_name: string;
  contact_name: string | null;
  visit_date: string;
  status: BookingStatus;
  people_booked: number;
}

/** GET /bookings list item (subset). */
export interface BookingListItem extends BookingSummary {
  group_type: string | null;
  area: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
  arrival_time: string | null;
  adults: number;
  children: number;
  vehicles: number;
  gazebos: number;
  price_per_person: number;
  deposit_due: number;
  deposit_waived: boolean;
  deposit_covered: boolean;
  paid_total: number;
  total_amount: number;
  balance_due: number;
  hold_expires_on: string | null;
  proforma_sent_at: string | null;
  ticket_sent_at: string | null;
  ticket_emailed_at: string | null;
  status_label: string;
  source: string;
  created_at: string;
}

export interface BookingDocument {
  id: number;
  booking_id: number;
  kind: string;
  number: string | null;
  version: number;
  total: number | null;
  issued_at: string;
  label: string;
  filename: string;
}

/** GET /bookings/:id and every action response (subset). */
export interface BookingDetail extends BookingListItem {
  allowed_transitions: BookingStatus[];
  documents: BookingDocument[];
  finance: {
    total_amount: number;
    deposit_due: number;
    deposit_waived: boolean;
    paid_total: number;
    balance_due: number;
    deposit_covered: boolean;
  };
  action?: string;
  action_result?: Record<string, unknown>;
}

export type BookingAction =
  | "send-acknowledgement"
  | "send-proforma"
  | "send-invoice"
  | "send-ticket-email"
  | "send-ticket-whatsapp"
  | "send-reminder"
  | "send-expiry"
  | "send-answers"
  | "confirm";

export type ReminderKind = "still_interested" | "deposit_reminder" | "final_details" | "lapse";

/** Live search for pickers: reference, group, contact, email, mobile, area. */
export function useBookingSearch(q: string, options: { status?: string; pageSize?: number; enabled?: boolean } = {}) {
  const trimmed = q.trim();
  const params = { q: trimmed, status: options.status, page_size: options.pageSize ?? 8, sort: "-updated_at" };
  return useQuery({
    queryKey: ["bookings", "list", params],
    queryFn: () => api.get<Paginated<BookingListItem>>("/bookings", { params }),
    enabled: (options.enabled ?? true) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useBookingDetail(id: number | null) {
  return useQuery({
    queryKey: ["bookings", id],
    queryFn: () => api.get<BookingDetail>(`/bookings/${id}`),
    enabled: id !== null,
  });
}

function useSettleBooking() {
  const qc = useQueryClient();
  return (detail: BookingDetail | undefined, id: number) => {
    if (detail) qc.setQueryData(["bookings", id], detail);
    void qc.invalidateQueries({ queryKey: ["bookings", "list"] });
    void qc.invalidateQueries({ queryKey: ["bookings", id] });
    void qc.invalidateQueries({ queryKey: ["queue"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
  };
}

export interface BookingActionInput {
  id: number;
  action: BookingAction;
  body?: Record<string, unknown>;
}

/** POST /bookings/:id/actions/<action>. Errors toast via the mutation cache. */
export function useBookingAction() {
  const settle = useSettleBooking();
  return useMutation({
    mutationFn: ({ id, action, body }: BookingActionInput) => api.post<BookingDetail>(`/bookings/${id}/actions/${action}`, body ?? {}),
    onSuccess: (detail, { id }) => settle(detail, id),
  });
}

/** PATCH /bookings/:id with any accepted booking fields. */
export function useUpdateBooking() {
  const settle = useSettleBooking();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & Record<string, unknown>) => api.patch<BookingDetail>(`/bookings/${id}`, data),
    onSuccess: (detail, { id }) => settle(detail, id),
  });
}

/** POST /bookings (silent: the form shows field errors inline). */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<BookingDetail>("/bookings", data),
    meta: { silent: true },
    onSuccess: (detail) => {
      qc.setQueryData(["bookings", detail.id], detail);
      void qc.invalidateQueries({ queryKey: ["bookings", "list"] });
      void qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

/** "Sat 14 Nov 2026" — weekday-prefixed date used wherever a visit date is shown. */
export function visitDateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}
