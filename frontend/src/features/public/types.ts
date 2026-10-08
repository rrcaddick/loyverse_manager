/** GET /public/form-config and POST /public/booking-request (docs/handoff/ops.md). */

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
  turnstile_site_key: string | null;
  park: { name: string | null; phone: string | null; website: string | null; email: string | null };
}

export interface BookingRequestInput {
  group_name: string;
  group_type: string;
  area?: string;
  contact_name: string;
  contact_email: string;
  contact_mobile: string;
  visit_date: string;
  alternative_date?: string;
  arrival_time?: string;
  adults: number;
  children: number;
  vehicles?: number;
  gazebos?: number;
  questions: string[];
  customer_notes?: string;
  policy_accepted: boolean;
  /** Honeypot — always empty. */
  website: string;
  turnstile_token?: string;
}

export interface BookingRequestResult {
  reference: string;
  group_name: string;
  visit_date: string;
  contact_email: string;
}

/** What RequestPage hands to RequestSentPage through router state. */
export interface RequestSentState extends BookingRequestResult {
  park: FormConfig["park"];
}
