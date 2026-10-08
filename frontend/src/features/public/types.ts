/**
 * Public form contract: GET /public/form-config, POST /public/booking-request
 * and GET /public/requests/:id?token= (docs/handoff/backend-v2-misc.md §6).
 */

export interface FormConfig {
  intro: string | null;
  group_types: { code: string; label: string }[];
  /** max(today + 1, season.start) */
  min_date: string;
  /** season.end; null when no season is configured */
  max_date: string | null;
  /** Python weekday numbers, 0 = Monday. */
  closed_weekdays: number[];
  avoid_weekdays: number[];
  closed_days: string[];
  peak_days: string[];
  max_questions: number;
  min_group_size: number;
  max_group_size: number;
  max_gazebos: number;
  /** Half-hour slots plus "Not sure yet"; the select's options verbatim. */
  arrival_slots: string[];
  acknowledgement_enabled: boolean;
  turnstile_site_key: string | null;
  park: { name: string | null; phone: string | null; website: string | null; email: string | null };
}

/** The JSON body of POST /public/booking-request. */
export interface BookingRequestInput {
  visit_date: string;
  alternative_date?: string;
  visitors: number;
  arrival_time?: string;
  group_name: string;
  group_type: string;
  area?: string;
  vehicles?: number;
  gazebos?: number;
  questions: string[];
  customer_notes?: string;
  contact_name: string;
  contact_email: string;
  contact_mobile: string;
  policy_accepted: true;
  /** Honeypot — always empty. */
  website: string;
  turnstile_token?: string;
}

/** What the confirmation page may show: no phone, no prices, no notes. */
export interface RequestSummary {
  id: number;
  reference: string;
  group_name: string;
  visit_date: string;
  contact_email: string;
  visitors: number;
  /** True when an acknowledgement email was sent (Settings toggle on). */
  acknowledged: boolean;
  submitted_at: string | null;
}

/** 201 from the POST: the summary plus the signed receipt token. */
export interface BookingRequestResult extends RequestSummary {
  /** Null only when the server has no signing secret. */
  token: string | null;
}
