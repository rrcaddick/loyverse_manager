/**
 * Types for the /api/v1 contract (docs/booking-system.md §6).
 * Keep these in step with web/api/*.py. Money arrives as numbers with 2dp.
 */

export type Role = "admin" | "manager";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  must_change_password: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Session {
  user: User;
  csrf_token: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------- settings

/** Python weekday numbers: 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SeasonSettings {
  start: string; // YYYY-MM-DD
  end: string;
  closed_weekdays: number[];
  avoid_weekdays: number[];
  no_discount_start: string; // MM-DD
  no_discount_end: string;
}

export interface PricingSettings {
  public_weekend_price: number;
  peak_price: number;
  vat_rate: number;
}

export interface DepositSettings {
  min_people: number;
  percent: number;
}

export interface DocumentsSettings {
  next_number: number;
  proforma_prefix: string;
  invoice_prefix: string;
  company_name: string;
  trading_name: string;
  address_line1: string;
  address_line2: string;
  company_reg: string;
  vat_no: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_type: string;
  bank_account_number: string;
  bank_branch_code: string;
  pop_email: string;
  payment_terms: string;
}

export interface RemindersSettings {
  still_interested_days: number;
  deposit_reminder_days_before: number;
  final_details_days_before: number;
  lapse_days_before: number;
}

export interface CapacitySettings {
  daily_warning_people: number;
}

export interface EmailSettings {
  sender_name: string;
  signature_name: string;
  signature_title: string;
  signature_company: string;
  phone: string;
  website: string;
  bounce_back_enabled: boolean;
  review_window_days: number;
}

export interface GroupType {
  code: string;
  label: string;
  weekday_tier: string;
  weekend_tier: string;
}

export interface FormSettings {
  group_types: GroupType[];
  max_questions: number;
  min_group_size: number;
  intro: string;
}

export interface Settings {
  season: SeasonSettings;
  pricing: PricingSettings;
  deposit: DepositSettings;
  documents: DocumentsSettings;
  reminders: RemindersSettings;
  capacity: CapacitySettings;
  email: EmailSettings;
  form: FormSettings;
}

export type SettingsSection = keyof Settings;

export type DayType = "weekday" | "weekend";

export interface PriceTier {
  id?: number;
  code: string;
  label: string;
  day_type: DayType;
  price: number;
  min_group_size: number;
  notes: string | null;
  sort_order: number;
  is_active: boolean;
}

export type SeasonDayKind = "closed" | "peak" | "open";

export interface SeasonDay {
  day: string; // YYYY-MM-DD
  kind: SeasonDayKind;
  label: string | null;
}

export interface SettingsResponse {
  settings: Settings;
  price_tiers: PriceTier[];
  season_days: SeasonDay[];
}

// -------------------------------------------------------------------- ops

/** GET /ops/status (web/api/ops.py). */
export interface OpsMailFolder {
  folder: string;
  uidvalidity: number | null;
  last_uid: number | null;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface OpsBankPoll {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  window_from: string | null;
  window_to: string | null;
  entries: number | null;
  new_entries: number | null;
  status: string | null;
  error: string | null;
}

export interface OpsImportRun {
  id: number;
  kind: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  summary: Record<string, unknown> | string | null;
}

export interface OpsStatus {
  server_time: string;
  today: string;
  mail: { folders: OpsMailFolder[]; pending_review: number };
  bank: { last_poll: OpsBankPoll | null; suggested: number };
  reminders: { due_count: number; due_total: number; sent: number; dismissed: number };
  bookings: { counts: Partial<Record<BookingStatus, number>>; total: number };
  imports: { last_run: OpsImportRun | null };
  scheduler: { add_inventory_cron: string; clear_inventory_cron: string; profile_enabled: boolean; timezone: string };
  /** Names accepted by POST /ops/run. */
  jobs: string[];
}

export interface OpsRunResult {
  ok: boolean;
  name: string;
  duration_ms: number;
  summary?: string | number | boolean | Record<string, unknown> | unknown[] | null;
  error?: string | null;
}

export interface OpsLogs {
  path: string;
  lines: string[];
  count: number;
  requested: number;
}

// --------------------------------------------------------------- bookings

/** Booking lifecycle (docs §5). Used by StatusBadge and the pages to come. */
export type BookingStatus =
  | "enquiry"
  | "proforma_sent"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "lapsed"
  | "no_show";

export const BOOKING_STATUSES: BookingStatus[] = [
  "enquiry",
  "proforma_sent",
  "confirmed",
  "completed",
  "cancelled",
  "lapsed",
  "no_show",
];
